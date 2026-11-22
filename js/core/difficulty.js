// Load difficulty (0 easy .. 100 very hard) and the action plan that goes with it, plus the memory of WHICH approaches actually covered hard loads.
// Eight factors from the request, plus equipment. A factor with no data is left out (not guessed) and the rest are re-weighted; the confidence says how much was known.
//   1 time to cover on this lane   2 carriers already contacted   3 response / quote rate   4 how many similar loads covered
//   5 rate vs what covered before  6 distance from freight markets   7 day / pickup date / season   8 return freight from the destination   9 equipment
import { safeNumeric } from './util.js';
import { median, stateCode, placeText, money, HOUR, DAY } from './netcommon.js';
import { relation, laneOf } from './lanematch.js';
import { thinSet, findBackhaulLoads, headsOf } from './corridor.js';
import { rateIntel, competitiveness } from './rateintel.js';

/** Major freight markets (city, state). Distance to the nearest one is the "how far from freight" signal. */
export const HUBS = [['Atlanta', 'GA'], ['Dallas', 'TX'], ['Chicago', 'IL'], ['Los Angeles', 'CA'], ['Houston', 'TX'], ['Memphis', 'TN'], ['Columbus', 'OH'], ['Indianapolis', 'IN'], ['Kansas City', 'MO'],
  ['Charlotte', 'NC'], ['Harrisburg', 'PA'], ['Nashville', 'TN'], ['Louisville', 'KY'], ['Phoenix', 'AZ'], ['Denver', 'CO'], ['Newark', 'NJ'], ['Jacksonville', 'FL'], ['Orlando', 'FL'], ['St. Louis', 'MO'],
  ['Cincinnati', 'OH'], ['Detroit', 'MI'], ['Minneapolis', 'MN'], ['Omaha', 'NE'], ['Oklahoma City', 'OK'], ['Birmingham', 'AL'], ['Savannah', 'GA'], ['Stockton', 'CA'], ['Salt Lake City', 'UT'], ['Seattle', 'WA'],
  ['Laredo', 'TX'], ['Greensboro', 'NC'], ['Allentown', 'PA'], ['Baltimore', 'MD'], ['Little Rock', 'AR'], ['Memphis', 'TN'], ['Fort Worth', 'TX'], ['San Antonio', 'TX'], ['Miami', 'FL'], ['Tampa', 'FL'], ['Portland', 'OR']];

export const LEVELS = [[30, 'easy'], [50, 'moderate'], [70, 'hard'], [101, 'very hard']];
export const levelOf = (s) => (LEVELS.find(([m]) => s < m) || LEVELS[3])[1];
const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
const spotZip = (zipMap, city, st) => { try { const m = zipMap && zipMap.size ? zipMap.market(city, st) : null; return m && m.zip ? m.zip : ''; } catch { return ''; } };
const hubMiles = (zipMap, city, st) => {
  const z = spotZip(zipMap, city, st); if (!z) return null; let best = null;
  for (const [c, s] of HUBS) { const hz = spotZip(zipMap, c, s); if (!hz) continue; let d = null; try { d = zipMap.distanceBetweenZips(z, hz); } catch { d = null; } if (d !== null && d !== undefined && (best === null || d < best)) best = d; }
  return best === null ? null : Math.round(best);
};

const HOLIDAYS = [[0, 1, 2], [4, 22, 31], [6, 1, 7], [8, 1, 7], [10, 20, 30], [11, 18, 31]];                        // [month, fromDay, toDay]: New Year, Memorial, July 4, Labor Day, Thanksgiving, Christmas
const inHoliday = (d) => HOLIDAYS.some(([m, a, b]) => d.getMonth() === m && d.getDate() >= a && d.getDate() <= b);
export const pickupAt = (load) => { const t = Date.parse(load.pickupEarliest || load.pickupDate || ''); return Number.isFinite(t) ? t : NaN; };

/**
 * scoreLoad(load, ctx) -> { score, level, confidence, factors:[{key,label,score,weight,note,tag}], reasons:[...], tags:[...], hubMiles:{o,d} }
 * ctx: { coverLog, inquiries, outreach, history, carriers, trucks, postings, zipMap, settings, now, teamLane }
 */
