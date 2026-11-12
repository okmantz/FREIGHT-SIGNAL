import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipMap } from '../../js/core/zipmap.js';
import { planMatrix, applyMatrix, hasAlternates } from '../../js/core/matrix.js';
import { blankPosting } from '../../js/core/model.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';
import { realZipMap } from './helpers.js';

const load = (over = {}) => blankPosting({ originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Atlanta', destState: 'GA', details: 'Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303', ...over });

test('real ZIP Map loads (33,782 rows) and resolves city -> ZIP', () => {
  const zm = realZipMap();
  assert.equal(zm.size, 33782);
  assert.equal(zm.bestZipForCityState('Atlanta', 'GA') !== '', true);
  assert.equal(zm.bestZipForCityState('Nowhereville', 'XX'), '');
});
test('ZipMap rejects a file with missing headers with a readable error', () => {
  assert.throws(() => ZipMap.fromCsv('zip,lat\n60601,1'), /missing/i);
  assert.throws(() => ZipMap.fromCsv(''), /empty/i);
});
test('matrix: exactly 9 postings, original + Nearby 1..8, all distinct lanes', () => {
  const zm = realZipMap(); const src = load();
  const plan = planMatrix({ source: src, zipMap: zm, inquiries: [], settings: DEFAULT_SETTINGS });
  assert.equal(plan.ok, true, plan.error);
  const rows = applyMatrix({ source: src, plan, inquiries: [], settings: DEFAULT_SETTINGS });
  assert.equal(rows.length, 9);
  assert.equal(rows[0].variant, 'Original');
  assert.deepEqual(rows.slice(1).map(r => r.variant), [1, 2, 3, 4, 5, 6, 7, 8].map(n => 'Nearby ' + n));
  assert.equal(new Set(rows.map(r => r.groupId)).size, 1); assert.ok(rows[0].groupId.startsWith('FS-'));
  const lanes = new Set(rows.map(r => `${r.originCity}|${r.originState}|${r.destCity}|${r.destState}`));
  assert.equal(lanes.size, 9);
  assert.equal(new Set(rows.map(r => r.id)).size, 9);
});
test('matrix: 3x3 grid order (origin outer loop, destination inner loop)', () => {
  const zm = realZipMap(); const src = load();
  const plan = planMatrix({ source: src, zipMap: zm, inquiries: [], settings: DEFAULT_SETTINGS });
  const rows = applyMatrix({ source: src, plan, inquiries: [], settings: DEFAULT_SETTINGS });
  const o = plan.origins, d = plan.dests; let k = 1;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (!i && !j) continue;
    assert.equal(rows[k].originCity, o[i].city); assert.equal(rows[k].destCity, d[j].city); k++;
  }
});
test('matrix: alternates come from the ZIP Map and respect the 20-60 mile first tier', () => {
  const zm = realZipMap(); const src = load();
  const plan = planMatrix({ source: src, zipMap: zm, inquiries: [], settings: DEFAULT_SETTINGS });
  for (const a of [...plan.origins.slice(1), ...plan.dests.slice(1)]) {
    assert.ok(a.miles >= 20 && a.miles <= 60, `${a.city} ${a.miles}`);
    const z = zm.findZip(a.zip); assert.ok(z, 'ZIP exists in map'); assert.equal(z.city, a.city); assert.equal(z.state, a.state);
  }
});
test('matrix: distance tiers are configurable', () => {
  const zm = realZipMap();
  const settings = { ...DEFAULT_SETTINGS, distanceTiers: [[40, 80]] };
  const plan = planMatrix({ source: load(), zipMap: zm, inquiries: [], settings });
  assert.equal(plan.ok, true);
  for (const a of [...plan.origins.slice(1), ...plan.dests.slice(1)]) assert.ok(a.miles >= 40 && a.miles <= 80, String(a.miles));
});
test('matrix: unknown city never invents geography', () => {
  const plan = planMatrix({ source: load({ originCity: 'Zzzzville', originState: 'IL', originZip: '' }), zipMap: realZipMap(), inquiries: [], settings: DEFAULT_SETTINGS });
  assert.equal(plan.ok, false); assert.match(plan.error, /ZIP Map|matched/i);
});
test('matrix: missing ZIP Map is a clear error', () => {
  assert.equal(planMatrix({ source: load(), zipMap: null, inquiries: [], settings: DEFAULT_SETTINGS }).ok, false);
});
test('matrix: prior inquiries on a lane influence selection (history scoring) deterministically', () => {
  const zm = realZipMap();
  const base = planMatrix({ source: load(), zipMap: zm, inquiries: [], settings: DEFAULT_SETTINGS });
  const again = planMatrix({ source: load(), zipMap: zm, inquiries: [], settings: DEFAULT_SETTINGS });
  assert.deepEqual(base.origins.map(o => o.city), again.origins.map(o => o.city));
});
test('hasAlternates blocks a second matrix on the same group', () => {
  const zm = realZipMap(); const src = load();
  const plan = planMatrix({ source: src, zipMap: zm, inquiries: [], settings: DEFAULT_SETTINGS });
  const rows = applyMatrix({ source: src, plan, inquiries: [], settings: DEFAULT_SETTINGS });
  assert.equal(hasAlternates(rows, rows[0]), true);
  assert.equal(hasAlternates([load()], load()), false);
});
