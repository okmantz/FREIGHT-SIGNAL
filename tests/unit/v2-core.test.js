import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPosting } from '../../js/core/model.js';
import { DEFAULT_SETTINGS } from '../../js/core/defaults.js';
import { realZipMap } from './helpers.js';
import { ladderStage, ladderReply, templatesOf, fillTemplate } from '../../js/core/ladder.js';
import { classForMiles, classifyLane, strategyFor } from '../../js/core/lanes.js';
import { buildCoverEntry, laneMemory, laneMemoryText, rateVsMemory, paceStats, attributionFromLog, weekStart, coverStatsByBroker } from '../../js/core/coverlog.js';
import { rankCarriers, planRankedOutreach, buildTruckCheck, laneFit, callList } from '../../js/core/ranking.js';
import { expiredGroups, hoursToPickup, isPastPickup } from '../../js/core/expiry.js';
import { summariseAlerts, overlapsWindow } from '../../js/core/weather.js';
import { analyseBoard, rankLoads, overviewCounts } from '../../js/core/worklist.js';
import { nextSteps } from '../../js/core/guidance.js';
import { outboxFile, parseDraftsDone, configFile } from '../../js/core/bridge.js';

const S = { ...DEFAULT_SETTINGS };
const post = (o = {}) => blankPosting({ originCity: 'Chicago', originState: 'IL', originZip: '60601', destCity: 'Atlanta', destState: 'GA', pickupEarliest: '1/1/2099', pickupLatest: '1/1/2099', datRate: '1500', targetRate: '1500', variant: 'Original', groupId: 'FS-1', ...o });

// ---------------------------------------------------------------- ladder
test('ladder: percent bands, not dollars ($200 is 22% on $900 but 3% on $6,000)', () => {
  assert.equal(ladderStage(1100, 900, S).stage, 'target');           // +22%
  assert.equal(ladderStage(6180, 6000, S).stage, 'book');            // +3.0%: $180 on a $6,000 load is inside the band
});
test('ladder: below or at target is always book; 3% / 8% edges; split rounds to $5', () => {
  assert.equal(ladderStage(1000, 1500, S).stage, 'book');
  assert.equal(ladderStage(1545, 1500, S).stage, 'book');            // exactly 3%
  assert.equal(ladderStage(1546, 1500, S).stage, 'split');
  assert.equal(ladderStage(1620, 1500, S).stage, 'split');           // exactly 8%
  assert.equal(ladderStage(1621, 1500, S).stage, 'target');
  assert.equal(ladderStage(1600, 1500, S).split, 1550);
  assert.equal(ladderStage(1601, 1500, S).split, 1550);
  assert.equal(ladderStage(1500, 0, S).stage, 'none');
});
test('ladder: percentages are configurable and wording is editable', () => {
  const s = { ...S, ladderBookPct: 1, ladderSplitPct: 4, templates: { split: 'Meet at {split}? ({pct} over {target})' } };
  assert.equal(ladderStage(1530, 1500, s).stage, 'split');
  assert.equal(ladderStage(1580, 1500, s).stage, 'target');
  assert.equal(ladderReply(1530, 1500, s).text, 'Meet at $1,515? (2.0% over $1,500)');
  assert.equal(templatesOf(S).book, 'Please confirm your ETA to pickup.');
  assert.equal(fillTemplate('{a} {b}', { a: 1 }), '1 {b}');
});

// ---------------------------------------------------------------- lanes
test('lanes: class by road miles with editable cut-offs', () => {
  assert.equal(classForMiles(100, S), 'local'); assert.equal(classForMiles(300, S), 'regional'); assert.equal(classForMiles(900, S), 'long');
  assert.equal(classForMiles(300, { laneLocalMax: 400 }), 'local');
  const zm = realZipMap();
  assert.equal(classifyLane(post({ destCity: 'Joliet', destState: 'IL', destZip: '' }), zm, S).cls, 'local');
  assert.equal(classifyLane(post(), zm, S).cls, 'long');
  assert.equal(strategyFor({ strategies: { local: { altMax: 12 } } }, 'local').altMax, 12);
});

