// Reply lessons (v18): the e-mail engine learns YOUR carriers' wording without ever inventing a reply.
// A lesson is "when a carrier writes <this>, it means <one of the meanings Freight Signal already knows>". The meaning is answered with your standard
// reply for it (the ladder / templates in System), so learning never creates new wording. Guard rails:
//   * only messages the rules could NOT understand ("unclear") are ever upgraded by a lesson: it can never override a rate, a decline or a stop;
//   * rates are never taught (a number in the message means the rate rules decide);
//   * a lesson drafts a reply for you to review; it only becomes eligible for automatic sending after you have confirmed it LEARN_AUTO times.
// Pure: no DOM, no storage. Lessons live in settings.replyLessons (an array, so cloud sync and backups carry them).

export const LEARN_AUTO = 3;                 // confirmations before a lesson may be sent without you
export const MAX_LESSONS = 200;
/** The meanings you can teach, in the words shown in the Teach menu. `intent` is what the planner then does. */
export const TEACHABLE = [
  { intent: 'asks_rate', label: 'Asking what the rate is' },
  { intent: 'asks_available', label: 'Asking if it is still available' },
  { intent: 'gives_eta', label: 'Giving timing (needs a rate)' },
  { intent: 'gives_truck', label: 'Describing a truck (needs rate and ETA)' },
  { intent: 'wants_details', label: 'Wants the load details' },
  { intent: 'wants_call', label: 'Wants a call' },
  { intent: 'needs_info', label: 'Asking something only I can answer' },
  { intent: 'asks_other_loads', label: 'Asking for other loads' },
  { intent: 'checking', label: 'Just checking in' },
  { intent: 'decline', label: 'Not interested / cannot cover' },
  { intent: 'ack', label: 'Just saying thanks' },
];
const OK = new Set(TEACHABLE.map(t => t.intent));
const FILLER = new Set('the a an is are was were be to of in on at for and or you your u ur me my we our it this that please pls thanks thank hi hello hey just so can could would will'.split(' '));

/** A comparable fingerprint of what the carrier typed: lower-case words, numbers and filler removed. */
export function signature(fresh) {
  const words = String(fresh || '').toLowerCase().replace(/[0-9]+/g, ' ').replace(/[^a-z' ]+/g, ' ').split(/\s+/).map(w => w.replace(/'/g, '')).filter(w => w && !FILLER.has(w));
  return words.slice(0, 14).join(' ');
}
const bag = (sig) => new Set(sig.split(' ').filter(Boolean));
function similarity(a, b) {
  if (a === b) return 1;
  const x = bag(a), y = bag(b); if (!x.size || !y.size) return 0;
  let both = 0; for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export function cleanLessons(list) {
  return (Array.isArray(list) ? list : []).filter(l => l && typeof l.sig === 'string' && l.sig && OK.has(l.intent)).map(l => ({ sig: l.sig.slice(0, 160), text: String(l.text || '').slice(0, 140), intent: l.intent, count: Math.max(1, Math.min(99, Number(l.count) || 1)), at: Number(l.at) || 0 })).slice(0, MAX_LESSONS);
}

/** Add or confirm a lesson. Returns the new lessons array (never mutates). Teaching a different meaning for the same words replaces the old one. */
export function teach(lessons, fresh, intent, now = Date.now()) {
  const list = cleanLessons(lessons); const sig = signature(fresh);
  if (!OK.has(intent) || sig.split(' ').filter(Boolean).length < 1 || sig.length < 3) return { lessons: list, ok: false, reason: 'There is not enough text in this message to learn from.' };
  const i = list.findIndex(l => l.sig === sig);
  if (i >= 0) { const same = list[i].intent === intent; list[i] = { ...list[i], intent, count: same ? Math.min(99, list[i].count + 1) : 1, at: now, text: String(fresh).replace(/\s+/g, ' ').trim().slice(0, 140) }; }
  else list.unshift({ sig, text: String(fresh).replace(/\s+/g, ' ').trim().slice(0, 140), intent, count: 1, at: now });
  return { lessons: list.slice(0, MAX_LESSONS), ok: true, sig };
}
/** One more confirmation for the lesson that was used (you marked its reply right). */
export function confirm(lessons, sig, now = Date.now()) { return cleanLessons(lessons).map(l => (l.sig === sig ? { ...l, count: Math.min(99, l.count + 1), at: now } : l)); }
export function forget(lessons, sig) { return cleanLessons(lessons).filter(l => l.sig !== sig); }

/** The best matching lesson for these carrier words, or null. Exact fingerprint, or near-identical wording (>= 0.8 overlap, at least two words). */
export function findLesson(lessons, fresh) {
  const sig = signature(fresh); if (!sig) return null;
  let best = null, bs = 0;
  for (const l of cleanLessons(lessons)) { const s = similarity(sig, l.sig); const words = bag(l.sig).size; if ((s === 1 || (s >= 0.8 && words >= 2)) && s > bs) { best = l; bs = s; } }
  return best;
}

/** Apply lessons to an analysis from analyseCarrierEmail(). Only an "unclear" message can be upgraded. */
export function applyLessons(analysis, lessons) {
  if (!analysis || analysis.intent !== 'unclear' || analysis.echo) return analysis;
  if (analysis.rate && (analysis.rate.found || analysis.rate.ambiguous || analysis.rate.perMile)) return analysis;
  const l = findLesson(lessons, analysis.fresh); if (!l) return analysis;
  return { ...analysis, intent: l.intent, learned: { sig: l.sig, count: l.count, intent: l.intent, was: 'unclear' } };
}
export const teachableLabel = (intent) => (TEACHABLE.find(t => t.intent === intent) || { label: String(intent || '').replace(/_/g, ' ') }).label;
