import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blankPosting, initializeLoadControls, laneBoxes, gridLabel, reconcileManualLane, targetForPriority, setGroupPriority } from '../../js/core/model.js';
import { DEFAULT_SETTINGS, DAT_COLUMNS, EQUIPMENT } from '../../js/core/defaults.js';
import { datCsv, datHeader, datRow, datRows, datTsv, datProblems, datFileName, datDate } from '../../js/core/dat.js';
import { parseDelimited } from '../../js/core/csv.js';
import { getEquipmentCode } from '../../js/core/parser.js';
import { rateViewUrl } from '../../js/core/links.js';
import { ZipMap } from '../../js/core/zipmap.js';

const tpl = readFileSync(new URL('../fixtures/DAT-bulk-upload-template.csv', import.meta.url), 'utf8');
const TEMPLATE_HEADER = tpl.split('\n').find(l => l.startsWith('Pickup Earliest*'));
const P = (o = {}) => { const p = blankPosting({ originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Atlanta', destState: 'GA', destZip: '30303', pickupEarliest: '11/16/2026', pickupLatest: '11/16/2026', weight: '38000', ...o }); initializeLoadControls(p); return p; };

test('DAT header is byte-identical to the DAT bulk-upload template header', () => {
  assert.ok(TEMPLATE_HEADER);
  assert.equal(datHeader().join(','), TEMPLATE_HEADER);
  assert.equal(DAT_COLUMNS.length, 24);
});

test('DAT csv: header first, LF endings, no BOM, no instruction rows, ASCII only', () => {
  const csv = datCsv([P(), P({ originCity: 'Joliet', comment: 'café, quick pay' })]);
  assert.ok(!csv.startsWith('﻿'));
  assert.ok(!csv.includes('\r'));
  assert.ok(csv.endsWith('\n'));
  assert.ok(/^[\x00-\x7f]*$/.test(csv));
  const rows = parseDelimited(csv, ',');
  assert.equal(rows.length, 3);
  assert.ok(rows.every(r => r.length === 24));
  assert.ok(!csv.includes('Instructions'));
  assert.equal(rows[2][21], 'cafe, quick pay');   // comma kept (quoted), accent folded
});

test('DAT row values follow the template styles', () => {
  const r = datRow(P({ equip: 'sd', datRate: '$1,650.40', targetRate: 1500, fullPartial: 'partial', contact: 'Email', useDat: 'Yes', pickupEarliest: '2026-11-16' }));
  const by = Object.fromEntries(DAT_COLUMNS.map((c, i) => [c.key, r[i]]));
  assert.equal(by.pickupEarliest, '11/16/2026');
  assert.equal(by.equip, 'SD');
  assert.equal(by.datRate, '1650');
  assert.equal(by.fullPartial, 'Partial');
  assert.equal(by.contact, 'email');
  assert.equal(by.useDat, 'yes');
  assert.equal(by.usePrivate, 'no');
  assert.equal(by.destZip, '30303');
  assert.equal(by.length, '53');
  assert.equal(datDate('8/5/22'), '8/5/2022');
});

test('target rate is never exported; DAT rate only when posting to the DAT loadboard', () => {
  const csv = datCsv([P({ targetRate: 1234, datRate: '' })]);
  assert.ok(!csv.includes('1234'));
  assert.equal(datRow(P({ datRate: 2000, useDat: 'no' }))[DAT_COLUMNS.findIndex(c => c.key === 'datRate')], '');
  assert.equal(datRow(P({ datRate: 2000 }))[DAT_COLUMNS.findIndex(c => c.key === 'datRate')], '2000');
});

test('required fields are reported before download', () => {
  const bad = P({ weight: '', destCity: '' });
  const probs = datProblems([P(), bad]);
  assert.equal(probs.length, 1);
  assert.deepEqual(probs[0].missing.sort(), ['Destination City', 'Weight (lbs)'].sort());
});

test('covered postings never export; subsets export only what is passed', () => {
  assert.equal(datRows([P(), P({ status: 'Covered' })]).length, 1);
  assert.equal(datTsv([P()], true).split('\n').length, 2);
});

test('file names: all / group / single', () => {
  const d = new Date('2026-11-11T12:00:00Z');
  assert.equal(datFileName('all', [], d), 'freight-signal-dat-all-2026-11-11.csv');
  assert.equal(datFileName('group', [P({ originCity: 'Modesto', originState: 'CA', destCity: 'Reno', destState: 'NV', variant: 'Original' })], d), 'freight-signal-dat-Modesto-CA-to-Reno-NV-2026-11-11.csv');
  assert.match(datFileName('one', [P({ variant: 'Nearby 3' })], d), /Nearby-3/);
});

test('equipment codes: Step Deck, Flatbed, Van Team, Reefer Team', () => {
  assert.deepEqual(EQUIPMENT.map(e => e.code), ['V', 'R', 'F', 'SD', 'VM', 'RM']);
  assert.equal(getEquipmentCode('Dry Van Team'), 'VM');
  assert.equal(getEquipmentCode('Reefer Team'), 'RM');
  assert.equal(getEquipmentCode('Reefer'), 'R');
  assert.equal(getEquipmentCode('Step Deck'), 'SD');
  assert.equal(getEquipmentCode('Flatbed'), 'F');
  assert.equal(getEquipmentCode('Van'), 'V');
  assert.match(rateViewUrl(P({ equip: 'RM' })).url, /Reefer$/);
  assert.match(rateViewUrl(P({ equip: 'VM' })).url, /Van$/);
  assert.match(rateViewUrl(P({ equip: 'SD' })).url, /Flatbed$/);
});

test('priority drives the target: Low 5, Medium 10, High 15, including after a matrix copy', () => {
  assert.equal(targetForPriority('Low').target, 5);
  assert.equal(targetForPriority('Medium').target, 10);
  assert.equal(targetForPriority('High').target, 15);
  const ps = [P({ groupId: 'G1', variant: 'Original' }), P({ groupId: 'G1', variant: 'Nearby 1' })];
  setGroupPriority(ps, 'G1', 'High');
  assert.deepEqual(ps.map(p => p.outreachTarget), [15, 15]);
  const copy = P({ priority: 'Medium' });
  assert.equal(copy.outreachTarget, 10);
});

test('lane boxes: one box per group with an Original-based header; grid labels', () => {
  const g = (v, extra = {}) => P({ groupId: 'G1', variant: v, ...extra });
  const ps = [g('Original', { originCity: 'Modesto', originState: 'CA', destCity: 'Reno', destState: 'NV' }), g('Nearby 1', { originCity: 'Ceres' }), P({ originCity: 'Solo' })];
  const boxes = laneBoxes(ps);
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].members.length, 2);
  assert.equal(boxes[0].title, 'Modesto, CA → Reno, NV');
  assert.deepEqual(['Original', 'Nearby 1', 'Nearby 2', 'Nearby 3', 'Nearby 4', 'Nearby 5', 'Nearby 6', 'Nearby 7', 'Nearby 8'].map(gridLabel),
    ['A-A', 'A-B', 'A-C', 'B-A', 'B-B', 'B-C', 'C-A', 'C-B', 'C-C']);
});

test('city change updates ZIP for origin AND destination; unknown city warns and clears', () => {
  const zm = ZipMap.fromCsv('zip,lat,lng,city,state_id,population\n60601,41.88,-87.62,Chicago,IL,1000\n60432,41.52,-88.08,Joliet,IL,500\n30303,33.75,-84.39,Atlanta,GA,900\n');
  const p = P();
  p.originCity = 'Joliet'; p.destCity = 'Atlanta';
  assert.equal(reconcileManualLane(p, zm).warning, undefined);
  assert.equal(p.originZip, '60432'); assert.equal(p.destZip, '30303');
  p.destCity = 'Nowhereville';
  const r = reconcileManualLane(p, zm);
  assert.match(r.warning, /Destination/);
  assert.equal(p.destZip, '');
});