export function scoreLoad(load, ctx = {}) {
  const { zipMap = null, settings = {}, now = Date.now() } = ctx;
  const F = [];
  const add = (key, label, weight, score, note, tag) => F.push({ key, label, weight, score: score === null ? null : clamp(score), note, tag });
  const lane = laneOf(load); const rel = (l, radius = 60) => relation(load, l, { zipMap, radius });
  const covers = (ctx.coverLog || []).filter(e => e.outcome === 'Covered' && rel(e.covered || e.lane || {}).kind);
  const real = covers.filter(e => !e.imported && Number(e.ageHours) > 0);
  const sameCovers = covers.filter(e => rel(e.covered || e.lane || {}).kind === 'same');
  const expired = (ctx.coverLog || []).filter(e => e.outcome === 'Expired' && rel(e.covered || e.lane || {}).kind);
  // 1. time to cover
  if (real.length >= 2) { const h = median(real.map(e => Number(e.ageHours))); add('time', 'Historical time to cover', 18, h < 2 ? 10 : h < 6 ? 35 : h < 12 ? 55 : h < 24 ? 75 : 95, 'Median ' + (h < 1 ? Math.round(h * 60) + ' min' : Math.round(h * 10) / 10 + ' h') + ' on ' + real.length + ' similar loads', 'slow-lane'); }
  else add('time', 'Historical time to cover', 18, null, 'Fewer than 2 timed covers on this lane');
  // 2 + 3. carriers contacted, response rate (outreach log + e-mail history)
  const th = (ctx.history || []).filter(t => t.lane && rel(t.lane).kind);
  const contactedN = th.filter(t => t.contactedAt).length + (ctx.outreach || []).filter(o => o.originCity && rel(o).kind).length;
  const repliedN = th.filter(t => t.contactedAt && t.responded).length;
  const quotedN = th.filter(t => t.contactedAt && (t.quotes || []).length).length;
  const per = covers.length ? contactedN / covers.length : null;
  if (contactedN >= 4) add('contacts', 'Carriers contacted per cover', 10, covers.length === 0 ? 90 : per <= 3 ? 15 : per <= 8 ? 40 : per <= 15 ? 65 : 90, contactedN + ' carriers contacted, ' + covers.length + ' covers', 'many-contacts');
  else add('contacts', 'Carriers contacted per cover', 10, null, 'Not enough contact history');
  if (contactedN >= 5) { const rr = repliedN / contactedN; add('response', 'Carrier response and quote rate', 12, rr < 0.1 ? 90 : rr < 0.25 ? 65 : rr < 0.5 ? 35 : 12, Math.round(rr * 100) + '% replied, ' + quotedN + ' quoted', 'low-response'); }
  else add('response', 'Carrier response and quote rate', 12, null, 'Not enough outreach history on this lane');
  // 4. similar loads covered (6 months)
  const recent = covers.filter(e => (now - Date.parse(e.closedAt)) / DAY <= 180).length + th.filter(t => t.booked && (now - (t.bookedAt || 0)) / DAY <= 180 && !covers.some(e => e.threadId === t.id)).length;
  const hasHistory = (ctx.coverLog || []).length >= 10 || recent > 0;
  if (hasHistory) add('similar', 'Similar loads covered (6 months)', 14, recent === 0 ? 95 : recent === 1 ? 75 : recent <= 3 ? 50 : recent <= 7 ? 25 : 8, recent + ' covered on or next to this lane' + (expired.length ? ', ' + expired.length + ' expired' : ''), 'few-covers');
  else add('similar', 'Similar loads covered (6 months)', 14, null, 'Not enough cover history yet');
  // 5. rate competitiveness
  const intel = ctx.intel || rateIntel(load, ctx);
  const target = safeNumeric(load.targetRate) || safeNumeric(load.datRate);
  const comp = competitiveness(target, intel);
  if (comp.verdict !== 'unknown') add('rate', 'Rate vs previous covers', 14, comp.verdict === 'low' ? Math.min(100, 65 + Math.abs(comp.gapPct) * 2) : comp.verdict === 'fair' ? 25 : 8, comp.text, 'low-rate');
  else add('rate', 'Rate vs previous covers', 14, null, comp.text);
  // 6. distance from freight markets
  const oMi = hubMiles(zipMap, lane.originCity, lane.originState), dMi = hubMiles(zipMap, lane.destCity, lane.destState);
  if (oMi !== null || dMi !== null) {
    const sc = (m) => (m === null ? null : m <= 50 ? 5 : m <= 100 ? 25 : m <= 200 ? 55 : m <= 350 ? 80 : 95);
    const a = sc(oMi), b = sc(dMi); const val = a === null ? b : b === null ? a : a * 0.4 + b * 0.6;
    add('hub', 'Distance from major freight markets', 10, val, (oMi !== null ? 'Pickup ' + oMi + ' mi' : '') + (oMi !== null && dMi !== null ? ', ' : '') + (dMi !== null ? 'delivery ' + dMi + ' mi' : '') + ' from the nearest major market', 'far-from-hub');
  } else add('hub', 'Distance from major freight markets', 10, null, 'Needs the ZIP Map');
  // 7. day of week, pickup date, season
  const pu = pickupAt(load);
  if (Number.isFinite(pu)) {
    const lead = (pu - now) / HOUR; const d = new Date(pu); const dow = d.getDay();
    let s = lead < 0 ? 85 : lead < 6 ? 90 : lead < 24 ? 70 : lead < 48 ? 40 : 15; const notes = [lead < 0 ? 'pickup already started' : lead < 24 ? 'pickup in ' + Math.max(1, Math.round(lead)) + ' h' : ''];
    if (dow === 0 || dow === 6) { s += 18; notes.push('weekend pickup'); } else if (dow === 5 && d.getHours() >= 12) { s += 10; notes.push('Friday afternoon pickup'); }
    if (inHoliday(d)) { s += 12; notes.push('holiday week'); }
    const dows = real.filter(e => e.pickup && Number.isFinite(Date.parse(e.pickup)) && new Date(e.pickup).getDay() === dow).map(e => Number(e.ageHours));
    if (dows.length >= 3 && real.length >= 8) { const ratio = median(dows) / median(real.map(e => Number(e.ageHours))); if (ratio > 1.3) { s += 10; notes.push('this weekday covers slower here'); } else if (ratio < 0.75) { s -= 10; notes.push('this weekday covers faster here'); } }
    add('timing', 'Day, pickup date and season', 10, s, notes.filter(Boolean).join(', ') || 'Normal timing', 'short-lead');
  } else add('timing', 'Day, pickup date and season', 10, null, 'No pickup date on the load');
  // 8. return freight from the destination
  const thin = thinSet(settings).has(stateCode(lane.destState));
  const home = (ctx.postings ? findBackhaulLoads({ ...load, id: load.id }, headsOf(ctx.postings), { zipMap }) : []).length;
  const outbound = (ctx.coverLog || []).filter(e => e.outcome === 'Covered' && relation({ originCity: lane.destCity, originState: lane.destState, destCity: '', destState: '' }, { originCity: (e.lane || {}).originCity, originState: (e.lane || {}).originState, destCity: '', destState: '' }, { zipMap, radius: 60 }).kind).length;
  { let s = thin ? 75 : 30; const notes = [thin ? lane.destState + ' is a poor outbound state' : 'normal outbound freight']; if (home) { s -= 25; notes.push(home + ' of your own load' + (home === 1 ? '' : 's') + ' start near the delivery'); } if (outbound >= 2) { s -= 15; notes.push(outbound + ' loads you covered started near the delivery'); } add('return', 'Return freight from the destination', 12, s, notes.join(', '), 'thin-dest'); }
  // 9. equipment
  { const eq = String(load.equip || 'V').toUpperCase(); const base = eq === 'V' ? 10 : eq === 'R' ? 40 : eq === 'F' || eq === 'SD' ? 55 : 70; const have = (ctx.carriers || []).filter(c => String(c.equipment || '').toUpperCase().split(/[ ,/]+/).includes(eq)).length;
    add('equipment', 'Equipment', 8, eq === 'V' ? base : have >= 10 ? base - 20 : have >= 3 ? base - 8 : base + 10, eq === 'V' ? 'Dry van: plentiful' : (have + ' carrier' + (have === 1 ? '' : 's') + ' in your database run ' + eq), 'equipment'); }
  const have = F.filter(f => f.score !== null); const wsum = have.reduce((s, f) => s + f.weight, 0);
  const score = wsum ? clamp(have.reduce((s, f) => s + f.score * f.weight, 0) / wsum) : 0;
  const confidence = Math.round(wsum / F.reduce((s, f) => s + f.weight, 0) * 100);
  const hard = have.filter(f => f.score >= 60).sort((a, b) => b.score * b.weight - a.score * a.weight);
  return { score, level: levelOf(score), confidence, factors: F, reasons: hard.map(f => ({ key: f.key, tag: f.tag, label: f.label, text: f.note, score: f.score })), tags: [...new Set(hard.map(f => f.tag))], hubMiles: { o: oMi, d: dMi }, intel, comp };
}

