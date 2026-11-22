import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAssignment, matchAssignments, assignmentDraft, recordOutcome, fit } from '../../js/core/assignments.js';
import { scoreLoad, buildPlan, learnApproaches, approachesFromOps, makeApproachRecord, levelOf } from '../../js/core/difficulty.js';
import { rateIntel, competitiveness, openingPlan } from '../../js/core/rateintel.js';
import { matchCarriers } from '../../js/core/networkmatch.js';
import { summarize, compare, describe, fxSnapshot } from '../../js/core/performance.js';
import { relation } from '../../js/core/lanematch.js';
import { realZipMap } from './helpers.js';

const zip = realZipMap();
const NOW = Date.parse('2026-11-20T15:00:00');
const day = (n) => new Date(NOW - n * 86400000).toISOString();
const L = (oc, os, dc, ds, extra = {}) => ({ originCity: oc, originState: os, destCity: dc, destState: ds, equip: 'V', ...extra });
const cover = (lane, rate, hrs, extra = {}) => ({ id: 'e' + Math.random(), outcome: 'Covered', closedAt: day(extra.ago ?? 10), rate, ageHours: hrs, lane, covered: lane, carrier: { name: extra.name || 'Taylord Logistics', email: extra.email || 'dispatch@taylord.example', mc: extra.mc || 'MC 111111' }, targetRate: extra.target || '', postings: [], ...extra.more });

test('lane relation: same, nearby and unrelated lanes', () => {
  assert.equal(relation(L('Aiken', 'SC', 'Fletcher', 'OK'), L('Aiken', 'SC', 'Fletcher', 'OK'), { zipMap: zip }).kind, 'same');
  assert.equal(relation(L('Aiken', 'SC', 'Fletcher', 'OK'), L('Augusta', 'GA', 'Fletcher', 'OK'), { zipMap: zip }).kind, 'near');
  assert.equal(relation(L('Aiken', 'SC', 'Fletcher', 'OK'), L('Seattle', 'WA', 'Miami', 'FL'), { zipMap: zip }).kind, '');
});

test('assignments: a carrier is set as primary for a lane or a state pair, and the best fit wins', () => {
  const as = [cleanAssignment({ carrierId: 'c1', carrierName: 'Taylord Logistics', email: 'd@taylord.example', mc: 'MC 111111', originState: 'SC', destState: 'GA', priority: 'primary' }),
    cleanAssignment({ carrierId: 'c2', carrierName: 'Whala Transport', email: 'd@whala.example', originCity: 'San Leandro', originState: 'CA', destCity: 'Visalia', destState: 'CA' }),
    cleanAssignment({ carrierId: 'c3', carrierName: 'Backup Co', email: 'b@backup.example', originState: 'SC', destState: 'GA', priority: 'backup' })];
  assert.equal(cleanAssignment({ carrierName: 'x' }), null);
  const carriers = [{ id: 'c1', carrierName: 'Taylord Logistics', email: 'd@taylord.example', phone: '(803) 555-0100' }];
  const a = matchAssignments(L('Columbia', 'SC', 'Savannah', 'GA'), as, carriers, { zipMap: zip });
  assert.equal(a[0].name, 'Taylord Logistics'); assert.equal(a[0].phone, '(803) 555-0100'); assert.equal(a[1].name, 'Backup Co');
  const w = matchAssignments(L('San Leandro', 'CA', 'Visalia', 'CA'), as, [], { zipMap: zip }); assert.equal(w[0].name, 'Whala Transport'); assert.ok(fit(L('San Leandro', 'CA', 'Visalia', 'CA'), as[1], { zipMap: zip }) === 100);
  assert.equal(matchAssignments(L('Dallas', 'TX', 'Austin', 'TX'), as, [], { zipMap: zip }).length, 0);
  const d = assignmentDraft(L('Columbia', 'SC', 'Savannah', 'GA', { pickupEarliest: '2026-11-21' }), a[0], { rate: 900 });
  assert.match(d.subject, /Columbia, SC to Savannah, GA/); assert.match(d.body, /\$900/); assert.match(d.body, /driver and dispatch/i); assert.match(d.script, /803/);
  const r = recordOutcome(as[0], { won: true }); assert.equal(r.hits, 1); assert.equal(r.wins, 1);
  assert.equal(matchAssignments(L('Columbia', 'SC', 'Savannah', 'GA'), [{ ...as[0], active: false }], [], {}).length, 0);
});

