// v14: Team Network core logic: invite codes, truck board (expiry, status, search), load rescue, shared lane intelligence, other boards.
import test from 'node:test';
import assert from 'node:assert/strict';
import { realZipMap } from './helpers.js';
import { newId, makeInvite, parseInvite, formatInvite, carrierKey, resolveSpot, equipFits, isoDay, addDays, todayIso, repriceTotal, median, percentile, HOUR, DAY } from '../../js/core/netcommon.js';
import { buildTruck, cleanTruck, cleanStat, resolveTrucks, statRecord, searchTrucks, prunable, expiryFor, parseDest, destMatch, queryForLoad, MAX_TTL_HOURS } from '../../js/core/trucks.js';
import { rescueFacts, buildRescue, cleanRescue, rescueState, needsHelp, buildTip, cleanTip, alternateCities, helperBoard, ownCarrierPicks } from '../../js/core/rescue.js';
import { coverEvent, inquiryEvent, outreachEvent, cleanEvent, summarizeLane, summarizeLanes, liftAdvice, liftText, suggestStep, confidence, shardKey, shardMonth, shardOwner, laneOf } from '../../js/core/laneintel.js';
import { trucksmarterCsv, truckerPathCsv, tsEquipment, mapHeaders, hmm, deliveryDay, postText, TS_COLUMNS } from '../../js/core/boards.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';

const NOW = new Date(2026, 10, 17, 10, 0, 0).getTime();     // Tue 11/17/2026 10:00 local
const ME = { uid: 'u-me', name: 'Owen K', email: 'owen@tql.example' };
const PEER = { uid: 'u-peer', name: 'Priya S', email: 'priya@tql.example' };
const zm = realZipMap();

/* ------------------------------------------------------------------------------------------------ ids, invites, helpers */
test('ids are time ordered and unique', () => {
  const a = newId(1000), b = newId(2000), c = newId(2000, () => 0.5);
  assert.ok(a < b); assert.notEqual(b, c); assert.match(a, /^[0-9a-z]{14}$/);
});

test('invite codes: made, formatted, read back however they are pasted, bad ones refused', () => {
  const inv = makeInvite();
  assert.match(inv.code, /^([A-Z2-9]{4}-){4}[A-Z2-9]{4}$/);
  assert.equal(inv.teamId.length, 8); assert.equal(inv.secret.length, 12);
  for (const pasted of [inv.code, inv.code.toLowerCase(), ' ' + inv.code.replace(/-/g, ' ') + ' ', 'Join code: ' + inv.code + '!']) {
    const p = parseInvite(pasted); assert.ok(p, pasted); assert.equal(p.teamId, inv.teamId); assert.equal(p.secret, inv.secret);
  }
  assert.equal(parseInvite('ABCD-EFGH'), null);
  assert.equal(parseInvite('0000-0000-0000-0000-0000'), null, 'ambiguous characters are not in the alphabet');
  assert.equal(parseInvite(''), null);
  assert.equal(formatInvite('abcdefghjk'), 'ABCD-EFGH-JK');
  const seeded = makeInvite(() => 0.1); assert.equal(makeInvite(() => 0.1).code, seeded.code);
});

test('carrier keys identify by MC/DOT first, then a hash of the e-mail (the address itself is never in the key)', () => {
  assert.equal(carrierKey({ mc: 'MC# 123456' }), 'mc:123456');
  assert.equal(carrierKey({ mc: 'USDOT 3456789', email: 'a@b.co' }), 'dot:3456789');
  const k = carrierKey({ email: 'Dispatch@Haul.example' });
  assert.match(k, /^em:[0-9a-z]+$/); assert.ok(!k.includes('haul'));
  assert.equal(k, carrierKey({ email: 'dispatch@haul.example' }));
  assert.equal(carrierKey({}), '');
});

test('spots resolve from a ZIP or "City, ST"; equipment fits by family; dates are strict', () => {
  assert.equal(resolveSpot('60601', zm).state, 'IL');
  const dal = resolveSpot('Dallas, TX', zm); assert.equal(dal.state, 'TX'); assert.match(dal.zip, /^75/);
  assert.equal(resolveSpot('Nowhereville', zm), null);
  assert.ok(equipFits('V', 'V')); assert.ok(equipFits('V', 'VR')); assert.ok(!equipFits('V', 'R')); assert.ok(equipFits('V', 'R', true)); assert.ok(!equipFits('F', 'V'));
  assert.equal(isoDay('11/20/2026'), '2026-11-20'); assert.equal(isoDay('2026-11-20'), '2026-11-20'); assert.equal(isoDay('2/30/2026'), ''); assert.equal(isoDay('junk'), '');
  assert.equal(addDays('2026-11-30', 2), '2026-12-02'); assert.equal(todayIso(NOW), '2026-11-17');
  assert.equal(repriceTotal([{ type: 'reprice', detail: '+$100' }, { type: 'reprice', detail: '+$50' }, { type: 'reprice', detail: '-$25' }, { type: 'wave2', detail: '+$999' }]), 125);
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null); assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.75), 8);
});

