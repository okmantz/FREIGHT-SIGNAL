import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTqlLoad, splitLoads, getEquipmentCode, extractWeight } from '../../js/core/parser.js';
import { fixture } from './helpers.js';

test('parses the synthetic TQL fixture', () => {
  const r = parseTqlLoad(fixture('tql-synthetic-1.txt'));
  assert.equal(r.ok, true, JSON.stringify(r.missing));
  const f = r.fields;
  assert.equal(f.originCity, 'Chicago'); assert.equal(f.originState, 'IL'); assert.equal(f.originZip, '60601');
  assert.equal(f.destCity, 'Atlanta'); assert.equal(f.destState, 'GA');
  assert.equal(f.pickupEarliest, '11/16/2026'); assert.equal(f.pickupLatest, '11/16/2026');
  assert.equal(String(f.weight), '38000'); assert.equal(f.equip, 'V');
  assert.equal(f.length, 53); assert.equal(f.fullPartial, 'Full'); assert.equal(f.contact, 'Email');
  assert.equal(f.useDat, 'yes'); assert.equal(f.usePrivate, 'no');
  assert.ok(f.details.includes('SYN-1001'), 'source text is preserved');
});
test('equipment codes', () => {
  assert.equal(getEquipmentCode('Reefer'), 'R'); assert.equal(getEquipmentCode('Van'), 'V'); assert.equal(getEquipmentCode(''), 'V');
  assert.equal(getEquipmentCode('Flatbed'), 'F');
});
test('weight keeps digits only (macro quirk) and a decimal point triggers a warning', () => {
  assert.equal(String(extractWeight('Weight: 38,000 lbs')), '38000');
  const r = parseTqlLoad('Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303\nPickup Date/Time: 11/16/2026\nWeight: 38.5 lbs\n');
  assert.ok(r.warnings.some(w => /decimal/i.test(w)));
});
test('malformed input is reported, never thrown', () => {
  for (const bad of ['', '   ', 'hello world', 'Pickup:\nDelivery:\n', null, undefined]) {
    const r = parseTqlLoad(bad);
    assert.equal(r.ok, false); assert.ok(r.missing.length > 0);
  }
});
test('multi-stop uses first Pickup and LAST Delivery (and warns)', () => {
  const t = 'Pickup: Chicago, IL 60601\nPickup: Joliet, IL 60432\nDelivery: Gary, IN 46402\nDelivery: Atlanta, GA 30303\nPickup Date/Time: 11/16/2026\nWeight: 1000 lbs\n2 pick - 2 drop';
  const r = parseTqlLoad(t);
  assert.equal(r.fields.originCity, 'Chicago'); assert.equal(r.fields.destCity, 'Atlanta');
});
test('splitLoads: several loads in one paste', () => {
  const one = fixture('tql-synthetic-1.txt');
  const text = `1 pick - 1 drop\n${one}\n1 pick - 1 drop\n${one.replace('SYN-1001', 'SYN-1002')}`;
  const blocks = splitLoads(text);
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].includes('SYN-1001') && !blocks[0].includes('SYN-1002'));
  assert.ok(blocks[1].includes('SYN-1002'));
});
test('splitLoads: dashed separators and single block fallback', () => {
  const one = fixture('tql-synthetic-1.txt');
  assert.equal(splitLoads(`${one}\n-----\n${one}`).length, 2);
  assert.equal(splitLoads(one).length, 1);
  assert.equal(splitLoads('').length, 0);
});
