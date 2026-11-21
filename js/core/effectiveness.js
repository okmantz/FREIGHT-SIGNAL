// Posting effectiveness (v16): which of the nine DAT posting combinations (origin A/B/C x destination A/B/C) and which cities actually produce
// QUALIFIED responses and covers, so the matrix can favour what works. Pure logic (no DOM, no storage).
//
// A "qualified" inquiry is one that got somewhere: the carrier quoted a real rate, gave an ETA or agreed. A carrier who asked "still available?" and
// vanished counts as a small fraction of a response. A decline barely counts. That is what separates a posting that makes the phone ring from one that
// makes the inbox noisy.

import { normalizeText, safeNumeric } from './util.js';

/** How much one inquiry is worth as evidence that this lane/city produces trucks. 0.25 .. 3. */
export function inquiryQuality(q) {
  const st = String(q.stage || '').toUpperCase();
  const intent = String(q.intent || '').toLowerCase();
  if (st === 'ETA_RECEIVED' || st === 'AGREED') return 3;
  if (st === 'DECLINED' || intent === 'decline' || intent === 'stop') return 0.25;
  if (safeNumeric(q.lastCarrierRate) > 0) return 2;
  if (st === 'RATE_RESPONSE_SENT') return 1.5;
  if (intent === 'pushback') return 1;
  return 0.75;
}
export const isQualified = (q) => inquiryQuality(q) >= 1.5;

const DAY = 86400000;
/** Recency weight: halves every 120 days, never below 0.25. */
export const inquiryRecency = (q, now) => { const t = Date.parse(q.dateCounted); if (!Number.isFinite(t)) return 0.6; return Math.max(0.25, Math.pow(0.5, Math.max(0, now - t) / DAY / 120)); };

/**
 * Weighted counterpart of buildInquiryCaches: same shape (lane / origin / dest Maps), but each inquiry adds its quality x recency, not 1.
 */
export function buildWeightedCaches(inquiries, now = Date.now()) {
  const lane = new Map(), origin = new Map(), dest = new Map();
  const add = (m, k, w) => m.set(k, (m.get(k) || 0) + w);
  for (const q of inquiries || []) {
    if (!String(q.conversationId ?? '').trim()) continue;
    const a = normalizeText(q.originCity), b = normalizeText(q.originState), c = normalizeText(q.destCity), d = normalizeText(q.destState);
    if (!(a && b && c && d)) continue;
    const w = inquiryQuality(q) * inquiryRecency(q, now);
    add(origin, a + '|' + b, w); add(dest, c + '|' + d, w); add(lane, a + '|' + b + '>' + c + '|' + d, w);
  }
  return { lane, origin, dest };
}

/**
 * The nine combinations, measured. log = cover log. Returns { cells:{ 'A-A': {posted, covers, inquiries, coverRate, perPosting} }, groups, best, worst, enough }.
 * `enough` is false until there are at least 15 finished loads, so the screen can say "still learning" instead of drawing conclusions from noise.
 */
export function gridEffectiveness(log) {
  const cells = {}; for (const a of 'ABC') for (const b of 'ABC') cells[a + '-' + b] = { posted: 0, covers: 0, inquiries: 0 };
  let groups = 0;
  for (const e of log || []) {
    if ((e.outcome !== 'Covered' && e.outcome !== 'Expired') || !Array.isArray(e.postings) || !e.postings.length) continue;
    groups++;
    for (const p of e.postings) {
      const g = p.grid || (p.variant ? '' : 'A-A'); if (!cells[g]) continue;
      cells[g].posted++; cells[g].inquiries += safeNumeric(p.inquiryCount);
    }
    if (e.outcome === 'Covered' && e.covered && cells[e.covered.grid]) cells[e.covered.grid].covers++;
  }
  const rows = Object.entries(cells).map(([k, v]) => ({ grid: k, ...v, coverRate: v.posted ? v.covers / v.posted : 0, perPosting: v.posted ? v.inquiries / v.posted : 0 }));
  const ranked = rows.filter(r => r.posted >= 3).sort((a, b) => b.coverRate - a.coverRate || b.perPosting - a.perPosting);
  return { cells: Object.fromEntries(rows.map(r => [r.grid, r])), rows, groups, best: ranked[0] || null, worst: ranked.length > 3 ? ranked[ranked.length - 1] : null, enough: groups >= 15 };
}

/** One sentence for the report. */
export function gridSummary(eff) {
  if (!eff.enough) return 'Still learning: ' + eff.groups + ' finished load' + (eff.groups === 1 ? '' : 's') + ' so far. After about 15, this will show which of the nine postings actually produce trucks.';
  const b = eff.best, w = eff.worst;
  return 'Best posting: ' + b.grid + ' (' + Math.round(b.coverRate * 100) + '% of its postings covered the load)' + (w ? '. Weakest: ' + w.grid + ' (' + Math.round(w.coverRate * 100) + '%).' : '.');
}