/* ------------------------------------------------------------------------------------------------ truck board */
const form = (over = {}) => ({ carrierName: 'Blue Line Freight', mc: 'MC 445566', email: 'dispatch@blueline.example', phone: '(312) 555-0101', equip: 'V', oCity: 'Chicago', oState: 'il', dCity: '', dState: '', destOpen: true, date: '2026-11-18', note: 'Two trucks. Driver at the yard.', ...over });
const publish = (over, me = ME, opts = {}) => { const r = buildTruck(form(over), me, { now: NOW, zipMap: zm, ...opts }); assert.ok(r.ok, r.error); return { ...r.truck, id: newId(NOW + Math.random() * 1000) }; };

test('publishing a truck: validation, defaults, ZIP filled from the ZIP Map, 24 h life', () => {
  const r = buildTruck(form(), ME, { now: NOW, zipMap: zm });
  assert.ok(r.ok); const t = r.truck;
  assert.equal(t.oState, 'IL'); assert.match(t.oZip, /^606/); assert.equal(t.mc, 'MC 445566'); assert.equal(t.exp, NOW + 24 * HOUR); assert.equal(t.destOpen, true); assert.equal(t.uid, 'u-me');
  assert.match(buildTruck(form({ carrierName: '', mc: '', email: '', phone: '' }), ME, { now: NOW }).error, /carrier/i);
  assert.match(buildTruck(form({ email: '', phone: '' }), ME, { now: NOW }).error, /e-mail or a phone/i);
  assert.match(buildTruck(form({ oCity: '', oState: '', oZip: '' }), ME, { now: NOW, zipMap: zm }).error, /Where is the truck/);
  const zipOnly = buildTruck(form({ oCity: '', oState: '', oZip: '75201' }), ME, { now: NOW, zipMap: zm }); assert.ok(zipOnly.ok); assert.equal(zipOnly.truck.oCity, 'Dallas');
  assert.match(buildTruck(form({ date: '2026-11-10' }), ME, { now: NOW }).error, /passed/);
  assert.match(buildTruck(form({ date: '2026-11-20', dateTo: '2026-11-19' }), ME, { now: NOW }).error, /before/);
  assert.equal(buildTruck(form({ dCity: 'Dallas', dState: 'tx', destOpen: false }), ME, { now: NOW, zipMap: zm }).truck.dState, 'TX');
  assert.equal(buildTruck(form({ phone: 'abc' }), ME, { now: NOW }).truck.phone, '', 'junk phone is dropped, e-mail still reaches the carrier');
});

test('truck lifetime is configurable and bounded', () => {
  assert.equal(expiryFor(4, { now: NOW }), NOW + 4 * HOUR);
  assert.equal(expiryFor('garbage', { now: NOW }), NOW + 24 * HOUR);
  assert.equal(expiryFor(9999, { now: NOW }), NOW + MAX_TTL_HOURS * HOUR);
  assert.equal(expiryFor(0.1, { now: NOW }), NOW + HOUR, 'never shorter than an hour');
  const endOfDay = expiryFor('date', { now: NOW, date: '2026-11-18' }); assert.equal(new Date(endOfDay).getDate(), 18); assert.equal(new Date(endOfDay).getHours(), 23);
  assert.equal(buildTruck(form(), ME, { now: NOW, ttlHours: 8 }).truck.exp, NOW + 8 * HOUR);
  assert.equal(buildTruck(form({ ttl: 'date', date: '2026-11-19' }), ME, { now: NOW }).truck.exp, expiryFor('date', { now: NOW, date: '2026-11-19' }));
});

test('trucks expire by themselves; booked / withdrawn win; only the publisher can renew', () => {
  const t = publish({});
  assert.equal(resolveTrucks([t], [], NOW)[0].status, 'open');
  assert.equal(resolveTrucks([t], [], NOW + 24 * HOUR)[0].status, 'expired', 'expired the moment the lifetime ends');
  assert.equal(resolveTrucks([t], [], NOW + 24 * HOUR - 1)[0].status, 'open');
  const booked = statRecord(t, 'booked', PEER, { now: NOW + HOUR });
  const rb = resolveTrucks([t], [booked], NOW + 2 * HOUR)[0]; assert.equal(rb.status, 'booked'); assert.equal(rb.statusBy, 'Priya S');
  assert.equal(resolveTrucks([t], [statRecord(t, 'withdrawn', ME, { now: NOW + HOUR })], NOW + 2 * HOUR)[0].status, 'withdrawn');
  const renewed = statRecord(t, 'renew', ME, { now: NOW + 20 * HOUR, ttl: 24 });
  assert.equal(resolveTrucks([t], [renewed], NOW + 30 * HOUR)[0].status, 'open', 'the owner renewed it');
  const forged = { ...statRecord(t, 'renew', PEER, { now: NOW + 20 * HOUR, ttl: 24 }) };
  assert.equal(resolveTrucks([t], [forged], NOW + 30 * HOUR)[0].status, 'expired', 'a teammate cannot extend someone else\'s truck');
  const reopened = statRecord(t, 'renew', ME, { now: NOW + 3 * HOUR, ttl: 24 });
  assert.equal(resolveTrucks([t], [reopened], NOW + 4 * HOUR)[0].status, 'open', 'the owner can put a booked-then-fell-through truck back');
  assert.throws(() => statRecord(t, 'nope', ME));
});

test('old trucks are safe to delete a week after they stop mattering', () => {
  const t = publish({});
  assert.ok(!prunable(resolveTrucks([t], [], NOW + 24 * HOUR)[0], NOW + 24 * HOUR));
  assert.ok(prunable(resolveTrucks([t], [], NOW)[0], NOW + 24 * HOUR + 8 * DAY));
  const b = resolveTrucks([t], [statRecord(t, 'booked', PEER, { now: NOW + 10 * DAY })], NOW + 11 * DAY)[0];
  assert.ok(!prunable(b, NOW + 11 * DAY), 'a recent booking is kept even though the truck itself expired long ago');
});

