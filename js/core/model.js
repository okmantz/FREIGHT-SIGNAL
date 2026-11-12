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

/** InitializeLoadControls: defaults for status/priority/outreach; target is ALWAYS reset to LOW_TARGET (as in the macro). */
export function initializeLoadControls(p, settings = DEFAULT_SETTINGS) {
  if (!String(p.status ?? '').trim()) p.status = 'Active';
  if (!String(p.priority ?? '').trim()) p.priority = 'Low';
  p.outreachTarget = settings.lowTarget;
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

/** ReconcileManualLane: fix ZIP from city/state; uppercase states. Returns { warning? } */
export function reconcileManualLane(p, zipMap) {
  const out = {};
  const city = String(p.originCity ?? '').trim();
  const st = String(p.originState ?? '').trim().toUpperCase();
  if (zipMap && zipMap.size && city && st) {
    let z = String(p.originZip ?? '').replace(/[^0-9]/g, '');
    z = z ? z.slice(0, 5).padStart(5, '0') : '';
    if (z === '' || !zipMap.zipMatchesCityState(z, city, st)) {
      const best = zipMap.bestZipForCityState(city, st);
      if (!best) out.warning = `"${city}, ${st}" was not found in the ZIP Map; the ZIP was cleared (same as the Excel macro).`;
      z = best;
    }
    p.originZip = z;
  }
  p.originState = st;
  p.destState = String(p.destState ?? '').trim().toUpperCase();
  return out;
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