// ---------------------------------------------------------------- cover log
const members = () => [post({ id: 'a' }), post({ id: 'b', variant: 'Nearby 1', originCity: 'Joliet' }), post({ id: 'c', variant: 'Nearby 2', originCity: 'Aurora' })];
test('coverlog: entry records which posting, carrier and rate', () => {
  const e = buildCoverEntry({ members: members(), coveredId: 'b', carrier: { name: 'Acme', email: 'DRIVER@acme.example' }, rate: 1450, inquiries: [{ postingId: 'a' }, { postingId: 'b' }] });
  assert.equal(e.outcome, 'Covered'); assert.equal(e.covered.originCity, 'Joliet'); assert.equal(e.covered.grid, 'A-B'.length ? e.covered.grid : '');
  assert.equal(e.carrier.email, 'driver@acme.example'); assert.equal(e.rate, 1450); assert.equal(e.inquiries, 2); assert.equal(e.postings.length, 3);
});
test('coverlog: lane memory exact and near, with readable text', () => {
  const zm = realZipMap();
  const log = [buildCoverEntry({ members: members(), coveredId: 'a', rate: 1600, now: new Date(2026, 10, 3, 12) })];
  const mem = laneMemory(log, post(), zm);
  assert.equal(mem.kind, 'exact'); assert.equal(mem.last.rate, 1600);
  assert.match(laneMemoryText(mem), /last covered at \$1,600 on 11\/3/);
  const near = laneMemory(log, post({ originCity: 'Evanston', originState: 'IL', originZip: '60201' }), zm, 75);
  assert.equal(near && near.kind, 'near');
  assert.equal(laneMemory(log, post({ originCity: 'Dallas', originState: 'TX', originZip: '75201' }), zm), null);
  assert.match(rateVsMemory(1650, mem), /\+\$50 \(\+3\.1%\)/);
});
test('coverlog: pace counts only covers, projects over working time, per broker', () => {
  const now = new Date(2026, 10, 11, 12, 30); // Wednesday midday
  const ws = weekStart(now); assert.equal(ws.getDay(), 1);
  const mkc = (d, broker = '') => ({ ...buildCoverEntry({ members: [post({ broker })], coveredId: null, now: d }), outcome: 'Covered' });
  const log = [mkc(new Date(2026, 10, 9, 10)), mkc(new Date(2026, 10, 10, 10), 'Sam'), mkc(new Date(2026, 10, 11, 9), 'Sam'), { ...mkc(new Date(2026, 10, 11, 9)), outcome: 'Expired' }, { ...mkc(new Date(2026, 10, 11, 9)), outcome: 'Manual' }];
  const p = paceStats(log, S, now);
  assert.equal(p.today, 1); assert.equal(p.week, 3); assert.equal(p.floor, 50); assert.equal(p.status, 'short'); assert.match(p.text, /At the current rate you land at \d+ — short\./);
  const by = coverStatsByBroker(log, ['Sam'], S, now);
  assert.equal(by.find(x => x.broker === 'Sam').week, 2); assert.equal(by.find(x => x.broker === '').week, 1);
});
test('coverlog: attribution counts appearances and wins per grid position and city', () => {
  const a = attributionFromLog([buildCoverEntry({ members: members(), coveredId: 'b', rate: 1 }), buildCoverEntry({ members: members(), outcome: 'Expired' })]);
  assert.equal(a.groups, 2); assert.equal(a.origin.get('joliet|il').wins, 1); assert.equal(a.origin.get('joliet|il').appear, 2);
});

