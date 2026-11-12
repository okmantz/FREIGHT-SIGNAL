// 3 x 3 posting matrix. Port of CreateNearbyPostings, SelectTwoAlternates, AddCandidatesToPool,
// WriteNearbyPosting, BuildInquiryCaches and BuildPreviewMessage (Excel v3).

import {
  normalizeText, normalizeZip, isSameCity, calculateDistanceMiles, vbaRound, fmt1, createLoadGroupId, safeNumeric, canonHeader,
} from './util.js';
import { extractLastZipAfterLabel } from './parser.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { blankPosting, initializeLoadControls, reconcileManualLane, countAlternates, groupMembers } from './model.js';
import { classifyLane, DEFAULT_STRATEGIES, ringsFor } from './lanes.js';
import { attributionFromLog } from './coverlog.js';

/** BuildInquiryCaches: origin / destination / lane inquiry counts from the Inquiry Log. */
export function buildInquiryCaches(inquiries) {
  const lane = new Map(), origin = new Map(), dest = new Map();
  const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const q of inquiries || []) {
    if (!String(q.conversationId ?? '').trim()) continue; // IsInquiryRow
    const a = normalizeText(q.originCity), b = normalizeText(q.originState);
    const c = normalizeText(q.destCity), d = normalizeText(q.destState);
    if (a && b && c && d) {
      inc(origin, a + '|' + b); inc(dest, c + '|' + d); inc(lane, a + '|' + b + '>' + c + '|' + d);
    }
  }
  return { lane, origin, dest };
}

