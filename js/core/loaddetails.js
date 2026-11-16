// "Copy original load details": pure helpers (no DOM) so the rule is unit-tested.
//
// The ORIGINAL load details are the TQL text that was pasted when the load was added (posting.details). Every
// alternate in a 3 x 3 matrix is a copy of the original row, so they carry the same text; the Original row wins
// when they differ (e.g. the user edited one alternate by hand).
// Loads added with "Add blank row" have no pasted text. For those we fall back to the same short summary the
// outreach drafts use, and say so, so nobody mistakes a summary for the real source text.

import { buildFallbackLoadDetails } from './outreach.js';

const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();

/**
 * @param {object[]} members postings of ONE lane box (or a single posting wrapped in an array)
 * @returns {{ text: string, source: 'original' | 'summary' | 'none' }}
 */
export function originalLoadDetails(members) {
  const list = (members || []).filter(Boolean);
  if (!list.length) return { text: '', source: 'none' };
  const ordered = [...list.filter(p => p.variant === 'Original'), ...list.filter(p => p.variant !== 'Original')];
  for (const p of ordered) {
    const t = norm(p.details);
    if (t) return { text: t, source: 'original' };
  }
  const head = ordered[0];
  const hasLane = [head.originCity, head.originState, head.destCity, head.destState].some(v => String(v ?? '').trim());
  if (!hasLane) return { text: '', source: 'none' };
  return { text: norm(buildFallbackLoadDetails(head)), source: 'summary' };
}

/** Toast text for the three outcomes of a copy. */
export function copyDetailsMessage(source) {
  if (source === 'original') return 'Original load details copied.';
  if (source === 'summary') return 'No pasted text is stored for this load, so a short summary of its fields was copied.';
  return 'There are no load details to copy for this load.';
}

// ---------------------------------------------------------------------------------------------------------------------
// v11: editable load details + a per-load "reply note".
//
// The note is a short line you add for ONE load ("Need FMCSA sticker", "No-touch freight"). It goes into the first reply to a carrier
// inquiry, directly UNDER the load details and ABOVE the "ETA and rate" question. A matrix is nine postings and a carrier can answer
// any of them, so details and note are always read from, and written to, every posting of the load together.
// The old Excel macro wrote "::" into the notes cell when it was empty; that placeholder is treated as "no note".
// ---------------------------------------------------------------------------------------------------------------------

/** A note as it is stored: CRLF normalised, trailing spaces trimmed, and the macro's "::" placeholder counted as empty. */
export function cleanNote(text) {
  const t = norm(text);
  return /^:+$/.test(t) ? '' : t;
}

/** The reply note of a load (lane box): Original row first, then any other posting that has one. */
export function groupNote(members) {
  const list = (members || []).filter(Boolean);
  const ordered = [...list.filter(p => p.variant === 'Original'), ...list.filter(p => p.variant !== 'Original')];
  for (const p of ordered) { const n = cleanNote(p.notes); if (n) return n; }
  return '';
}

/** What goes into the first reply above the "ETA / rate" question: the details, then (when there is one) a blank line and the note. */
export function detailsWithNote(details, note, eol = '\r\n') {
  const d = String(details ?? '').trim();
  const n = cleanNote(note).replace(/\n/g, eol);
  return n ? (d ? d + eol + eol + n : n) : d;
}

/** Normalise and write details / note onto every posting in `members`. Returns the values written. Pure: the store saves afterwards. */
export function applyLoadText(members, patch) {
  const out = {};
  if ('details' in patch) out.details = String(patch.details ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim();
  if ('notes' in patch) out.notes = cleanNote(patch.notes);
  for (const m of members) Object.assign(m, out);
  return out;
}