// ---------------------------------------------------------------- ranking
const car = (o) => ({ id: o.email, carrierName: o.email.split('@')[0], status: 'Active', ...o });
test('ranking: radius match (not exact city pair) and cover history floats carriers up', () => {
  const zm = realZipMap();
  const carriers = [
    car({ email: 'exact@x.example', originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA' }),
    car({ email: 'near@x.example', originCity: 'Evanston', originState: 'IL', destCity: 'Marietta', destState: 'GA' }),
    car({ email: 'far@x.example', originCity: 'Dallas', originState: 'TX', destCity: 'Houston', destState: 'TX' }),
    car({ email: 'nomail@x.example', email2: '', originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', status: 'Inactive' }),
  ];
  const ctx = { zip: zm, settings: S };
  const r = rankCarriers(post(), carriers, ctx);
  assert.deepEqual(r.slice(0, 2).map(x => x.carrier.email), ['exact@x.example', 'near@x.example']);
  assert.ok(!r.some(x => x.carrier.email === 'nomail@x.example'));
  assert.equal(laneFit(post(), carriers[1], zm, 75).tier, 'B');
  const log = [buildCoverEntry({ members: [post({ id: 'z' })], coveredId: 'z', carrier: { email: 'near@x.example' }, rate: 1400 })];
  assert.equal(rankCarriers(post(), carriers, { ...ctx, coverLog: log })[0].carrier.email, 'near@x.example');
  const wave2 = planRankedOutreach(post(), carriers, { ...ctx, exclude: new Set(['exact@x.example']) });
  assert.ok(!wave2.drafts.some(d => d.to === 'exact@x.example'));
});
test('ranking: truck-check draft uses editable wording; call list needs phones', () => {
  const c = car({ email: 'a@b.example', carrierName: 'Ace', originCity: 'Fresno', originState: 'CA', destCity: 'Reno', destState: 'NV', phone: '555-1212' });
  const d = buildTruckCheck(c, S); assert.equal(d.to, 'a@b.example'); assert.match(d.body, /Hello Ace,/); assert.match(d.body, /Fresno, CA heading toward Reno, NV/);
  assert.equal(buildTruckCheck(c, { ...S, templates: { truckSubject: 'Trucks? {name}' } }).subject, 'Trucks? Ace');
  assert.equal(callList(post({ originCity: 'Fresno', originState: 'CA', originZip: '93721', destCity: 'Reno', destState: 'NV' }), [c, car({ email: 'n@x.example', originCity: 'Fresno', originState: 'CA', destCity: 'Reno', destState: 'NV' })], { zip: realZipMap(), settings: S }).length, 1);
});

// ---------------------------------------------------------------- expiry / weather
test('expiry: a group retires only when every posting is past pickup (midnight after the pickup day)', () => {
  const ps = [post({ id: 'a', pickupEarliest: '11/10/2026', pickupLatest: '11/10/2026' }), post({ id: 'b', variant: 'Nearby 1', pickupEarliest: '11/10/2026', pickupLatest: '11/10/2026' })];
  assert.equal(expiredGroups(ps, new Date(2026, 10, 10, 23, 59)).length, 0);
  assert.equal(expiredGroups(ps, new Date(2026, 10, 11, 0, 1)).length, 1);
  assert.equal(expiredGroups(ps, new Date(2026, 10, 11, 0, 1), 1).length, 0);
  assert.equal(isPastPickup(post({ pickupEarliest: '', pickupLatest: '' }), new Date()), false);
  assert.ok(hoursToPickup(post({ pickupEarliest: '11/10/2026', pickupLatest: '11/10/2026' }), new Date(2026, 10, 10, 8)) > 8);
});
test('weather: keeps severe / disruptive alerts, drops noise, honours the window', () => {
  const json = { features: [{ properties: { event: 'Winter Storm Warning', severity: 'Severe', onset: '2026-11-11T12:00:00Z', ends: '2026-11-12T12:00:00Z', headline: 'x' } }, { properties: { event: 'Special Weather Statement', severity: 'Minor' } }, { properties: { event: 'Air Quality Alert', severity: 'Moderate' } }] };
  const a = summariseAlerts(json); assert.equal(a.length, 1); assert.equal(a[0].level, 'watch');
  assert.equal(overlapsWindow(a[0], new Date('2026-11-12T00:00:00Z'), new Date('2026-11-12T20:00:00Z')), true);
  assert.equal(overlapsWindow(a[0], new Date('2026-11-14T00:00:00Z'), new Date('2026-11-14T20:00:00Z')), false);
});

// ---------------------------------------------------------------- worklist + guidance
const ctxFor = (over = {}) => ({ postings: [], inquiries: [], drafts: [], coverLog: [], carriers: [], zip: realZipMap(), settings: S, now: new Date(2026, 10, 10, 9), weather: new Map(), ...over });
test('worklist: closer pickup + more inquiries rank higher; overview counts', () => {
  const a = [post({ id: 'a', groupId: '', pickupEarliest: '11/10/2026', pickupLatest: '11/10/2026', createdAt: new Date(2026, 10, 10, 8).toISOString() }), post({ id: 'b', groupId: '', pickupEarliest: '11/20/2026', pickupLatest: '11/20/2026', createdAt: new Date(2026, 10, 10, 8).toISOString() })];
  const inq = [{ postingId: 'a', dateCounted: new Date(2026, 10, 10, 8, 30).toISOString(), senderEmail: 'x@y.z' }];
  const ctx = ctxFor({ postings: a, inquiries: inq });
  const rows = rankLoads(analyseBoard(ctx));
  assert.equal(rows[0].box.head.id, 'a'); assert.ok(rows[0].score > rows[1].score);
  assert.equal(overviewCounts(rows, ctx).loads, 2);
});
test('guidance: advice differs for a cold load vs a hot load and escalates after you act', () => {
  const created = new Date(2026, 10, 10, 6).toISOString();           // 3 h old at 9:00
  const cold = [post({ id: 'a', groupId: '', createdAt: created })];
  const carriers = [car({ email: 'a@x.example', originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA' }), car({ email: 'b@x.example', originCity: 'Joliet', originState: 'IL', destCity: 'Atlanta', destState: 'GA' }), car({ email: 'c@x.example', originCity: 'Aurora', originState: 'IL', destCity: 'Atlanta', destState: 'GA' })];
  const ctx = ctxFor({ postings: cold, carriers });
  const row = analyseBoard(ctx)[0];
  const adv1 = nextSteps(row.stats, { depth: 3, unusedDepth: 3, wave: 5, now: ctx.now });
  assert.ok(adv1.steps.length > 0 && adv1.steps[0].action, 'a cold load gets a one-click action');
  const hotInq = Array.from({ length: 5 }, (_, i) => ({ postingId: 'a', dateCounted: new Date(2026, 10, 10, 8, 10 + i * 5).toISOString(), senderEmail: `h${i}@x.example` }));
  const hotRow = analyseBoard(ctxFor({ postings: cold, carriers, inquiries: hotInq }))[0];
  const adv2 = nextSteps(hotRow.stats, { depth: 3, unusedDepth: 3, wave: 5, now: ctx.now });
  assert.notEqual(adv1.steps[0].id, adv2.steps[0].id); assert.equal(adv2.steps[0].id, 'hot');
  assert.ok(!adv2.steps.some(s => s.action && s.action.type === 'reprice' && s.primary), 'never push a price change on a hot load');
  const acted = [{ ...cold[0], ops: [{ type: 'outreach', at: new Date(2026, 10, 10, 6, 5).toISOString() }, { type: 'reprice', at: new Date(2026, 10, 10, 7, 0).toISOString(), detail: '+$75' }] }];
  const row3 = analyseBoard(ctxFor({ postings: acted, carriers }))[0];
  const adv3 = nextSteps(row3.stats, { depth: 3, unusedDepth: 3, wave: 5, now: ctx.now });
  assert.notEqual(adv3.steps[0].id, adv1.steps[0].id, 'advice moves on after the earlier steps were taken');
});

// ---------------------------------------------------------------- bridge protocol
test('bridge: outbox ends with #END and round-trips; config carries the ladder', () => {
  const t = outboxFile([{ outboxId: 'd1', to: 'a@b.example', subject: 'Hi\tthere', body: 'Line1\r\nLine2', kind: 'Truck availability' }]);
  const lines = t.trim().split(/\r?\n/);
  assert.match(lines[0], /^#FREIGHT-SIGNAL-OUTBOX/); assert.equal(lines[lines.length - 1], '#END\t1'); assert.ok(!lines.slice(2, -1).some(l => l.split('\t').length < 5));
  assert.equal(outboxFile([]).trim().split(/\r?\n/).pop(), '#END\t0');
  const done = parseDraftsDone('DraftId\tTimestamp\tResult\tDetail\r\nd1\t2026-11-10 09:00:00\tOK\t\r\nd2\t2026-11-10 09:00:01\tERROR\tboom\r\n');
  assert.equal(done.get('d1').ok, true); assert.equal(done.get('d2').ok, false); assert.equal(done.get('d2').detail, 'boom');
  const cfg = configFile({ ...S, ladderBookPct: 2, ladderSplitPct: 6 });
  assert.match(cfg, /bookPct\t2/); assert.match(cfg, /splitPct\t6/);
});
