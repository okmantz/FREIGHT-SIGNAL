import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPosting } from '../../js/core/model.js';
import { DEFAULT_SETTINGS, DAT_COLUMNS } from '../../js/core/defaults.js';
import { realZipMap } from './helpers.js';
import { datRow, datRows, datCsv, loadRateInfo } from '../../js/core/dat.js';
import { weekStart, nextWeekStart, weekKey, weeklyGoalHit, paceStats } from '../../js/core/coverlog.js';
import { applyOrder, moveItem } from '../../js/core/util.js';
import { TOUR_STEPS } from '../../js/core/tourSteps.js';
import { analyseBoard } from '../../js/core/worklist.js';
import { nextSteps } from '../../js/core/guidance.js';
import { strategyFor } from '../../js/core/lanes.js';

const S = { ...DEFAULT_SETTINGS };
const rateIdx = DAT_COLUMNS.findIndex(c => c.key === 'datRate');
const mk = (o = {}) => blankPosting({ originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Atlanta', destState: 'GA', pickupEarliest: '1/1/2099', pickupLatest: '1/1/2099', weight: '38000', equip: 'V', targetRate: '1800', ...o });

// ---------------------------------------------------------------- per-posting DAT rate
test('DAT rate: with the target-as-rate option, one rated posting means the load\'s other postings go out blank', () => {
  const all = ['A-A', 'A-B', 'A-C'].map((v, i) => mk({ id: 'p' + i, groupId: 'g1', variant: v, datRate: i === 0 ? '2100' : '' }));
  const rows = datRows(all, { targetAsRate: true, all });
  assert.deepEqual(rows.map(r => r[rateIdx]), ['2100', '', '']);
});
test('DAT rate: a load with no own rates still uses the target on every posting; other loads are unaffected', () => {
  const g1 = [0, 1].map(i => mk({ id: 'a' + i, groupId: 'g1', datRate: i === 0 ? '2100' : '' }));
  const g2 = [0, 1].map(i => mk({ id: 'b' + i, groupId: 'g2', targetRate: '1500' }));
  const rows = datRows([...g1, ...g2], { targetAsRate: true, all: [...g1, ...g2] });
  assert.deepEqual(rows.map(r => r[rateIdx]), ['2100', '', '1500', '1500']);
});
test('DAT rate: a single posting downloaded alone still sees its siblings\' rates (opts.all)', () => {
  const all = [mk({ id: 'x', groupId: 'g', datRate: '2100' }), mk({ id: 'y', groupId: 'g' })];
  assert.equal(datRow(all[1], { targetAsRate: true, ownRates: new Set(['g:g']) })[rateIdx], '');
  assert.equal(datRows([all[1]], { targetAsRate: true, all })[0][rateIdx], '');
});
test('DAT rate: loadRateInfo reports own / target / none', () => {
  const m = [mk({ id: '1', datRate: '2100' }), mk({ id: '2' }), mk({ id: '3' })];
  assert.deepEqual(loadRateInfo(m, { targetAsRate: true }), { mode: 'own', count: 1, total: 3 });
  assert.equal(loadRateInfo([mk({ id: '1' })], { targetAsRate: true }).mode, 'target');
  assert.equal(loadRateInfo([mk({ id: '1' })], {}).mode, 'none');
  assert.ok(datCsv([m[0]], { targetAsRate: true }).includes('2100'));
});

// ---------------------------------------------------------------- week runs Monday to Sunday
test('cover week: Sunday 23:59 is the old week, Monday 00:00 starts a new one', () => {
  const sun = new Date(2026, 10, 15, 23, 59), mon = new Date(2026, 10, 16, 0, 0);
  assert.equal(weekStart(sun).getDate(), 9);                      // Monday 9 Nov
  assert.equal(weekStart(mon).getDate(), 16);                     // Monday 16 Nov
  assert.equal(nextWeekStart(sun).getTime(), mon.getTime());
  assert.notEqual(weekKey(sun), weekKey(mon));
});
test('cover week: covers logged Sunday night do not count toward Monday', () => {
  const log = [{ outcome: 'Covered', closedAt: new Date(2026, 10, 15, 22).toISOString() }, { outcome: 'Covered', closedAt: new Date(2026, 10, 16, 8).toISOString() }];
  assert.equal(paceStats(log, S, new Date(2026, 10, 16, 9)).week, 1);
  assert.equal(paceStats(log, S, new Date(2026, 10, 15, 23)).week, 1);
});

// ---------------------------------------------------------------- confetti trigger
test('weekly goal: fires only on the cover that reaches the floor, once per week', () => {
  const now = new Date(2026, 10, 12, 10);
  const st = { ...S, weeklyFloor: 50 };
  const cov = (n) => Array.from({ length: n }, (_, i) => ({ outcome: 'Covered', closedAt: new Date(2026, 10, 10, 8, i).toISOString() }));
  const entry = { outcome: 'Covered', closedAt: now.toISOString() };
  assert.equal(weeklyGoalHit({ logBefore: cov(48), entry, settings: st, now }), null);
  const hit = weeklyGoalHit({ logBefore: cov(49), entry, settings: st, now });
  assert.equal(hit.floor, 50); assert.equal(hit.week, 50);
  assert.equal(weeklyGoalHit({ logBefore: cov(49), entry, settings: st, now, goalWeek: hit.key }), null, 'already celebrated this week');
  assert.equal(weeklyGoalHit({ logBefore: cov(50), entry, settings: st, now }), null, 'past the floor already');
  assert.equal(weeklyGoalHit({ logBefore: cov(49), entry: { outcome: 'Expired', closedAt: now.toISOString() }, settings: st, now }), null);
});

// ---------------------------------------------------------------- guided notes follow the clock from the download
const NOW = new Date(2026, 10, 10, 9);
const ctxFor = (postings, extra = {}) => ({ postings, inquiries: [], drafts: [], coverLog: [], carriers: [], zip: realZipMap(), settings: S, now: NOW, weather: new Map(), ...extra });
const stepsAt = (minutesLive, over = {}) => {
  const at = new Date(NOW.getTime() - minutesLive * 60000).toISOString();
  const p = mk({ id: 'a', groupId: '', createdAt: new Date(NOW.getTime() - 5 * 3600000).toISOString(), ops: minutesLive === null ? [] : [{ type: 'posted', at }], ...over });
  const row = analyseBoard(ctxFor([p]))[0];
  return nextSteps(row.stats, { depth: 3, unusedDepth: 3, wave: 5, now: NOW });
};
test('guidance: fresh post is told to wait, never that rates will not come in for hours', () => {
  const adv = stepsAt(10);
  assert.equal(adv.steps[0].id, 'wait');
  assert.ok(!/5 ?hr|five hours/i.test(JSON.stringify(adv)));
});
test('guidance: at 30 minutes the note says refresh; at an hour it says something is not working', () => {
  assert.ok(stepsAt(35).steps.some(s => s.id === 'refresh'));
  const adv = stepsAt(75);
  const d = adv.steps.find(s => s.id === 'diagnose');
  assert.ok(d && d.checks && d.checks.length >= 4, 'diagnose step carries a specific checklist');
});
test('guidance: stalled and dead bands differ, and every band is specific to the lane', () => {
  assert.notEqual(stepsAt(75).steps[0].id, stepsAt(180).steps[0].id);
  for (const m of [10, 35, 75, 180]) assert.ok(JSON.stringify(stepsAt(m)).includes('Chicago'), `lane named at ${m} min`);
});
test('guidance: a load not yet downloaded gets a post step with a CSV action', () => {
  const p = mk({ id: 'a', groupId: '', createdAt: new Date(NOW.getTime() - 5 * 60000).toISOString() });
  const adv = nextSteps(analyseBoard(ctxFor([p]))[0].stats, { depth: 3, unusedDepth: 3, wave: 5, now: NOW });
  const post = adv.steps.find(s => s.id === 'post');
  assert.ok(post && post.action && post.action.type === 'csv');
});
test('lanes: every lane class treats a post as stale after an hour', () => {
  for (const c of ['local', 'regional', 'long']) assert.equal(strategyFor(S, c).staleHours, 1);
});

// ---------------------------------------------------------------- broker order helpers
test('applyOrder keeps unknown names, drops stale ones, and appends brokers missing from the saved order', () => {
  assert.deepEqual(applyOrder(['A', 'B', 'C'], ['C', 'X', 'A']), ['C', 'A', 'B']);
  assert.deepEqual(applyOrder(['A', 'B'], []), ['A', 'B']);
  assert.deepEqual(applyOrder(['A', 'B', 'C'], ['B', 'B', 'A', 'C']), ['B', 'A', 'C']);
});
test('moveItem places a broker at the requested index', () => {
  assert.deepEqual(moveItem(['A', 'B', 'C', 'D'], 'A', 2), ['B', 'C', 'A', 'D']);
  assert.deepEqual(moveItem(['A', 'B', 'C', 'D'], 'D', 0), ['D', 'A', 'B', 'C']);
  assert.deepEqual(moveItem(['A', 'B'], 'Z', 0), ['A', 'B']);
});

// ---------------------------------------------------------------- tour content
test('tour: 7-10 steps, unique ids, every step has a route, title and body', () => {
  assert.ok(TOUR_STEPS.length >= 7 && TOUR_STEPS.length <= 10, `has ${TOUR_STEPS.length} steps`);
  assert.equal(new Set(TOUR_STEPS.map(s => s.id)).size, TOUR_STEPS.length);
  for (const s of TOUR_STEPS) { assert.match(s.route, /^#\//); assert.ok(s.title && s.body && Array.isArray(s.target)); }
  const text = TOUR_STEPS.map(s => s.title + s.body).join(' ').toLowerCase();
  for (const k of ['outlook', 'carrier', 'post']) assert.ok(text.includes(k), `mentions ${k}`);
});

// ---------------------------------------------------------------- v7
import { EQUIPMENT } from '../../js/core/defaults.js';
import { getEquipmentCode } from '../../js/core/parser.js';
import { rateViewUrl, findTruckInfo } from '../../js/core/links.js';

test('equipment: straight box truck (SB) is in the list, parsed from TQL text, and uses the Van RateView', () => {
  assert.ok(EQUIPMENT.some(e => e.code === 'SB' && /straight box/i.test(e.label)));
  assert.equal(getEquipmentCode('Straight Box Truck'), 'SB');
  assert.equal(getEquipmentCode('26ft Box Truck'), 'SB');
  assert.equal(getEquipmentCode('Dry Van'), 'V');
  assert.equal(getEquipmentCode('Reefer Team'), 'RM');
  assert.match(rateViewUrl(mk({ equip: 'SB' })).url, /~Van$/);
  assert.equal(datRow(mk({ equip: 'SB' }))[DAT_COLUMNS.findIndex(c => c.key === 'equip')], 'SB');
});
test('find more carriers: DAT Find Trucks link with the lane, equipment and pickup ready to paste', () => {
  const f = findTruckInfo(mk({ equip: 'SB', pickupEarliest: '11/16/2026' }));
  assert.equal(f.ok, true); assert.match(f.url, /^https:\/\/one\.dat\.com\//);
  assert.equal(f.origin, 'Chicago, IL'); assert.equal(f.dest, 'Atlanta, GA'); assert.equal(f.equipment, 'Straight Box Truck'); assert.equal(f.pickup, '11/16/2026');
  assert.equal(findTruckInfo(mk({ destCity: '' })).ok, false);
});
test('DAT avg fields exist on a new posting and start blank', () => { const p = mk(); assert.equal(p.datAvg, ''); assert.equal(p.datAvgAt, ''); });
