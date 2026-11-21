import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuickLoads, parseQuickLine, buildStandardLoadDetails, looksLikeLabelledLoad } from '../../js/core/quickload.js';
import { parseTqlLoad } from '../../js/core/parser.js';
import { originalLoadDetails } from '../../js/core/loaddetails.js';
import { realZipMap } from './helpers.js';

const zm = realZipMap();
const NOW = new Date(2026, 10, 21, 8, 17);     // Sat 11/21/2026
const lane = (t) => { const r = parseQuickLine(t, zm, NOW); return r && r.fields; };
const ends = (f) => f && `${f.originCity}, ${f.originState} > ${f.destCity}, ${f.destState}`;

test('the same lane is understood however it is typed', () => {
  for (const t of ['aiken sc-fletcher ok', 'aiken sc to fletcher ok', 'Aiken south carolina to fletcher oklahoma', 'Aiken, SC to Fletcher, OK', 'AIKEN SC -> FLETCHER OK',
    'Aiken, SC → Fletcher, OK', 'aiken sc fletcher ok', 'from aiken sc to fletcher ok', 'aiken sc / fletcher ok', 'Aiken, South Carolina - Fletcher, Oklahoma']) {
    assert.equal(ends(lane(t)), 'Aiken, SC > Fletcher, OK', t);
  }
});

test('defaults: 53 ft dry van, 40,000 lbs, pickup today', () => {
  const f = lane('aiken sc-fletcher ok');
  assert.equal(f.equip, 'V'); assert.equal(f.length, 53); assert.equal(f.weight, '40000');
  assert.equal(f.pickupEarliest, '11/21/2026'); assert.equal(f.pickupLatest, '11/21/2026');
  assert.equal(f.destZip, '73541'); assert.ok(/^\d{5}$/.test(f.originZip));
});

test('multi-word states and cities, hyphenated cities, Saint / St, typos', () => {
  assert.equal(ends(lane('kansas city ks to oklahoma city oklahoma')), 'Kansas City, KS > Oklahoma City, OK');
  assert.equal(ends(lane('new york new york to charleston west virginia')), 'New York, NY > Charleston, WV');
  assert.equal(ends(lane('winston-salem nc to st louis mo')), 'Winston Salem, NC > Saint Louis, MO');
  assert.equal(ends(lane('ft worth tx to mt pleasant tx')), 'Fort Worth, TX > Mount Pleasant, TX');
  const typo = parseQuickLine('fletchr ok to aiken sc', zm, NOW);
  assert.equal(ends(typo.fields), 'Fletcher, OK > Aiken, SC'); assert.ok(typo.warnings.some(w => /check the spelling/.test(w)));
});

test('optional extras: weight, equipment, date, trailer size, ZIPs', () => {
  const f = lane('aiken sc to fletcher ok reefer 42,000 lbs 11/25');
  assert.equal(f.equip, 'R'); assert.equal(f.weight, '42000'); assert.equal(f.pickupEarliest, '11/25/2026');
  assert.equal(lane('aiken sc to fletcher ok 45k flatbed 48ft').length, 48);
  assert.equal(lane('aiken sc to fletcher ok tomorrow').pickupEarliest, '11/22/2026');
  const z = lane('Aiken SC 29801 to Fletcher OK 73541'); assert.equal(z.originZip, '29801'); assert.equal(z.destZip, '73541');
});

test('one load per line; lines that are not lanes are skipped', () => {
  const r = parseQuickLoads('aiken sc to fletcher ok\n\nchicago il - atlanta ga\nthanks for the help', zm, NOW);
  assert.equal(r.loads.length, 2); assert.deepEqual(r.skipped, ['thanks for the help']);
});

test('works before the ZIP Map is loaded (state-only check, no ZIPs)', () => {
  const f = parseQuickLine('aiken sc to fletcher ok', null, NOW).fields;
  assert.equal(ends(f), 'Aiken, SC > Fletcher, OK'); assert.equal(f.originZip, '');
});

test('TQL-labelled pastes are not read as typed lanes', () => {
  assert.equal(looksLikeLabelledLoad('Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303'), true);
  assert.equal(looksLikeLabelledLoad('aiken sc to fletcher ok'), false);
});

test('standard load details layout', () => {
  const f = lane('aiken sc-fletcher ok');
  const d = buildStandardLoadDetails({ ...f, originZip: '29801' }, zm, NOW);
  const lines = d.split('\n');
  assert.equal(lines[0], '1 pick - 1 drop');
  assert.deepEqual(lines.map(l => l.trim()).filter(Boolean).slice(1, 6), ['Pick 1', 'Pickup: Aiken, SC 29801', 'Pickup Date/Time: 11/21/2026 FCFS 08:00 to 16:00', 'Drop 1', 'Delivery: Fletcher, OK 73541']);
  assert.ok(/Delivery Date\/Time: 11\/2[2-9]\/2026 FCFS 08:00 to 16:00/.test(d));
  assert.ok(/Weight: 40,000 lbs/.test(d)); assert.ok(/Commodity:\n/.test(d)); assert.ok(/Temp:\n/.test(d));
  assert.ok(/Miles: \d{3,4}\n/.test(d)); assert.ok(d.endsWith('Trailer Type: Van\n Trailer Size: 53 ft'));
});

test('delivery date moves with the miles; reefer and weight carry into the details', () => {
  const short = buildStandardLoadDetails(lane('atlanta ga to macon ga'), zm, NOW);
  assert.ok(short.includes('Delivery Date/Time: 11/22/2026'));        // under 500 miles: next day
  const r = buildStandardLoadDetails(lane('aiken sc to fletcher ok reefer 42000 lbs'), zm, NOW);
  assert.ok(r.includes('Weight: 42,000 lbs') && r.includes('Trailer Type: Reefer'));
});

test('the details read back through the load parser and are kept as the original load details', () => {
  const f = lane('aiken sc to fletcher ok 41,500 lbs 11/25');
  const d = buildStandardLoadDetails(f, zm, NOW);
  const p = parseTqlLoad(d);
  assert.equal(p.ok, true, JSON.stringify(p.missing));
  assert.equal(p.fields.originCity, 'Aiken'); assert.equal(p.fields.destCity, 'Fletcher'); assert.equal(p.fields.weight, '41500');
  assert.equal(p.fields.pickupEarliest, '11/25/2026'); assert.equal(p.fields.equip, 'V');
  const o = originalLoadDetails([{ variant: 'Original', details: d }]);
  assert.equal(o.source, 'original'); assert.ok(o.text.startsWith('1 pick - 1 drop') && o.text.includes('Pickup: Aiken, SC'));
});
