// Rate recommendation (v16): the rate that is most likely to get a truck on THIS load, built from your own results.
//
// What this is NOT: live DAT RateView data. DAT has no public API this static app can call, so the app never fetches or invents market rates
// (README: "No pricing"). Instead it learns from (1) loads you actually covered, (2) rates carriers actually quoted you, (3) the DAT average you
// typed once for the lane (it is recent only if you typed it recently: the age is shown), (4) teammates' lane statistics when you are on the Team Network.
// With none of those, it falls back to a rough per-mile table and says so ("low confidence").
// Pure logic (no DOM, no storage).

import { laneMiles } from './lanes.js';
import { zipMiles, median, roundTo, stateCode, DAY, HOUR, money } from './netcommon.js';
import { normalizeZip, normalizeText, safeNumeric } from './util.js';
import { equipFamily } from './netcommon.js';
import { laneDifficulty } from './corridor.js';

// Rough all-in dollars per mile for a ~700 mile haul, by equipment family. ONLY a last resort; it is labelled low confidence everywhere it shows.
const FALLBACK_RPM = { van: 2.05, reefer: 2.45, flatbed: 2.55, other: 2.6 };
const HALF_LIFE_DAYS = 45;

const recency = (iso, now) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return 0.5; const d = Math.max(0, (now - t) / DAY); return Math.max(0.2, Math.pow(0.5, d / HALF_LIFE_DAYS)); };
const zipFor = (city, st, zip, zipMap) => normalizeZip(zip) || (zipMap && zipMap.size && city && st ? zipMap.bestZipForCityState(city, st) : '');
const same = (a, b) => normalizeText(a.originCity) === normalizeText(b.originCity) && normalizeText(a.originState) === normalizeText(b.originState) && normalizeText(a.destCity) === normalizeText(b.destCity) && normalizeText(a.destState) === normalizeText(b.destState);

function laneRel(load, other, zipMap, radius = 100) {
  if (same(load, other)) return { kind: 'same', w: 3 };
  const lo = zipFor(load.originCity, load.originState, load.originZip, zipMap), ld = zipFor(load.destCity, load.destState, load.destZip, zipMap);
  const oo = zipFor(other.originCity, other.originState, other.originZip, zipMap), od = zipFor(other.destCity, other.destState, other.destZip, zipMap);
  const a = zipMiles(zipMap, lo, oo), b = zipMiles(zipMap, ld, od);
  if (a !== null && b !== null && a !== undefined && b !== undefined && a <= radius && b <= radius) return { kind: 'near', w: 2 };
  return null;
}

/**
 * suggestRate(load, ctx) -> { rate, low, high, confidence, basis:[strings], miles, sources:{...}, premium } or { rate: 0, confidence: 'none', basis: [...] }
 * ctx: { zipMap, coverLog, inquiries, settings, now, teamLane:{median, n} }
 */
