import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSort, sortRows, columnKind } from '../../js/core/tablesort.js';
import { parseMcDot, fmcsaUrl, mapsRouteUrl, mapsCarriersNearUrl, telHref, mailHref } from '../../js/core/resources.js';

const rows = [
  { id: 'a', state: 'TX', rate: '$1,850', last: '2026-03-02', name: 'Zed' },
  { id: 'b', state: 'AL', rate: '$900', last: '2026-11-01', name: 'alpha' },
  { id: 'c', state: '', rate: '', last: '', name: '' },
  { id: 'd', state: 'CA', rate: '$12,000', last: '2025-12-31', name: 'Beta 10' },
  { id: 'e', state: 'NY', rate: '$250', last: '', name: 'Beta 2' },
];
const ids = (list) => list.map(r => r.id).join('');

test('header clicks cycle A-Z, Z-A, random, then back to A-Z', () => {
  let s = nextSort(null, 'state');
  assert.equal(s.mode, 'asc');
  s = nextSort(s, 'state'); assert.equal(s.mode, 'desc');
  s = nextSort(s, 'state', () => 0.5); assert.equal(s.mode, 'random'); assert.ok(s.seed > 0);
  s = nextSort(s, 'state'); assert.equal(s.mode, 'asc');
  assert.equal(nextSort(s, 'rate').mode, 'asc', 'another column starts at A-Z');
});

test('text sorts A-Z and Z-A, blanks always last, numbers inside text sort naturally', () => {
  assert.equal(ids(sortRows(rows, { key: 'state', mode: 'asc' })), 'bdeac');
  assert.equal(ids(sortRows(rows, { key: 'state', mode: 'desc' })), 'aedbc');
  assert.equal(ids(sortRows(rows, { key: 'name', mode: 'asc' })), 'bedac');  // alpha, Beta 2, Beta 10, Zed, blank
});

test('money and date columns sort by value, not by characters', () => {
  assert.equal(columnKind(rows.map(r => r.rate)), 'number');
  assert.equal(columnKind(rows.map(r => r.last)), 'date');
  assert.equal(ids(sortRows(rows, { key: 'rate', mode: 'asc' })), 'ebadc');    // 250, 900, 1850, 12000, blank
  assert.equal(ids(sortRows(rows, { key: 'rate', mode: 'desc' })), 'dabec');
  assert.equal(ids(sortRows(rows, { key: 'last', mode: 'asc' })), 'dabce');   // 2025-12-31, 2026-03-02, 2026-11-01, then blanks
  assert.equal(columnKind(['5', 'five']), 'text', 'one stray word makes the column text');
});

test('random order is a repeatable shuffle for a seed, differs between seeds, and never loses a row', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'r' + i, v: String(i) }));
  const a1 = sortRows(many, { key: 'v', mode: 'random', seed: 7 }), a2 = sortRows(many, { key: 'v', mode: 'random', seed: 7 }), b = sortRows(many, { key: 'v', mode: 'random', seed: 99 });
  assert.deepEqual(a1, a2);
  assert.notDeepEqual(a1.map(r => r.id), b.map(r => r.id));
  assert.notDeepEqual(a1.map(r => r.id), many.map(r => r.id));
  assert.deepEqual(a1.map(r => r.id).sort(), many.map(r => r.id).sort());
});

test('sorting never changes the input and no sort returns the original order', () => {
  const copy = rows.map(r => r.id);
  sortRows(rows, { key: 'state', mode: 'desc' });
  assert.deepEqual(rows.map(r => r.id), copy);
  assert.equal(ids(sortRows(rows, null)), 'abcde');
});

test('MC / DOT numbers are read from free text and become FMCSA links', () => {
  assert.deepEqual(parseMcDot('MC 123456'), { type: 'MC', num: '123456' });
  assert.deepEqual(parseMcDot('mc#987654'), { type: 'MC', num: '987654' });
  assert.deepEqual(parseMcDot('USDOT 3456789'), { type: 'DOT', num: '3456789' });
  assert.deepEqual(parseMcDot('MC 123456 / DOT 3456789'), { type: 'DOT', num: '3456789' });
  assert.deepEqual(parseMcDot('3456789'), { type: 'DOT', num: '3456789' });
  assert.deepEqual(parseMcDot('123456'), { type: 'MC', num: '123456' });
  assert.equal(parseMcDot('pending'), null);
  assert.match(fmcsaUrl('MC 123456'), /^https:\/\/safer\.fmcsa\.dot\.gov\/query\.asp\?.*query_param=MC_MX&query_string=123456$/);
  assert.match(fmcsaUrl('DOT 3456789'), /query_param=USDOT&query_string=3456789$/);
  assert.equal(fmcsaUrl(''), '');
});

test('map, phone and e-mail links are built safely', () => {
  const p = { originCity: 'Joliet', originState: 'il', destCity: 'Atlanta', destState: 'GA' };
  assert.equal(mapsRouteUrl(p), 'https://www.google.com/maps/dir/?api=1&origin=Joliet%2C%20IL&destination=Atlanta%2C%20GA&travelmode=driving');
  assert.equal(mapsRouteUrl({ originCity: 'Joliet', originState: 'IL' }), '');
  assert.match(mapsCarriersNearUrl(p), /query=trucking%20companies%20near%20Joliet%2C%20IL$/);
  assert.equal(telHref('(555) 123-4567 x12'), 'tel:5551234567');
  assert.equal(telHref('+1 555 123 4567'), 'tel:+15551234567');
  assert.equal(telHref('call me'), '');
  assert.equal(mailHref('a@b.co'), 'mailto:a@b.co');
  assert.equal(mailHref('a@b.co, c@d.co'), '', 'two addresses in one cell are not turned into one link');
  assert.equal(mailHref('javascript:alert(1)'), '');
});
