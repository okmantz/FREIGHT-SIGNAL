// Carrier outreach. Two engines, because the two macros contain two different implementations:
//   planExcelOutreach  - DraftCarrierOutreachForRow (Excel v3): fired by Carrier Outreach = Yes on one posting row.
//   planOutlookScan    - RunCarrierDatabaseScan (Outlook v3): scans every Active + outreach=YES load.
// Both only PLAN drafts. Nothing is ever sent.

import { normalizeText, normalizeForMatching, isSameCity, safeString, CRLF } from './util.js';
import { DEFAULT_SETTINGS } from './defaults.js';

/** IsBlockedSender (Excel): "@domain" entries block a domain suffix, everything else is an exact address. Empty email is blocked. */
export function isBlockedExcel(email, list) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!e) return true;
  for (const raw of list || []) {
    const entry = String(raw ?? '').trim().toLowerCase();
    if (!entry) continue;
    if (entry[0] === '@') { if (e.endsWith(entry)) return true; }
    else if (e === entry) return true;
  }
  return false;
}

/** Outlook IsBlockedSender: substring test. */
export function isBlockedOutlook(email, list) {
  const e = String(email ?? '').trim().toLowerCase();
  for (const raw of list || []) {
    const entry = String(raw ?? '').trim().toLowerCase();
    if (entry && e.includes(entry)) return true;
  }
  return false;
}

/** CleanLoadDetailsText */
export function cleanLoadDetailsText(rawText) {
  let c = String(rawText ?? '');
  c = c.replace(/<br\s*\/>/gi, CRLF).replace(/<br\/>/gi, CRLF).replace(/<br>/gi, CRLF);
  c = c.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
  c = c.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, CRLF);
  while (c.includes(CRLF + CRLF + CRLF)) c = c.replace(CRLF + CRLF + CRLF, CRLF + CRLF);
  return c.trim();
}

/** BuildFallbackLoadDetails (Excel) */
export function buildFallbackLoadDetails(p) {
  let details = 'Pickup: ' + safeString(p.originCity) + ', ' + safeString(p.originState).toUpperCase();
  const z = String(p.originZip ?? '').trim();
  if (z) details += ' ' + z;
  details += CRLF + 'Pickup Date: ' + safeString(p.pickupEarliest) + CRLF + CRLF +
    'Delivery: ' + safeString(p.destCity) + ', ' + safeString(p.destState).toUpperCase() + CRLF + CRLF +
    'Weight: ' + safeString(p.weight) + CRLF + 'Equipment: ' + safeString(p.equip);
  return details;
}

/** BuildOutreachSubject (Excel) - note the macro puts no space after the second comma. */
export function buildExcelSubject(p) {
  return 'Load available: ' + safeString(p.originCity) + ', ' + safeString(p.originState).toUpperCase() + ' to ' +
    safeString(p.destCity) + ',' + safeString(p.destState).toUpperCase();
}

/** BuildOutreachBody (Excel) */
export function buildExcelBody(p, carrier) {
  const name = safeString(carrier.carrierName);
  const hello = name ? 'Hello ' + name + ',' : 'Hello,';
  let details = cleanLoadDetailsText(p.details);
  if (!details) details = buildFallbackLoadDetails(p);
  return hello + CRLF + CRLF + 'We have the following load available:' + CRLF + CRLF + details + CRLF + CRLF +
    'Please reply with availability and your best rate.' + CRLF + CRLF + 'Thank you,';
}

/**
 * DraftCarrierOutreachForRow. Match order: 1) exact origin+destination city/state, 2) same origin+destination state,
 * 3) same origin state only. Carriers with no origin-state match are rejected. Inactive carriers are skipped.
 */
