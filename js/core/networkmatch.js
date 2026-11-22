// Who is most likely to cover this load? Ranks every candidate by what actually happened, not by how close their truck is:
//   covers on this exact lane, covers on nearby lanes, quotes on similar loads, the shared truck board, trucks in the pickup region,
//   carriers that have accepted this destination before, shared team results, and your own primary / backup assignments.
// Distance only breaks ties. A carrier who covered this lane twice beats a carrier parked next to the pickup who never answered.
import { safeNumeric } from './util.js';
import { carrierKey, emailOf, equipFits, placeText, DAY } from './netcommon.js';
import { relation } from './lanematch.js';
import { freshness, isActive } from './truckbook.js';

const keyOf = (w) => carrierKey({ mc: w.mc, email: w.email }) || (w.email ? 'e:' + emailOf(w.email) : '') || (w.name ? 'n:' + String(w.name).toLowerCase().replace(/[^a-z0-9]/g, '') : '');
const spot = (zipMap, city, st) => { try { const m = zipMap && zipMap.size ? zipMap.market(city, st) : null; return m && m.zip ? m.zip : ''; } catch { return ''; } };
const dist = (zipMap, a, b) => { try { return a && b ? zipMap.distanceBetweenZips(a, b) : null; } catch { return null; } };
const rec = (t, now) => Math.max(0.3, Math.pow(0.5, Math.max(0, (now - t) / DAY) / 90));       // half weight every 90 days

export const LABELS = { assigned: 'Your assigned carrier', exact: 'Covered this exact lane', near: 'Covered a nearby lane', quoted: 'Quoted similar loads', board: 'On the truck board near pickup', region: 'Based in the pickup region', dest: 'Has delivered to this destination', team: 'Covered it for the team' };

/**
 * matchCarriers(load, ctx) -> [{ key, name, email, phone, mc, score, likelihood, why:[...], signals:{...}, lastRate, covers }], best first
 * ctx: { carriers, coverLog, inquiries, history, trucks, teamLane:{carriers:[...]}, teamTrucks, assignMatches, zipMap, now, radius, exclude:Set, limit }
 */