test('rate intelligence: average quote, average cover, negotiation, lowest and fastest, with confidence from count and age', () => {
  const lane = L('Aiken', 'SC', 'Fletcher', 'OK');
  const log = [cover(lane, 2300, 4, { ago: 5 }), cover(lane, 2200, 1.5, { ago: 20 }), cover(lane, 2500, 9, { ago: 40 }), cover(L('Augusta', 'GA', 'Fletcher', 'OK'), 2400, 6, { ago: 15 })];
  const history = [{ lane, booked: true, finalRate: 2200, firstQuote: 2500, rateConf: 'high', bookedAt: NOW - 3 * 86400000, quotes: [{ at: NOW - 3 * 86400000, rate: 2500 }] }];
  const i = rateIntel(lane, { coverLog: log, inquiries: [{ originCity: 'Aiken', originState: 'SC', destCity: 'Fletcher', destState: 'OK', lastCarrierRate: 2600, dateCounted: day(4), stage: 'AGREED' }], history, zipMap: zip, now: NOW });
  assert.ok(i.covers.n >= 4); assert.equal(i.covers.lowestSuccessful, 2200); assert.deepEqual(i.fastest, { rate: 2200, hours: 1.5 });
  assert.equal(i.negotiation.avgDrop, 300); assert.ok(i.quotes.avg > 2400); assert.ok(['medium', 'high'].includes(i.confidence));
  const none = rateIntel(lane, { zipMap: zip, now: NOW }); assert.equal(none.confidence, 'none'); assert.equal(none.n, 0);
  assert.equal(competitiveness(1800, i).verdict, 'low'); assert.equal(competitiveness(i.covers.avg, i).verdict, 'fair'); assert.equal(competitiveness(3200, i).verdict, 'high');
  const o = openingPlan(i, {}); assert.ok(o.open <= o.expected && o.expected <= o.walkAway);
  const old = rateIntel(lane, { coverLog: [cover(lane, 2000, 3, { ago: 400 })], zipMap: zip, now: NOW }); assert.ok(old.confidenceScore < i.confidenceScore);
});

test('difficulty: a poor-outbound, far, short-notice, under-priced load scores hard; an easy lane scores easy; unknown factors are left out', () => {
  const easy = scoreLoad(L('Atlanta', 'GA', 'Dallas', 'TX', { pickupEarliest: new Date(NOW + 3 * 86400000).toISOString().slice(0, 10), targetRate: '2000' }), { coverLog: Array.from({ length: 12 }, (_, i) => cover(L('Atlanta', 'GA', 'Dallas', 'TX'), 2000, 1.5, { ago: 3 + i })), zipMap: zip, now: NOW });
  const hard = scoreLoad(L('Bangor', 'ME', 'Miami', 'FL', { pickupEarliest: new Date(NOW + 3 * 3600000).toISOString(), targetRate: '900', equip: 'F' }), { coverLog: [cover(L('Bangor', 'ME', 'Miami', 'FL'), 2500, 30, { ago: 9 }), cover(L('Bangor', 'ME', 'Miami', 'FL'), 2600, 26, { ago: 30 })], zipMap: zip, now: NOW });
  assert.ok(easy.score < 40, 'easy ' + easy.score); assert.ok(hard.score >= 60, 'hard ' + hard.score);
  assert.ok(hard.tags.includes('thin-dest') && hard.tags.includes('short-lead') && hard.tags.includes('low-rate'));
  const blank = scoreLoad(L('Bangor', 'ME', 'Miami', 'FL'), { zipMap: null, now: NOW });
  assert.ok(blank.factors.some(f => f.score === null)); assert.ok(blank.confidence < 100);
  assert.equal(levelOf(10), 'easy'); assert.equal(levelOf(95), 'very hard');
});

