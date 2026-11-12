// Per-load analysis: statistics, the work score (cover-probability estimate), "needs attention" flags and the board overview numbers.
// One "load" = one lane box = a load group (the 9 postings) or a single posting. Pure functions; the caller passes everything in `ctx`:
//   { postings, inquiries, drafts, coverLog, carriers, zip, settings, now, weather: Map("city|st" -> alerts[]), carrierRev }

import { safeNumeric, normalizeText } from './util.js';
import { laneBoxes } from './model.js';
import { classifyLane } from './lanes.js';
import { hoursToPickup, parseDateText } from './expiry.js';
import { laneMemory } from './coverlog.js';
import { rankCarriers } from './ranking.js';
import { overlapsWindow, pickupWindow, alertLabel } from './weather.js';
import { ladderStage } from './ladder.js';

const H = 3600000;
const cityKey = (c, s) => normalizeText(c) + '|' + normalizeText(s);

const depthCache = new Map();
export const clearDepthCache = () => depthCache.clear();
/** Number of carriers that fit this load's lane well (tier A-D). Cached per lane + carrier-list revision. */
export function carrierDepth(head, ctx) {
  const key = [cityKey(head.originCity, head.originState), cityKey(head.destCity, head.destState), ctx.carrierRev || 0, (ctx.carriers || []).length].join('>');
  if (depthCache.has(key)) return depthCache.get(key);
  const n = rankCarriers(head, ctx.carriers || [], { zip: ctx.zip, settings: ctx.settings, coverLog: ctx.coverLog, inquiries: ctx.inquiries, now: ctx.now }).filter(r => 'ABCD'.includes(r.tier)).length;
  if (depthCache.size > 4000) depthCache.clear();
  depthCache.set(key, n);
  return n;
}

/** Everything the scoring and guidance engines need to know about one load. */
export function groupStats(members, ctx) {
  const now = ctx.now || new Date();
  const head = members.find(m => m.variant === 'Original') || members[0];
  const ids = new Set(members.map(m => m.id));
  const inq = (ctx.inquiries || []).filter(q => ids.has(q.postingId));
  const times = inq.map(q => Date.parse(q.dateCounted)).filter(Number.isFinite);
  const fieldTotal = members.reduce((n, m) => n + safeNumeric(m.inquiryCount), 0);
  const total = Math.max(inq.length, fieldTotal);
  const quotes = inq.filter(q => safeNumeric(q.lastCarrierRate) > 0).map(q => ({ rate: safeNumeric(q.lastCarrierRate), email: q.senderEmail, stage: q.stage, flag: q.flag || '' }));
  const created = members.map(m => Date.parse(m.createdAt)).filter(Number.isFinite);
  const ageHours = created.length ? Math.max(0, (now.getTime() - Math.min(...created)) / H) : 0;
  const ops = members.flatMap(m => Array.isArray(m.ops) ? m.ops : []).filter((o, i, a) => a.findIndex(x => x.at === o.at && x.type === o.type) === i).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const lane = classifyLane(head, ctx.zip, ctx.settings || {});
  const rates = members.map(m => safeNumeric(m.datRate)).filter(r => r > 0);
  const datRate = safeNumeric(head.datRate) || rates[0] || 0;
  const target = safeNumeric(head.targetRate);
  const outreachSent = members.reduce((n, m) => n + safeNumeric(m.outreachCount), 0) + (ctx.drafts || []).filter(d => ids.has(d.postingId) && /outreach|truck|wave/i.test(d.kind || '')).length;
  // weather: pickup cities of every posting + the original delivery city, restricted to the pickup window
  const alerts = [];
  if (ctx.weather && ctx.weather.size) {
    const w = pickupWindow(head, now, parseDateText);
    const cities = new Set([...members.map(m => cityKey(m.originCity, m.originState)), cityKey(head.destCity, head.destState)]);
    const originSet = new Set(members.map(m => cityKey(m.originCity, m.originState)));
    for (const c of cities) for (const a of ctx.weather.get(c) || []) if (overlapsWindow(a, w.from, w.to)) alerts.push({ ...a, where: originSet.has(c) ? 'pickup' : 'delivery' });
  }
  const lastInquiryAt = times.length ? Math.max(...times) : 0;
  const lastOp = ops.length ? ops[ops.length - 1] : null;
  const lastOpAt = lastOp ? Date.parse(lastOp.at) : 0;
  const mem = laneMemory(ctx.coverLog, head, ctx.zip, Number(ctx.settings && ctx.settings.carrierRadiusMiles) || 75);
  const brokerStage = quotes.length ? ladderStage(Math.min(...quotes.map(q => q.rate)), target, ctx.settings || {}) : null;
  return {
    head, members, ids, lane, strategy: lane.strategy, cls: lane.cls,
    ageHours, hoursToPickup: hoursToPickup(head, now),
    inquiries: { total, log: inq.length, last2h: times.filter(t => now.getTime() - t <= 2 * H).length, lastAt: lastInquiryAt, sinceOp: lastOpAt ? times.filter(t => t > lastOpAt).length : total, quotes, bestQuote: quotes.length ? Math.min(...quotes.map(q => q.rate)) : 0,
      avgQuote: quotes.length ? Math.round(quotes.reduce((a, q) => a + q.rate, 0) / quotes.length) : 0, stage: brokerStage, flagged: inq.filter(q => /MANUAL REVIEW|RATE RECEIVED/i.test(q.flag || '')).length },
    outreachSent, datRate, rateSet: rates.length > 0, target, ops, lastOp, lastOpAt, alerts, weatherText: alertLabel(alerts), mem,
    phone: String(head.contact || '').toLowerCase() === 'phone',
    splitPct: Number(ctx.settings && ctx.settings.ladderSplitPct) || 8,
  };
}

