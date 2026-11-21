import test from 'node:test';
import assert from 'node:assert/strict';
import { inquiryQuality, isQualified, buildWeightedCaches, gridEffectiveness, gridSummary } from '../../js/core/effectiveness.js';
import { buildInquiryCaches } from '../../js/core/matrix.js';

const q = (o) => ({ conversationId: 'c' + Math.random(), originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', dateCounted: new Date().toISOString(), ...o });

test('inquiry quality: ETA/agreed > real quote > counter > bare question > decline', () => {
  const v = [q({ stage: 'ETA_RECEIVED' }), q({ lastCarrierRate: 1500 }), q({ stage: 'RATE_RESPONSE_SENT' }), q({ stage: 'INQUIRY_REPLY_SENT' }), q({ stage: 'DECLINED' })].map(inquiryQuality);
  assert.deepEqual(v, [...v].sort((a, b) => b - a)); assert.equal(isQualified(q({ stage: 'AGREED' })), true); assert.equal(isQualified(q({})), false);
});
test('weighted caches: a lane with real quotes outranks a lane with the same number of empty questions; counts stay plain integers', () => {
  const good = [1, 2].map(() => q({ lastCarrierRate: 1500, destCity: 'Atlanta' })), noise = [1, 2].map(() => q({ stage: 'INQUIRY_REPLY_SENT', destCity: 'Dallas', destState: 'TX' }));
  const w = buildWeightedCaches([...good, ...noise]);
  assert.ok(w.lane.get('chicago|il>atlanta|ga') > w.lane.get('chicago|il>dallas|tx'));
  const c = buildInquiryCaches([...good, ...noise], { weighted: true }); assert.equal(c.lane.get('chicago|il>atlanta|ga'), 2); assert.ok(c.weighted);
  assert.equal(buildInquiryCaches([...good]).weighted, undefined);
});
test('grid effectiveness measures the nine postings and says "still learning" until there is enough data', () => {
  const entry = (grid, covered) => ({ outcome: covered ? 'Covered' : 'Expired', covered: covered ? { grid } : null, postings: ['A-A', 'A-B', 'B-A'].map(g => ({ grid: g, inquiryCount: g === 'A-B' ? 3 : 1 })) });
  const small = gridEffectiveness([entry('A-B', true)]); assert.equal(small.enough, false); assert.match(gridSummary(small), /Still learning/);
  const log = Array.from({ length: 20 }, (_, i) => entry('A-B', i % 2 === 0));
  const e = gridEffectiveness(log); assert.equal(e.enough, true); assert.equal(e.best.grid, 'A-B'); assert.match(gridSummary(e), /Best posting: A-B/);
});