/* ------------------------------------------------------------------------------------------------ approaches (what was tried) and learning */
export const APPROACHES = {
  primary: { label: 'Reach your primary carrier first', kind: 'primary' },
  history: { label: 'Go to carriers that already covered this lane', kind: 'carriers' },
  network: { label: 'Use shared network and truck board matches', kind: 'carriers' },
  'raise-rate': { label: 'Raise the rate to what this lane actually covers at', kind: 'rate' },
  backhaul: { label: 'Pitch the return load / backhaul', kind: 'pitch' },
  'call-first': { label: 'Phone the best matches before e-mailing', kind: 'call' },
  'wider-radius': { label: 'Widen the search (more cities, second wave)', kind: 'reach' },
  'ask-shipper': { label: 'Ask the shipper for a wider pickup window', kind: 'shipper' },
  rescue: { label: 'Ask the team for help (Rescue)', kind: 'team' },
};
const OP_TO_APPROACH = { outreach: 'history', wave2: 'wider-radius', truckcheck: 'network', call: 'call-first', reprice: 'raise-rate', 'rescue-rate': 'raise-rate', recities: 'wider-radius', 'assign-offer': 'primary', 'plan-backhaul': 'backhaul', rescue: 'rescue' };
/** Which approaches were actually used on a load, from its operation log. */
export const approachesFromOps = (ops) => [...new Set((ops || []).map(o => OP_TO_APPROACH[o.type]).filter(Boolean))];

