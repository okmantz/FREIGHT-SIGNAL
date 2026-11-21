// Safe-send policy (v16). Decides, for one drafted reply, whether it may go out WITHOUT a person.
// Pure: no DOM, no storage. The Outlook macro mirrors these gates (see OUTLOOK-BRIDGE.md); the JS version is what the tests and the readiness meter use.
//
// Modes (settings.sendMode):
//   off      drafts only. Nothing is ever sent by itself.                                        (default)
//   shadow   drafts only, but every reply is also judged "would I have auto-sent this?" so you can see how often you agree before trusting it.
//   routine  auto-sends only the routine replies: "is it available", "what's the rate", "send details", "need ETA", first rate counter.
//   full     routine + the replies that confirm a rate ("agreed - book it", "book it" at the ladder's top step). Needs a confirmed target.
//
// "Why wasn't it sent?" is always answered in plain words (reasons[]), so the exception queue can show it.

export const SEND_MODES = ['off', 'shadow', 'routine', 'full'];
export const MODE_LABEL = { off: 'Drafts only', shadow: 'Shadow (measure, never send)', routine: 'Auto-send routine replies', full: 'Auto-send routine + rate-confirming replies' };

/** Kinds that only ask a question or restate what the carrier already has. */
export const ROUTINE_KINDS = ['asks_rate', 'available', 'need_rate', 'need_rate_eta', 'details', 'inquiry'];
/** Kinds that move money: a counter or a "book it". `ladder` is routine only while it is a counter (target/split), never at "book". */
export const COMMIT_KINDS = ['agreed'];

export const POLICY_DEFAULTS = {
  sendMode: 'off',
  sendMaxPerConversation: 3,
  sendMaxPerDay: 60,
  sendDelayMinutes: 3,
  sendMinLaneScore: 220,
  sendWorkHoursOnly: false,
  sendWorkStart: 7,
  sendWorkEnd: 19,
  sendMaxChars: 600,
  sendDuplicateMinutes: 120,
};

/** Back-compat: the old v15 "autoSendInbound" switch maps to full mode. */
export function sendModeOf(settings = {}) {
  const m = String(settings.sendMode || '');
  if (SEND_MODES.includes(m)) return m;
  return settings.autoSendInbound ? 'full' : 'off';
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null && v !== undefined ? Number(v) : d);

/**
 * ctx = {
 *   plan,                 // from planCarrierReply (kind, text, autoSendSafe, ladderNext, rateConfidence ...)
 *   analysis,             // from analyseCarrierEmail
 *   settings, now,
 *   laneScore,            // how well the e-mail matched its posting (inbound.js score); 220+ = exact lane
 *   targetConfirmed,      // the posting's target rate was typed or accepted by a person (not auto-suggested)
 *   events,               // messages already in this conversation
 *   sentInConversation,   // [{kind, at}] auto-sent replies already in this conversation
 *   sentToday, sentLastHour,
 *   attachments,          // count of non-inline attachments on the inbound message
 *   fromSelf, noReply,    // sender is us / a no-reply address
 * }
 * Returns { send, mode, shadow, reasons:[...], delayMinutes }.
 *   send      true = this reply may leave without a person (only in routine/full)
 *   shadow    true = it WOULD have been sent in routine/full (what shadow mode counts)
 */
