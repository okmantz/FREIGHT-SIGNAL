// Counter ladder (percent-based) and the e-mail wording for each rung.
//
// A flat "$200 of target" means 22% on a $900 load and 3% on a $6,000 load. The ladder works in percent of the TARGET rate:
//   carrier rate <= target + book%   -> 'book'   : ETA / booking script
//   carrier rate <= target + split%  -> 'split'  : auto-drafted split-the-difference counter
//   anything higher                  -> 'target' : counter at the target ("How close can you come to $target?")
// A carrier who quotes BELOW target is always 'book'. With no target rate set there is nothing to compare against ('none').
// The Outlook macro (v5) applies the same rules from the numbers and wording in freight-signal-config.tsv.

import { safeNumeric, formatCurrency0 } from './util.js';
import { DEFAULT_SETTINGS } from './defaults.js';

export const DEFAULT_TEMPLATES = {
  book: 'Please confirm your ETA to pickup.',
  split: 'Can we meet in the middle at {split}? If that works, please confirm your ETA to pickup.',
  target: 'How close can you come to {target}?',
  // v8: replies to a carrier who has not given a rate. askRate answers "rate?" / "what are you paying?" with your target.
  askRate: 'How close can you come to {target}?',
  available: 'Yes, it is still available. What is your best all-in rate and ETA to pickup?',
  availableLead: 'Yes, it is still available.',
  needRate: 'Thank you. What is your best all-in rate for this load?',
  needRateEta: 'Thank you. What is your best all-in rate and ETA to pickup?',
  agreed: 'Great, we are set at {ourRate}. Please confirm your ETA to pickup.',
  truckSubject: 'Any trucks available? {lane}',
  truckBody: 'Hello {name},\n\nDo you have any trucks available {where}?\n\nIf so, please reply with the truck location, equipment and the rate you would need.\n\nThank you,',
};
export const TEMPLATE_VARS = {
  book: ['{rate}', '{target}', '{split}', '{pct}'],
  split: ['{rate}', '{target}', '{split}', '{pct}'],
  target: ['{rate}', '{target}', '{split}', '{pct}'],
  askRate: ['{target}'],
  available: ['{target}'],
  availableLead: [],
  needRate: ['{target}'],
  needRateEta: ['{target}'],
  agreed: ['{ourRate}', '{target}'],
  truckSubject: ['{lane}', '{name}'],
  truckBody: ['{name}', '{where}', '{lane}'],
};

export function templatesOf(settings) {
  const t = (settings && settings.templates) || {};
  const out = { ...DEFAULT_TEMPLATES };
  for (const k of Object.keys(DEFAULT_TEMPLATES)) if (typeof t[k] === 'string' && t[k].trim()) out[k] = t[k];
  return out;
}

const roundTo = (x, step) => (step > 0 ? Math.round(x / step) * step : Math.round(x));

/** { stage, pct, split, over } for a carrier rate against a target. pct = % ABOVE target (negative = below). */
export function ladderStage(rate, target, settings = DEFAULT_SETTINGS) {
  const r = safeNumeric(rate), t = safeNumeric(target);
  const book = Number.isFinite(Number(settings.ladderBookPct)) ? Number(settings.ladderBookPct) : 3;
  const splitPct = Number.isFinite(Number(settings.ladderSplitPct)) ? Number(settings.ladderSplitPct) : 8;
  const step = Number.isFinite(Number(settings.ladderRound)) ? Number(settings.ladderRound) : 5;
  if (!(t > 0)) return { stage: 'none', pct: 0, split: 0, over: r };
  const pct = (r - t) / t * 100;
  let stage = 'target';
  if (pct <= book + 1e-9) stage = 'book';
  else if (pct <= splitPct + 1e-9) stage = 'split';
  const split = stage === 'split' ? Math.max(t, Math.min(r, roundTo((r + t) / 2, step))) : 0;
  return { stage, pct, split, over: r - t };
}

/** Fill {rate} {target} {split} {pct} {name} {lane} {where} in a template. */
export function fillTemplate(tpl, vars = {}) {
  return String(tpl ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in vars && vars[k] !== undefined ? String(vars[k]) : m));
}

/** The reply text for a carrier rate. Returns { stage, text, pct, split } */
export function ladderReply(rate, target, settings = DEFAULT_SETTINGS) {
  const st = ladderStage(rate, target, settings);
  const tpls = templatesOf(settings);
  const vars = { rate: formatCurrency0(safeNumeric(rate)), target: formatCurrency0(safeNumeric(target)), split: st.split ? formatCurrency0(st.split) : '', pct: Math.abs(st.pct).toFixed(1) + '%' };
  const key = st.stage === 'book' ? 'book' : st.stage === 'split' ? 'split' : 'target';
  return { ...st, text: fillTemplate(tpls[key], vars).replace(/\r?\n/g, '\r\n') };
}

/** Description line for the Inquiry Log "Last Action" column. */
export function ladderAction(st, rate, target) {
  const pct = Math.abs(st.pct).toFixed(1);
  if (st.stage === 'book') return st.pct <= 0 ? `Rate at or under target (${pct}% ${st.pct < 0 ? 'under' : 'equal'}) - ETA confirmation drafted` : `Rate ${pct}% over target (inside the booking band) - ETA confirmation drafted`;
  if (st.stage === 'split') return `Rate ${pct}% over target - split-the-difference counter drafted (${formatCurrency0(st.split)})`;
  return `Rate ${pct}% over target - counter at ${formatCurrency0(safeNumeric(target))} drafted`;
}