/** One learning record per finished load (covered or expired). */
export function makeApproachRecord({ id, entry, diff, ops, coveredVia = '' }) {
  return {
    id, at: entry.closedAt, outcome: entry.outcome, lane: { ...entry.lane }, hours: Number(entry.ageHours) > 0 ? Math.round(Number(entry.ageHours) * 10) / 10 : null,
    level: diff ? diff.level : '', score: diff ? diff.score : null, tags: diff ? diff.tags : [], tried: approachesFromOps(ops), coveredVia, rate: entry.rate || '',
  };
}

/**
 * Among finished loads that were at least `minLevel` hard and share a difficulty tag with this one: how often did each approach end in a cover, and how fast?
 * -> { key: { n, covered, rate, medianHours, without:{n, rate, medianHours}, lift } }. Needs `minN` uses before it has an opinion.
 */
export function learnApproaches(records = [], tags = [], { minN = 3, hardOnly = true } = {}) {
  const pool = records.filter(r => (r.outcome === 'Covered' || r.outcome === 'Expired') && (!hardOnly || (r.score ?? 0) >= 50) && (!tags.length || (r.tags || []).some(t => tags.includes(t))));
  const out = {};
  for (const key of Object.keys(APPROACHES)) {
    const used = pool.filter(r => (r.tried || []).includes(key)), not = pool.filter(r => !(r.tried || []).includes(key));
    const st = (l) => ({ n: l.length, covered: l.filter(r => r.outcome === 'Covered').length, rate: l.length ? Math.round(l.filter(r => r.outcome === 'Covered').length / l.length * 100) : null, medianHours: (() => { const h = l.filter(r => r.outcome === 'Covered' && r.hours > 0).map(r => r.hours); return h.length ? Math.round(median(h) * 10) / 10 : null; })() });
    const u = st(used), w = st(not);
    out[key] = { ...u, enough: u.n >= minN, without: w, lift: u.n >= minN && w.n >= minN && u.rate !== null && w.rate !== null ? u.rate - w.rate : null };
  }
  return out;
}

