// Posting (row of the FREIGHT SIGNAL sheet) model and the group operations from Workbook_SheetChange.

import { uid, safeNumeric } from './util.js';
import { DEFAULT_SETTINGS } from './defaults.js';

export const PRIORITIES = ['Low', 'Medium', 'High'];
export const STATUSES = ['Active', 'Covered'];

export function blankPosting(over = {}) {
  return {
    id: uid(),
    groupId: '',
    variant: '',              // "Original" | "Nearby n" | ""
    // Columns A..O (DAT bulk posting fields)
    pickupEarliest: '', pickupLatest: '', length: 53, weight: '', fullPartial: 'Full', equip: 'V',
    usePrivate: 'no', privateRate: '', allowPrivBooking: 'no', allowPrivBidding: 'no',
    useDat: 'yes', datRate: '', allowDatBooking: 'no', useExtended: 'no', contact: 'Email',
    // P..T lane (+ derived destination ZIP, not exported)
    originCity: '', originState: '', originZip: '', destCity: '', destState: '', destZip: '',
    targetRate: '',           // Z
    details: '',              // AB AutoReplyDetails (raw TQL text)
    notes: '',                // AC AutoReplyNotes
    inquiryCount: '',         // AD
    outreach: 'No',           // AI Carrier Outreach (Yes/No action dropdown)
    outreachCount: '',        // AJ Carrier Outreach Count
    status: '',               // AK Load Status
    priority: '',             // AL Outreach Priority
    outreachTarget: '',       // AM Outreach Target
    comment: '', commodity: '', referenceId: '',   // DAT columns V, W, X
    originAltMiles: '', destAltMiles: '',
    draftsCreated: '', lastRun: '', result: '',
    order: 0,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

export function targetForPriority(priority, settings = DEFAULT_SETTINGS) {
  switch (String(priority ?? '').trim().toLowerCase()) {
    case 'high': return { priority: 'High', target: settings.highTarget };
    case 'medium': case 'normal': return { priority: 'Medium', target: settings.mediumTarget };
    default: return { priority: 'Low', target: settings.lowTarget };
  }
}

/** InitializeLoadControls: defaults for status/priority/outreach. Outreach target always follows the priority (blank priority = Low = LOW_TARGET, exactly as the macro). */
export function initializeLoadControls(p, settings = DEFAULT_SETTINGS) {
  if (!String(p.status ?? '').trim()) p.status = 'Active';
  if (!String(p.priority ?? '').trim()) p.priority = 'Low';
  p.outreachTarget = targetForPriority(p.priority, settings).target;
  if (!String(p.outreach ?? '').trim()) p.outreach = 'No';
  return p;
}

export const groupMembers = (postings, groupId) => postings.filter(p => p.groupId && p.groupId.toLowerCase() === String(groupId).toLowerCase());

/** SetGroupPriority */
export function setGroupPriority(postings, groupId, priorityText, settings = DEFAULT_SETTINGS) {
  const { priority, target } = targetForPriority(priorityText, settings);
  for (const p of groupMembers(postings, groupId)) { p.priority = priority; p.outreachTarget = target; }
  return postings;
}

/** SetGroupStatus */
export function setGroupStatus(postings, groupId, statusText) {
  for (const p of groupMembers(postings, groupId)) p.status = statusText;
  return postings;
}

/**
 * Covered: the macro deletes the whole load group (or the single row if it has no group id).
 * Returns { remaining, removed }.
 */
export function coverPosting(postings, id) {
  const hit = postings.find(p => p.id === id);
  if (!hit) return { remaining: postings, removed: [] };
  const gid = (hit.groupId || '').trim();
  const removed = gid ? groupMembers(postings, gid) : [hit];
  const ids = new Set(removed.map(r => r.id));
  return { remaining: postings.filter(p => !ids.has(p.id)), removed };
}

export function countAlternates(postings, groupId) {
  return groupMembers(postings, groupId).filter(p => String(p.variant || '').toLowerCase().startsWith('nearby ')).length;
}

/** Re-number `order` to match array order. */
export function reindex(postings) {
  postings.forEach((p, i) => { p.order = i; });
  return postings;
}

/** Display row number (header is row 1 in the workbook, so first posting = row 2). */
export const sheetRow = (postings, id) => { const i = postings.findIndex(p => p.id === id); return i < 0 ? 0 : i + 2; };

function reconcileEnd(p, zipMap, cityKey, stateKey, zipKey, label) {
  const city = String(p[cityKey] ?? '').trim();
  const st = String(p[stateKey] ?? '').trim().toUpperCase();
  p[stateKey] = st;
  if (!(zipMap && zipMap.size && city && st)) return null;
  let z = String(p[zipKey] ?? '').replace(/[^0-9]/g, '');
  z = z ? z.slice(0, 5).padStart(5, '0') : '';
  let warning = null;
  if (z === '' || !zipMap.zipMatchesCityState(z, city, st)) {
    const best = zipMap.bestZipForCityState(city, st);
    if (!best) warning = `${label} "${city}, ${st}" was not found in the ZIP Map; the ZIP was cleared.`;
    z = best;
  }
  p[zipKey] = z;
  return warning;
}

/**
 * ReconcileManualLane: fix the ZIP from city/state and uppercase states, for the ORIGIN (as in the macro) and also the
 * DESTINATION (web-app addition, needed for the DAT "Destination Postal Code" column). Returns { warning? }.
 */
export function reconcileManualLane(p, zipMap) {
  const out = {};
  const w1 = reconcileEnd(p, zipMap, 'originCity', 'originState', 'originZip', 'Origin');
  const w2 = reconcileEnd(p, zipMap, 'destCity', 'destState', 'destZip', 'Destination');
  const w = [w1, w2].filter(Boolean);
  if (w.length) out.warning = w.join(' ');
  return out;
}

/** Position label inside a 3x3 matrix: Original = A-A, Nearby n (grid order, origin outer, destination inner) = A-B, A-C, B-A ... C-C. */
export function gridLabel(variant) {
  const v = String(variant ?? '');
  if (v === 'Original') return 'A-A';
  const m = /^nearby (\d+)$/i.exec(v);
  if (!m) return '';
  const n = Number(m[1]);           // 1..8
  const idx = n;                    // skips (0,0): index in a 3x3 row-major grid
  return 'ABC'[Math.floor(idx / 3)] + '-' + 'ABC'[idx % 3];
}

/**
 * Lane boxes for the board: one box per load group (the 9 matrix postings), one box per ungrouped posting.
 * Boxes keep first-appearance order; members keep sheet order. title = "Origin City, ST → Destination City, ST" of the ORIGINAL row.
 */
export function laneBoxes(postings) {
  const boxes = []; const byKey = new Map();
  for (const p of postings) {
    const gid = String(p.groupId || '').trim();
    const key = gid ? 'g:' + gid.toLowerCase() : 'p:' + p.id;
    let b = byKey.get(key);
    if (!b) { b = { key, groupId: gid, members: [] }; byKey.set(key, b); boxes.push(b); }
    b.members.push(p);
  }
  for (const b of boxes) {
    const head = b.members.find(m => m.variant === 'Original') || b.members[0];
    b.head = head;
    b.title = `${head.originCity || '?'}, ${head.originState || '?'} \u2192 ${head.destCity || '?'}, ${head.destState || '?'}`;
    b.isMatrix = b.members.length > 1 || !!b.groupId;
  }
  return boxes;
}

export function activeGroups(postings) {
  const seen = new Set(); let n = 0;
  for (const p of postings) {
    if (String(p.status).toLowerCase() !== 'active') continue;
    const key = p.groupId || p.id;
    if (!seen.has(key)) { seen.add(key); n++; }
  }
  return n;
}

export const numOrBlank = (v) => (v === '' || v === null || v === undefined ? '' : safeNumeric(v));
