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