test('the plan changes with the reasons, puts the primary first, and quotes what has worked on similar hard loads', () => {
  const hardLoad = L('Bangor', 'ME', 'Miami', 'FL', { pickupEarliest: new Date(NOW + 3 * 3600000).toISOString(), targetRate: '900' });
  const diff = scoreLoad(hardLoad, { coverLog: [cover(L('Bangor', 'ME', 'Miami', 'FL'), 2500, 30, { ago: 9 }), cover(L('Bangor', 'ME', 'Miami', 'FL'), 2600, 26, { ago: 30 })], zipMap: zip, now: NOW });
  const recs = [1, 2, 3, 4, 5, 6].map(i => ({ id: 'r' + i, outcome: i <= 5 ? 'Covered' : 'Expired', score: 80, tags: ['thin-dest', 'short-lead'], tried: i === 6 ? ['wider-radius'] : ['call-first'], hours: 3 }));
  const learned = learnApproaches(recs, diff.tags);
  assert.equal(learned['call-first'].rate, 100); assert.equal(learned['call-first'].medianHours, 3); assert.equal(learned['wider-radius'].enough, false);
  const plan = buildPlan(diff, { load: hardLoad, assignMatches: [{ name: 'Taylord', priority: 'primary', wins: 2, originState: 'ME', destState: 'FL' }], carriersTop: [{ name: 'X', email: 'x@x.example', why: ['Covered this lane'] }], learned, intel: diff.intel });
  assert.equal(plan[0].key, 'primary'); assert.ok(plan.some(a => a.key === 'call-first' && /covered 5/.test(a.evidence))); assert.ok(plan.some(a => a.key === 'raise-rate'));
  assert.deepEqual(approachesFromOps([{ type: 'call' }, { type: 'reprice' }, { type: 'posted' }, { type: 'call' }]), ['call-first', 'raise-rate']);
  const rec = makeApproachRecord({ id: 'x', entry: { closedAt: day(0), outcome: 'Covered', lane: hardLoad, ageHours: 2.25, rate: 1200 }, diff, ops: [{ type: 'call' }], coveredVia: 'history' });
  assert.equal(rec.hours, 2.3 > 2.25 ? 2.3 : 2.2); assert.deepEqual(rec.tried, ['call-first']);
});

test('carrier matching ranks by what actually happened, not by distance', () => {
  const load = L('Aiken', 'SC', 'Fletcher', 'OK');
  const log = [cover(load, 2300, 3, { name: 'Lane Runner', email: 'a@lane.example', mc: 'MC 222222', ago: 8 }), cover(load, 2350, 4, { name: 'Lane Runner', email: 'a@lane.example', mc: 'MC 222222', ago: 20 }), cover(L('Augusta', 'GA', 'Fletcher', 'OK'), 2400, 5, { name: 'Nearby Lane', email: 'n@near.example', mc: 'MC 333333', ago: 12 })];
  const trucks = [{ id: 't1', carrierName: 'Parked Next Door', email: 'p@next.example', mc: 'MC 444444', equip: 'V', oCity: 'Aiken', oState: 'SC', status: 'open', at: NOW - 3600000 }];
  const m = matchCarriers(load, { coverLog: log, trucks, zipMap: zip, now: NOW, assignMatches: [{ name: 'Taylord', email: 't@taylord.example', mc: 'MC 111111', priority: 'primary', fit: 100 }] });
  const order = m.map(x => x.name);
  assert.equal(order[0], 'Taylord'); assert.ok(order.indexOf('Lane Runner') < order.indexOf('Parked Next Door'), order.join()); assert.ok(order.indexOf('Lane Runner') < order.indexOf('Nearby Lane'));
  assert.ok(m.find(x => x.name === 'Lane Runner').why.some(w => /exact lane/i.test(w))); assert.ok(m.find(x => x.name === 'Parked Next Door').signals.board > 0);
  const declined = matchCarriers(load, { coverLog: log, inquiries: [{ senderEmail: 'a@lane.example', originCity: 'Aiken', originState: 'SC', destCity: 'Fletcher', destState: 'OK', stage: 'DECLINED', dateCounted: day(2) }], zipMap: zip, now: NOW });
  assert.ok(declined.find(x => x.email === 'a@lane.example').score < m.find(x => x.name === 'Lane Runner').score);
  assert.equal(matchCarriers(load, { coverLog: log, zipMap: zip, now: NOW, exclude: new Set([m.find(x => x.name === 'Lane Runner').key]) }).some(x => x.name === 'Lane Runner'), false);
});

