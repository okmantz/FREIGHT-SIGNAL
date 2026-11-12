// Pickup dates and auto-expiry. Dates in the app are "m/d/yyyy" text (as DAT wants them); the pickup "deadline" for scoring and
// expiry is 5 PM local time on the pickup date (the app has no pickup times).

import { groupMembers } from './model.js';

export const DEADLINE_HOUR = 17;

/** Date for "m/d/yyyy" (also m/d/yy and yyyy-mm-dd) at local midnight, or null. */
export function parseDateText(v) {
  const t = String(v ?? '').trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return new Date(+m[3], +m[1] - 1, +m[2]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(t);
  if (m) return new Date(2000 + +m[3], +m[1] - 1, +m[2]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

/** The LAST pickup day of a posting (pickupLatest, else pickupEarliest) or null. */
export function pickupDay(p) { return parseDateText(p.pickupLatest) || parseDateText(p.pickupEarliest); }

/** Hours from `now` until 5 PM on the pickup day (negative once passed). null when the date is unknown. */
export function hoursToPickup(p, now = new Date()) {
  const d = pickupDay(p); if (!d) return null;
  const end = new Date(d); end.setHours(DEADLINE_HOUR, 0, 0, 0);
  return (end.getTime() - now.getTime()) / 3600000;
}

/** Has the pickup day passed (by more than the grace days)? Midnight rule: on the day after pickup + grace the posting is retired. */
export function isPastPickup(p, now = new Date(), graceDays = 0) {
  const d = pickupDay(p); if (!d) return false;
  const limit = new Date(d); limit.setDate(limit.getDate() + 1 + Math.max(0, Number(graceDays) || 0));
  return now.getTime() >= limit.getTime();
}

/**
 * Groups whose every posting is past pickup. A group is retired as a whole (a half-expired matrix makes no sense).
 * Returns [{ groupKey, members }] ; ungrouped postings are their own group.
 */
export function expiredGroups(postings, now = new Date(), graceDays = 0) {
  const seen = new Set(); const out = [];
  for (const p of postings) {
    if (String(p.status || 'Active').toLowerCase() === 'covered') continue;
    const key = (p.groupId || '').trim() ? 'g:' + p.groupId.toLowerCase() : 'p:' + p.id;
    if (seen.has(key)) continue; seen.add(key);
    const members = p.groupId ? groupMembers(postings, p.groupId) : [p];
    if (members.every(m => isPastPickup(m, now, graceDays))) out.push({ groupKey: key, members });
  }
  return out;
}
