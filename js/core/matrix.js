// 3 x 3 posting matrix. Port of CreateNearbyPostings, SelectTwoAlternates, AddCandidatesToPool,
// WriteNearbyPosting, BuildInquiryCaches and BuildPreviewMessage (Excel v3).

import {
  normalizeText, normalizeZip, isSameCity, calculateDistanceMiles, vbaRound, fmt1, createLoadGroupId, safeNumeric, canonHeader,
} from './util.js';
import { extractLastZipAfterLabel } from './parser.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { blankPosting, initializeLoadControls, reconcileManualLane, countAlternates, groupMembers } from './model.js';

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

/** AddCandidatesToPool */
function addCandidatesToPool(pool, zm, caches, centerZip, originalCity, originalState, minMiles, maxMiles, otherCity, otherState, selectingOrigin) {
  const center = zm.byZipGeo.get(normalizeZip(centerZip));
  if (!center) {
    const bz = zm.bestZipForCityState(originalCity, originalState);
    if (bz && bz !== centerZip) addCandidatesToPool(pool, zm, caches, bz, originalCity, originalState, minMiles, maxMiles, otherCity, otherState, selectingOrigin);
    return;
  }
  const oc = normalizeText(otherCity), os = normalizeText(otherState);
  for (const r of zm.rows) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lng)) continue;
    const city = r.city, st = r.state, z = r.zip;
    if (!city || !st || !z || isSameCity(city, st, originalCity, originalState)) continue;
    const dist = calculateDistanceMiles(center.lat, center.lng, r.lat, r.lng);
    if (dist < minMiles || dist > maxMiles) continue;
    const key = normalizeText(city) + '|' + normalizeText(st);
    let hist, lane;
    if (selectingOrigin) {
      hist = caches.origin.get(key) || 0;
      lane = caches.lane.get(key + '>' + oc + '|' + os) || 0;
    } else {
      hist = caches.dest.get(key) || 0;
      lane = caches.lane.get(oc + '|' + os + '>' + key) || 0;
    }
    const score = lane * 1000000 + hist * 10000 + Math.log(r.population + 1) * 10 - dist;
    const old = pool.get(key);
    if (!old) pool.set(key, { city, state: st, zip: z, miles: dist, pop: r.population, score });
    else if (score > old.score) pool.set(key, { city, state: st, zip: z, miles: dist, pop: r.population, score });
  }
}

/** SelectTwoAlternates: progressive fallback (20-60, 0-100, 0-200, anywhere) and top-2 by score. */
export function selectTwoAlternates(zm, caches, centerZip, originalCity, originalState, otherCity, otherState, selectingOrigin, tiers = DEFAULT_SETTINGS.distanceTiers) {
  const pool = new Map();
  for (const [lo, hi] of tiers) {
    addCandidatesToPool(pool, zm, caches, centerZip, originalCity, originalState, lo, hi, otherCity, otherState, selectingOrigin);
    if (pool.size >= 2) break;
  }
  if (pool.size < 2) return null;
  const picked = new Set(), out = [];
  for (let slot = 1; slot <= 2; slot++) {
    let bestKey = '', bestScore = -1e99;
    for (const [key, item] of pool) {
      if (picked.has(key)) continue;
      if (item.score > bestScore) { bestScore = item.score; bestKey = key; }
    }
    if (bestKey === '') return null;
    picked.add(bestKey);
    out.push(pool.get(bestKey));
  }
  return out;
}

/** Candidate list for the manual-review UI (same pool/score the macro uses, top N). */
export function rankCandidates(zm, caches, centerZip, originalCity, originalState, otherCity, otherState, selectingOrigin, tiers, topN = 15) {
  const pool = new Map();
  for (const [lo, hi] of tiers) {
    addCandidatesToPool(pool, zm, caches, centerZip, originalCity, originalState, lo, hi, otherCity, otherState, selectingOrigin);
    if (pool.size >= 2) break;
  }
  return [...pool.values()].sort((a, b) => b.score - a.score).slice(0, topN);
}

/**
 * Plan the matrix without changing anything.
 * Returns { ok:true, origins:[3], dests:[3] } or { ok:false, error }
 */
export function planMatrix({ source, zipMap, inquiries, settings = DEFAULT_SETTINGS }) {
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
  const oAlts = selectTwoAlternates(zipMap, caches, o0.zip, o0.city, o0.state, d0.city, d0.state, true, settings.distanceTiers);
  if (!oAlts) return { ok: false, error: 'Could not find two distinct origin alternatives anywhere in ZIP Map.' };
  const dAlts = selectTwoAlternates(zipMap, caches, d0.zip, d0.city, d0.state, o0.city, o0.state, false, settings.distanceTiers);
  if (!dAlts) return { ok: false, error: 'Could not find two distinct destination alternatives anywhere in ZIP Map.' };
  const toLoc = (a) => ({ city: a.city, state: a.state, zip: a.zip, miles: a.miles });
  return { ok: true, warnings, caches, origins: [o0, toLoc(oAlts[0]), toLoc(oAlts[1])], dests: [d0, toLoc(dAlts[0]), toLoc(dAlts[1])] };
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