test('truck records read from storage are cleaned (nothing from another person\'s file is trusted)', () => {
  const t = publish({});
  assert.deepEqual(cleanTruck({ ...t, extra: 'x' }), cleanTruck(t));
  assert.equal(cleanTruck({ ...t, uid: '' }), null); assert.equal(cleanTruck({ ...t, exp: 'soon' }), null); assert.equal(cleanTruck({ ...t, oCity: '' }), null); assert.equal(cleanTruck(null), null);
  assert.equal(cleanTruck({ ...t, carrierName: 'A'.repeat(500) }).carrierName.length, 80);
  assert.equal(cleanTruck({ ...t, email: 'not-an-email' }).email, '');
  assert.equal(cleanStat({ id: 'x', s: 'hacked', at: 1 }), null); assert.equal(cleanStat({ id: 'x', s: 'booked', at: 'now' }), null); assert.equal(cleanStat({ id: 'x', s: 'booked', at: 5, by: 'u' }).s, 'booked');
});

test('searching trucks: origin ZIP + radius, destination, equipment, date, carrier / MC, e-mail', () => {
  const chi = publish({ carrierName: 'Blue Line', mc: 'MC 445566', email: 'a@blue.example' });
  const jol = publish({ carrierName: 'Prairie Haul', mc: 'MC 778899', email: 'b@prairie.example', oCity: 'Joliet', oState: 'IL', dCity: 'Dallas', dState: 'TX', destOpen: false, equip: 'R' }, PEER);
  const dal = publish({ carrierName: 'Lone Star', mc: 'MC 112233', email: 'c@lone.example', oCity: 'Dallas', oState: 'TX', date: '2026-11-25', dCity: 'Atlanta', dState: 'GA', destOpen: false });
  const old = publish({ carrierName: 'Old Timer', mc: 'MC 999000', email: 'old@x.example' }); old.exp = NOW - 1;
  const rows = resolveTrucks([chi, jol, dal, old], [], NOW);
  const s = (q) => searchTrucks(rows, q, { zipMap: zm, now: NOW }).map(r => r.carrierName);

  assert.deepEqual(s({}).sort(), ['Blue Line', 'Lone Star', 'Prairie Haul'], 'expired trucks never show as available');
  assert.deepEqual(s({ status: 'all' }).length, 4);
  assert.deepEqual(s({ origin: '60601', radius: 20 }), ['Blue Line'], 'Joliet is about 35 miles from downtown Chicago');
  assert.deepEqual(s({ origin: '60601', radius: 60 }), ['Blue Line', 'Prairie Haul'], 'nearest first');
  assert.deepEqual(s({ origin: 'Chicago, IL', radius: 60 }), ['Blue Line', 'Prairie Haul']);
  const near = searchTrucks(rows, { origin: '60601', radius: 60 }, { zipMap: zm, now: NOW }); assert.ok(near[0].miles < near[1].miles); assert.ok(near[1].miles > 25 && near[1].miles < 50, String(near[1].miles));
  assert.deepEqual(s({ dest: 'TX' }).sort(), ['Blue Line', 'Prairie Haul'], 'a truck that goes anywhere also matches a destination search');
  assert.deepEqual(s({ dest: 'Dallas, TX' }).sort(), ['Blue Line', 'Prairie Haul']);
  assert.deepEqual(s({ dest: 'GA' }).sort(), ['Blue Line', 'Lone Star']);
  assert.deepEqual(s({ equip: 'R' }), ['Prairie Haul']); assert.deepEqual(s({ equip: 'V' }).sort(), ['Blue Line', 'Lone Star']);
  assert.deepEqual(s({ equip: 'V', looseReefer: true }).sort(), ['Blue Line', 'Lone Star', 'Prairie Haul']);
  assert.deepEqual(s({ date: '2026-11-18' }).sort(), ['Blue Line', 'Prairie Haul'], 'a truck is available on its date and the two days after');
  assert.deepEqual(s({ date: '2026-11-25' }), ['Lone Star']); assert.deepEqual(s({ date: '2026-12-30' }), []);
  assert.deepEqual(s({ carrier: 'prairie' }), ['Prairie Haul']); assert.deepEqual(s({ carrier: 'MC 112233' }), ['Lone Star']); assert.deepEqual(s({ carrier: '778899' }), ['Prairie Haul']);
  assert.deepEqual(s({ email: 'lone.example' }), ['Lone Star']); assert.deepEqual(s({ email: 'owen@tql' }).sort(), ['Blue Line', 'Lone Star'], 'the publisher\'s e-mail is searchable too');
  assert.deepEqual(s({ origin: '60601', radius: 60, dest: 'GA' }), ['Blue Line'], 'filters combine');
  assert.deepEqual(s({ origin: 'Atlantis' }), [], 'an unknown place finds nothing instead of everything');
});

