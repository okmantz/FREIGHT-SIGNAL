import test from 'node:test';
import assert from 'node:assert/strict';
import { realZipMap } from './helpers.js';
import { suggestRate, autoTarget, raiseHistory } from '../../js/core/raterec.js';
import { consolidateCarriers, duplicateRows, mergePatches, callSheet, identityOf } from '../../js/core/prospects.js';
import { blankPosting } from '../../js/core/model.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';

const zip = realZipMap(); const NOW = new Date(2026, 10, 20, 10).getTime();
const load = (o = {}) => blankPosting({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', equip: 'V', ...o });
const cover = (rate, daysAgo, over = {}) => ({ outcome: 'Covered', rate, closedAt: new Date(NOW - daysAgo * 86400000).toISOString(), lane: { originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA' }, ...over });

test('suggestRate: your own covers win, newer weigh more, and the basis says why', () => {
  const s = suggestRate(load(), { zipMap: zip, now: NOW, coverLog: [cover(1500, 3), cover(1500, 10), cover(1400, 90), cover(1550, 5)] });
  assert.ok(s.rate >= 1450 && s.rate <= 1550, String(s.rate)); assert.equal(s.confidence, 'high'); assert.ok(s.basis.some(b => /recent cover/.test(b)));
  assert.ok(s.low <= s.rate && s.high >= s.rate);
});
test('suggestRate: a fresh typed DAT average is used, an old one counts for less, and the age is shown', () => {
  const fresh = suggestRate(load({ datAvg: 1800, datAvgAt: new Date(NOW - 3600000).toISOString() }), { zipMap: zip, now: NOW });
  assert.equal(fresh.rate, 1800); assert.match(fresh.basis[0], /1 h old|just now/);
  const mixed = suggestRate(load({ datAvg: 1800, datAvgAt: new Date(NOW - 20 * 86400000).toISOString() }), { zipMap: zip, now: NOW, coverLog: [cover(1500, 2), cover(1500, 4)] });
  assert.ok(mixed.rate < 1700);
});
test('suggestRate: no data -> low-confidence per-mile fallback that says so; no ZIPs and no data -> nothing', () => {
  const f = suggestRate(load(), { zipMap: zip, now: NOW }); assert.equal(f.confidence, 'low'); assert.ok(f.rate > 800 && f.rate < 2200); assert.ok(f.basis.some(b => /per-mile table/.test(b)));
  assert.equal(suggestRate(load(), { zipMap: null, now: NOW }).confidence, 'none');
});
test('suggestRate: hard lanes get a premium unless your own covers already prove the number', () => {
  const hard = load({ originCity: 'Phoenix', originState: 'AZ', destCity: 'Miami', destState: 'FL', datAvg: 3000, datAvgAt: new Date(NOW).toISOString() });
  const s = suggestRate(hard, { zipMap: zip, now: NOW }); assert.ok(s.rate > 3000); assert.ok(s.premium > 0.08);
  const proven = suggestRate(hard, { zipMap: zip, now: NOW, coverLog: [3, 5, 8].map(d => cover(3100, d, { lane: { originCity: 'Phoenix', originState: 'AZ', destCity: 'Miami', destState: 'FL' } })) });
  assert.ok(proven.premium < 0.01);
});
test('autoTarget never overwrites a typed target; raiseHistory needs 3 covers', () => {
  assert.equal(autoTarget(load({ targetRate: 1500 }), { zipMap: zip, now: NOW }), null);
  assert.ok(autoTarget(load(), { zipMap: zip, now: NOW }).rate > 0);
  assert.equal(raiseHistory([cover(1500, 1)]), null);
  assert.equal(raiseHistory([1, 2, 3].map(i => ({ ...cover(1600, i), targetRate: 1500 }))).medianPct, 6.7);
});

const rows = [
  { id: '1', carrierName: 'ACME', mc: 'MC 123456', email: '', phone: '312-555-0147', originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA' },
  { id: '2', carrierName: 'ACME TRUCKING', mc: '123456', email: 'acme@x.com', phone: '', originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', equipment: 'Van' },
  { id: '3', carrierName: 'ACME', mc: '123456', email: 'acme@x.com', phone: '312-555-0147', originCity: 'Joliet', originState: 'IL', destCity: '', destState: '' },
  { id: '4', carrierName: 'Beta', email: 'b@x.com', phone: '717-555-0100', originCity: 'Harrisburg', originState: 'PA', destCity: 'Richmond', destState: 'VA' },
];
test('consolidateCarriers folds per-lane rows into one profile; duplicateRows finds only exact duplicates; mergePatches fills the blanks', () => {
  assert.equal(identityOf(rows[0]), identityOf(rows[1]));
  const p = consolidateCarriers(rows); assert.equal(p.length, 2); const acme = p.find(x => x.mc.includes('123456')); assert.equal(acme.rows, 3); assert.equal(acme.lanes.length, 2); assert.equal(acme.email, 'acme@x.com');
  const d = duplicateRows(rows); assert.equal(d.drop.length, 1); assert.equal(d.groups, 1); assert.ok(!d.drop.includes('3'));
  const m = mergePatches(rows); assert.equal(m.length, 1); assert.equal(m[0].patch.phone || m[0].patch.email || m[0].patch.equipment ? true : false, true);
});
test('callSheet: one row per carrier with a phone, best load for them, recently contacted ones pushed down', () => {
  const pava = load({ originCity: 'Harrisburg', originState: 'PA', destCity: 'Richmond', destState: 'VA', createdAt: new Date(NOW - 30 * 3600000).toISOString(), pickupEarliest: '2026-11-20' });
  const chi = load({ createdAt: new Date(NOW - 1 * 3600000).toISOString(), pickupEarliest: '2026-11-25' });
  const sheet = callSheet([pava, chi], rows, { zip, zipMap: zip, settings: DEFAULT_SETTINGS, now: new Date(NOW), inquiries: [], coverLog: [] });
  assert.ok(sheet.length >= 2); assert.equal(new Set(sheet.map(r => r.key)).size, sheet.length);
  const beta = sheet.find(r => r.carrier.carrierName === 'Beta'); assert.equal(beta.load, pava); assert.match(beta.urgency, /picks up today|hard lane|posted/);
  const quiet = callSheet([pava], rows, { zip, zipMap: zip, settings: DEFAULT_SETTINGS, now: new Date(NOW), inquiries: [], coverLog: [], outreach: [{ email: 'b@x.com', at: new Date(NOW - 3600000).toISOString() }] });
  assert.ok(quiet.find(r => r.carrier.carrierName === 'Beta').score < beta.score);
});
