import test from 'node:test';
import assert from 'node:assert/strict';
import { realZipMap } from './helpers.js';
import { parseTruckText, parseTruckList, makeTruck, mergeTrucks, freshness, isActive, matchTrucksToLoad, matchLoadsToTruck, carrierHistoryFromLog, truckKeyOf } from '../../js/core/truckbook.js';
import { blankPosting } from '../../js/core/model.js';

const NOW = new Date(2026, 10, 20, 10, 0).getTime();       // Fri Nov 20 2026 10:00
const zip = realZipMap();
const load = (o = {}) => blankPosting({ originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Atlanta', destState: 'GA', destZip: '30303', pickupEarliest: '2026-11-21', equip: 'V', ...o });

test('parseTruckText reads a carrier e-mail: place, destination, equipment, date, contact', () => {
  const t = parseTruckText("Hi, I have a 53' dry van empty in Gary, IN tomorrow going to Atlanta, GA. Call 312-555-0147. MC 123456", { now: NOW, zipMap: zip });
  assert.equal(t.oCity, 'Gary'); assert.equal(t.oState, 'IN'); assert.equal(t.dCity, 'Atlanta'); assert.equal(t.dState, 'GA');
  assert.equal(t.date, '2026-11-21'); assert.equal(t.phone, '312-555-0147'); assert.equal(t.mc, 'MC 123456'); assert.equal(t.equip, 'V');
  const o = parseTruckText('Truck available in Joliet IL going anywhere', { now: NOW });
  assert.equal(o.oCity, 'Joliet'); assert.equal(o.destOpen, true); assert.equal(o.dState, '');
  assert.equal(parseTruckText('thanks for the info', { now: NOW }), null);
  assert.equal(parseTruckText('Reefer in Harrisburg PA heading to VA', { now: NOW }).equip, 'R');
});

test('parseTruckList: CSV with headers and free text, one truck per line', () => {
  const csv = 'Carrier,MC,Phone,City,State,Equipment,Date\nACME TRUCKING,123456,312-555-0147,Joliet,IL,Van,11/21/2026\nBeta LLC,654321,717-555-0100,Harrisburg,PA,Reefer,11/20/2026\nNoplace,1,2,,,,';
  const r = parseTruckList(csv, { now: NOW, zipMap: zip });
  assert.equal(r.trucks.length, 2); assert.equal(r.skipped.length, 1);
  assert.equal(r.trucks[1].equip, 'R'); assert.equal(r.trucks[0].oZip.length, 5);
  const free = parseTruckList('Van in Joliet IL going anywhere\nFlatbed in York PA to Richmond VA tomorrow\nnothing here', { now: NOW, zipMap: zip });
  assert.equal(free.trucks.length, 2); assert.equal(free.skipped.length, 1);
});

test('freshness decays: full for 4 h, nothing after 36 h; stale or expired trucks are not active', () => {
  const t = makeTruck({ oCity: 'Joliet', oState: 'IL', phone: '312-555-0147', carrierName: 'A' }, { now: NOW, zipMap: zip });
  assert.equal(freshness({ at: NOW - 2 * 3600000 }, NOW), 1);
  assert.ok(freshness({ at: NOW - 20 * 3600000 }, NOW) < 0.6);
  assert.equal(freshness({ at: NOW - 40 * 3600000 }, NOW), 0);
  assert.equal(isActive(t, NOW), true); assert.equal(isActive({ ...t, exp: NOW - 1 }, NOW), false); assert.equal(isActive({ ...t, status: 'booked' }, NOW), false);
});

test('mergeTrucks: a newer report from the same carrier replaces the old one, never duplicates', () => {
  const a = makeTruck({ oCity: 'Joliet', oState: 'IL', mc: '123456', phone: '312-555-0147', date: '2026-11-21' }, { now: NOW, zipMap: zip });
  const b = makeTruck({ oCity: 'Joliet', oState: 'IL', mc: 'MC 123456', phone: '312-555-0147', date: '2026-11-21', dCity: 'Atlanta', dState: 'GA' }, { now: NOW + 3600000, zipMap: zip });
  assert.equal(truckKeyOf(a), truckKeyOf(b));
  const m = mergeTrucks([a], [b]); assert.equal(m.trucks.length, 1); assert.equal(m.updated, 1); assert.equal(m.trucks[0].dState, 'GA');
  assert.equal(mergeTrucks(m.trucks, [a]).trucks[0].dState, 'GA', 'an older report never overwrites a newer one');
});

test('matchTrucksToLoad: nearer + fresher + heading your way beats far, stale and going elsewhere; wrong equipment and too-far trucks are dropped', () => {
  const mk = (o) => makeTruck({ phone: '312-555-0147', carrierName: o.n, ...o }, { now: NOW, zipMap: zip });
  const trucks = [
    mk({ n: 'near-open', oCity: 'Joliet', oState: 'IL', destOpen: true, date: '2026-11-21' }),
    mk({ n: 'same-city-to-ga', oCity: 'Chicago', oState: 'IL', dCity: 'Atlanta', dState: 'GA', date: '2026-11-21' }),
    mk({ n: 'stale', oCity: 'Gary', oState: 'IN', destOpen: true, date: '2026-11-21', at: NOW - 30 * 3600000 }),
    mk({ n: 'reefer', oCity: 'Chicago', oState: 'IL', equip: 'VR', destOpen: true, date: '2026-11-21' }),
    mk({ n: 'flatbed', oCity: 'Chicago', oState: 'IL', equip: 'F', destOpen: true, date: '2026-11-21' }),
    mk({ n: 'far', oCity: 'Phoenix', oState: 'AZ', destOpen: true, date: '2026-11-21' }),
    mk({ n: 'late', oCity: 'Chicago', oState: 'IL', destOpen: true, date: '2026-11-25' }),
  ];
  const r = matchTrucksToLoad(load(), trucks, { zipMap: zip, now: NOW });
  const names = r.map(x => x.truck.carrierName);
  assert.equal(names[0], 'same-city-to-ga');
  assert.ok(names.indexOf('near-open') < names.indexOf('stale'));
  assert.ok(!names.includes('flatbed') && !names.includes('far') && !names.includes('late'));
  assert.ok(names.includes('reefer'), 'a reefer can haul dry freight');
  assert.ok(r[0].reasons.some(x => /wants to go to GA/.test(x)));
});

test('matchLoadsToTruck is the inverse and history lifts a carrier', () => {
  const t = makeTruck({ oCity: 'Harrisburg', oState: 'PA', destOpen: true, mc: '123456', phone: '717-555-0100', date: '2026-11-21' }, { now: NOW, zipMap: zip });
  const loads = [load({ originCity: 'York', originState: 'PA', originZip: '17401', destCity: 'Richmond', destState: 'VA', destZip: '23219' }), load()];
  const r = matchLoadsToTruck(t, loads, { zipMap: zip, now: NOW });
  assert.equal(r.length, 1); assert.equal(r[0].load.originCity, 'York');
  const hist = carrierHistoryFromLog([{ outcome: 'Covered', carrier: { mc: 'MC 123456' }, at: '2026-10-01' }]);
  const plain = matchLoadsToTruck(t, loads, { zipMap: zip, now: NOW })[0].score;
  const lifted = matchLoadsToTruck(t, loads, { zipMap: zip, now: NOW, carrierHistory: hist })[0].score;
  assert.ok(lifted > plain);
});
