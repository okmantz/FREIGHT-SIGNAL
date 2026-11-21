import test from 'node:test';
import assert from 'node:assert/strict';
import { realZipMap } from './helpers.js';
import { laneDifficulty, corridorCarriers, findBackhaulLoads, bundleOpportunities, swapOpportunities, backhaulPitch, headsOf } from '../../js/core/corridor.js';
import { blankPosting } from '../../js/core/model.js';

const zip = realZipMap(); const NOW = new Date(2026, 10, 20, 10).getTime();
const L = (o) => blankPosting({ equip: 'V', pickupEarliest: '2026-11-21', ...o });
const azfl = L({ originCity: 'Phoenix', originState: 'AZ', destCity: 'Miami', destState: 'FL' });
const pava = L({ originCity: 'Harrisburg', originState: 'PA', destCity: 'Richmond', destState: 'VA' });

test('laneDifficulty explains why a lane is hard and suggests a premium', () => {
  const a = laneDifficulty(azfl, { zipMap: zip }); assert.ok(a.tough); assert.ok(a.premium >= 0.09); assert.ok(a.notes.some(n => /FL/.test(n)));
  const b = laneDifficulty(pava, { zipMap: zip }); assert.ok(b.tough); assert.ok(b.notes.some(n => /Short haul/.test(n)));
  const c = laneDifficulty(L({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA' }), { zipMap: zip }); assert.equal(c.tough, false);
});

test('corridorCarriers: finds carriers delivering near the pickup and living near the delivery', () => {
  const carriers = [
    { carrierName: 'Delivers Near', email: 'a@x.com', originCity: 'Miami', originState: 'FL', destCity: 'Phoenix', destState: 'AZ' },
    { carrierName: 'Home In Miami', email: 'b@x.com', originCity: 'Miami', originState: 'FL', destCity: 'Atlanta', destState: 'GA' },
    { carrierName: 'Nowhere', email: 'c@x.com', originCity: 'Seattle', originState: 'WA', destCity: 'Portland', destState: 'OR' },
  ];
  const coverLog = [{ outcome: 'Covered', closedAt: new Date(NOW - 5 * 86400000).toISOString(), lane: { originCity: 'Dallas', originState: 'TX', destCity: 'Phoenix', destState: 'AZ' }, carrier: { email: 'd@x.com', name: 'Recent Phoenix' } }];
  const r = corridorCarriers(azfl, { carriers, coverLog, trucks: [], zipMap: zip, now: NOW });
  const names = r.map(x => x.name);
  assert.ok(names.includes('Delivers Near') && names.includes('Home In Miami') && names.includes('Recent Phoenix'));
  assert.ok(!names.includes('Nowhere'));
  assert.ok(r.find(x => x.name === 'Delivers Near').why.some(w => /delivers near your pickup/.test(w)));
  assert.equal(corridorCarriers(azfl, { carriers, zipMap: null }).length, 0);
});

test('findBackhaulLoads: your own load that starts where this one ends, on a date the truck can make', () => {
  const back = L({ originCity: 'Miami', originState: 'FL', destCity: 'Atlanta', destState: 'GA', pickupEarliest: '2026-11-28' });
  const gone = L({ originCity: 'Miami', originState: 'FL', destCity: 'Atlanta', destState: 'GA', pickupEarliest: '2026-11-10', pickupLatest: '2026-11-10' });
  const far = L({ originCity: 'Seattle', originState: 'WA', destCity: 'Portland', destState: 'OR' });
  const r = findBackhaulLoads(azfl, [azfl, back, gone, far], { zipMap: zip });
  assert.equal(r.length, 1); assert.equal(r[0].load, back);
  assert.match(backhaulPitch(azfl, r[0]), /round trip/);
});

test('bundleOpportunities chains loads and swapOpportunities uses teammates\' rescues', () => {
  const a = L({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', groupId: 'g1' });
  const b = L({ originCity: 'Atlanta', originState: 'GA', destCity: 'Miami', destState: 'FL', groupId: 'g2', pickupEarliest: '2026-11-23' });
  const ch = bundleOpportunities([a, b], { zipMap: zip }); assert.equal(ch.length, 1); assert.equal(ch[0].first, a);
  assert.equal(headsOf([{ variant: 'Original' }, { variant: 'Nearby 1' }]).length, 1);
  const rescue = { id: 'r1', status: 'open', by: 'Sam', equip: 'V', oCity: 'Miami', oState: 'FL', dCity: 'Atlanta', dState: 'GA' };
  const sw = swapOpportunities(azfl, [rescue], { zipMap: zip }); assert.equal(sw[0].kind, 'continue');
});
