// Is a logged carrier rate believable? One shared check, used by the board (ready-to-book flag, scoring, guidance), the Inquiry Log and
// the Mark-covered dialog, so a rate the app does not trust can never be shown as "inside your booking band".
//
// WHY THIS EXISTS. A quote used to count as soon as its number sat between "min plausible" and "max plausible" ($250 - $20,000) and the
// last log line was not flagged. Two holes:
//   1. A rate far BELOW target is always the "book it" rung of the ladder, so a stray "$700" on a $4,200 load read as
//      "inside your booking band" instead of "this cannot be right".
//   2. The flag is overwritten by the next reply, so a rate flagged "RATE LOOKS WRONG" became a normal quote again after the carrier's
//      following message.
// The older Outlook macros (v4 / v5) also read every number in the whole e-mail, including your own quoted load text, and wrote the
// first plausible one to the log. Those log lines carry no "intent" column, so they are treated as unverified here.

import { safeNumeric } from './util.js';

/** A real quote is no lower than half and no higher than three times the target (the same limits the reply engine uses: "rate looks wrong"). */
export const RATE_SANITY = { low: 0.5, high: 3 };

const BAD_FLAG = /RATE LOOKS WRONG|MORE THAN ONE RATE|NO RATE DETECTED|NOT UNDERSTOOD/i;

/** Standalone numbers (3+ digits) in a piece of text, dates removed, commas ignored: "42,000 lbs" -> 42000. */
export function numbersIn(text) {
  const out = new Set();
  const t = String(text ?? '').replace(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, ' ').replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  for (const m of t.matchAll(/\d[\d,]*\d|\d/g)) {
    const v = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(v) && v >= 100) out.add(v);
  }
  return out;
}

/** True when the log line was written by a macro that read the whole e-mail (v4 / v5): it has no Intent. App-made lines always carry one. */
export const isLegacyLine = (q) => String(q && q.source || '').toLowerCase() === 'outlook' && !String(q.intent || '').trim();

/**
 * Judge one inquiry-log line.
 *   q    the inquiry record ({ lastCarrierRate, flag, intent, source, subject })
 *   ctx  { target, settings, ownText, miles }  (target = the load's target rate; ownText = the load details + note we wrote)
 * Returns { rate, has, ok, unverified, reason }
 *   has        a rate was logged at all
 *   ok         the rate is believable and can be used as a quote
 *   unverified ok, but it was read by an old macro from the whole e-mail, so it is not trusted enough to say "ready to book"
 *   reason     plain-language explanation when not ok (or unverified)
 */
export function judgeQuote(q, ctx = {}) {
  const rate = safeNumeric(q && q.lastCarrierRate);
  if (!(rate > 0)) return { rate: 0, has: false, ok: false, unverified: false, reason: '' };
  const cfg = ctx.settings || {};
  const lo = safeNumeric(cfg.minReasonableRate) || 250, hi = safeNumeric(cfg.maxReasonableRate) || 20000;
  const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
  const no = (reason) => ({ rate, has: true, ok: false, unverified: false, reason });
  if (rate < lo || rate > hi) return no(`${fmt(rate)} is outside the plausible range (${fmt(lo)} - ${fmt(hi)}).`);
  if (BAD_FLAG.test(String(q.flag || ''))) return no(`${fmt(rate)} was flagged as unreadable or ambiguous when the e-mail was read.`);
  const target = safeNumeric(ctx.target);
  if (target > 0 && (rate < target * RATE_SANITY.low || rate > target * RATE_SANITY.high)) {
    return no(`${fmt(rate)} is far from the ${fmt(target)} target, so it is probably a number picked out of the e-mail (a date, mileage, ID or your own load text), not a quote.`);
  }
  if (isLegacyLine(q)) {
    const own = numbersIn(String(ctx.ownText || '') + '\n' + String(q.subject || ''));
    if (own.has(Math.round(rate))) return no(`${fmt(rate)} also appears in your own load text or the e-mail subject, so the old Outlook macro most likely copied it from there.`);
    const miles = safeNumeric(ctx.miles);
    if (miles > 0 && Math.abs(rate - miles) <= 1) return no(`${fmt(rate)} equals this lane's mileage, so it is probably the miles, not a rate.`);
    return { rate, has: true, ok: true, unverified: true, reason: 'Read by the older Outlook macro from the whole e-mail, not just the carrier\'s own words: open the e-mail to confirm.' };
  }
  return { rate, has: true, ok: true, unverified: false, reason: '' };
}
