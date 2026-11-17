import test from 'node:test';
import assert from 'node:assert/strict';
import { EQUIPMENT, dedupeEquipment } from '../../js/core/defaults.js';
import { equipFromText, equipLabel, rateViewWord, equipWords, broadEquipCode } from '../../js/core/equipment.js';
import { rateViewUrl } from '../../js/core/links.js';
import { datRow } from '../../js/core/dat.js';
import { DAT_COLUMNS } from '../../js/core/defaults.js';

// The complete DAT One list as shown in the owner's screenshots (code -> name), in DAT's order.
const DAT = `V Van|R Reefer|F Flatbed|AC Auto Carrier|BT B-Train|CN Conestoga|C Container|CI Container Insulated|CR Container Refrigerated|CV Conveyor|DD Double Drop|LA Drop Deck Landoll|DT Dump Trailer|FA Flatbed Air-Ride|FN Flatbed Conestoga|F2 Flatbed Double|FZ Flatbed HazMat|FH Flatbed Hotshot|MX Flatbed Maxi|FD Flatbed or Step Deck|FC Flatbed w/Chains|FS Flatbed w/Sides|FT Flatbed w/Tarps|FM Flatbed w/Team|FO Flatbed (Over Dimension)|FR Flatbed/Van/Reefer|HB Hopper Bottom|IR Insulated Van or Reefer|LB Lowboy|LR Lowboy or RGN|LO Lowboy (Over Dimension)|MV Moving Van|NU Pneumatic|PO Power Only|RA Reefer Air-Ride|R2 Reefer Double|RZ Reefer HazMat|RN Reefer Intermodal|RL Reefer Logistics|RV Reefer or Vented Van|RM Reefer w/Team|RP Reefer w/Pallet Exchange|RG Removable Gooseneck|SD Step Deck|SR Step Deck or RGN|SN Stepdeck Conestoga|SB Straight Box Truck|ST Stretch Trailer|TA Tanker Aluminum|TN Tanker Intermodal|TS Tanker Steel|TT Truck and Trailer|VA Van Air-Ride|VS Van Conestoga|V2 Van Double|VZ Van HazMat|VH Van Hotshot|VI Van Insulated|VN Van Intermodal|VG Van Lift-Gate|VL Van Logistics|OT Van Open-Top|VT Van or Flatbed w/Tarps|VF Van or Flatbed|VR Van or Reefer|VB Van Roller Bed|V3 Van Triple|VV Van Vented|VW Van w/Blanket Wrap|VC Van w/Curtains|VP Van w/Pallet Exchange|VM Van w/Team|SV Sprinter Van|SZ Sprinter Van Hazmat|SC Sprinter Van Temp-Controlled|SM Sprinter Van Team|BR Straight Box Truck - Reefer|BZ Straight Box Truck Hazmat|PT Power Only Towaway|PL Power Only Load Out`
  .split('|').map(x => { const i = x.indexOf(' '); return [x.slice(0, i), x.slice(i + 1)]; });

