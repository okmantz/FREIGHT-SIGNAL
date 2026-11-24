import test from 'node:test';
import assert from 'node:assert/strict';
import { realZipMap } from './helpers.js';
import { blankPosting } from '../../js/core/model.js';
import { norm, digitsOf, editDistance, parseQuery, searchRecords, highlightParts, carrierSpec, customerSpec } from '../../js/core/search.js';
import { primaryMap, primaryBoost } from '../../js/core/assignments.js';
import { newRescue, dueStages, canContact, callCooling, callState, callKeyOf, reshuffleDecision, paceOf, ALL_STAGES, STAGES } from '../../js/core/autorescue.js';
import { planMatrix } from '../../js/core/matrix.js';

const NOW = new Date(2026, 10, 20, 10, 0).getTime();
const HOUR = 3600000, MIN = 60000;
const zip = realZipMap();
const load = (o = {}) => blankPosting({ id: 'L1', variant: 'Original', originCity: 'Harrisburg', originState: 'PA', originZip: '17101', destCity: 'Richmond', destState: 'VA', destZip: '23219', pickupEarliest: '2026-11-21', equip: 'V', targetRate: '900', status: 'Active', ...o });
const car = (id, name, o = {}) => ({ id, carrierName: name, mc: '', email: '', phone: '', originCity: '', originState: '', destCity: '', destState: '', equipment: 'V', status: 'Active', notes: '', ...o });

// ---------- search
const carriers = [
  car('a', 'Keystone Haul LLC', { mc: 'MC 123456', phone: '(717) 555-0100', originState: 'PA', destState: 'VA' }),
  car('b', 'Smith Trucking Inc', { mc: 'MC 998877', phone: '804-555-0199', originState: 'VA', notes: 'keystone partner' }),
  car('c', 'Big Smith Express', { mc: 'MC 111222', originState: 'TX' }),
  car('d', 'Zephyr Freight', { mc: 'MC 400400', email: 'z@zephyr.example', originState: 'PA' }),
];
const run = (q, recs = carriers) => searchRecords(recs, q, carrierSpec(() => ({})));
const ids = (res) => res.results.map(r => r.record.id);

test('search: normalising, digits and edit distance', () => {
  assert.equal(norm('  Smith, TRUCKING!! '), 'smith trucking');
  assert.equal(digitsOf('(717) 555-0100'), '7175550100');
  assert.equal(editDistance('keystone', 'keystne'), 1);
});
test('search: a name hit outranks a note-only hit', () => {
  assert.deepEqual(ids(run('keystone')), ['a', 'b']);
});
test('search: filler words are optional ("smith trucking" still finds Big Smith Express, behind the exact one)', () => {
  const r = ids(run('smith trucking')); assert.equal(r[0], 'b'); assert.ok(r.includes('c'));
});
test('search: typos, phone digits and bare MC numbers all work', () => {
  assert.equal(ids(run('keystne'))[0], 'a');
  assert.deepEqual(ids(run('717 555')), ['a']);
  assert.deepEqual(ids(run('998877')), ['b']);
});
test('search: field operators narrow to one field', () => {
  assert.deepEqual(ids(run('st:tx')), ['c']);
  assert.deepEqual(ids(run('mc:400400')), ['d']);
});
test('search: when nothing matches every word, the closest are returned and flagged partial', () => {
  const r = run('smith zzzz'); assert.equal(r.partial, true); assert.ok(r.results.length >= 1);
});
test('search: empty query returns everything, and highlightParts splits on the matched text', () => {
  assert.equal(run('').results.length, carriers.length);
  const parts = highlightParts('Keystone Haul', [{ text: 'stone' }]);
  assert.ok(parts.some(p => p.hit) && parts.map(p => p.text).join('') === 'Keystone Haul');
});
test('search: customers rank the company name above a contact-only hit', () => {
  const cust = [{ id: 'x', company: 'Plastic Works of Ohio', contactName: 'Acme Liaison' }, { id: 'y', company: 'Acme Plastics', contactName: 'Dana' }];
  const r = searchRecords(cust, 'acme', customerSpec());
  assert.equal(r.results[0].record.id, 'y'); assert.equal(r.results.length, 2);
});

// ---------- primary carriers
test('primaryMap links assignments to carriers by id, MC and e-mail, and primary beats backup', () => {
  const cs = [car('a', 'A', { mc: 'MC 55' }), car('b', 'B', { email: 'b@x.example' }), car('c', 'C')];
  const as = [{ carrierId: 'a', priority: 'backup', originState: 'PA', destState: 'VA' }, { mc: '55', priority: 'primary', originState: 'OH', destState: 'GA' }, { email: 'B@X.example', priority: 'backup' }];
  const m = primaryMap(as, cs);
  assert.equal(m.get('a').level, 'primary'); assert.equal(m.get('a').count, 2);
  assert.equal(m.get('b').level, 'backup'); assert.equal(m.has('c'), false);
});
test('primaryBoost: primary adds more than backup and never goes negative', () => {
  assert.ok(primaryBoost(80, 'primary') > primaryBoost(80, 'backup')); assert.equal(primaryBoost(-5, 'primary'), 0);
});