/** Work score 0-100: an estimate of how worth working (and how likely to cover with a push) the load is right now. */
export function workScore(st, ctx) {
  const s = st.strategy; const r = []; let urgency = 0, engage = 0, hist = 0, fresh = 0, wx = 0, pen = 0;
  const h = st.hoursToPickup;
  if (h === null) urgency = 8;
  else if (h <= s.closingHours / 2) { urgency = 35; r.push(h <= 0 ? 'pickup window closing now' : `pickup in ${Math.max(1, Math.round(h))} h`); }
  else if (h <= s.closingHours) { urgency = 28; r.push('pickup closing soon'); }
  else if (h <= s.closingHours * 2) urgency = 18;
  else if (h <= s.closingHours * 4) urgency = 10;
  else urgency = 4;
  const n = st.inquiries.total;
  engage = n === 0 ? 0 : n === 1 ? 10 : n === 2 ? 16 : n <= 4 ? 22 : 28;
  if (n) r.push(`${n} inquir${n === 1 ? 'y' : 'ies'} in`);
  if (st.inquiries.quotes.length) { engage += 7; r.push('rate on the table'); }
  if (st.inquiries.last2h >= 2) { engage += 3; r.push(`${st.inquiries.last2h} in the last 2 h`); }
  engage = Math.min(35, engage);
  if (st.mem) { hist += st.mem.kind === 'exact' ? 10 : 5; r.push(st.mem.kind === 'exact' ? 'this lane has covered before' : 'a nearby lane has covered'); }
  const depth = ctx.carriers && ctx.carriers.length ? carrierDepth(st.head, ctx) : 0;
  if (depth >= 3) { hist += 5; r.push(`${depth} matching carriers`); } else if (depth > 0) hist += 2;
  const stale = s.staleHours;
  fresh = n > 0 ? 10 : st.ageHours <= stale ? 10 : st.ageHours <= stale * 3 ? Math.round(10 * (1 - (st.ageHours - stale) / (stale * 2))) : 0;
  if (st.alerts.length) { wx = 5; r.push('weather alert: ' + st.weatherText); }
  if (!st.rateSet) { pen = 10; r.push('no DAT rate set'); }
  const score = Math.max(0, Math.min(100, Math.round(urgency + engage + hist + fresh + wx - pen)));
  return { score, label: score >= 65 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold', reasons: r };
}

/** What needs the dispatcher's attention on this load. [{ kind, level:'urgent'|'act'|'watch', text }] */
export function attentionFlags(st) {
  const f = []; const s = st.strategy; const n = st.inquiries.total; const h = st.hoursToPickup;
  if (!st.rateSet) f.push({ kind: 'norate', level: 'act', text: 'No DAT rate set' });
  if (st.inquiries.quotes.length && st.inquiries.stage && st.inquiries.stage.stage === 'book') f.push({ kind: 'hot', level: 'urgent', text: 'A carrier is inside your booking band - confirm and book' });
  if (st.inquiries.flagged) f.push({ kind: 'review', level: 'act', text: `${st.inquiries.flagged} reply(ies) flagged for review` });
  if (n === 0 && st.ageHours >= s.staleHours) f.push({ kind: 'aging', level: h !== null && h <= s.closingHours ? 'urgent' : 'act', text: `Aging: ${Math.round(st.ageHours * 10) / 10} h with no inquiries` });
  if (h !== null && h <= s.closingHours && h > -24 && (n === 0 || !st.inquiries.quotes.length)) f.push({ kind: 'closing', level: 'urgent', text: h <= 0 ? 'Pickup day is ending' : `Pickup closes in ${Math.max(1, Math.round(h))} h` });
  if (st.alerts.length) f.push({ kind: 'weather', level: st.alerts.some(a => a.level === 'severe') ? 'urgent' : 'act', text: 'Weather: ' + st.weatherText });
  return f;
}

/**
 * Analyse every load on the board. Returns [{ box, stats, score, label, reasons, flags, attention }] in board order.
 * (Done once per render and shared by the overview, worklist, filters and lane headers.)
 */
export function analyseBoard(ctx) {
  const boxes = laneBoxes(ctx.postings.filter(p => String(p.status || 'Active').toLowerCase() !== 'covered'));
  return boxes.map(box => {
    const stats = groupStats(box.members, ctx);
    const sc = workScore(stats, ctx);
    const flags = attentionFlags(stats);
    return { box, stats, score: sc.score, label: sc.label, reasons: sc.reasons, flags, attention: flags.length > 0 };
  });
}

/** The ranked list: best score first, ties broken by the nearer pickup. */
export const rankLoads = (rows) => [...rows].sort((a, b) => b.score - a.score || (a.stats.hoursToPickup ?? 1e9) - (b.stats.hoursToPickup ?? 1e9));

export function overviewCounts(rows, ctx) {
  const now = ctx.now || new Date();
  const c = { loads: rows.length, postings: 0, attention: 0, urgent: 0, hot: 0, aging: 0, closing: 0, weather: 0, noRate: 0, noInquiries: 0, inquiries: 0, phone: 0 };
  for (const r of rows) {
    c.postings += r.box.members.length;
    if (r.attention) c.attention++;
    if (r.flags.some(f => f.level === 'urgent')) c.urgent++;
    if (r.flags.some(f => f.kind === 'hot')) c.hot++;
    if (r.flags.some(f => f.kind === 'aging')) c.aging++;
    if (r.flags.some(f => f.kind === 'closing')) c.closing++;
    if (r.flags.some(f => f.kind === 'weather')) c.weather++;
    if (r.flags.some(f => f.kind === 'norate')) c.noRate++;
    if (r.stats.inquiries.total === 0) c.noInquiries++;
    c.inquiries += r.stats.inquiries.total;
    if (r.stats.phone) c.phone++;
  }
  return c;
}

/** Board filter predicate by quick-filter name. */
export function matchesQuick(row, quick) {
  switch (quick) {
    case 'attention': return row.attention;
    case 'hot': return row.flags.some(f => f.kind === 'hot');
    case 'aging': return row.flags.some(f => f.kind === 'aging');
    case 'closing': return row.flags.some(f => f.kind === 'closing');
    case 'weather': return row.flags.some(f => f.kind === 'weather');
    case 'noinquiry': return row.stats.inquiries.total === 0;
    case 'norate': return row.flags.some(f => f.kind === 'norate');
    default: return true;
  }
}