export function matchCarriers(load, ctx = {}) {
  const { zipMap = null, now = Date.now(), radius = 100 } = ctx;
  const out = new Map(); const exclude = ctx.exclude || new Set();
  const byEmail = new Map();                                      // the same carrier seen once by MC and once by e-mail only is ONE candidate
  const get = (who) => {
    let k = keyOf(who); const em = emailOf(who.email);
    if (em && byEmail.has(em)) k = byEmail.get(em);
    if (!k || exclude.has(k)) return null;
    if (em && !byEmail.has(em)) byEmail.set(em, k);
    let o = out.get(k);
    if (!o) { o = { key: k, name: '', email: '', phone: '', mc: '', score: 0, why: [], signals: {}, lastRate: 0, covers: 0, lastAt: 0, declinedAt: 0 }; out.set(k, o); }
    o.name = o.name || who.name || ''; o.email = o.email || emailOf(who.email); o.phone = o.phone || who.phone || ''; o.mc = o.mc || who.mc || '';
    return o;
  };
  const hit = (o, sig, pts, why, cap = 1e9) => { if (!o) return; const had = o.signals[sig] || 0; const add = Math.max(0, Math.min(pts, cap - had)); if (add <= 0) return; o.signals[sig] = had + add; o.score += add; if (why && !o.why.includes(why)) o.why.push(why); };
  const rel = (l, r) => relation(load, l, { zipMap, radius: r || 60 });
  const oz = spot(zipMap, load.originCity, load.originState);
  // own covers (also the verified ones read from e-mail history, which are in the Cover Log)
  const byCarrier = new Map();
  for (const e of ctx.coverLog || []) {
    if (e.outcome !== 'Covered' || !e.carrier || !(e.carrier.email || e.carrier.mc || e.carrier.name)) continue;
    const t = Date.parse(e.closedAt); const r = rel(e.covered || e.lane || {});
    const o = get({ name: e.carrier.name, email: e.carrier.email, phone: e.carrier.phone, mc: e.carrier.mc }); if (!o) continue;
    o.covers++; if (t > o.lastAt) { o.lastAt = t; if (safeNumeric(e.rate) > 0) o.lastRate = safeNumeric(e.rate); }
    if (r.kind === 'same') { const n = (byCarrier.get(o.key + '|s') || 0) + 1; byCarrier.set(o.key + '|s', n); hit(o, 'exact', (n === 1 ? 40 : 15) * rec(t, now), n === 1 ? 'Covered this exact lane ' + Math.round((now - t) / DAY) + ' d ago' + (safeNumeric(e.rate) ? ' at $' + Math.round(safeNumeric(e.rate)).toLocaleString('en-US') : '') : 'Covered this lane ' + n + ' times', 70); }
    else if (r.kind === 'near') { const n = (byCarrier.get(o.key + '|n') || 0) + 1; byCarrier.set(o.key + '|n', n); hit(o, 'near', (n === 1 ? 18 : 6) * r.w * rec(t, now), n === 1 ? 'Covered a nearby lane (' + placeText((e.lane || {}).originCity, (e.lane || {}).originState) + ' to ' + placeText((e.lane || {}).destCity, (e.lane || {}).destState) + ')' : '', 30); }
    // accepted this destination before (any origin)
    const dz = spot(zipMap, load.destCity, load.destState), ed = spot(zipMap, (e.lane || {}).destCity, (e.lane || {}).destState); const dd = dz && ed ? dist(zipMap, dz, ed) : null;
    if (dd !== null && dd <= 50 && r.kind !== 'same') hit(o, 'dest', 14 * rec(t, now), 'Has delivered near ' + placeText(load.destCity, load.destState), 20);
  }
  // quotes and replies (e-mail history + inquiry log)
  for (const t of ctx.history || []) {
    if (!t.lane || !t.carrier) continue; const r = rel(t.lane); if (!r.kind) continue;
    const o = get({ name: t.carrier.name, email: t.carrier.email, phone: t.carrier.phone, mc: t.carrier.mc }); if (!o) continue;
    if ((t.quotes || []).length) hit(o, 'quoted', 8 * r.w * rec(t.last || now, now), 'Quoted a similar load' + (t.firstQuote ? ' ($' + Math.round(t.firstQuote).toLocaleString('en-US') + ')' : ''), 24);
    else if (t.responded) hit(o, 'quoted', 3 * r.w, '', 24);
  }
  for (const q of ctx.inquiries || []) {
    const em = emailOf(q.senderEmail); if (!em) continue; const r = rel({ originCity: q.originCity, originState: q.originState, destCity: q.destCity, destState: q.destState }); if (!r.kind) continue;
    const o = get({ email: em, name: '' }); if (!o) continue; const t = Date.parse(q.dateCounted);
    if (String(q.stage || '').toUpperCase() === 'DECLINED') { if (Number.isFinite(t) && now - t < 14 * DAY) { o.declinedAt = Math.max(o.declinedAt, t); o.score -= 25; if (!o.why.includes('Declined a similar load recently')) o.why.push('Declined a similar load recently'); } continue; }
    if (safeNumeric(q.lastCarrierRate) > 0) hit(o, 'quoted', 8 * r.w * rec(t || now, now), 'Quoted a similar load', 24);
  }
  // trucks (your Truck Book + the shared board) near the pickup
  for (const t of [...(ctx.trucks || []), ...(ctx.teamTrucks || [])]) {
    if (!isActive(t, now) || !equipFits(load.equip || 'V', t.equip || 'V', true)) continue;
    const tz = t.oZip || spot(zipMap, t.oCity, t.oState); const d = tz && oz ? dist(zipMap, tz, oz) : (t.oState && t.oState === load.originState ? 80 : null);
    if (d === null || d > radius) continue;
    const o = get({ name: t.carrierName, email: t.email, phone: t.phone, mc: t.mc }); if (!o) continue;
    hit(o, 'board', 25 * freshness(t, now) * (1 - d / (radius * 1.6)), 'Truck listed ' + Math.round(d) + ' mi from pickup' + (t.oCity ? ' (' + placeText(t.oCity, t.oState) + ')' : ''), 30);
    if (t.dState && t.dState === load.destState) hit(o, 'board', 6, '', 36);
  }
  // shared team results for this lane
  for (const c of (ctx.teamLane && ctx.teamLane.carriers) || []) {
    const o = get({ name: c.name, mc: c.mc, email: '' }) || get({ name: c.name, mc: c.mc }); if (!o) continue;
    if (c.covers) hit(o, 'team', 30 + Math.min(20, c.replies * 3 + c.covers * 6), 'The team covered this lane with them ' + c.covers + ' time' + (c.covers === 1 ? '' : 's'), 60);
    else if (c.replies) hit(o, 'team', 8 + Math.min(10, c.replies * 2), 'Answered the team on this lane', 24);
    if (c.avgRate && !o.lastRate) o.lastRate = c.avgRate;
  }
  // carriers in your database: lanes they run and where they are based (weak signals; distance never outranks results)
  for (const c of ctx.carriers || []) {
    if (String(c.status || '').toLowerCase() === 'inactive') continue;
    if (c.equipment && /^[A-Z]{1,3}$/.test(c.equipment) && !equipFits(load.equip || 'V', c.equipment, true)) continue;
    const who = { name: c.carrierName, email: c.email, phone: c.phone, mc: c.mc };
    const r = c.originState && c.destState ? rel({ originCity: c.originCity, originState: c.originState, destCity: c.destCity, destState: c.destState }, 80) : { kind: '' };
    if (r.kind === 'same' || r.kind === 'near') { const o = get(who); hit(o, 'region', r.kind === 'same' ? 16 : 9, 'Lists this lane in your carrier database', 16); }
    else if (c.destCity && oz) { const cz = spot(zipMap, c.destCity, c.destState); const d = cz ? dist(zipMap, cz, oz) : null; if (d !== null && d <= radius) hit(get(who), 'region', 10 * (1 - d / (radius * 1.5)), 'Delivers near your pickup (' + placeText(c.destCity, c.destState) + ')', 12); }
    if (c.verified === 'email') { const o = out.get(keyOf(who)); if (o) hit(o, 'verified', 4, '', 4); }
  }
  // your own primary / backup assignments are the strongest statement
  for (const a of ctx.assignMatches || []) { const o = get({ name: a.name, email: a.email, phone: a.phone, mc: a.mc }); hit(o, 'assigned', (a.priority === 'primary' ? 60 : 35) * Math.min(1, a.fit / 90), (a.priority === 'primary' ? 'Your primary carrier' : 'Your backup carrier') + ' for this lane', 70); }
  const list = [...out.values()].filter(o => o.score > 0 && (o.email || o.phone || o.mc)).map(o => ({ ...o, score: Math.round(o.score * 10) / 10 }))
    .sort((a, b) => b.score - a.score || b.covers - a.covers || b.lastAt - a.lastAt);

  for (const o of list) o.likelihood = o.score >= 60 ? 'very likely' : o.score >= 35 ? 'likely' : o.score >= 15 ? 'possible' : 'long shot';

  return list.slice(0, Number(ctx.limit) > 0 ? Number(ctx.limit) : 15);
}

/** Which carriers (by key) would the plan have suggested? Used to tell "covered by a suggestion" from "covered by someone the app did not point to". */
export const suggestedKeys = (list, n = 5) => new Set((list || []).slice(0, n).map(o => o.key));
