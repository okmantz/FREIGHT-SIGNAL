// Cover Log: one record per load group that leaves the board (Covered, Expired, or logged by hand).
// It is the memory the rest of the app learns from:
//   * attribution  - which of the 9 postings (A-A ... C-C), which alternate cities and which carriers actually produce covers
//   * lane memory  - "this lane last covered at $1,650 on 11/3"
//   * ranked outreach - carriers who covered a lane before float to the top
//   * pace tracker - covers today / this week against the weekly floor
// Pure functions only (no DOM, no storage).

import { uid, normalizeText, safeNumeric, calculateDistanceMiles, normalizeZip } from './util.js';
import { gridLabel } from './model.js';

export const OUTCOMES = ['Covered', 'Expired', 'Manual'];
const cityKey = (c, s) => normalizeText(c) + '|' + normalizeText(s);
const laneKey = (p) => cityKey(p.originCity, p.originState) + '>' + cityKey(p.destCity, p.destState);

const slim = (p) => {
  const o = JSON.parse(JSON.stringify(p));
  if (o.variant !== 'Original') o.details = '';   // the pasted TQL text is only kept once per group
  return o;
};

/**
 * Build the log record for a group that is leaving the board.
 *   members : every posting of the group
 *   coveredId : id of the posting that actually covered (Covered outcome) or null
 *   carrier : { id?, name, email, mc, phone } (any subset)
 *   rate : what the carrier was paid / agreed (number)
 */
export function buildCoverEntry({ members, outcome = 'Covered', coveredId = null, carrier = {}, rate = '', inquiries = [], note = '', now = new Date(), laneClass = '' }) {
  const head = members.find(m => m.variant === 'Original') || members[0] || {};
  const hit = members.find(m => m.id === coveredId) || null;
  const ids = new Set(members.map(m => m.id));
  const inq = inquiries.filter(q => ids.has(q.postingId));
  const created = members.map(m => Date.parse(m.createdAt)).filter(Number.isFinite);
  const ageHours = created.length ? Math.max(0, (now.getTime() - Math.min(...created)) / 3600000) : '';
  const view = (p) => ({ variant: p.variant || '', grid: gridLabel(p.variant) || (p.variant ? '' : 'A-A'), originCity: p.originCity, originState: p.originState, originZip: p.originZip, destCity: p.destCity, destState: p.destState, destZip: p.destZip, datRate: p.datRate || p.targetRate, targetRate: p.targetRate, inquiryCount: safeNumeric(p.inquiryCount), contact: p.contact || '' });
  return {
    id: uid(), closedAt: now.toISOString(), outcome,
    groupId: head.groupId || '', broker: head.broker || '', laneClass,
    lane: { originCity: head.originCity, originState: head.originState, destCity: head.destCity, destState: head.destState },
    covered: hit ? view(hit) : null,
    carrier: { id: carrier.id || '', name: carrier.name || carrier.carrierName || '', email: String(carrier.email || '').trim().toLowerCase(), mc: carrier.mc || '', phone: carrier.phone || '' },
    rate: rate === '' || rate === null || rate === undefined ? '' : safeNumeric(rate),
    datRate: hit ? safeNumeric(hit.datRate) || safeNumeric(hit.targetRate) || '' : safeNumeric(head.datRate) || safeNumeric(head.targetRate) || '',
    targetRate: safeNumeric(head.targetRate) || '',
    pickup: head.pickupEarliest || '', equip: head.equip || '',
    postings: members.map(view),
    inquiries: inq.length || members.reduce((n, m) => n + safeNumeric(m.inquiryCount), 0),
    ageHours, note,
    rows: members.map(slim),
  };
}

/**
 * Learn from the log. Only Covered and Expired groups count as "appearances" (the group was posted and finished);
 * a group's three origin cities and three destination cities each appear once.
 * Returns { origin: Map(city|st -> {appear,wins}), dest: Map, lane: Map("o>d" -> wins), grid: {A-A:{appear,wins}...}, carriers: Map(email -> {covers,rateSum}), groups }
 */