test('destination matching and the search built from a load on the board', () => {
  assert.deepEqual(parseDest('TX'), { city: '', state: 'TX' }); assert.deepEqual(parseDest('Dallas, tx'), { city: 'Dallas', state: 'TX' }); assert.deepEqual(parseDest('Dallas'), { city: 'Dallas', state: '' }); assert.equal(parseDest(''), null);
  const open = { destOpen: true }, tx = { destOpen: false, dState: 'TX', dCity: '' }, houston = { destOpen: false, dState: 'TX', dCity: 'Houston' };
  assert.equal(destMatch(open, parseDest('GA')), 'open'); assert.equal(destMatch(tx, parseDest('Dallas, TX')), 'state'); assert.equal(destMatch(houston, parseDest('Houston, TX')), 'city');
  assert.equal(destMatch(houston, parseDest('GA')), ''); assert.equal(destMatch(houston, null), 'any');
  const q = queryForLoad({ originZip: '60601', originCity: 'Chicago', originState: 'IL', equip: 'r', pickupEarliest: '11/20/2026' }, { carrierRadiusMiles: 50 });
  assert.deepEqual(q, { origin: '60601', radius: 50, equip: 'R', looseReefer: false, date: '2026-11-20', dest: '', status: 'open' });
});

/* ------------------------------------------------------------------------------------------------ load rescue */
const posting = (over = {}) => ({ id: 'p1', groupId: 'g1', variant: 'Original', originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Dallas', destState: 'TX', destZip: '75201', equip: 'V', weight: '42000', length: 53,
  pickupEarliest: '11/20/2026', targetRate: '2400', datRate: '', details: 'CUSTOMER SECRET TEXT', referenceId: 'REF123', comment: 'secret comment', inquiryCount: '', createdAt: new Date(NOW - 100 * 60000).toISOString(),
  ops: [{ type: 'reprice', detail: '+$100' }, { type: 'outreach', detail: '5 draft(s)' }, { type: 'wave2', detail: '5 draft(s)' }], ...over });

test('a rescue request summarises what was tried and leaks nothing private', () => {
  const members = [posting(), posting({ id: 'p2', variant: 'Nearby 1', inquiryCount: '' })];
  const facts = rescueFacts(members, { outreach: [{ postingId: 'p1', email: 'a@x.example' }, { postingId: 'p2', email: 'a@x.example' }, { postingId: 'p1', email: 'b@x.example' }, { postingId: 'other', email: 'z@x.example' }], inquiries: [], now: NOW });
  assert.deepEqual({ age: facts.ageMin, contacted: facts.contacted, inq: facts.inquiries, raised: facts.raised, waves: facts.waves, target: facts.target }, { age: 100, contacted: 2, inq: 0, raised: 100, waves: 2, target: 2400 });
  const r = buildRescue(members, facts, ME, { note: 'Tight dock window', now: NOW, miles: 967.4, id: 'r1' });
  assert.ok(r.ok); const json = JSON.stringify(r.rescue);
  for (const secret of ['CUSTOMER SECRET', 'REF123', 'secret comment', 'owen@tql.example'.replace('owen@tql.example', 'zzz')]) assert.ok(!json.includes(secret), secret);
  assert.equal(r.rescue.miles, 967); assert.equal(r.rescue.pickup, '2026-11-20'); assert.equal(r.rescue.exp, NOW + 12 * HOUR); assert.equal(r.rescue.status, 'open');
  assert.deepEqual(cleanRescue(r.rescue), { ...r.rescue, closedAt: 0 });
  assert.match(buildRescue([posting({ destCity: '' })], facts, ME, {}).error, /destination/);
  assert.equal(buildRescue([], facts, ME, {}).ok, false);
  assert.equal(cleanRescue({ ...r.rescue, id: '' }), null);
  assert.equal(rescueState(r.rescue, NOW), 'open'); assert.equal(rescueState(r.rescue, NOW + 13 * HOUR), 'expired'); assert.equal(rescueState({ ...r.rescue, status: 'covered' }, NOW), 'covered');
});

test('"this load needs help" fires after 90 quiet minutes, once', () => {
  assert.ok(needsHelp({ inquiries: 0, ageMin: 95 })); assert.ok(!needsHelp({ inquiries: 0, ageMin: 60 })); assert.ok(!needsHelp({ inquiries: 2, ageMin: 300 }));
  assert.ok(!needsHelp({ inquiries: 0, ageMin: 300 }, { alreadyAsked: true })); assert.ok(needsHelp({ inquiries: 0, ageMin: 31 }, { afterMin: 30 }));
});

test('tips: each kind is validated; the owner marks the helpful ones; helpers are ranked', () => {
  const rescue = { id: 'r1' };
  const ok = (input) => { const r = buildTip(input, rescue, PEER, { now: NOW, id: newId(NOW + Math.random() * 999) }); assert.ok(r.ok, r.error); return r.tip; };
  const car = ok({ type: 'carrier', carrierName: 'Prairie Haul', mc: 'mc 778899', phone: '(815) 555-0100', text: 'Ran Joliet-Dallas twice' }); assert.equal(car.mc, 'MC 778899');
  const rate = ok({ type: 'rate', rate: '2,550' }); assert.equal(rate.rate, 2550);
  const city = ok({ type: 'city', city: 'Joliet', state: 'il' }); assert.equal(city.state, 'IL');
  ok({ type: 'market', city: 'Gary', state: 'IN' }); ok({ type: 'note', text: 'Try the customer\'s second dock' });
  assert.match(buildTip({ type: 'carrier', carrierName: 'X', phone: '' }, rescue, PEER).error, /e-mail or phone/); assert.match(buildTip({ type: 'carrier', phone: '(815) 555-0100' }, rescue, PEER).error, /name or an MC/);
  assert.match(buildTip({ type: 'rate', rate: '5' }, rescue, PEER).error, /rate/); assert.match(buildTip({ type: 'city', city: 'Joliet' }, rescue, PEER).error, /city and state/); assert.match(buildTip({ type: 'note' }, rescue, PEER).error, /idea/);
  assert.equal(buildTip({ type: 'weird', text: 'hi' }, rescue, PEER).tip.type, 'note');
  assert.deepEqual(cleanTip(car), car); assert.equal(cleanTip({ ...car, rid: '' }), null);
  const board = helperBoard([car, rate, city, { ...city, id: 'z', uid: 'u-x', by: 'Sam' }], [{ id: car.id }, { id: rate.id }]);
  assert.deepEqual(board.map(b => [b.name, b.tips, b.helpful]), [['Priya S', 3, 2], ['Sam', 1, 0]]);
});

