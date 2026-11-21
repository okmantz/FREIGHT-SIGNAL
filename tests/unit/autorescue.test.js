import test from 'node:test';
import assert from 'node:assert/strict';
import { realZipMap } from './helpers.js';
import { blankPosting } from '../../js/core/model.js';
import { makeTruck } from '../../js/core/truckbook.js';
import { reconcileMatches, matchStats, matchesForLoad } from '../../js/core/matching.js';
import { newRescue, stageAt, dueStages, planStage, canContact, contactLedger, keyOfEmail, proposeRate, shouldAutoStart, signatureOf, STAGES } from '../../js/core/autorescue.js';

const NOW = new Date(2026, 10, 20, 10, 0).getTime();
const zip = realZipMap();
const mkLoad = (o = {}) => blankPosting({ id: 'L1', variant: 'Original', originCity: 'Harrisburg', originState: 'PA', originZip: '17101', destCity: 'Richmond', destState: 'VA', destZip: '23219', pickupEarliest: '2026-11-21', equip: 'V', targetRate: '900', status: 'Active', ...o });
const truck = (o = {}) => makeTruck({ carrierName: 'Keystone Haul', email: 'dispatch@keystone.example', phone: '717-555-0100', oCity: 'Harrisburg', oState: 'PA', equip: 'V', date: '2026-11-21', ...o }, { now: NOW, zipMap: zip });
const carrier = (o = {}) => ({ id: 'c1', carrierName: 'Old Dominion Van', email: 'ops@odv.example', phone: '804-555-0100', originCity: 'Harrisburg', originState: 'PA', destCity: 'Richmond', destState: 'VA', equipment: 'V', status: 'Active', ...o });

test('two-way matching: a new load finds the trucks already on file', () => {
  const l = mkLoad(); const t = truck();
  const r = reconcileMatches({ existing: [], loads: [l], trucks: [t], zipMap: zip, now: NOW, newLoadIds: new Set([l.id]) });
  assert.equal(r.matches.length, 1); assert.equal(r.matches[0].via, 'load'); assert.equal(r.added.length, 1);
  assert.equal(matchesForLoad(r.matches, l.id)[0].carrierName, 'Keystone Haul');
});

test('two-way matching: a newly reported truck finds the open loads, and covered loads are ignored', () => {
  const open = mkLoad(); const covered = mkLoad({ id: 'L2', status: 'Covered' }); const t = truck();
  const r = reconcileMatches({ existing: [], loads: [open, covered], trucks: [t], zipMap: zip, now: NOW, newTruckKeys: new Set([t.key]) });
  assert.equal(r.matches.length, 1); assert.equal(r.matches[0].via, 'truck'); assert.equal(r.newTrucks.length, 1); assert.equal(r.newTrucks[0].loads[0].loadId, 'L1');
});

test('matching is stable: the second pass adds nothing, and the metric counts qualified matches per load', () => {
  const l = mkLoad(); const l2 = mkLoad({ id: 'L9', originCity: 'Phoenix', originState: 'AZ', originZip: '85001', destCity: 'Miami', destState: 'FL', destZip: '33101' }); const t = truck();
  const a = reconcileMatches({ existing: [], loads: [l, l2], trucks: [t], zipMap: zip, now: NOW });
  const b = reconcileMatches({ existing: a.matches, loads: [l, l2], trucks: [t], zipMap: zip, now: NOW + 60000 });
  assert.equal(b.added.length, 0); assert.equal(b.matches[0].firstAt, a.matches[0].firstAt);
  const st = matchStats(b.matches, [l, l2]); assert.equal(st.loads, 2); assert.equal(st.withMatch, 1); assert.equal(st.withoutMatch, 1); assert.equal(st.avgPerLoad, 0.5);
});

test('a truck that fades away drops its match, but a contacted match is kept while the load is open', () => {
  const l = mkLoad(); const t = truck();
  const a = reconcileMatches({ existing: [], loads: [l], trucks: [t], zipMap: zip, now: NOW });
  const later = NOW + 3 * 86400000;
  const dropped = reconcileMatches({ existing: a.matches, loads: [l], trucks: [t], zipMap: zip, now: later });
  assert.equal(dropped.matches.length, 0);
  const kept = reconcileMatches({ existing: a.matches.map(m => ({ ...m, status: 'contacted' })), loads: [l], trucks: [t], zipMap: zip, now: later });
  assert.equal(kept.matches.length, 1);
});

test('stages follow the minute marks', () => {
  assert.equal(stageAt(0).id, 'match'); assert.equal(stageAt(6).id, 'wave1'); assert.equal(stageAt(45).id, 'expand'); assert.equal(stageAt(90).id, 'commercial'); assert.equal(stageAt(500).id, 'team');
  const r = newRescue(mkLoad(), { now: NOW });
  assert.deepEqual(dueStages(r, NOW), ['match']);
  assert.deepEqual(dueStages(r, NOW + 7 * 60000), ['match', 'wave1']);
  r.fired.match = NOW; assert.deepEqual(dueStages(r, NOW + 7 * 60000), ['wave1']);
  assert.deepEqual(dueStages({ ...r, status: 'paused' }, NOW + 7e6), []);
  assert.equal(STAGES.length, 5);
});