export function planExcelOutreach(post, carriers, settings = DEFAULT_SETTINGS) {
  const res = { drafts: [], attempted: 0, created: 0, detail: '', error: '' };
  let target = Math.trunc(Number(post.outreachTarget) || 0);
  if (target < 1) target = settings.lowTarget;
  const originCity = safeString(post.originCity), originState = safeString(post.originState).toUpperCase();
  const destCity = safeString(post.destCity), destState = safeString(post.destState).toUpperCase();
  if (!originState) { res.detail = 'The selected load is missing an origin state in column Q.'; return res; }
  if (!destState) { res.detail = 'The selected load is missing a destination state in column T.'; return res; }

  const exact = [], stateToState = [], originOnly = [];
  for (const c of carriers) {
    const email = safeString(c.email).toLowerCase();
    const active = safeString(c.status).toLowerCase() !== 'inactive';
    if (!email || !active) continue;
    const co = safeString(c.originCity), cs = safeString(c.originState).toUpperCase();
    const cd = safeString(c.destCity), ds = safeString(c.destState).toUpperCase();
    const exactOrigin = !!(co && originCity && isSameCity(co, cs, originCity, originState));
    const exactDest = !!(cd && destCity && isSameCity(cd, ds, destCity, destState));
    if (exactOrigin && exactDest) exact.push(c);
    else if (cs === originState && ds === destState) stateToState.push(c);
    else if (cs === originState) originOnly.push(c);
  }

  const used = new Set();
  let created = 0;
  const run = (list) => {
    for (const c of list) {
      if (created >= target) break;
      const email = safeString(c.email).toLowerCase();
      if (!email) continue;
      if (isBlockedExcel(email, settings.outreachBlocklist)) continue;
      if (used.has(email)) continue;
      used.add(email);
      res.attempted++;
      res.drafts.push({ to: email, subject: buildExcelSubject(post), body: buildExcelBody(post, c), carrierId: c.id, tier: '' });
      created++;
    }
  };
  let before = created;
  run(exact); const exactCreated = created - before;
  before = created;
  if (created < target) run(stateToState); const stateCreated = created - before;
  before = created;
  if (created < target) run(originOnly); const originCreated = created - before;
  // tier labels for the UI
  const exactEmails = new Set(exact.map(c => safeString(c.email).toLowerCase()));
  const stateEmails = new Set(stateToState.map(c => safeString(c.email).toLowerCase()));
  res.drafts.forEach(d => { d.tier = exactEmails.has(d.to) ? 'Exact lane' : stateEmails.has(d.to) ? 'State-to-state' : 'Origin state only'; });

  res.created = created;
  res.detail = 'Requested ' + target + '; created ' + created + '.' + CRLF +
    'Exact city/state lane: ' + exactCreated + CRLF +
    'State-to-state lane: ' + stateCreated + CRLF +
    'Origin-state-only fallback: ' + originCreated + CRLF +
    'Carriers without an origin-state match were rejected.' + CRLF +
    'Every run creates new items and does not use prior-send deduplication.';
  if (created < target) res.detail += CRLF + 'The outreach target was not filled because no additional qualified carriers were available.';
  return res;
}

// ---------------- Outlook v3 scan engine ----------------

const isYesValue = (t) => ['YES', 'Y', 'TRUE', '1'].includes(String(t ?? '').trim().toUpperCase());
const sameLocation = (a, b) => { const x = normalizeForMatching(a), y = normalizeForMatching(b); return !!x && !!y && x.toLowerCase() === y.toLowerCase(); };

/** GetCarrierLaneScore */
export function carrierLaneScore(loc, car, requireBoth = false) {
  if (!sameLocation(loc.originCity, car.originCity) || !sameLocation(loc.destCity, car.destCity)) return -1;
  let score = 200;
  if (sameLocation(loc.originState, car.originState)) score += 25; else if (requireBoth) return -1;
  if (sameLocation(loc.destState, car.destState)) score += 25; else if (requireBoth) return -1;
  return score;
}

