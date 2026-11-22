// Rate intelligence learned from YOUR history: what carriers quoted, what loads finally covered at, how far negotiation moves the number, the cheapest
// cover that worked and the rate that covered fastest. Sources: the Cover Log, the Inquiry Log, e-mail history threads and the shared lane data.
// Nothing here guesses: every number comes with how many comparable deals stand behind it and how old they are.
import { safeNumeric } from './util.js';
import { median, mean, roundTo, money, DAY, HOUR } from './netcommon.js';
import { relation } from './lanematch.js';

const ageDays = (t, now) => (Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : 365);
const recency = (days) => Math.max(0.25, Math.pow(0.5, days / 60));           // half weight every 60 days, never below a quarter

/**
 * rateIntel(load, ctx) -> { n, ... }
 *   ctx: { coverLog, inquiries, history (thread records), zipMap, now, teamLane:{median,n}, radius }
 *   result: { sameN, nearN, quotes:{n,avg,median,low,high}, covers:{n,avg,median,low,high,lowestSuccessful}, negotiation:{n,avgDrop,avgPct},
 *             fastest:{rate,hours}, confidence:'none'|'low'|'medium'|'high', confidenceScore, newest, oldest, basis:[...] }
 */
export function rateIntel(load, ctx = {}) {
  const { zipMap = null, now = Date.now(), radius = 60 } = ctx;
  const quotes = [], covers = [], deals = [];
  const take = (l, rate, at, kind, extra = {}) => {
    const r = relation(load, l, { zipMap, radius }); if (!r.kind || r.kind === 'state' && zipMap && zipMap.size) return null;
    const days = ageDays(at, now); const w = r.w * recency(days);
    return { rate, at, days, w, kind: r.kind, ...extra, via: kind };
  };
  for (const e of ctx.coverLog || []) {
    if (e.outcome !== 'Covered') continue; const rate = safeNumeric(e.rate); if (!(rate > 0)) continue;
    const t = Date.parse(e.closedAt); const hrs = Number(e.ageHours); const imported = !!e.imported;
    const p = take(e.covered || e.lane || {}, rate, t, 'cover', { hours: Number.isFinite(hrs) && hrs > 0 && !imported ? hrs : null, target: safeNumeric(e.targetRate) || null });
    if (p) covers.push(p);
  }
  for (const q of ctx.inquiries || []) {
    const rate = safeNumeric(q.lastCarrierRate); if (!(rate > 0)) continue;
    const st = String(q.stage || '').toUpperCase();
    const p = take({ originCity: q.originCity, originState: q.originState, destCity: q.destCity, destState: q.destState }, rate, Date.parse(q.dateCounted), 'inquiry', { verified: st === 'ETA_RECEIVED' || st === 'AGREED' });
    if (p) quotes.push(p);
  }
  for (const t of ctx.history || []) {
    if (!t.lane) continue;
    for (const qt of t.quotes || []) { const p = take(t.lane, safeNumeric(qt.rate), qt.at, 'mail'); if (p && p.rate > 0) quotes.push(p); }
    if (t.booked && t.finalRate > 0 && (t.rateConf === 'high')) {
      const p = take(t.lane, t.finalRate, t.bookedAt || t.last, 'mail-cover', {}); if (p) covers.push(p);
      if (t.firstQuote > 0 && t.firstQuote >= t.finalRate) { const d = take(t.lane, t.firstQuote - t.finalRate, t.bookedAt || t.last, 'deal', { first: t.firstQuote, final: t.finalRate }); if (d) deals.push(d); }
    }
  }
  // negotiation inside the app: first quote vs the cover the same carrier gave is only known from e-mail history; the Cover Log adds "asked vs target"
  const wmean = (list) => (list.length ? list.reduce((s, p) => s + p.rate * p.w, 0) / list.reduce((s, p) => s + p.w, 0) : null);
  const sum = (list) => list.length ? { n: list.length, avg: roundTo(wmean(list), 5), median: roundTo(median(list.map(p => p.rate)), 5), low: Math.min(...list.map(p => p.rate)), high: Math.max(...list.map(p => p.rate)) } : { n: 0, avg: null, median: null, low: null, high: null };
  const q = sum(quotes), c = sum(covers);
  const exactCovers = covers.filter(p => p.kind === 'same');
  const lowestSuccessful = covers.length ? Math.min(...(exactCovers.length ? exactCovers : covers).map(p => p.rate)) : null;
  const timed = covers.filter(p => p.hours > 0);
  let fastest = null; for (const p of timed) if (!fastest || p.hours < fastest.hours) fastest = { rate: p.rate, hours: Math.round(p.hours * 10) / 10 };
  const drops = deals.map(d => d.first - d.final), pcts = deals.map(d => (d.first - d.final) / d.first);
  // when there are no e-mail deals, the gap between the average quote and the average cover is the best available hint, flagged as an estimate
  let neg = { n: deals.length, avgDrop: drops.length ? Math.round(mean(drops)) : null, avgPct: pcts.length ? Math.round(mean(pcts) * 1000) / 10 : null, estimated: false };
  if (!deals.length && q.n >= 2 && c.n >= 2 && q.avg && c.avg && q.avg >= c.avg) neg = { n: Math.min(q.n, c.n), avgDrop: Math.round(q.avg - c.avg), avgPct: Math.round((q.avg - c.avg) / q.avg * 1000) / 10, estimated: true };
  const all = [...quotes, ...covers];
  const strongN = covers.length * 1.5 + quotes.length * 0.6 + (ctx.teamLane && ctx.teamLane.n ? Math.min(2, ctx.teamLane.n * 0.3) : 0);
  const avgAge = all.length ? mean(all.map(p => p.days)) : null;
  const confidenceScore = Math.round(Math.min(100, (strongN / 6) * 100 * (avgAge === null ? 0 : Math.max(0.35, 1 - avgAge / 240))));
  const confidence = !all.length && !(ctx.teamLane && ctx.teamLane.n) ? 'none' : confidenceScore >= 70 ? 'high' : confidenceScore >= 35 ? 'medium' : 'low';
  const basis = [];
  if (c.n) basis.push(c.n + ' covered load' + (c.n === 1 ? '' : 's') + ' on or next to this lane, newest ' + Math.round(Math.min(...covers.map(p => p.days))) + ' d ago');
  if (q.n) basis.push(q.n + ' carrier quote' + (q.n === 1 ? '' : 's'));
  if (deals.length) basis.push(deals.length + ' negotiation' + (deals.length === 1 ? '' : 's') + ' read from your e-mail');
  return {
    n: all.length, sameN: all.filter(p => p.kind === 'same').length, nearN: all.filter(p => p.kind === 'near').length, quotes: q, covers: { ...c, lowestSuccessful }, negotiation: neg, fastest,
    confidence, confidenceScore, newest: all.length ? Math.round(Math.min(...all.map(p => p.days))) : null, oldest: all.length ? Math.round(Math.max(...all.map(p => p.days))) : null, basis, teamLane: ctx.teamLane || null,
  };
}