test('helpers can offer carriers from their OWN database and bigger markets near the pickup', () => {
  const rescue = { oCity: 'Chicago', oState: 'IL', oZip: '60601', dCity: 'Dallas', dState: 'TX', dZip: '75201', equip: 'V' };
  const carriers = [{ id: 'c1', carrierName: 'Chi Dallas Van', email: 'a@x.example', phone: '', originCity: 'Chicago', originState: 'IL', destCity: 'Dallas', destState: 'TX', equipment: 'Van', status: 'Active' },
    { id: 'c2', carrierName: 'Miami Only', email: 'b@x.example', originCity: 'Miami', originState: 'FL', destCity: 'Tampa', destState: 'FL', equipment: 'Van', status: 'Active' }];
  const picks = ownCarrierPicks(rescue, carriers, { zip: zm, settings: DEFAULT_SETTINGS, coverLog: [], inquiries: [] });
  assert.deepEqual(picks.map(p => p.carrier.carrierName), ['Chi Dallas Van']);
  const alt = alternateCities(zm, { city: 'Chicago', state: 'IL', zip: '60601' }, { limit: 5 });
  assert.ok(alt.length >= 3); assert.ok(alt.every(a => a.miles >= 8 && a.miles <= 60 && !(a.city === 'Chicago' && a.state === 'IL'))); assert.ok(alt.every((a, i) => i === 0 || alt[i - 1].pop >= a.pop));
  assert.deepEqual(alternateCities(null, { city: 'x', state: 'y' }), []);
});

/* ------------------------------------------------------------------------------------------------ lane intelligence */
const cover = (over = {}) => ({ id: 'e' + Math.random().toString(36).slice(2), outcome: 'Covered', closedAt: new Date(NOW - 5 * DAY).toISOString(), lane: { originCity: 'Chicago', originState: 'IL', destCity: 'Dallas', destState: 'TX' }, equip: 'V', rate: 2500, targetRate: 2350, datRate: 2350,
  ageHours: 4.5, inquiries: 6, carrier: { name: 'Prairie Haul', email: 'dispatch@prairie.example', mc: 'MC 778899', phone: '555' }, rows: [{ variant: 'Original', originZip: '60601', destZip: '75201', ops: [{ type: 'reprice', detail: '+$150' }] }], ...over });

test('lane events carry the lane, rates and a carrier name / MC, never contacts, customers or load text', () => {
  const e = coverEvent(cover(), ME, { zipMap: zm });
  assert.equal(e.k, 'c'); assert.equal(e.o, 'chicago|il'); assert.equal(e.d, 'dallas|tx'); assert.equal(e.r, 2500); assert.equal(e.tg, 2350); assert.equal(e.lf, 150); assert.equal(e.v, 1); assert.equal(e.cr, 'mc:778899'); assert.equal(e.hr, 4.5);
  assert.ok(e.mi > 800 && e.mi < 1100, String(e.mi));
  const json = JSON.stringify(e); for (const leak of ['dispatch', 'prairie.example', '555', 'details']) assert.ok(!json.includes(leak), leak);
  assert.equal(coverEvent(cover({ outcome: 'Expired' }), ME), null); assert.equal(coverEvent(cover({ lane: { originCity: 'x' } }), ME), null);
  assert.equal(coverEvent(cover({ rate: 500 }), ME).v, 0, 'a rate far from the target is not verified');
  assert.equal(coverEvent(cover({ carrier: {} }), ME).v, 0, 'a cover with no carrier is not verified');
  assert.equal(coverEvent(cover({ rate: '' }), ME).r, 0);
  assert.deepEqual(cleanEvent(e), e); assert.equal(cleanEvent({ ...e, k: 'z' }), null); assert.equal(cleanEvent({ ...e, t: 'x' }), null); assert.equal(cleanEvent({ ...e, r: 9e9 }).r, 0);
  assert.equal(shardKey(Date.UTC(2026, 10, 17), 'u-me'), '202611__u-me'); assert.equal(shardMonth('202611__u-me'), '202611'); assert.equal(shardOwner('202611__u-me'), 'u-me');
});