/** BuildLoadDetails (Outlook) */
export function buildOutlookLoadDetails(p) {
  let s = '';
  if (safeString(p.loadNumber)) s += 'Load #: ' + safeString(p.loadNumber) + CRLF;
  s += 'Pickup: ' + safeString(p.originCity) + ', ' + safeString(p.originState) + CRLF + 'Delivery: ' + safeString(p.destCity) + ', ' + safeString(p.destState);
  if (safeString(p.pickupEarliest)) s += CRLF + 'Pickup Date: ' + safeString(p.pickupEarliest);
  if (safeString(p.equip)) s += CRLF + 'Equipment: ' + safeString(p.equip);
  if (safeString(p.weight)) s += CRLF + 'Weight: ' + safeString(p.weight);
  return s.trim();
}

/** CreateCarrierAvailabilityDraft subject/body */
export function buildOutlookOutreach(p, email, details) {
  return {
    to: email,
    subject: 'Truck Available? ' + p.originCity + ', ' + p.originState + ' -> ' + p.destCity + ', ' + p.destState,
    body: 'Hello,' + CRLF + CRLF + 'Do you have a truck available?' + CRLF + CRLF + 'Here are the load details:' + CRLF + details +
      CRLF + CRLF + 'What is your best all-in rate? ETA to pickup?',
  };
}

/**
 * RunCarrierDatabaseScan / FindCarriersForLoad. Eligible loads: Load Status = ACTIVE and Carrier Outreach in YES/Y/TRUE/1.
 * Loads are scanned bottom-to-top. Carriers match on origin CITY + destination CITY; states only add score.
 * At most `maxCarriersPerLoad` new drafts per load; (load, email) pairs already in the outreach log are skipped.
 */
export function planOutlookScan(postings, carriers, outreachLog, settings = DEFAULT_SETTINGS) {
  const seen = new Set((outreachLog || []).map(o => String(o.key).toLowerCase()));
  const laneIndex = new Map();
  carriers.forEach((c, i) => {
    const o = normalizeForMatching(c.originCity), d = normalizeForMatching(c.destCity);
    if (!o || !d) return;
    const k = o + '|' + d;
    if (!laneIndex.has(k)) laneIndex.set(k, []);
    laneIndex.get(k).push(c);
  });
  const drafts = [], logEntries = [], countUpdates = new Map();
  for (let i = postings.length - 1; i >= 0; i--) {
    const p = postings[i];
    if (!(String(p.status ?? '').trim().toUpperCase() === 'ACTIVE' && isYesValue(p.outreach))) continue;
    const key = normalizeForMatching(p.originCity) + '|' + normalizeForMatching(p.destCity);
    if (key === '|' || !laneIndex.has(key)) continue;
    const loadKey = String(p.loadNumber || p.id).toLowerCase();
    const details = safeString(p.details) ? safeString(p.details) : buildOutlookLoadDetails(p);
    let created = 0;
    for (const c of laneIndex.get(key)) {
      const email = safeString(c.email).toLowerCase();
      if (!email) continue;
      const score = carrierLaneScore(p, c, settings.requireBothStates);
      if (score < 200) continue;
      const outreachKey = (loadKey + '|' + email).toLowerCase();
      if (seen.has(outreachKey)) continue;
      drafts.push({ ...buildOutlookOutreach(p, email, details), postingId: p.id, carrierId: c.id, tier: 'Lane scan (score ' + score + ')' });
      logEntries.push({
        key: outreachKey, dateTime: new Date().toISOString(), loadNumber: p.loadNumber || '', postingId: p.id, postingRow: i + 2,
        carrierName: c.carrierName, email: c.email, phone: c.phone, mc: c.mc,
        originCity: p.originCity, originState: p.originState, destCity: p.destCity, destState: p.destState, score, status: 'DRAFT CREATED',
      });
      seen.add(outreachKey);
      countUpdates.set(p.id, (countUpdates.get(p.id) || 0) + 1);
      created++;
      if (created >= settings.maxCarriersPerLoad) break;
    }
  }
  // OutreachCount per load key (existing log + new)
  return { drafts, logEntries, countUpdates };
}

export { normalizeText };