test('equipment list = the full DAT list, in DAT order, nothing missing, nothing extra', () => {
  assert.equal(DAT.length, 80);
  assert.deepEqual(EQUIPMENT.map(e => [e.code, e.label]), DAT);
});
test('equipment list has no duplicate code or name', () => {
  assert.equal(new Set(EQUIPMENT.map(e => e.code)).size, EQUIPMENT.length);
  assert.equal(new Set(EQUIPMENT.map(e => e.label.toLowerCase().replace(/[^a-z0-9]+/g, ''))).size, EQUIPMENT.length);
  const d = dedupeEquipment([{ code: 'V', label: 'Van' }, { code: 'v', label: 'Other' }, { code: 'X', label: 'VAN' }, { code: 'Y', label: 'Yard' }]);
  assert.deepEqual(d.map(e => e.code), ['V', 'Y']);
});
test('every entry is complete', () => {
  for (const e of EQUIPMENT) { assert.ok(e.fam.length && e.fam.every(Boolean), e.code); assert.ok(['Van', 'Reefer', 'Flatbed'].includes(e.rateView), e.code); assert.ok(equipWords(e.code).length, e.code); }
});
test('every DAT code is accepted by the CSV exactly as typed', () => {
  const i = DAT_COLUMNS.findIndex(c => c.key === 'equip');
  for (const [code] of DAT) assert.equal(datRow({ equip: code.toLowerCase() })[i], code);
});
test('RateView word follows the equipment family, not just V/R/F', () => {
  const url = (equip) => rateViewUrl({ equip, originCity: 'Oakland', originState: 'CA', destCity: 'Dallas', destState: 'TX' }).url.split('~').pop();
  assert.equal(url('V'), 'Van'); assert.equal(url('R'), 'Reefer'); assert.equal(url('F'), 'Flatbed'); assert.equal(url('SD'), 'Flatbed');
  assert.equal(url('FN'), 'Flatbed'); assert.equal(url('LB'), 'Flatbed'); assert.equal(url('RZ'), 'Reefer'); assert.equal(url('CR'), 'Reefer');
  assert.equal(url('SC'), 'Reefer'); assert.equal(url('SB'), 'Van'); assert.equal(url('VR'), 'Van'); assert.equal(url('RM'), 'Reefer'); assert.equal(url('VM'), 'Van');
});
test('carrier equipment words: new codes no longer fall back to Van', () => {
  assert.ok(equipWords('FN').includes('flat')); assert.ok(!equipWords('FN').includes('van'));
  assert.ok(equipWords('RZ').includes('reefer')); assert.ok(equipWords('VR').includes('van') && equipWords('VR').includes('reefer'));
  assert.ok(equipWords('SV').includes('sprinter')); assert.ok(equipWords('SB').includes('box')); assert.ok(equipWords('LB').includes('flat'));
});
test('TQL trailer text maps to the right DAT code (old answers unchanged)', () => {
  const t = { 'Van': 'V', 'Dry Van': 'V', '': 'V', 'Reefer': 'R', 'Flatbed': 'F', 'Step Deck': 'SD', 'Straight Box Truck': 'SB', 'Box Truck': 'SB', 'Reefer Team': 'RM', 'Van Team': 'VM', 'unknown thing': 'V',
    'Van or Reefer': 'VR', 'Van, Reefer': 'VR', 'Flatbed or Step Deck': 'FD', 'Flatbed, Van or Reefer': 'FR', 'Step Deck or RGN': 'SR', 'Lowboy': 'LB', 'Lowboy or RGN': 'LR',
    'Conestoga': 'CN', 'Flatbed Conestoga': 'FN', 'Flatbed w/Tarps': 'FT', 'Van or Flatbed': 'VF', 'Van or Flatbed w/Tarps': 'VT', 'Power Only': 'PO', 'Sprinter Van': 'SV',
    'Sprinter Van Hazmat': 'SZ', 'Hazmat Van': 'VZ', 'Van HazMat': 'VZ', 'Reefer HazMat': 'RZ', 'Straight Box Truck - Reefer': 'BR', 'Van w/Curtains': 'VC', 'Van Lift-Gate': 'VG',
    'Container': 'C', 'Container Refrigerated': 'CR', 'Tanker Steel': 'TS', 'Hotshot': 'FH', 'Van Air-Ride': 'VA', 'Insulated Van or Reefer': 'IR', 'Reefer or Vented Van': 'VR' };
  for (const [text, code] of Object.entries(t)) { const got = equipFromText(text); if (text === 'Reefer or Vented Van') assert.ok(['RV', 'VR'].includes(got)); else assert.equal(got, code, text); }
  for (const e of EQUIPMENT) assert.equal(equipFromText(e.label), e.code, `label "${e.label}" should parse back to ${e.code}`);
});
test('widening is opt-in and only for Van and Flatbed', () => {
  assert.equal(broadEquipCode('V'), 'VR'); assert.equal(broadEquipCode('F'), 'FD'); assert.equal(broadEquipCode('SD'), 'SD'); assert.equal(broadEquipCode('R'), 'R'); assert.equal(broadEquipCode('VM'), 'VM');
  const i = DAT_COLUMNS.findIndex(c => c.key === 'equip'), x = DAT_COLUMNS.findIndex(c => c.key === 'useExtended');
  assert.equal(datRow({ equip: 'V' })[i], 'V'); assert.equal(datRow({ equip: 'V' }, { broadEquip: true })[i], 'VR');
  assert.equal(datRow({ equip: 'V' })[x], 'no'); assert.equal(datRow({ equip: 'V' }, { extended: true })[x], 'yes');
});
test('equipLabel / rateViewWord defaults', () => {
  assert.equal(equipLabel('vm'), 'Van w/Team'); assert.equal(equipLabel('ZZ'), 'ZZ'); assert.equal(rateViewWord('ZZ'), 'Van');
});
