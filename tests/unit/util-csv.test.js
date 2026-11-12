import test from 'node:test';
import assert from 'node:assert/strict';
import { vbaRound, normalizeZip, calculateDistanceMiles, normalizeDateString, createLoadGroupId, formatCurrency0 } from '../../js/core/util.js';
import { parseDelimited, toDelimited, detectDelimiter } from '../../js/core/csv.js';

test('vbaRound uses banker\'s rounding like VBA Round()', () => {
  assert.equal(vbaRound(0.5), 0); assert.equal(vbaRound(1.5), 2); assert.equal(vbaRound(2.5), 2); assert.equal(vbaRound(3.5), 4);
  assert.equal(vbaRound(20.45, 1) === 20.4 || vbaRound(20.45, 1) === 20.5, true);
});
test('normalizeZip pads to 5 digits and trims', () => {
  assert.equal(normalizeZip('601'), '00601'); assert.equal(normalizeZip(' 60601 '), '60601'); assert.equal(normalizeZip(''), '');
});
test('haversine distance Chicago -> Atlanta is about 590 miles', () => {
  const d = calculateDistanceMiles(41.8781, -87.6298, 33.749, -84.388);
  assert.ok(d > 580 && d < 610, String(d));
  assert.equal(calculateDistanceMiles(10, 10, 10, 10), 0);
});
test('normalizeDateString outputs m/d/yyyy without leading zeros', () => {
  assert.equal(normalizeDateString('11/05/2026'), '11/5/2026');
});
test('group id has the documented shape', () => {
  assert.match(createLoadGroupId(new Date(2026, 10, 16, 8, 5, 9), 7), /^FS-20261116-080509-\d{6,}-R7$/);
});
test('formatCurrency0', () => { assert.equal(formatCurrency0(1234.4), '$1,234'); });
test('CSV: quotes, embedded commas/newlines, CRLF round trip', () => {
  const rows = [['a', 'b,c', 'd"e'], ['line\nbreak', '', 'x']];
  assert.deepEqual(parseDelimited(toDelimited(rows, ','), ','), rows);
});
test('CSV: BOM stripped and tab detection', () => {
  const t = '﻿a\tb\r\n1\t2\r\n';
  assert.equal(detectDelimiter(t), '\t');
  assert.deepEqual(parseDelimited(t, '\t'), [['a', 'b'], ['1', '2']]);
});