test('performance: the nine numbers, with sample sizes and an honest "not enough data"', () => {
  const mk = (i, o) => ({ id: 'p' + i, outcome: o.outcome || 'Covered', closedAt: day(o.ago ?? 2), ageHours: o.min / 60, rate: o.rate || 1000, targetRate: o.target || 1100, fx: { v: 1, minutes: o.min, calls: o.calls, contacted: o.contacted, historical: o.hist, assisted: !!o.assisted, planShown: true, score: o.score, vsTarget: (o.target || 1100) - (o.rate || 1000), vsPrior: o.prior ?? null }, postings: [] });
  const log = [
    ...[1, 2, 3].map(i => mk(i, { min: 30, calls: 1, contacted: 3, hist: true, assisted: true, score: 20, prior: 60 })),
    ...[4, 5, 6].map(i => mk(i, { min: 120, calls: 4, contacted: 9, hist: false, assisted: false, score: 20, prior: 20 })),
    mk(7, { min: 400, calls: 6, contacted: 14, hist: true, assisted: false, score: 75 }), mk(8, { outcome: 'Expired', min: 600, calls: 8, contacted: 20, score: 80, rate: '' }), mk(9, { outcome: 'Expired', min: 600, calls: 8, contacted: 20, score: 85, rate: '' }),
    { id: 'imp', outcome: 'Covered', imported: true, closedAt: day(1), rate: 2000, ageHours: '', postings: [] },
  ];
  const s = summarize(log, { now: NOW, days: 30 });
  assert.equal(s.covered, 8); assert.equal(s.expired, 2); assert.equal(s.avgCalls, 3); assert.equal(s.avgContacted, 7.1);
  assert.equal(s.pctHistorical, 57); assert.equal(s.pctNew, 43); assert.equal(s.timeSavedMinutes, 160); assert.equal(s.assistedN, 3); assert.equal(s.unassistedN, 4);
  assert.equal(s.marginVsPrior, 40); assert.deepEqual([s.easy.rate, s.hard.rate, s.hard.total], [100, 33, 3]);
  assert.equal(s.timed, 7); assert.ok(!s.enough);
  const empty = summarize([], { now: NOW }); assert.equal(empty.avgMinutes, null); assert.ok(describe(empty).every(r => r.value === ''));
  const c = compare(log, { now: NOW, days: 30 }); assert.equal(c.previous.covered, 0); assert.equal(c.delta.avgMinutes, null);
  assert.ok(describe(s).find(r => r.key === 'saved').value);
});

test('fx snapshot at cover time: historical vs new carrier, calls, contacted, assisted by the suggestion', () => {
  const entry = { outcome: 'Covered', ageHours: 2, rate: 1000, targetRate: 1100 };
  const keyOf = (c) => (c && c.email) || '';
  const fx = fxSnapshot({ entry, ops: [{ type: 'call' }, { type: 'assign-call' }, { type: 'outreach' }], outreach: [{ email: 'a@x.example' }, { email: 'a@x.example' }, { email: 'b@x.example' }], carrier: { email: 'p@x.example' }, dbCarrier: { coverCount: '3' }, logBefore: [], diff: { score: 72, level: 'hard', tags: ['thin-dest'] }, plan: { keys: new Set(['q@x.example']), assignedKeys: new Set(['p@x.example']) }, priorAvgRate: 1150, keyOf });
  assert.deepEqual([fx.minutes, fx.calls, fx.contacted, fx.historical, fx.assistedBy, fx.vsTarget, fx.vsPrior], [120, 2, 2, true, 'primary', 100, 150]);
  const fresh = fxSnapshot({ entry, ops: [], outreach: [], carrier: { email: 'new@x.example' }, dbCarrier: null, logBefore: [], diff: null, plan: null, keyOf });
  assert.equal(fresh.historical, false); assert.equal(fresh.planShown, false); assert.equal(fresh.assisted, false);
});