export function laneInquiryCount(caches, oc, os, dc, ds) {
  return caches.lane.get(normalizeText(oc) + '|' + normalizeText(os) + '>' + normalizeText(dc) + '|' + normalizeText(ds)) || 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// ADAPTIVE ALTERNATE SELECTION (replaces the Excel macro's fixed 20-60 mile tier + population/distance score)
//
// Why: with a fixed 20-60 mile ring, a San Leandro pickup skipped Hayward and Oakland (too close) and reached for Stockton
// and beyond, because the old score added ln(population) x 10 and subtracted only 1 point per mile.
//
// Now, per end of the lane (origin and destination separately):
//   1. The lane is classed local / regional / long (lanes.js) and that class decides the search rings (tight first, widening
//      only if too few markets turn up) and the "sweet spot" distance.
//   2. Candidates are whole MARKETS (a city's ZIPs summed), not single ZIP rows.
//   3. score = size x closeness + what has actually worked:
//        size       0.15 .. 1   log-scaled population (saturates near 120k), so a huge metro does not drown out a closer freight town
//        closeness  1 / (1 + ((miles - ideal) / scale)^2)  - a bell around the ideal distance. The class's ideal is shrunk in dense metros
//                   (many markets nearby = alternates can be close and still reach different trucks) and kept in thin country.
//        history    + lane covers, + covers from that city as this end, + inquiries; - cities posted many times with no cover
//   4. The two picks must be at least `minSep` miles apart (two suburbs on the same highway add no reach).
//   5. Your own pins (System / preview "remember my choice") win over everything.
// ---------------------------------------------------------------------------------------------------------------------
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mktKey = (city, st) => normalizeText(city) + '|' + normalizeText(st);

function candidateScore(c, dist, ideal, attr, caches, selectingOrigin, otherKey) {
  const popF = clamp(Math.log10(Math.max(c.pop, 1) / 8000) / 1.18, 0.15, 1);
  const scale = Math.max(4, ideal * 0.9);
  const distF = 1 / (1 + ((dist - ideal) / scale) ** 2);
  let hist = 0;
  const cityKey = c.key;
  const lane = selectingOrigin ? cityKey + '>' + otherKey : otherKey + '>' + cityKey;
  if (attr) {
    const side = (selectingOrigin ? attr.origin : attr.dest).get(cityKey);
    const laneWins = attr.lane.get(lane) || 0;
    hist += Math.min(2.4, laneWins * 1.2);
    if (side) {
      hist += Math.min(1.0, side.wins * 0.25);
      if (side.appear >= 6 && side.wins === 0) hist -= 0.2;
    }
  }
  if (caches) {
    const h = (selectingOrigin ? caches.origin : caches.dest).get(cityKey) || 0;
    const l = caches.lane.get(lane) || 0;
    hist += Math.min(0.6, l * 0.15) + Math.min(0.3, h * 0.03);
  }
  return popF * distF + hist;
}

/**
 * Rank candidate markets around one end of the lane.
 * Returns { ring, ranked:[{city,state,zip,miles,pop,score}], center } ; ring = index of the first ring that gave >= 4 markets.
 */
export function rankMarkets(zm, { centerCity, centerState, centerZip, otherCity, otherState, selectingOrigin, strategy, attr = null, caches = null, topN = 40, exclude = null }) {
  const mk = zm.market(centerCity, centerState);
  const zr = zm.byZipGeo.get(normalizeZip(centerZip));
  const center = zr ? { lat: zr.lat, lng: zr.lng } : mk ? { lat: mk.lat, lng: mk.lng } : null;
  if (!center) return { ring: -1, ranked: [], center: null };
  const otherKey = mktKey(otherCity, otherState);
  const self = mktKey(centerCity, centerState);
  const all = [];
  for (const c of zm.markets().values()) {
    if (c.key === self || c.key === otherKey) continue;
    if (exclude && exclude.has(c.key)) continue;
    all.push({ c, d: calculateDistanceMiles(center.lat, center.lng, c.lat, c.lng) });
  }
  // Density: how many real markets sit inside the class's normal reach. Dense (Bay Area, Chicagoland) -> ideal shrinks to as little as 45%.
  const nearCount = all.filter(x => x.d <= strategy.altMax && x.c.pop >= strategy.minPop).length;
  const ideal = strategy.altIdeal * clamp(Math.sqrt(10 / Math.max(nearCount, 1)), 0.45, 1);
  let used = -1, pool = [];
  const rings = ringsFor(strategy);
  for (let i = 0; i < rings.length; i++) {
    const r = rings[i];
    pool = all.filter(x => x.d >= r.min && x.d <= r.max && x.c.pop >= r.minPop);
    used = i;
    if (pool.length >= 4) break;
  }
  const ranked = pool.map(({ c, d }) => ({ city: c.city, state: c.state, zip: c.zip, miles: d, pop: c.pop, lat: c.lat, lng: c.lng, key: c.key,
    score: candidateScore(c, d, ideal, attr, caches, selectingOrigin, otherKey) }))
    .sort((a, b) => b.score - a.score || a.miles - b.miles).slice(0, topN);
  return { ring: used, ranked, center, ideal, nearCount };
}

/** Pick the best two alternates (min separation enforced). Pins are honoured first. Returns { picks, ring, pinned, ranked } or null. */
export function selectAlternates(zm, args) {
  const { ranked, ring, center, ideal } = rankMarkets(zm, args);
  const pins = (args.pins || []).map(pn => zm.market(pn.city, pn.state)).filter(Boolean);
  const toPick = (m, d) => ({ city: m.city, state: m.state, zip: m.zip, miles: d, pop: m.pop, lat: m.lat, lng: m.lng, key: m.key });
  if (pins.length >= 2 && center) {
    const picks = pins.slice(0, 2).map(m => toPick(m, calculateDistanceMiles(center.lat, center.lng, m.lat, m.lng)));
    return { picks, ring, pinned: true, ranked };
  }
  if (ranked.length < 2) return null;
  const minSep = Math.max(4, ideal * 0.8);
  const first = ranked[0];
  let second = ranked.slice(1).find(c => calculateDistanceMiles(first.lat, first.lng, c.lat, c.lng) >= minSep) || ranked[1];
  return { picks: [first, second], ring, pinned: false, ranked };
}

/** Back-compat helper (old signature). Uses the regional strategy. */
export function selectTwoAlternates(zm, caches, centerZip, originalCity, originalState, otherCity, otherState, selectingOrigin, strategy = DEFAULT_STRATEGIES.regional) {
  const r = selectAlternates(zm, { centerCity: originalCity, centerState: originalState, centerZip, otherCity, otherState, selectingOrigin, strategy, caches });
  return r ? r.picks : null;
}

/** Candidate list for the matrix preview pickers. */
export function rankCandidates(zm, caches, centerZip, originalCity, originalState, otherCity, otherState, selectingOrigin, strategy = DEFAULT_STRATEGIES.regional, topN = 15, attr = null) {
  return rankMarkets(zm, { centerCity: originalCity, centerState: originalState, centerZip, otherCity, otherState, selectingOrigin, strategy, caches, attr, topN }).ranked;
}

/** Pins are stored per market: "san leandro|ca" -> [{city,state},{city,state}] */
export const pinKey = (city, state) => mktKey(city, state);

/**
 * Plan the matrix without changing anything.
 * Returns { ok:true, origins:[3], dests:[3], lane:{cls,miles}, quality:{weird,reasons[]}, ... } or { ok:false, error }
 * `quality.weird` is what decides whether the auto-build asks you first ("Auto-build 3x3" in System -> Matrix).
 */
/** exclude: array of "city|st" market keys that must not be picked (used by "try different cities" so the rebuild moves on). */
export function planMatrix({ source, zipMap, inquiries, coverLog = [], settings = DEFAULT_SETTINGS, exclude = [] }) {
  if (!zipMap || !zipMap.size) return { ok: false, error: 'ZIP Map sheet is missing.' };
  const warnings = [];
  const rec = reconcileManualLane(source, zipMap);
  if (rec.warning) warnings.push(rec.warning);
  const o0 = { city: String(source.originCity).trim(), state: String(source.originState).trim().toUpperCase(), zip: normalizeZip(source.originZip), miles: 0 };
  const d0 = { city: String(source.destCity).trim(), state: String(source.destState).trim().toUpperCase(), zip: '', miles: 0 };
  d0.zip = zipMap.bestZipForCityState(d0.city, d0.state);
  if (!d0.zip) d0.zip = extractLastZipAfterLabel(source.details, 'Delivery:');
  if (!o0.city || !o0.state || !o0.zip || !d0.city || !d0.state || !d0.zip) {
    return { ok: false, error: 'Origin or destination could not be matched to ZIP Map.' };
  }
  const caches = buildInquiryCaches(inquiries);
  const attr = attributionFromLog(coverLog);
  const lane = classifyLane({ ...source, originZip: o0.zip, destZip: d0.zip }, zipMap, settings);
  const pins = exclude.length ? {} : (settings.matrixPins || {});
  const ex = exclude.length ? new Set(exclude) : null;
  const oSel = selectAlternates(zipMap, { centerCity: o0.city, centerState: o0.state, centerZip: o0.zip, otherCity: d0.city, otherState: d0.state, selectingOrigin: true, strategy: lane.strategy, attr, caches, exclude: ex, pins: pins[pinKey(o0.city, o0.state)] });
  if (!oSel) return { ok: false, error: 'Could not find two distinct origin alternatives anywhere in ZIP Map.' };
  const dSel = selectAlternates(zipMap, { centerCity: d0.city, centerState: d0.state, centerZip: d0.zip, otherCity: o0.city, otherState: o0.state, selectingOrigin: false, strategy: lane.strategy, attr, caches, exclude: ex, pins: pins[pinKey(d0.city, d0.state)] });
  if (!dSel) return { ok: false, error: 'Could not find two distinct destination alternatives anywhere in ZIP Map.' };
  const toLoc = (a) => ({ city: a.city, state: a.state, zip: a.zip, miles: a.miles });
  const reasons = [];
  const st = lane.strategy;
  const check = (sel, label) => {
    if (sel.pinned) return;
    if (sel.ring >= 2) reasons.push(`${label}: nothing suitable within ${Math.round(st.altMax * 1.75)} mi, so the search widened.`);
    for (const a of sel.picks) {
      if (a.miles > st.altMax * 1.5) reasons.push(`${label}: ${a.city}, ${a.state} is ${Math.round(a.miles)} mi away (class limit ${st.altMax} mi).`);
      else if (a.pop < 10000) reasons.push(`${label}: ${a.city}, ${a.state} is a very small market (${a.pop.toLocaleString()} people).`);
    }
  };
  check(oSel, 'Origin'); check(dSel, 'Destination');
  if (rec.warning) reasons.push(rec.warning);
  return {
    ok: true, warnings, caches, lane: { cls: lane.cls, miles: lane.miles, label: lane.label },
    origins: [o0, ...oSel.picks.map(toLoc)], dests: [d0, ...dSel.picks.map(toLoc)],
    quality: { weird: reasons.length > 0, reasons },
  };
}

/** BuildPreviewMessage */
export function buildPreviewMessage(origins, dests) {
  let s = 'The matrix will use these markets:\r\n\r\n';
  origins.forEach((o, i) => { s += `Origin ${String.fromCharCode(65 + i)}: ${o.city}, ${o.state} (${fmt1(o.miles)} mi)\r\n`; });
  s += '\r\n';
  dests.forEach((d, j) => { s += `Destination ${String.fromCharCode(65 + j)}: ${d.city}, ${d.state} (${fmt1(d.miles)} mi)\r\n`; });
  s += '\r\nCreate all 9 combinations?';
  return s;
}

/**
 * Apply a plan: returns the 9 postings (original first, then Nearby 1..8) in sheet order.
 * Grid order from the macro: for i in 0..2 (origin), for j in 0..2 (destination), skipping (0,0).
 * Each alternate is a full copy of the source row with P..T, variant, group, alt miles and inquiry count replaced.
 */
export function applyMatrix({ source, plan, inquiries, settings = DEFAULT_SETTINGS, now = new Date(), sourceRow = 2, existingGroupIds = [] }) {
  let groupId = createLoadGroupId(now, sourceRow);
  let bump = 0;
  while (existingGroupIds.includes(groupId)) { bump++; groupId = createLoadGroupId(new Date(now.getTime() + bump * 10), sourceRow); }
  const caches = plan.caches || buildInquiryCaches(inquiries);
  source.variant = 'Original';
  source.groupId = groupId;
  source.originAltMiles = 0;
  source.destAltMiles = 0;
  initializeLoadControls(source, settings);
  const rows = [source];
  let n = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === 0 && j === 0) continue;
      n++;
      const o = plan.origins[i], d = plan.dests[j];
      // The macro copies the whole source row, then overwrites P..T and the matrix columns.
      const copy = JSON.parse(JSON.stringify(source));
      copy.id = blankPosting().id;
      copy.originCity = o.city; copy.originState = o.state; copy.originZip = normalizeZip(o.zip);
      copy.destCity = d.city; copy.destState = d.state; copy.destZip = normalizeZip(d.zip);
      copy.variant = 'Nearby ' + n;
      copy.groupId = groupId;
      copy.originAltMiles = vbaRound(o.miles, 1);
      copy.destAltMiles = vbaRound(d.miles, 1);
      copy.inquiryCount = laneInquiryCount(caches, o.city, o.state, d.city, d.state);
      initializeLoadControls(copy, settings);
      copy.outreach = 'No';
      rows.push(copy);
    }
  }
  return rows;
}

/** Guard used by the UI before building (macro: "This load already has alternate rows."). */
export function hasAlternates(postings, source) {
  return !!(source.groupId && countAlternates(postings, source.groupId) > 0);
}

export { groupMembers, safeNumeric, canonHeader };
