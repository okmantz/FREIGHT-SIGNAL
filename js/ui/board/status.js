// Small presentation helpers for a load's card: its status badge, and the basic details shown in its header.
import { EQUIPMENT } from '../../core/defaults.js';
import { parseDateText } from '../../core/expiry.js';

export const equipLabel = (code) => { const c = String(code ?? '').toUpperCase(); const e = EQUIPMENT.find(x => x.code === c); return e ? e.label : c || '-'; };

/** "11/14/2026" -> "Nov 14". Text that is not a date is shown as typed. */
export function shortDate(v) {
  const d = parseDateText(v);
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : String(v ?? '').trim();
}

/** "44000" -> "44,000 lbs" (blank when there is no weight). */
export function lbs(v) {
  const n = Number(String(v ?? '').replace(/[^0-9.]/g, ''));
  return n > 0 ? n.toLocaleString('en-US') + ' lbs' : '';
}

/**
 * The one status a load shows in its header, worst first.
 *   hot     a carrier is inside the booking band: go book it
 *   urgent  something is about to cost you the load
 *   act     needs a decision from you
 *   ok      nothing to do right now
 */
export function loadStatus(row) {
  const flags = row.flags || [];
  if (flags.some(f => f.kind === 'hot')) return { tone: 'hot', label: 'Ready to book', icon: 'check' };
  if (flags.some(f => f.level === 'urgent')) return { tone: 'urgent', label: 'Urgent', icon: 'alert' };
  if (flags.length) return { tone: 'act', label: 'Needs attention', icon: 'alert' };
  return { tone: 'ok', label: 'On track', icon: 'check' };
}

export const FLAG_ICON = { norate: 'target', hot: 'check', review: 'mail', aging: 'clock', closing: 'clock', weather: 'storm' };

/** The quick-filter choices on the board (matchesQuick in core/worklist.js understands every key). */
export const QUICK_FILTERS = [
  ['', 'All loads'], ['attention', 'Needs attention'], ['hot', 'Ready to book'], ['closing', 'Pickup closing'],
  ['aging', 'Aging, no inquiries'], ['weather', 'Weather flags'], ['norate', 'No target rate'], ['noinquiry', 'No inquiries yet'],
];