test('inquiries count; only believable rates are verified', () => {
  const posts = [posting()];
  const q = (over) => ({ id: 'q' + Math.random(), dateCounted: new Date(NOW - DAY).toISOString(), senderEmail: 'dispatch@prairie.example', postingId: 'p1', originCity: 'Chicago', originState: 'IL', destCity: 'Dallas', destState: 'TX', targetRate: '2400', lastCarrierRate: '2550', intent: 'rate', flag: '', source: 'app', ...over });
  const carriers = [{ email: 'dispatch@prairie.example', carrierName: 'Prairie Haul', mc: 'MC 778899' }];
  const good = inquiryEvent(q(), ME, { postings: posts, carriers, settings: DEFAULT_SETTINGS, zipMap: zm });
  assert.equal(good.v, 1); assert.equal(good.r, 2550); assert.equal(good.cr, 'mc:778899'); assert.equal(good.cn, 'Prairie Haul');
  const wild = inquiryEvent(q({ lastCarrierRate: '700' }), ME, { postings: posts, carriers, settings: DEFAULT_SETTINGS }); assert.equal(wild.v, 0); assert.equal(wild.r, 0); assert.equal(wild.k, 'i');
  const none = inquiryEvent(q({ lastCarrierRate: '' }), ME, { postings: posts, carriers, settings: DEFAULT_SETTINGS }); assert.equal(none.v, 0);
  const legacy = inquiryEvent(q({ source: 'outlook', intent: '' }), ME, { postings: posts, carriers, settings: DEFAULT_SETTINGS }); assert.equal(legacy.v, 0, 'a rate read by an old macro from the whole e-mail is unverified');
  assert.equal(inquiryEvent({ id: 'x', dateCounted: 'junk', originCity: 'a', originState: 'b', destCity: 'c', destState: 'd' }, ME, {}), null);
  const o = outreachEvent({ key: 'k1', dateTime: new Date(NOW).toISOString(), postingId: 'p1', email: 'x@y.example', mc: '', carrierName: 'X' }, ME, { postings: posts });
  assert.equal(o.k, 'o'); assert.ok(o.cr.startsWith('em:')); assert.ok(!JSON.stringify(o).includes('y.example')); assert.equal(outreachEvent({ postingId: 'nope', dateTime: new Date().toISOString(), email: 'a@b.co' }, ME, { postings: posts }), null);
});

function lane(n, { who = ['u-me', 'u-peer', 'u-sam'], rate = 2500, tg = 2350, lf = 100, miles = 950, o = 'chicago|il', d = 'dallas|tx', os = 'IL', ds = 'TX', t = NOW - 5 * DAY, k = 'c' } = {}) {
  return Array.from({ length: n }, (_, i) => ({ id: `${k}${o}${d}${i}`, k, t: t - i * 3600000, u: who[i % who.length], o, d, oc: o.split('|')[0], os, dc: d.split('|')[0], ds, e: 'V', mi: miles, cr: 'mc:' + (100 + i % 3), cn: 'Carrier ' + (i % 3), mc: 'MC ' + (100 + i % 3), r: rate + i * 10, tg, lf: lf + (i % 2) * 50, hr: 5, iq: 4, v: 1 }));
}

test('lane summary: inquiries, covers, asking rate, last cover, responsive carriers, trend, equipment', () => {
  const evs = [...lane(8), ...lane(12, { k: 'i', rate: 2600, who: ['u-me', 'u-peer'] }), ...lane(3, { k: 'o', rate: 0 }), ...lane(4, { o: 'dallas|tx', d: 'atlanta|ga', os: 'TX', ds: 'GA', miles: 780 })];
  const s = summarizeLane(evs, { o: 'chicago|il', d: 'dallas|tx' }, { now: NOW, uid: 'u-me' });
  assert.equal(s.covers, 8); assert.equal(s.inquiries, 12); assert.equal(s.carriersContacted, 3); assert.equal(s.coverN, 8);
  assert.ok(s.avgAsk > 2600 && s.avgAsk < 2700); assert.equal(s.askN, 12); assert.equal(s.lastCover.rate, 2500, 'the most recent cover is the newest one'); assert.equal(s.contributors, 3); assert.ok(s.mine > 0);
  assert.equal(s.equipment.van, 23); assert.equal(s.responsive.length, 3); assert.ok(s.responsive[0].covers >= s.responsive[2].covers); assert.ok(s.trend.length >= 1 && s.trend[0].paidN > 0);
  assert.equal(s.confidence.ok, true); assert.equal(s.dc, 'dallas'); assert.equal(s.miles, 950);
  const all = summarizeLanes(evs, { now: NOW }); assert.equal(all.length, 2); assert.equal(all[0].o, 'chicago|il', 'busiest lane first');
  assert.equal(summarizeLane(evs, { o: 'x', d: 'y' }, { now: NOW }).inquiries, 0);
  assert.equal(summarizeLane(lane(8, { t: NOW - 400 * DAY }), { o: 'chicago|il', d: 'dallas|tx' }, { now: NOW }).covers, 0, 'old data ages out of the window');
});

