// Processing ledger + exception queue (v16). Pure: the store layer persists the entries (IndexedDB store 'ledger').
// One entry per inbound carrier e-mail the app has judged. It answers three questions without anyone watching the inbox:
//   1. Did we already handle this message? (idempotency key, so a restart or a re-paste can never double-reply)
//   2. What needs a person right now? (the exception queue: every held or flagged message, with the carrier's words and a ready draft)
//   3. Can I trust auto-send yet? (shadow mode + your "ok / wrong" marks -> readiness)

import { readiness } from './sendpolicy.js';

const HOUR = 3600000, DAY = 24 * HOUR;

/** Stable key for a message: the Internet Message-ID when there is one, else sender + subject + the first 200 characters. */
export function ledgerKey(mail = {}) {
  const id = String(mail.messageId || mail.internetMessageId || mail.entryId || '').trim();
  if (id) return 'id:' + id.toLowerCase();
  const raw = [String(mail.from || '').toLowerCase().trim(), String(mail.subject || '').toLowerCase().trim(), String(mail.body || '').replace(/\s+/g, ' ').trim().slice(0, 200)].join('|');
  let h = 5381; for (let i = 0; i < raw.length; i++) h = ((h << 5) + h + raw.charCodeAt(i)) | 0;
  return 'h:' + (h >>> 0).toString(36) + ':' + raw.length;
}

/** What happened to this message, in one word. */
export function outcomeOf(res, decision) {
  const a = res && res.action;
  if (!res || a === 'ignored' || a === 'no-match' || a === 'no-posting') return 'ignored';
  if (decision && decision.send) return 'auto';
  if (res.draft) return decision && decision.shadow ? 'shadow' : (res.autoSendSafe ? 'drafted' : 'review');
  return 'review';
}

/**
 * res = processIncomingEmail() result, decision = decideSend() result (or null).
 * status: 'auto' (sent by itself) | 'drafted' (a draft you can send) | 'shadow' (drafted; would have been sent) | 'review' (needs your eyes) | 'ignored'.
 */
export function buildLedgerEntry(res, mail, decision, now = Date.now()) {
  const status = outcomeOf(res, decision);
  const a = res.analysis || {};
  const reasons = decision ? decision.reasons : [];
  return {
    id: ledgerKey(mail),
    at: now,
    from: String(mail.from || ''),
    subject: String(mail.subject || '').slice(0, 160),
    convId: (res.newInquiry && res.newInquiry.conversationId) || (res.inquiryPatch && res.inquiryPatch.id) || '',
    inquiryId: res.inquiryPatch ? res.inquiryPatch.id : '',
    intent: res.intent || a.intent || '',
    action: res.action || '',
    kind: res.planKind || '',
    flag: res.flag || '',
    reason: String(res.reason || '').slice(0, 300),
    fresh: String(a.fresh || '').slice(0, 400),
    rate: a.rate && a.rate.found ? a.rate.rate : 0,
    rateConfidence: a.rate && a.rate.found ? a.rate.confidence : '',
    draftText: res.draft ? String(res.draft.body || '').slice(0, 1500) : '',
    suggestText: res.suggest ? String(res.suggest.body || '').slice(0, 1500) : '',
    draftTo: res.draft ? res.draft.to : res.suggest ? res.suggest.to : '',
    draftSubject: res.draft ? res.draft.subject : res.suggest ? res.suggest.subject : '',
    status,
    would: !!(decision && decision.would),
    holdReasons: reasons.slice(0, 6),
    verdict: '',            // '' | 'ok' | 'bad' : your mark on whether the reply was right
    resolved: status === 'ignored' || status === 'auto' || status === 'drafted' || status === 'shadow',
    truckLead: !!res.truckLead,
    mc: res.mc || '',
    learned: a.learned ? { sig: a.learned.sig, count: a.learned.count } : null,   // v18: this message was read through a lesson you taught
  };
}

/** Messages that need a person, newest first. Anything flagged, any reply the policy held, and any suggested reply. */
export function exceptionQueue(entries = []) {
  return entries.filter(e => e && !e.resolved && e.status === 'review').sort((a, b) => b.at - a.at);
}

/** Auto-sent replies in a conversation / today / this hour (for the caps). */
export function sendCounts(entries = [], convId = '', now = Date.now()) {
  const auto = entries.filter(e => e && e.status === 'auto');
  const sentInConversation = auto.filter(e => convId && e.convId === convId).map(e => ({ kind: e.kind, at: e.at }));
  return { sentInConversation, sentToday: auto.filter(e => now - e.at < DAY).length, sentLastHour: auto.filter(e => now - e.at < HOUR).length };
}

/** Shadow / auto stats: how often your verdicts agree with what the engine would have sent. */
export function shadowStats(entries = []) {
  return readiness(entries.filter(e => e && (e.status === 'shadow' || e.status === 'auto' || e.status === 'drafted')));
}

/** A short plain-English summary for the System page and the Cover Desk header. */
export function ledgerSummary(entries = [], now = Date.now()) {
  const day = entries.filter(e => e && now - e.at < DAY);
  const c = (s) => day.filter(e => e.status === s).length;
  return { today: day.length, auto: c('auto'), drafted: c('drafted') + c('shadow'), review: exceptionQueue(entries).length, ignored: c('ignored') };
}