export function suggestRate(load, ctx = {}) {
  const { zipMap = null, now = Date.now(), settings = {} } = ctx;
  const miles = laneMiles(load, zipMap);
  const pts = [];          // { rate, w, tag }
  const basis = [];
  let sameWeight = 0, ownN = 0, quoteN = 0;
  // 1. loads you covered
  for (const e of ctx.coverLog || []) {
    if (e.outcome !== 'Covered') continue; const r = safeNumeric(e.rate); if (!(r > 0)) continue;
    const l = e.covered || e.lane || {}; const rel = laneRel(load, l, zipMap); if (!rel) continue;
    const em = laneMilesOf(l, e, zipMap);
    const scaled = rel.kind === 'same' || !(miles > 0 && em > 0) ? r : r * (miles / em) * 0.5 + r * 0.5;      // a nearby lane of different length is only half scaled
    const w = rel.w * recency(e.closedAt, now);
    pts.push({ rate: scaled, w, tag: 'cover' }); ownN++; if (rel.kind === 'same') sameWeight += rel.w;
  }
  if (ownN) basis.push('Your ' + ownN + ' recent cover' + (ownN === 1 ? '' : 's') + ' on this lane or next to it (newer weighs more)');
  // 2. what carriers quoted you (an ETA/agreed stage means the quote was real)
  for (const q of ctx.inquiries || []) {
    const r = safeNumeric(q.lastCarrierRate); if (!(r > 0)) continue;
    const rel = laneRel(load, { originCity: q.originCity, originState: q.originState, destCity: q.destCity, destState: q.destState }, zipMap, 60); if (!rel || rel.kind !== 'same') continue;
    const st = String(q.stage || '').toUpperCase(); const verified = st === 'ETA_RECEIVED' || st === 'AGREED';
    pts.push({ rate: r, w: (verified ? 2 : 0.7) * recency(q.dateCounted, now), tag: 'quote' }); quoteN++;
  }
  if (quoteN) basis.push(quoteN + ' carrier quote' + (quoteN === 1 ? '' : 's') + ' on this lane');
  // 3. the DAT average you typed
  const dat = safeNumeric(load.datAvg);
  if (dat > 0) {
    const t = Date.parse(load.datAvgAt); const ageH = Number.isFinite(t) ? (now - t) / HOUR : null;
    const w = ageH === null ? 1.2 : ageH <= 48 ? 2.5 : ageH <= 24 * 7 ? 1.5 : 0.7;
    pts.push({ rate: dat, w, tag: 'dat' });
    basis.push('The DAT average you entered (' + money(dat) + ', ' + (ageH === null ? 'date unknown' : ageH < 1 ? 'just now' : ageH < 48 ? Math.round(ageH) + ' h old' : Math.round(ageH / 24) + ' d old') + ')');
  }
  // 4. teammates
  const tl = ctx.teamLane;
  if (tl && safeNumeric(tl.median) > 0) { pts.push({ rate: safeNumeric(tl.median), w: Math.min(2, 0.8 + (safeNumeric(tl.n) || 1) * 0.2), tag: 'team' }); basis.push('Team lane statistics (' + (tl.n || 1) + ' report' + ((tl.n || 1) === 1 ? '' : 's') + ')'); }
  // 5. last resort
  let fallback = false;
  if (!pts.length) {
    if (!(miles > 0)) return { rate: 0, low: 0, high: 0, confidence: 'none', basis: ['Not enough information: add the ZIP codes, or type the DAT average for this lane.'], miles: null, sources: {}, premium: 0 };
    const base = FALLBACK_RPM[equipFamily(load.equip)] || FALLBACK_RPM.van;
    const shortBoost = 1 + Math.max(0, (600 - miles) / 600) * 0.7;
    pts.push({ rate: Math.max(450, base * shortBoost * miles), w: 1, tag: 'fallback' }); fallback = true;
    basis.push('A rough per-mile table, because you have no covers, quotes or DAT average for this lane yet');
  }
  const wsum = pts.reduce((s, p) => s + p.w, 0);
  let rate = pts.reduce((s, p) => s + p.rate * p.w, 0) / wsum;
  // difficulty premium: only the part not already explained by your own results on exactly this lane
  const diff = laneDifficulty(load, { zipMap, settings });
  const premium = diff.premium * (1 - Math.min(1, sameWeight / 3));
  if (premium > 0.005) { rate *= 1 + premium; basis.push('Hard lane: +' + Math.round(premium * 100) + '% (' + diff.notes.join('; ').toLowerCase() + ')'); }
  rate = roundTo(rate, 25);
  const rates = pts.map(p => p.rate).sort((a, b) => a - b);
  const spread = rates.length > 1 ? (rates[rates.length - 1] - rates[0]) / 2 : rate * 0.08;
  const band = Math.max(rate * 0.05, Math.min(spread, rate * 0.15));
  const strong = ownN + quoteN;
  const confidence = fallback ? 'low' : strong >= 4 || (sameWeight >= 3 && strong >= 2) ? 'high' : strong >= 1 || dat > 0 && pts.some(p => p.tag === 'dat' && p.w >= 2) ? 'medium' : 'low';
  return { rate, low: roundTo(rate - band, 25), high: roundTo(rate + band, 25), confidence, basis, miles: miles === null ? null : Math.round(miles), sources: { covers: ownN, quotes: quoteN, dat: dat > 0, team: !!tl, fallback }, premium: Math.round(premium * 100) / 100 };
}
function laneMilesOf(l, e, zipMap) { const m = laneMiles(l, zipMap); return m > 0 ? m : safeNumeric(e.miles) || 0; }

/** Rate to put on a load that has none: the suggestion if it is good enough to trust as a starting point (never overwrites a number a person typed). */
export function autoTarget(load, ctx = {}) {
  if (safeNumeric(load.targetRate) > 0) return null;
  const s = suggestRate(load, ctx);
  return s.rate > 0 && s.confidence !== 'none' ? s : null;
}

/** "How much more should I pay to get a truck" from what actually happened: rate above the first target when loads were covered. */
export function raiseHistory(coverLog = []) {
  const rows = coverLog.filter(e => e.outcome === 'Covered' && safeNumeric(e.rate) > 0 && safeNumeric(e.targetRate) > 0);
  if (rows.length < 3) return null;
  const pct = rows.map(e => (safeNumeric(e.rate) - safeNumeric(e.targetRate)) / safeNumeric(e.targetRate) * 100);
  return { n: rows.length, medianPct: Math.round(median(pct) * 10) / 10 };
}