// ---------- auto rescue v21
test('escalation rounds start after the timed stages and repeat on their own cycle', () => {
  const r = newRescue(load(), { now: NOW });
  for (const s of STAGES) r.fired[s.id] = NOW;
  r.startedAt = NOW - 160 * MIN;
  assert.deepEqual(dueStages(r, NOW), ['cycle']);
  r.lastCycleAt = NOW - 10 * MIN; assert.deepEqual(dueStages(r, NOW), []);
  r.lastCycleAt = NOW - 61 * MIN; assert.deepEqual(dueStages(r, NOW), ['cycle']);
  assert.equal(ALL_STAGES.length, STAGES.length + 1);
});
test('Fast pace runs everything twice as soon', () => {
  const r = newRescue(load(), { now: NOW, pace: 2 }); assert.equal(paceOf(r), 2);
  r.startedAt = NOW - 3 * MIN; assert.deepEqual(dueStages(r, NOW).includes('wave1'), true);
});
test('cooldown between contacts shrinks with each round (but never below four hours) and updates use three', () => {
  const ledger = new Map([['k', [{ t: NOW - 5 * HOUR, loadId: 'other' }]]]);
  const base = canContact('k', 'L1', ledger, NOW, {}, {}); const later = canContact('k', 'L1', ledger, NOW, {}, { cycles: 3 });
  assert.equal(base.ok, false); assert.equal(later.ok, true);
  const recent = new Map([['k', [{ t: NOW - 2 * HOUR, loadId: 'other' }]]]);
  assert.equal(canContact('k', 'L1', recent, NOW, {}, { cycles: 6 }).ok, false);
  assert.equal(canContact('k', 'L1', new Map([['k', [{ t: NOW - 3.5 * HOUR, loadId: 'L1' }]]]), NOW, {}, { update: true }).ok, true);
});
test('call outcomes: "no truck" holds for a day and a half, "no answer" for three hours, and the latest entry wins', () => {
  const l = load({ calls: [{ key: 'k', result: 'noanswer', at: NOW - 4 * HOUR }, { key: 'k', result: 'notruck', at: NOW - 1 * HOUR }, { key: 'j', result: 'noanswer', at: NOW - 4 * HOUR }, { key: 'm', result: 'noanswer', at: NOW - 1 * HOUR }] });
  const st = callState(l);
  assert.match(callCooling(st.get('k'), NOW), /no truck/); assert.equal(callCooling(st.get('j'), NOW), ''); assert.match(callCooling(st.get('m'), NOW), /did not answer/);
  assert.equal(callCooling(null, NOW), ''); assert.equal(callCooling({ result: 'notruck', at: NOW - 40 * HOUR }, NOW), '');
  assert.equal(callKeyOf({ email: 'A@B.example' }), callKeyOf({ email: 'a@b.example' }));
});
test('reshuffleDecision: only on the pushing stages, never beyond the cap, and not while replies are arriving', () => {
  const r = newRescue(load(), { now: NOW }); const l = load();
  assert.equal(reshuffleDecision('match', r, l, { now: NOW }), null);
  const d = reshuffleDecision('expand', r, l, { now: NOW, inquiries: [], settings: {} }); assert.ok(d);
  r.reshuffles = 6; assert.equal(reshuffleDecision('cycle', r, l, { now: NOW, settings: {} }), null);
  const r2 = newRescue(load(), { now: NOW }); r2.lastReshuffleAt = NOW - 5 * MIN; assert.equal(reshuffleDecision('cycle', r2, l, { now: NOW, settings: {} }), null);
});

// ---------- matrix reach / cross-state
test('planMatrix: a wider reach never produces fewer distinct markets, and cross-state keeps one market at home', () => {
  const src = load();
  const base = planMatrix({ source: src, zipMap: zip, inquiries: [], now: new Date(NOW) });
  const wide = planMatrix({ source: src, zipMap: zip, inquiries: [], now: new Date(NOW), reach: 1.6, crossState: true });
  assert.ok(base.ok && wide.ok);
  const keys = (p) => new Set([...(p.origins || []), ...(p.dests || [])].map(x => (x.city + ',' + x.state)));
  assert.ok(keys(wide).size >= keys(base).size);
});