export function attributionFromLog(log) {
  const origin = new Map(), dest = new Map(), lane = new Map(), carriers = new Map();
  const grid = {}; for (const a of 'ABC') for (const b of 'ABC') grid[a + '-' + b] = { appear: 0, wins: 0 };
  const bump = (m, k, f) => { let v = m.get(k); if (!v) { v = { appear: 0, wins: 0 }; m.set(k, v); } f(v); };
  let groups = 0;
  for (const e of log || []) {
    if (e.outcome !== 'Covered' && e.outcome !== 'Expired') continue;
    if (!Array.isArray(e.postings) || !e.postings.length) continue;
    groups++;
    const oSeen = new Set(), dSeen = new Set();
    for (const p of e.postings) {
      const ok = cityKey(p.originCity, p.originState), dk = cityKey(p.destCity, p.destState);
      if (!oSeen.has(ok)) { oSeen.add(ok); bump(origin, ok, v => { v.appear++; }); }
      if (!dSeen.has(dk)) { dSeen.add(dk); bump(dest, dk, v => { v.appear++; }); }
      if (p.grid && grid[p.grid]) grid[p.grid].appear++;
    }
    if (e.outcome === 'Covered' && e.covered) {
      const ok = cityKey(e.covered.originCity, e.covered.originState), dk = cityKey(e.covered.destCity, e.covered.destState);
      bump(origin, ok, v => { v.wins++; }); bump(dest, dk, v => { v.wins++; });
      lane.set(ok + '>' + dk, (lane.get(ok + '>' + dk) || 0) + 1);
      if (e.covered.grid && grid[e.covered.grid]) grid[e.covered.grid].wins++;
    }
    if (e.outcome === 'Covered' && e.carrier && e.carrier.email) {
      const c = carriers.get(e.carrier.email) || { covers: 0, rateSum: 0, rated: 0 };
      c.covers++; if (safeNumeric(e.rate) > 0) { c.rateSum += safeNumeric(e.rate); c.rated++; }
      carriers.set(e.carrier.email, c);
    }
  }
  return { origin, dest, lane, grid, carriers, groups };
}

/** Rows for the "which cities produce covers" report, best first. */
export function cityPerformance(log, side = 'origin', minAppear = 1) {
  const a = attributionFromLog(log);
  const m = side === 'origin' ? a.origin : a.dest;
  const names = new Map();
  for (const e of log || []) for (const p of e.postings || []) {
    const c = side === 'origin' ? [p.originCity, p.originState] : [p.destCity, p.destState];
    names.set(cityKey(c[0], c[1]), c[0] + ', ' + c[1]);
  }
  return [...m.entries()].filter(([, v]) => v.appear >= minAppear).map(([k, v]) => ({ key: k, label: names.get(k) || k, appear: v.appear, wins: v.wins, rate: v.appear ? v.wins / v.appear : 0 }))
    .sort((x, y) => y.wins - x.wins || y.rate - x.rate || y.appear - x.appear);
}

const isCover = (e) => e.outcome === 'Covered';

/**
 * Lane memory for a lane (posting-shaped object). Exact city pair first (matched on the original lane OR the posting that covered),
 * otherwise a lane whose two ends are both within `radius` miles. Returns null when there is no history.
 */
export function laneMemory(log, p, zipMap = null, radius = 75) {
  const want = laneKey(p);
  const rated = (log || []).filter(e => e.outcome === 'Covered' && safeNumeric(e.rate) > 0);
  const exact = rated.filter(e => laneKey(e.lane || {}) === want || (e.covered && laneKey(e.covered) === want));
  let hits = exact, kind = 'exact';
  if (!hits.length && zipMap && zipMap.size) {
    const oz = normalizeZip(p.originZip) || zipMap.bestZipForCityState(p.originCity, p.originState);
    const dz = normalizeZip(p.destZip) || zipMap.bestZipForCityState(p.destCity, p.destState);
    if (oz && dz) {
      hits = rated.filter(e => {
        const l = e.covered || e.lane || {};
        const o2 = zipMap.bestZipForCityState(l.originCity, l.originState), d2 = zipMap.bestZipForCityState(l.destCity, l.destState);
        if (!o2 || !d2) return false;
        const a = zipMap.distanceBetweenZips(oz, o2), b = zipMap.distanceBetweenZips(dz, d2);
        return a !== null && b !== null && a <= radius && b <= radius;
      });
      kind = 'near';
    }
  }
  if (!hits.length) return null;
  const sorted = [...hits].sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
  const rates = sorted.map(e => safeNumeric(e.rate));
  return {
    kind, last: { rate: rates[0], date: sorted[0].closedAt, carrier: sorted[0].carrier && (sorted[0].carrier.name || sorted[0].carrier.email) || '', lane: sorted[0].covered || sorted[0].lane },
    count: sorted.length, avg: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length), min: Math.min(...rates), max: Math.max(...rates),
  };
}