test('RECOMMENDATIONS NEED VERIFIED, SUFFICIENT DATA: too few covers, one contributor, or unverified rates give no advice', () => {
  const load = { o: 'chicago|il', d: 'dallas|tx', os: 'IL', ds: 'TX', equip: 'V', miles: 950 };
  const few = liftAdvice(lane(4), load, { now: NOW }); assert.equal(few.ok, false); assert.match(few.reason, /4 of 5 covers/);
  const solo = liftAdvice(lane(10, { who: ['u-me'] }), load, { now: NOW }); assert.equal(solo.ok, false); assert.match(solo.reason, /1 of 2 teammates/);
  const unverified = lane(10).map(e => ({ ...e, v: 0 })); assert.equal(liftAdvice(unverified, load, { now: NOW }).ok, false, 'unverified covers never count');
  const noTarget = lane(10).map(e => ({ ...e, tg: 0 })); assert.equal(liftAdvice(noTarget, load, { now: NOW }).ok, false);
  const wrongEquip = lane(10).map(e => ({ ...e, e: 'F' })); assert.equal(liftAdvice(wrongEquip, load, { now: NOW }).ok, false, 'flatbed history says nothing about a van load');
  assert.equal(liftAdvice([], load, { now: NOW }).ok, false);
  assert.equal(suggestStep(few, 0), null); assert.equal(suggestStep(null, 0), null);
  assert.match(liftText(few), /Not enough verified/);
  assert.equal(confidence(lane(5), {}).ok, true); assert.equal(confidence(lane(5), { minSample: 6 }).ok, false);
});

test('with enough data: the typical raise, how much is still missing, and similar lanes when the lane itself is thin', () => {
  const load = { o: 'chicago|il', d: 'dallas|tx', os: 'IL', ds: 'TX', equip: 'V', miles: 950 };
  const evs = lane(10, { lf: 100 });               // lifts alternate 100 / 150
  const a = liftAdvice(evs, load, { now: NOW });
  assert.equal(a.ok, true); assert.equal(a.level, 'lane'); assert.equal(a.n, 10); assert.equal(a.contributors, 3); assert.equal(a.medianLift, 125); assert.equal(a.p75Lift, 150); assert.equal(a.shareRaised, 1); assert.equal(a.medianHours, 5);
  assert.match(liftText(a, 100), /10 verified covers on this lane \(3 teammates\).*median \$125.*raised it \$100 so far/);
  assert.deepEqual(suggestStep(a, 0), { step: 125, basis: 'typical' }); assert.deepEqual(suggestStep(a, 100), { step: 25, basis: 'typical' });
  assert.deepEqual(suggestStep(a, 125), { step: 25, basis: 'upper' }); assert.equal(suggestStep(a, 150), null, 'already raised past what similar loads needed');
  // The lane itself has nothing; similar lanes (same equipment family, about the same length) carry the advice.
  const other = lane(9, { o: 'joliet|il', d: 'houston|tx', miles: 1000, lf: 200 });
  const sim = liftAdvice(other, load, { now: NOW }); assert.equal(sim.ok, true); assert.equal(sim.level, 'similar'); assert.ok(sim.medianLift >= 200);
  assert.match(liftText(sim), /similar lanes/);
  const far = liftAdvice(lane(9, { o: 'joliet|il', d: 'miami|fl', miles: 1900 }), load, { now: NOW }); assert.equal(far.ok, false, 'a 1,900 mile lane is not similar to a 950 mile lane');
  const zero = liftAdvice(lane(10, { lf: 0 }).map(e => ({ ...e, lf: 0 })), load, { now: NOW }); assert.equal(zero.medianLift, 0); assert.match(liftText(zero), /first posted rate usually covered/); assert.equal(suggestStep(zero, 0), null);
  assert.deepEqual(laneOf({ originCity: 'Chicago', originState: 'il', destCity: 'Dallas', destState: 'tx' }), { o: 'chicago|il', d: 'dallas|tx', os: 'IL', ds: 'TX' });
});

/* ------------------------------------------------------------------------------------------------ other boards */
const settings = (b = {}) => ({ ...DEFAULT_SETTINGS, boards: { contactPhone: '(312) 555-0199', contactEmail: 'owen@tql.example', ...b } });
const matrix = () => [posting({ createdAt: '', ops: [] }), posting({ id: 'p2', variant: 'Nearby 1', destCity: 'Fort Worth', destZip: '76102', datRate: '2450' }), posting({ id: 'p3', variant: 'Nearby 2', originCity: 'Joliet', originZip: '60435', status: 'Covered' })];
const ctx = (b) => ({ settings: settings(b), zip: zm });

test('TruckSmarter CSV: exactly the documented Row-Per-Load columns, required fields filled, dates yyyy-mm-dd', () => {
  const r = trucksmarterCsv(matrix(), ctx());
  const lines = r.csv.split('\n'); const head = lines[0].split(',');
  for (const req of ['LoadId', 'ContactPhone', 'EquipmentCode', 'Length', 'Weight', 'PickUpCity', 'PickUpState', 'PickUpZipCode', 'DeliveryCity', 'DeliveryState', 'DeliveryZipCode', 'PickUpStartDate', 'PickUpStartTime', 'DeliveryStartDate', 'DeliveryStartTime']) assert.ok(head.includes(req), req);
  assert.deepEqual(head, TS_COLUMNS); assert.equal(r.count, 2, 'covered postings are never posted'); assert.equal(r.problems.length, 0); assert.ok(!r.csv.includes('\r'));
  const col = (row, name) => row.split(',')[head.indexOf(name)];
  assert.equal(col(lines[1], 'PickUpStartDate'), '2026-11-20'); assert.match(col(lines[1], 'DeliveryStartDate'), /^2026-11-2[12]$/); assert.equal(col(lines[1], 'PickUpStartTime'), '8:00'); assert.equal(col(lines[1], 'DeliveryStartTime'), '17:00');
  assert.equal(col(lines[1], 'EquipmentCode'), 'V'); assert.equal(col(lines[1], 'Weight'), '42000'); assert.equal(col(lines[1], 'ContactPhone'), '(312) 555-0199'.replace(/,/g, ','));
  assert.notEqual(col(lines[1], 'LoadId'), col(lines[2], 'LoadId'), 'every posting is its own load with its own id');
  assert.equal(col(lines[2], 'OfferPrice'), '2450', 'a posting with its own rate carries it'); assert.equal(col(lines[1], 'OfferPrice'), '', 'when any posting has its own rate, the others post without one (same rule as the DAT file)');
  assert.ok(r.notes.some(n => /estimates/.test(n)));
  const plain = trucksmarterCsv([posting({ createdAt: '' })], ctx()); assert.equal(plain.csv.split('\n')[1].split(',')[head.indexOf('OfferPrice')], '2400', 'the target rate is the price');
});

