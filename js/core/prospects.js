// Carrier acquisition engine (v16): one clean list of carriers out of every source you imported, and a single "call these first" sheet across all loads.
// Pure logic (no DOM, no storage).

import { carrierKey, emailOf, phoneOf, oneLine, placeText, HOUR, DAY, ago } from './netcommon.js';
import { normalizeText, safeNumeric, safeString } from './util.js';
import { rankCarriers } from './ranking.js';
import { laneDifficulty } from './corridor.js';

/** Who a carrier row is: MC/DOT, else e-mail, else phone, else name. '' when nothing identifies it. */
export function identityOf(c) {
  const k = carrierKey({ mc: c.mc, email: c.email }); if (k) return k;
  const ph = String(c.phone || '').replace(/\D/g, '').slice(-10); if (ph.length === 10) return 'ph:' + ph;
  const n = normalizeText(c.carrierName); return n ? 'nm:' + n : '';
}
const laneOf = (c) => [c.originCity, c.originState, c.destCity, c.destState].map(normalizeText).join('|');
const richness = (c) => ['carrierName', 'mc', 'email', 'phone', 'equipment', 'rate', 'lastCovered', 'lastContacted', 'notes'].reduce((n, k) => n + (safeString(c[k]) ? 1 : 0), 0) + safeNumeric(c.coverCount);

/**
 * One profile per carrier. Carrier rows in the app are per lane, so a carrier that runs 5 lanes is 5 rows; this folds them together.
 * Returns [{ key, name, mc, email, phone, equipment, lanes:[{label}], rows:n, covers, lastCovered, lastContacted, status, sources }]
 */
export function consolidateCarriers(rows) {
  const by = new Map();
  for (const c of rows || []) {
    const k = identityOf(c) || 'row:' + (c.id || Math.random());
    const p = by.get(k) || { key: k, name: '', mc: '', email: '', phone: '', equipment: '', lanes: [], laneKeys: new Set(), rows: 0, covers: 0, lastCovered: '', lastContacted: '', status: '', ids: [] };
    p.rows++; p.ids.push(c.id);
    p.name = p.name || safeString(c.carrierName); p.mc = p.mc || safeString(c.mc); p.email = p.email || emailOf(c.email); p.phone = p.phone || phoneOf(c.phone); p.equipment = p.equipment || safeString(c.equipment);
    const lk = laneOf(c); if (lk !== '|||' && !p.laneKeys.has(lk)) { p.laneKeys.add(lk); p.lanes.push({ label: placeText(c.originCity, c.originState) + (c.destCity || c.destState ? ' to ' + placeText(c.destCity, c.destState) : ' (any destination)') }); }
    p.covers = Math.max(p.covers, safeNumeric(c.coverCount));
    if (safeString(c.lastCovered) > p.lastCovered) p.lastCovered = safeString(c.lastCovered);
    if (safeString(c.lastContacted) > p.lastContacted) p.lastContacted = safeString(c.lastContacted);
    if (safeString(c.status).toLowerCase() === 'inactive') p.status = 'Inactive'; else p.status = p.status || safeString(c.status);
    by.set(k, p);
  }
  return [...by.values()].map(({ laneKeys, ...p }) => p).sort((a, b) => b.covers - a.covers || b.lanes.length - a.lanes.length || a.name.localeCompare(b.name));
}

/** Rows that are exact duplicates (same carrier AND same lane): keep the richest, return the ids of the rest. */
export function duplicateRows(rows) {
  const groups = new Map();
  for (const c of rows || []) { const id = identityOf(c); if (!id) continue; const k = id + '#' + laneOf(c); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
  const drop = [], keep = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => richness(b) - richness(a)); keep.push(sorted[0].id); for (const x of sorted.slice(1)) drop.push(x.id);
  }
  return { drop, keep, groups: keep.length };
}

