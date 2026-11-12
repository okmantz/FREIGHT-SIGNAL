import test from 'node:test';
import assert from 'node:assert/strict';
import { originalLoadDetails, copyDetailsMessage } from '../../js/core/loaddetails.js';

const TQL = 'Pickup: Modesto, CA 95354\r\nDelivery: Reno, NV 89501\r\nWeight: 42000  \r\n';

test('copies the pasted source text of the Original row, newlines normalised', () => {
  const r = originalLoadDetails([
    { variant: 'Nearby 1', details: 'edited alternate text' },
    { variant: 'Original', details: TQL },
  ]);
  assert.equal(r.source, 'original');
  assert.equal(r.text, 'Pickup: Modesto, CA 95354\nDelivery: Reno, NV 89501\nWeight: 42000');
});

test('falls back to another member when the Original has no text', () => {
  const r = originalLoadDetails([{ variant: 'Original', details: '' }, { variant: 'Nearby 1', details: TQL }]);
  assert.equal(r.source, 'original');
  assert.match(r.text, /^Pickup: Modesto/);
});

test('a blank-row load gets an honest summary, flagged as such', () => {
  const r = originalLoadDetails([{ variant: 'Original', details: '', originCity: 'Fresno', originState: 'ca', originZip: '93706', destCity: 'Reno', destState: 'nv', pickupEarliest: '11/12/2026', weight: '40000', equip: 'V' }]);
  assert.equal(r.source, 'summary');
  assert.match(r.text, /Pickup: Fresno, CA 93706/);
  assert.match(r.text, /Delivery: Reno, NV/);
  assert.match(copyDetailsMessage(r.source), /summary/);
});

test('nothing to copy for an empty lane', () => {
  assert.deepEqual(originalLoadDetails([]), { text: '', source: 'none' });
  assert.equal(originalLoadDetails([{ variant: 'Original', details: '  ' }]).source, 'none');
  assert.match(copyDetailsMessage('none'), /no load details/);
});