/** Is the rate you are about to pay competitive? Compares with what this lane actually covered at. -> { verdict:'unknown'|'low'|'fair'|'high', gapPct, gap, text } */
export function competitiveness(rate, intel) {
  const r = safeNumeric(rate);
  const ref = intel && intel.covers && intel.covers.avg ? intel.covers.avg : (intel && intel.quotes && intel.quotes.avg) || 0;
  if (!(r > 0) || !(ref > 0) || !intel || intel.n < 2) return { verdict: 'unknown', gapPct: 0, gap: 0, text: 'Not enough history on this lane to judge the rate.' };
  const gap = Math.round(r - ref), gapPct = Math.round(gap / ref * 1000) / 10;
  const verdict = gapPct <= -6 ? 'low' : gapPct >= 6 ? 'high' : 'fair';
  const text = verdict === 'low' ? money(r) + ' is ' + Math.abs(gapPct) + '% under what this lane covered at (' + money(ref) + '). Expect slower replies.' : verdict === 'high' ? money(r) + ' is ' + gapPct + '% over your usual (' + money(ref) + '). You can probably negotiate.' : money(r) + ' is in line with what this lane covered at (' + money(ref) + ').';
  return { verdict, gapPct, gap, text };
}

/** The rate to open with and the rate to stop at: start near the average quote less the usual negotiation, and never above the highest rate that was needed. */
export function openingPlan(intel, { target = 0 } = {}) {
  if (!intel || intel.n < 2) return null;
  const covered = intel.covers.avg || intel.quotes.avg; if (!covered) return null;
  const drop = intel.negotiation.avgDrop || 0;
  const open = roundTo(Math.min(covered, (intel.quotes.avg || covered) - drop * 0.5), 25);
  const walk = roundTo(Math.max(covered, intel.covers.high || covered), 25);
  return { open: Math.min(open, walk), walkAway: walk, expected: roundTo(covered, 25), note: 'Open near ' + money(Math.min(open, walk)) + ', expect to land near ' + money(roundTo(covered, 25)) + ', and the most this lane has needed is ' + money(walk) + '.', target: safeNumeric(target) || 0 };
}

export { HOUR };
