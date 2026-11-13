import test from 'node:test';
import assert from 'node:assert/strict';
import { attentionFlags } from '../../js/core/worklist.js';

// Regression: a carrier quote at the "book it" stage crashed the Freight Signal page ("formatCurrency0 is not defined").
test('attentionFlags: a bookable quote produces the urgent "hot" flag with a formatted rate', () => {
  const st = { rateSet: true, target: 1500, alerts: [], weatherText: '', hoursToPickup: 20, ageHours: 1, strategy: { staleHours: 6, closingHours: 24 },
    inquiries: { total: 1, flagged: 0, quotes: [{ email: 'carrier@example.test', rate: 1650 }], stage: { stage: 'book' } } };
  const flags = attentionFlags(st);
  const hot = flags.find((f) => f.kind === 'hot');
  assert.ok(hot, 'expected a hot flag');
  assert.match(hot.text, /\$1,650/);
});