const fmtMD = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : `${d.getMonth() + 1}/${d.getDate()}`; };
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

/** "This lane last covered at $1,650 on 11/3 (3 covers, avg $1,610)" */
export function laneMemoryText(mem) {
  if (!mem) return '';
  const where = mem.kind === 'near' && mem.last.lane ? ` (nearby lane ${mem.last.lane.originCity} → ${mem.last.lane.destCity})` : '';
  const extra = mem.count > 1 ? ` · ${mem.count} covers, avg ${money(mem.avg)}` : '';
  return `${mem.kind === 'near' ? 'A nearby lane' : 'This lane'} last covered at ${money(mem.last.rate)} on ${fmtMD(mem.last.date)}${where}${extra}`;
}

/** Percent difference text for a typed DAT rate vs lane memory: "+$50 (+3.0%) vs last cover" */
export function rateVsMemory(rate, mem) {
  const r = safeNumeric(rate);
  if (!mem || !(r > 0)) return '';
  const d = r - mem.last.rate;
  if (d === 0) return 'same as the last cover';
  return `${d > 0 ? '+' : '-'}${money(Math.abs(d))} (${d > 0 ? '+' : '-'}${(Math.abs(d) / mem.last.rate * 100).toFixed(1)}%) vs the last cover`;
}

// ------------------------------------------------------------------------------------------------ pace

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
/**
 * Monday 00:00 (local time) of the week containing d.
 * The cover week runs Monday through Sunday: Monday is the first day of a new week, so the weekly count resets the moment
 * Sunday ends (12:00 AM Monday). Anything closed on a Sunday still belongs to the week that is finishing.
 */