/** Fill the blanks of the kept row from its duplicates (a phone from one import, an e-mail from another). Returns [{ id, patch }]. */
export function mergePatches(rows) {
  const groups = new Map();
  for (const c of rows || []) { const id = identityOf(c); if (!id) continue; const k = id + '#' + laneOf(c); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
  const out = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue; const sorted = [...g].sort((a, b) => richness(b) - richness(a)); const best = sorted[0]; const patch = {};
    for (const k of ['carrierName', 'mc', 'email', 'phone', 'equipment', 'rate', 'notes']) if (!safeString(best[k])) { const v = sorted.slice(1).map(x => safeString(x[k])).find(Boolean); if (v) patch[k] = v; }
    if (Object.keys(patch).length) out.push({ id: best.id, patch });
  }
  return out;
}

/**
 * Who to call right now, across ALL open loads. One row per carrier: the load they fit best. Hardest, oldest and soonest-pickup loads come first.
 * ctx: { zip, inquiries, coverLog, settings, now:Date, outreach:[{email, at}], trucks (active Truck Book), matchTrucks (fn), limit, quietHours }
 */
export function callSheet(heads, carriers, ctx = {}) {
  const now = (ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now())).getTime();
  const quiet = (Number(ctx.quietHours) > 0 ? Number(ctx.quietHours) : 4) * HOUR;
  const recent = new Set((ctx.outreach || []).filter(o => now - Date.parse(o.at || o.sentAt || o.date || 0) < quiet).map(o => String(o.email || '').toLowerCase()).filter(Boolean));
  const best = new Map();
  const callable = (carriers || []).filter(c => safeString(c.phone));
  for (const load of heads || []) {
    if (load.covered || load.status === 'Covered' || load.status === 'Expired') continue;
    const urgency = urgencyOf(load, now, ctx);
    const ranked = rankCarriers(load, callable, { ...ctx, now: new Date(now), requireEmail: false, settings: { ...(ctx.settings || {}), outreachBlocklist: [] } }).slice(0, 12);
    for (const r of ranked) {
      const k = identityOf(r.carrier) || r.carrier.id; if (!k) continue;
      const em = String(r.carrier.email || '').toLowerCase();
      const score = r.score * (0.6 + urgency.factor * 0.4) - (em && recent.has(em) ? 40 : 0);
      const cur = best.get(k);
      if (!cur || score > cur.score) best.set(k, { key: k, carrier: r.carrier, load, score: Math.round(score * 10) / 10, fit: r.tierLabel, why: r.reasons.slice(0, 3), urgency: urgency.label, recentlyContacted: em && recent.has(em), source: 'database' });
    }
  }
  // live trucks first: a truck reported today beats a database guess
  for (const m of ctx.liveTrucks || []) {
    const t = m.truck; if (!t || !(t.phone)) continue; const k = identityOf({ mc: t.mc, email: t.email, phone: t.phone, carrierName: t.carrierName });
    const urgency = urgencyOf(m.load, now, ctx);
    best.set('truck:' + k, { key: 'truck:' + k, carrier: { carrierName: t.carrierName, phone: t.phone, email: t.email, mc: t.mc }, load: m.load, score: Math.round((m.score + 40) * (0.6 + urgency.factor * 0.4) * 10) / 10, fit: 'Truck available now', why: m.reasons.slice(0, 3), urgency: urgency.label, truck: t, source: 'truck' });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, Number(ctx.limit) > 0 ? Number(ctx.limit) : 25);
}

function urgencyOf(load, now, ctx) {
  let f = 0.3; const bits = [];
  const created = Date.parse(load.createdAt); if (Number.isFinite(created)) { const h = (now - created) / HOUR; if (h > 24) { f += 0.2; bits.push('posted ' + ago(created, now)); } else if (h > 6) f += 0.1; }
  const pu = Date.parse(load.pickupEarliest); if (Number.isFinite(pu)) { const d = (pu - now) / DAY; if (d < 1) { f += 0.35; bits.push('picks up today'); } else if (d < 2) { f += 0.2; bits.push('picks up tomorrow'); } }
  if (ctx.zipMap) { const df = laneDifficulty(load, { zipMap: ctx.zipMap, settings: ctx.settings }); if (df.tough) { f += 0.15; bits.push('hard lane'); } }
  return { factor: Math.min(1, f), label: bits.join(', ') };
}