test('first wave: one offer per carrier even when the carrier is found by several sources', () => {
  const l = mkLoad(); const c = carrier({ email: 'dispatch@keystone.example' }); const t = truck();
  const rescue = newRescue(l, { now: NOW });
  const p = planStage('wave1', rescue, l, { carriers: [c], trucks: [t], coverLog: [], inquiries: [], outreach: [], rescues: [], drafts: [], settings: {}, zipMap: zip, now: NOW });
  const mails = p.drafts.map(d => d.to);
  assert.equal(mails.length, new Set(mails).size); assert.ok(mails.includes('dispatch@keystone.example'));
  assert.match(p.drafts[0].body, /truck open in Harrisburg/);
});

test('frequency cap: a carrier contacted an hour ago, or twice about this load, is skipped', () => {
  const l = mkLoad(); const c = carrier(); const key = keyOfEmail(c.email);
  const recent = [{ email: c.email, dateTime: new Date(NOW - 3600000).toISOString(), postingId: 'OTHER' }];
  const led = contactLedger({ outreach: recent });
  assert.equal(canContact(key, l.id, led, NOW, {}).ok, false);
  assert.match(canContact(key, l.id, led, NOW, {}).why, /minimum gap/);
  const old = contactLedger({ outreach: [{ email: c.email, dateTime: new Date(NOW - 20 * 3600000).toISOString(), postingId: 'OTHER' }] });
  assert.equal(canContact(key, l.id, old, NOW, {}).ok, true);
  const twice = contactLedger({ outreach: [1, 2].map(i => ({ email: c.email, dateTime: new Date(NOW - (30 + i) * 3600000).toISOString(), postingId: l.id })) });
  assert.equal(canContact(key, l.id, twice, NOW, {}).ok, false);
  const p = planStage('wave1', newRescue(l, { now: NOW }), l, { carriers: [c], trucks: [], coverLog: [], inquiries: [], outreach: recent, rescues: [], drafts: [], settings: {}, zipMap: zip, now: NOW });
  assert.equal(p.drafts.length, 0); assert.ok(p.skipped.some(s => /minimum gap/.test(s.why)));
});

test('commercial step raises the rate only within the authorised limit', () => {
  const l = mkLoad({ targetRate: '900' });
  const none = proposeRate(l, { zipMap: zip, settings: {}, now: NOW, coverLog: [], inquiries: [] }, newRescue(l, { now: NOW }));
  assert.equal(none.raise, false); assert.match(none.reason, /No raise authorised/);
  const r = newRescue(l, { now: NOW, maxRate: 1000 });
  const up = proposeRate(l, { zipMap: zip, settings: {}, now: NOW, coverLog: [], inquiries: [] }, r);
  assert.equal(up.raise, true); assert.ok(up.rate > 900 && up.rate <= 1000);
  const capped = proposeRate(l, { zipMap: zip, settings: {}, now: NOW, coverLog: [], inquiries: [] }, { ...r, offerRate: 1000 });
  assert.equal(capped.raise, false); assert.equal(capped.capped, true);
  const p = planStage('commercial', r, l, { carriers: [carrier()], trucks: [], coverLog: [], inquiries: [], outreach: [], rescues: [], drafts: [], settings: {}, zipMap: zip, now: NOW });
  assert.ok(p.raise && p.raise.rate <= 1000); assert.match(p.drafts[0].body, /\$9\d\d|\$1,000/);
});

test('updated offers go only to carriers already written to who have not answered', () => {
  const l = mkLoad(); const c = carrier(); const key = keyOfEmail(c.email);
  const r = newRescue(l, { now: NOW, maxRate: 1100 }); r.contacts[key] = [{ at: NOW - 70 * 3600000 / 60, rate: 900 }];
  const base = { carriers: [c], trucks: [], coverLog: [], inquiries: [], outreach: [], rescues: [], drafts: [], settings: {}, zipMap: zip, now: NOW };
  const a = planStage('commercial', r, l, base);
  assert.equal(a.drafts.length, 1); assert.match(a.drafts[0].subject, /^Updated rate/);
  const b = planStage('commercial', r, l, { ...base, inquiries: [{ postingId: l.id, senderEmail: c.email }] });
  assert.equal(b.drafts.length, 0);
});

test('hard lanes with no replies start by themselves; easy lanes and answered loads do not', () => {
  const posted = (mins) => [{ type: 'posted', at: new Date(NOW - mins * 60000).toISOString() }];
  const hard = mkLoad({ destState: 'FL', destCity: 'Miami', destZip: '33101', ops: posted(45) });
  assert.equal(shouldAutoStart(hard, { zipMap: zip, settings: {}, now: NOW }).start, true);
  assert.equal(shouldAutoStart({ ...hard, ops: posted(10) }, { zipMap: zip, settings: {}, now: NOW }).start, false);
  assert.equal(shouldAutoStart({ ...hard, inquiryCount: 2 }, { zipMap: zip, settings: {}, now: NOW }).start, false);
  assert.equal(shouldAutoStart(hard, { zipMap: zip, settings: { autoEscalateHard: false }, now: NOW }).start, false);
  const easy = mkLoad({ originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Atlanta', destState: 'GA', destZip: '30303', ops: posted(90) });
  assert.equal(shouldAutoStart(easy, { zipMap: zip, settings: {}, now: NOW }).start, false);
});

test('the signature changes when a new truck appears, which triggers another matching cycle', () => {
  const l = mkLoad(); const base = { trucks: [], inquiries: [], zipMap: zip, now: NOW };
  const a = signatureOf(l, base); const b = signatureOf(l, { ...base, trucks: [truck()] });
  assert.notEqual(a, b); assert.equal(signatureOf(l, { ...base, trucks: [truck()] }), b);
});