export function weekStart(d) { const x = startOfDay(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
/** The Monday 00:00 that starts the NEXT week (when the weekly count resets). */
export function nextWeekStart(d) { const x = weekStart(d); x.setDate(x.getDate() + 7); return x; }
/** "2026-11-09": a stable id for the week containing d (its Monday). */
export function weekKey(d) { const x = weekStart(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }

/** Fraction (0..1) of this week's WORKING time that has passed, and how many working days remain (fractional). */
export function workWeekProgress(now, s) {
  const days = (Array.isArray(s.workDays) && s.workDays.length ? s.workDays : [1, 2, 3, 4, 5]).map(Number);
  const start = Number.isFinite(Number(s.workStart)) ? Number(s.workStart) : 7;
  const end = Number.isFinite(Number(s.workEnd)) && Number(s.workEnd) > start ? Number(s.workEnd) : 18;
  const ws = weekStart(now);
  let elapsed = 0;
  for (let i = 0; i < 7; i++) {
    const day = new Date(ws); day.setDate(ws.getDate() + i);
    if (!days.includes(day.getDay())) continue;
    const dayStart = new Date(day); dayStart.setHours(start, 0, 0, 0);
    const dayEnd = new Date(day); dayEnd.setHours(end, 0, 0, 0);
    const f = now >= dayEnd ? 1 : now <= dayStart ? 0 : (now - dayStart) / (dayEnd - dayStart);
    elapsed += f;
  }
  return { fraction: elapsed / days.length, daysElapsed: elapsed, daysTotal: days.length, daysLeft: Math.max(0, days.length - elapsed) };
}

/**
 * Covers today / this week and where the week is heading.
 *  status: 'on' (projected >= floor) | 'close' (>= 90%) | 'short' | 'early' (too little of the week has passed to project)
 */
export function paceStats(log, settings, now = new Date(), broker = null) {
  const floor = Number(settings.weeklyFloor) > 0 ? Number(settings.weeklyFloor) : 50;
  const ws = weekStart(now), we = nextWeekStart(now), ds = startOfDay(now), de = new Date(ds); de.setDate(de.getDate() + 1);
  const mine = (log || []).filter(e => isCover(e) && (broker === null || broker === undefined || (e.broker || '') === broker));
  const t = (e) => Date.parse(e.closedAt);
  const today = mine.filter(e => t(e) >= ds.getTime() && t(e) < de.getTime()).length;
  // Only this Monday-to-Sunday week counts: a cover dated in the future (or a manual cover for a later week) is not this week's.
  const week = mine.filter(e => t(e) >= ws.getTime() && t(e) < we.getTime()).length;
  const prog = workWeekProgress(now, settings);
  let projection = null, status = 'early';
  if (prog.fraction >= 1) { projection = week; }
  else if (prog.fraction >= 0.08) projection = Math.round(week / prog.fraction);
  if (projection !== null) status = projection >= floor ? 'on' : projection >= floor * 0.9 ? 'close' : 'short';
  const need = Math.max(0, floor - week);
  const perDay = prog.daysLeft > 0 ? Math.ceil(need / prog.daysLeft) : need;
  const word = status === 'on' ? 'on pace' : status === 'close' ? 'just short' : status === 'short' ? 'short' : '';
  const text = projection === null ? `Too early in the week to project - ${need} to go to reach ${floor}.`
    : `At the current rate you land at ${projection} — ${word}.`;
  return { today, week, floor, projection, status, need, perDay, text, fraction: prog.fraction, daysLeft: prog.daysLeft, weekStart: ws, resetsAt: we, weekKey: weekKey(now) };
}

/** "Mon 11/9 - Sun 11/15" for the week containing d. */
export function weekRangeText(d = new Date()) {
  const a = weekStart(d), b = new Date(a); b.setDate(a.getDate() + 6);
  const f = (x) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][x.getDay()]} ${x.getMonth() + 1}/${x.getDate()}`;
  return `${f(a)} - ${f(b)}`;
}

/**
 * Did logging `entry` just carry this week's cover count up to the weekly floor (default 50)? Pure: pass the log as it was BEFORE the
 * entry was added and the week that was already celebrated (counters.goalWeek). Fires once per week, at the moment of crossing, never
 * on a reload, a restore, or a week that was already over the line.
 * Returns null, or { week, floor, key }.
 */
export function weeklyGoalHit({ logBefore, entry, settings, goalWeek = '', now = new Date() }) {
  if (!entry || entry.outcome !== 'Covered') return null;
  const ws = weekStart(now).getTime(), we = nextWeekStart(now).getTime();
  const at = Date.parse(entry.closedAt);
  if (!(at >= ws && at < we)) return null;                       // a cover dated in some other week does not count toward this one
  const before = paceStats(logBefore, settings, now, null).week;
  const floor = Number(settings && settings.weeklyFloor) > 0 ? Number(settings.weeklyFloor) : 50;
  const key = weekKey(now);
  if (before + 1 !== floor || goalWeek === key) return null;     // exactly the cover that reaches the floor, once per week
  return { week: before + 1, floor, key };
}

export function coverStatsByBroker(log, brokers, settings, now = new Date()) {
  return [...brokers, ''].map(b => ({ broker: b, ...paceStats(log, settings, now, b || '') }));
}

/** Carriers ranked by covers in the log (for the carrier dashboard). */
export function topCarriersByCovers(log, n = 5) {
  const a = attributionFromLog(log);
  return [...a.carriers.entries()].map(([email, v]) => ({ email, covers: v.covers, avgRate: v.rated ? Math.round(v.rateSum / v.rated) : 0 }))
    .sort((x, y) => y.covers - x.covers).slice(0, n);
}

export { cityKey, laneKey, calculateDistanceMiles };