test('TruckSmarter CSV leaves out (and names) postings it cannot post; weight can default; equipment is mapped or reported', () => {
  const noPhone = trucksmarterCsv(matrix(), ctx({ contactPhone: '' })); assert.equal(noPhone.count, 0); assert.ok(noPhone.problems[0].missing.some(m => /phone/i.test(m)));
  const noWeight = [posting({ weight: '', createdAt: '' })];
  assert.equal(trucksmarterCsv(noWeight, ctx()).count, 0); assert.ok(trucksmarterCsv(noWeight, ctx()).problems[0].missing.includes('Weight'));
  assert.equal(trucksmarterCsv(noWeight, ctx({ defaultWeight: 40000 })).count, 1);
  assert.equal(trucksmarterCsv([posting({ pickupEarliest: '' })], ctx()).problems[0].missing[0], 'Pickup date');
  assert.deepEqual(tsEquipment('V'), { code: 'V', note: '' }); assert.equal(tsEquipment('FD').code, 'FSD'); assert.match(tsEquipment('FD').note, /closest/); assert.equal(tsEquipment('VM').code, 'V'); assert.equal(tsEquipment('LB').code, 'F'); assert.equal(tsEquipment('zzz').code, 'V');
  const reef = trucksmarterCsv([posting({ equip: 'RM', createdAt: '' })], ctx()); assert.match(reef.notes.join(' '), /sent as R/);
  const fields = trucksmarterCsv([posting({ originCity: 'Montréal', comment: 'Line1\nLine2, with comma', createdAt: '' })], ctx()); assert.equal(fields.csv.split('\n').length, 3, 'no raw line breaks inside a row'); assert.ok(fields.csv.includes('Montreal'));
  assert.equal(deliveryDay('2026-11-20', 950, 500), '2026-11-22'); assert.equal(deliveryDay('2026-11-20', 30, 500), '2026-11-21'); assert.equal(hmm('5pm'), '17:00'); assert.equal(hmm('08:30'), '8:30'); assert.equal(hmm('x', '9:00'), '9:00');
});

test('Trucker Path: a plain load sheet, or the layout of the template you paste', () => {
  const std = truckerPathCsv(matrix(), ctx()); assert.equal(std.layout, 'standard'); assert.equal(std.count, 2); assert.ok(std.csv.split('\n')[0].includes('Origin City')); assert.ok(std.notes.some(n => /no fixed CSV/.test(n)));
  const map = mapHeaders('Load ID,Pickup City,Pickup State,Pickup Zip,Delivery City,Delivery State,Delivery Zip,Pickup Date,Delivery Date,Equipment Type,Weight,Offer Price,Mystery Column');
  assert.deepEqual(map.map, ['loadId', 'oCity', 'oState', 'oZip', 'dCity', 'dState', 'dZip', 'pickupDate', 'deliveryDate', 'equipCode', 'weight', 'rate', null]); assert.deepEqual(map.unknown, ['Mystery Column']);
  const tpl = truckerPathCsv([posting({ createdAt: '' })], ctx({ tpHeaders: 'Load ID,Pickup City,Pickup State,Delivery City,Delivery State,Pickup Date,Weight,Offer Price,Mystery Column' }));
  assert.equal(tpl.layout, 'template'); const [h, row] = tpl.csv.split('\n'); assert.equal(h, 'Load ID,Pickup City,Pickup State,Delivery City,Delivery State,Pickup Date,Weight,Offer Price,Mystery Column');
  assert.deepEqual(row.split(',').slice(1), ['Chicago', 'IL', 'Dallas', 'TX', '2026-11-20', '42000', '2400', '']); assert.ok(tpl.notes.some(n => /Mystery Column/.test(n)));
  assert.equal(truckerPathCsv([posting({ createdAt: '' })], ctx({ tpHeaders: 'nonsense,more nonsense' })).layout, 'standard', 'a template with nothing recognisable falls back to the standard sheet');
  const tab = mapHeaders('Load ID\tPickup City\tOffer Price'); assert.deepEqual(tab.map, ['loadId', 'oCity', 'rate']);
});

test('copy-ready post text for a board form', () => {
  const t = postText(posting({ createdAt: '' }), { settings: settings(), zip: zm, all: [posting()] });
  assert.match(t, /Chicago, IL 60601 {2}> {2}Dallas, TX 75201/); assert.match(t, /Equipment: Van \(V\)/); assert.match(t, /Rate: \$2400/); assert.match(t, /Contact: \(312\) 555-0199 \/ owen@tql\.example/); assert.match(t, /Delivery \(est\.\): 11\/2[12]\/2026/);
  assert.ok(!t.includes('CUSTOMER SECRET'));
});