/**
 * buildPlan(diff, ctx) -> [{ key, title, why, how, evidence, priority, kind }]
 * ctx: { assignMatches, carriersTop (from networkmatch), learned (learnApproaches result), backhaul, intel, load, now }
 * The learned results reorder the plan and are quoted as evidence; before there is enough data the order comes from the difficulty reasons.
 */
export function buildPlan(diff, ctx = {}) {
  const { load = {}, assignMatches = [], carriersTop = [], learned = {}, backhaul = [], now = Date.now() } = ctx;
  const intel = diff.intel || ctx.intel; const has = (t) => diff.tags.includes(t);
  const acts = [];
  const push = (key, p, title, why, how = '') => { const L = learned[key]; const ev = L && L.enough ? 'Tried on ' + L.n + ' similar hard load' + (L.n === 1 ? '' : 's') + ': covered ' + L.covered + ' (' + L.rate + '%)' + (L.medianHours ? ', median ' + L.medianHours + ' h' : '') + (L.without.n >= 3 ? '. Without it: ' + L.without.rate + '%' : '') + '.' : ''; acts.push({ key, title, why, how, evidence: ev, priority: p + (L && L.enough && L.lift !== null ? L.lift / 4 : 0), kind: APPROACHES[key].kind, learnedLift: L && L.enough ? L.lift : null }); };
  if (assignMatches.length) { const a = assignMatches[0]; push('primary', 100, 'Reach ' + (a.name || 'your primary carrier') + ' first', (a.priority === 'primary' ? 'Your primary' : 'Your backup') + ' for ' + describeShort(a) + (a.wins ? ' (' + a.wins + ' win' + (a.wins === 1 ? '' : 's') + ')' : ''), 'Send the draft or call now.'); }
  if (carriersTop.length) { const c = carriersTop[0]; push('history', 80, 'Go to carriers that already ran this lane', carriersTop.length + ' match' + (carriersTop.length === 1 ? '' : 'es') + ', best: ' + (c.name || c.email) + ' (' + c.why[0] + ')', 'Start at the top of the match list.'); }
  if (diff.comp && diff.comp.verdict === 'low' && intel && intel.covers.avg) push('raise-rate', 85, 'Raise the rate toward ' + money(intel.covers.avg), diff.comp.text, 'Your rate is below what this lane covered at. Raise it before contacting more carriers.');
  if (has('thin-dest')) { if (backhaul.length) push('backhaul', 75, 'Pitch your own return load', backhaul.length + ' of your loads start near ' + placeText(load.destCity, load.destState), 'Offer the round trip in the e-mail.'); else push('backhaul', 55, 'Offer carriers a return plan', 'Delivery is in a poor outbound area; carriers want to know how they get home', 'Mention nearby freight out of ' + load.destState + ' or price the deadhead.'); }
  if (has('short-lead')) { push('call-first', 82, 'Phone, do not e-mail', 'Pickup is close; replies by e-mail take too long', 'Call the top matches now.'); push('ask-shipper', 45, 'Ask the shipper for a wider pickup window', 'A later or wider window widens the carrier pool', ''); }
  if (has('low-response') || has('many-contacts')) push('wider-radius', 70, 'Widen the search', 'Few carriers answer on this lane; reach more of them', 'Run a second wave over more cities.');
  if (has('few-covers') || has('far-from-hub')) push('network', 72, 'Check the shared truck board and the team', 'You have little history here; the network may have trucks nearby', 'Search the truck board and ask the team for matches.');
  if (diff.level === 'very hard') push('rescue', 60, 'Ask the team for help', 'This is a very hard load', 'Open Rescue.');
  const seen = new Set();
  return acts.sort((a, b) => b.priority - a.priority).filter(a => (seen.has(a.key) ? false : seen.add(a.key))).slice(0, 6);
}
const describeShort = (a) => (a.originCity || a.originState || '') + (a.originState && a.originCity ? ', ' + a.originState : '') + ' to ' + (a.destCity || a.destState || '') + (a.destState && a.destCity ? ', ' + a.destState : '');