export function decideSend(ctx) {
  const { plan = {}, analysis = {}, settings = {}, now = Date.now() } = ctx;
  const mode = sendModeOf(settings);
  const reasons = [];
  const no = (why) => reasons.push(why);
  const kind = plan.kind;
  const text = String(plan.text || '');

  if (!text || kind === 'none') no('There is nothing to send for this message.');
  if (plan.ignore) no('This message does not need an answer.');
  if (!plan.autoSendSafe) no('The reply is one you should look at first.');
  if (ctx.fromSelf) no('The message came from your own address.');
  if (ctx.noReply) no('The sender is a no-reply address.');
  if (analysis.rate && analysis.rate.weak) no('The rate was not clearly stated.');
  if (analysis.tags && analysis.tags.extras) no('The carrier mentioned extra charges.');

  const isCounter = kind === 'ladder' && plan.ladderNext && plan.ladderNext !== 'book';
  const isCommit = COMMIT_KINDS.includes(kind) || (kind === 'ladder' && plan.ladderNext === 'book');
  const routine = ROUTINE_KINDS.includes(kind) || isCounter;
  if (!routine && !isCommit) no('This kind of reply is always sent by a person.');
  if (isCommit && mode !== 'full') no('Replies that confirm a rate are only auto-sent in "routine + rate-confirming" mode.');

  const needTarget = kind === 'asks_rate' || kind === 'ladder' || kind === 'agreed';
  if (needTarget && !ctx.targetConfirmed) no('The target rate on this load was suggested, not confirmed by you.');
  const minScore = num(settings.sendMinLaneScore, POLICY_DEFAULTS.sendMinLaneScore);
  if (num(ctx.laneScore, 0) < minScore) no('The e-mail did not match the load exactly (lane score ' + num(ctx.laneScore, 0) + ').');
  if (num(ctx.events, 0) >= 6) no('Long conversation: a person should take over.');
  if (num(ctx.attachments, 0) > 0) no('The carrier attached a file.');
  if (text.length > num(settings.sendMaxChars, POLICY_DEFAULTS.sendMaxChars)) no('The reply is longer than usual.');
  if ((text.match(/\?/g) || []).length > 2) no('The reply asks more than two questions.');

  const sent = Array.isArray(ctx.sentInConversation) ? ctx.sentInConversation : [];
  if (sent.length >= num(settings.sendMaxPerConversation, POLICY_DEFAULTS.sendMaxPerConversation)) no('Already auto-replied ' + sent.length + ' times in this conversation.');
  const dupMs = num(settings.sendDuplicateMinutes, POLICY_DEFAULTS.sendDuplicateMinutes) * 60000;
  if (sent.some(s => s.kind === kind && now - s.at < dupMs)) no('The same kind of reply was already sent in this conversation a moment ago.');
  if (num(ctx.sentToday, 0) >= num(settings.sendMaxPerDay, POLICY_DEFAULTS.sendMaxPerDay)) no('Daily auto-send limit reached.');
  if (num(ctx.sentLastHour, 0) >= num(settings.maxAutoSendsPerHour, 15)) no('Hourly auto-send limit reached.');
  if (settings.sendWorkHoursOnly) {
    const hr = new Date(now).getHours();
    if (hr < num(settings.sendWorkStart, 7) || hr >= num(settings.sendWorkEnd, 19)) no('Outside your sending hours.');
  }

  const would = reasons.length === 0;
  const live = would && (mode === 'routine' || mode === 'full');
  return { send: live, shadow: would && mode === 'shadow', would, mode, reasons, delayMinutes: live ? Math.max(0, num(settings.sendDelayMinutes, POLICY_DEFAULTS.sendDelayMinutes)) : 0 };
}

/**
 * How ready are you to switch on auto-send? Looks at the shadow-mode ledger entries that you judged ("ok" / "wrong").
 * entries = [{ would: bool, verdict: 'ok'|'bad'|'' }]. Ready at >= 98% over >= 30 judged auto-send candidates.
 */
export function readiness(entries = []) {
  const cand = entries.filter(e => e && e.would);
  const judged = cand.filter(e => e.verdict === 'ok' || e.verdict === 'bad');
  const ok = judged.filter(e => e.verdict === 'ok').length;
  const pct = judged.length ? Math.round((ok / judged.length) * 1000) / 10 : null;
  const ready = judged.length >= 30 && pct !== null && pct >= 98;
  return { candidates: cand.length, judged: judged.length, ok, bad: judged.length - ok, pct, ready, need: Math.max(0, 30 - judged.length) };
}
