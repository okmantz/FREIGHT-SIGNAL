// Inbound carrier e-mail handling. Port of the Outlook v3 InboxItems_ItemAdd chain:
// ProcessIncomingCarrierEmail -> ProcessCarrierInquiry / rate engine / flags / inquiry log updates.
// The browser cannot watch an Outlook inbox, so the user pastes (or types) the carrier e-mail; the
// decisions below are identical to the macro and the function returns the changes for the caller to apply.

import { normalizeForMatching, safeNumeric, safeString, formatCurrency0, vbaRound, CRLF } from './util.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { isBlockedOutlook } from './outreach.js';
import { buildOutlookLoadDetails } from './outreach.js';
import { ladderReply, ladderAction, templatesOf, fillTemplate } from './ladder.js';
import { freshText, extractRate, analyseCarrierEmail, planCarrierReply, REPLY_FLAGS } from './carrierreply.js';

/**
 * The rate a carrier typed. v8: looks ONLY at the carrier's own words (quoted history, signatures and our own wording are removed first),
 * and only at rate-shaped phrases, so numbers inside your load details, dates, ZIP codes or phone numbers can never become a "quote".
 * `subject` is accepted for backwards compatibility and ignored (a reply subject repeats your own subject line).
 */
export function extractCarrierRate(subject, body, settings = DEFAULT_SETTINGS, own = '') {
  const r = extractRate(freshText(body, own), settings);
  return { found: r.found, rate: r.rate, ambiguous: r.ambiguous, perMile: r.perMile };
}

// ---- Lane matching (GetLaneMatchScore / FindMatchingLoadDetails) ----
const containsExactPhrase = (text, phrase) => {
  const ph = normalizeForMatching(phrase);
  return ph.length > 0 && (' ' + text + ' ').toLowerCase().includes(' ' + ph + ' ');
};
const containsCityStatePair = (text, city, st) => {
  const c = normalizeForMatching(city), s = normalizeForMatching(st);
  return c.length > 0 && s.length > 0 && (' ' + text + ' ').toLowerCase().includes(' ' + c + ' ' + s + ' ');
};

export function laneMatchScore(text, oc, os, dc, ds) {
  if (!text || !containsExactPhrase(text, oc) || !containsExactPhrase(text, dc)) return -1;
  let score = 200;
  if (containsExactPhrase(text, os)) score += 10;
  if (containsExactPhrase(text, ds)) score += 10;
  if (containsCityStatePair(text, oc, os)) score += 25;
  if (containsCityStatePair(text, dc, ds)) score += 25;
  return score;
}

/** Scans postings from the bottom up (VBA loops r = last To 2 Step -1); strict ">" means the lowest row wins ties. */
export function findMatchingLoad(subject, body, postings) {
  const subj = normalizeForMatching(subject), bod = normalizeForMatching(body);
  let bestScore = -1, matched = null, matchedIndex = -1;
  for (let i = postings.length - 1; i >= 0; i--) {
    const p = postings[i];
    if (!safeString(p.originCity) || !safeString(p.destCity)) continue;
    let score = laneMatchScore(subj, p.originCity, p.originState, p.destCity, p.destState);
    if (score >= 0) score += 1000;
    else score = laneMatchScore(bod, p.originCity, p.originState, p.destCity, p.destState);
    if (score > bestScore) { bestScore = score; matched = p; matchedIndex = i; }
  }
  if (!matched) return null;
  let details = safeString(matched.details);
  if (!details) details = buildOutlookLoadDetails(matched);
  const notes = safeString(matched.notes);
  if (notes) details = details + CRLF + CRLF + notes;
  return { posting: matched, index: matchedIndex, details, targetRate: safeNumeric(matched.targetRate), score: bestScore };
}

// ---- Message filters ----
export const isAutomatedMessage = (mail) => {
  const sender = String(mail.from ?? '').toLowerCase(), subj = String(mail.subject ?? '').trim().toLowerCase();
  return sender.includes('mailer-daemon') || sender.includes('postmaster') || subj.includes('out of office') || subj.includes('out-of-office') || subj.includes('automatic reply') ||
    subj.includes('auto-reply') || subj.includes('autoreply') || subj.includes('undeliverable') || subj.includes('delivery status notification');
};
export const isForward = (mail) => { const s = String(mail.subject ?? '').trim().toUpperCase(); return s.startsWith('FW:') || s.startsWith('FWD:'); };

/** Conversation id: Outlook's ConversationID is not available outside Outlook, so derive one from sender + subject without RE:/FW:. */
export function deriveConversationId(mail) {
  if (safeString(mail.conversationId)) return safeString(mail.conversationId);
  const subj = String(mail.subject ?? '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim().toLowerCase();
  const raw = String(mail.from ?? '').trim().toLowerCase() + '|' + subj;
  let h = 5381; for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
  return 'WEB-' + h.toString(16).toUpperCase().padStart(8, '0');
}

function quotedOriginal(mail) {
  return CRLF + CRLF + 'From: ' + (mail.from || '') + CRLF + 'Sent: ' + (mail.sent || '') + CRLF + 'To: ' + (mail.to || '') + CRLF +
    'Subject: ' + (mail.subject || '') + CRLF + CRLF + (mail.body || '');
}
const replySubject = (s) => (/^\s*re\s*:/i.test(s || '') ? s : 'RE: ' + (s || ''));

/** Text we posted or wrote for a posting (details + notes): a carrier line that repeats it word for word is history, not an answer. */
const ownTextOf = (posting) => { const d = safeString(posting.details) || buildOutlookLoadDetails(posting); const n = safeString(posting.notes); return n ? d + CRLF + n : d; };

const stageAction = {
  book: 'rate-within-target', split: 'rate-split', target: 'rate-negotiate',
};

/**
 * Decide what the Outlook macro would do with one inbound e-mail (the macro v6 applies the same rules).
 * Returns:
 *  { action, reason, intent?, draft?, flag?, newInquiry?, inquiryPatch?, postingPatch?, autoSendSafe? }
 * `inquiries` and `postings` are read-only here. A draft is NEVER sent by this function; draft.autoSendSafe says whether a
 * person could safely be left out of the loop for it (the Outlook macro only sends when the Settings switch is on AND this is true).
 */
export function processIncomingEmail({ mail, postings, inquiries, settings = DEFAULT_SETTINGS, now = new Date() }) {
  if (isBlockedOutlook(mail.from, settings.inboundBlocklist)) return { action: 'ignored', reason: 'Sender is on the inbound blocklist.' };
  if (isAutomatedMessage(mail)) return { action: 'ignored', reason: 'Automated message (mailer-daemon / postmaster / out of office / automatic reply).' };
  if (isForward(mail)) return { action: 'ignored', reason: 'Forwarded message (FW:/FWD:).' };

  const convId = deriveConversationId(mail);
  const log = inquiries.find(q => String(q.conversationId).toLowerCase() === convId.toLowerCase());
  const tpl = templatesOf(settings);
  const mkDraft = (text, over = {}) => ({ to: mail.from, subject: replySubject(mail.subject), body: text + CRLF + CRLF + quotedOriginal(mail).trimStart(), display: false, kind: 'Rate response', ...over });

  // New conversation -> ProcessCarrierInquiry
  if (!log) {
    const m = findMatchingLoad(mail.subject, mail.body, postings);
    if (!m || !m.details) return { action: 'no-match', reason: 'No posting lane was found in the subject or body, so no inquiry draft was created.' };
    const a = analyseCarrierEmail(mail.body, ownTextOf(m.posting), settings);
    if (a.echo) return { action: 'ignored', reason: 'This message only contains our own wording (for example a test sent to yourself), so nothing was drafted.' };
    if (a.intent === 'stop' || a.intent === 'decline') return { action: 'ignored', reason: 'The carrier is not interested, so no reply was drafted.', intent: a.intent };
    const target = safeNumeric(m.posting.targetRate);
    // A carrier whose FIRST message is "rate?" gets the details and your target, not a request for their rate.
    const askRate = a.intent === 'asks_rate' && target > 0;
    const ask = askRate ? fillTemplate(tpl.askRate, { target: formatCurrency0(target) }) + CRLF + 'What is your ETA to pickup?' : 'What is your best all-in rate? ETA to pickup?';
    const draft = mkDraft(m.details + CRLF + CRLF + ask, { display: true, kind: 'Inquiry reply', autoSendSafe: (m.score % 1000) >= 220 && a.intent !== 'wants_call' && a.intent !== 'pushback' });
    const count = safeNumeric(m.posting.inquiryCount) + 1;
    return {
      action: 'inquiry-reply', intent: a.intent, autoSendSafe: draft.autoSendSafe,
      reason: 'Matched posting row ' + (m.index + 2) + ' (' + m.posting.originCity + ', ' + m.posting.originState + ' -> ' + m.posting.destCity + ', ' + m.posting.destState + ').',
      draft,
      postingPatch: { id: m.posting.id, patch: { inquiryCount: count } },
      newInquiry: {
        conversationId: convId, dateCounted: now.toISOString(), senderEmail: mail.from, subject: mail.subject || '',
        postingId: m.posting.id, postingRow: m.index + 2,
        originCity: m.posting.originCity, originState: m.posting.originState, destCity: m.posting.destCity, destState: m.posting.destState,
        countAfterInquiry: count, targetRate: target, status: 'INQUIRY', stage: 'INQUIRY_REPLY_SENT',
        rateResponseSent: 'NO', lastCarrierRate: '', lastAction: askRate ? 'Inquiry reply draft created (asked for the rate: answered with the target)' : 'Inquiry reply draft created', eventCount: 1, approved: 'No', dateAdded: '',
        intent: a.intent, ladderStage: askRate ? 'target' : '', ourRate: askRate ? target : '',
      },
    };
  }

  const stage = String(log.stage || '').toUpperCase();
  const evt = safeNumeric(log.eventCount) + 1;
  const posting = postings.find(p => p.id === log.postingId) ||
    (log.postingId ? null : postings[Number(log.postingRow) - 2]);
  if (!posting) return { action: 'no-posting', reason: 'The posting this inquiry was logged against no longer exists (it was covered/removed), so nothing was drafted.' };

  const targetRate = safeNumeric(posting.targetRate);
  const analysis = analyseCarrierEmail(mail.body, ownTextOf(posting), settings);
  const plan = planCarrierReply({ analysis, target: targetRate, settings, state: { stage, ladderStage: String(log.ladderStage || ''), ourRate: safeNumeric(log.ourRate), events: safeNumeric(log.eventCount) } });
  if (plan.ignore) return { action: 'ignored', intent: plan.intent, reason: plan.reason };

  const patch = { eventCount: evt, intent: plan.intent };
  if (plan.stageNext) patch.stage = plan.stageNext;
  if (plan.ladderNext !== undefined) { patch.ladderStage = plan.ladderNext; patch.ourRate = plan.ourRateNext || ''; }
  const flag = plan.flag || '';

  // nothing to send: a person looks at it
  if (plan.kind === 'none') {
    // a real, readable quote is still logged even when no reply is drafted (for example: a rate but no target rate to compare it with)
    if (plan.rate) patch.lastCarrierRate = plan.rate;
    patch.flag = flag; patch.lastAction = plan.reason;
    const actionName = plan.stageNext === 'DECLINED' ? 'declined' : plan.stageNext === 'ETA_RECEIVED' ? 'eta-received' : plan.flag === REPLY_FLAGS.noTarget ? 'flag-no-target' : plan.flag === REPLY_FLAGS.noRate ? 'flag-no-rate' : plan.flag === REPLY_FLAGS.closed ? 'flag-repeat' : 'flag-manual';
    return { action: actionName, intent: plan.intent, reason: plan.reason, flag, inquiryPatch: { id: log.id, patch } };
  }

  // a reply is drafted
  if (plan.kind === 'ladder') { patch.lastCarrierRate = plan.rate; patch.rateResponseSent = 'YES'; patch.lastAction = ladderAction({ ...plan.ladder }, plan.rate, targetRate); }
  else if (plan.kind === 'asks_rate') { patch.rateResponseSent = 'YES'; patch.lastAction = 'Carrier asked for the rate - answered with your target (' + formatCurrency0(targetRate) + ')'; }
  else if (plan.kind === 'agreed') { patch.rateResponseSent = 'YES'; patch.lastAction = 'Carrier agreed to ' + formatCurrency0(plan.ourRateNext) + ' - ETA requested'; }
  else if (plan.kind === 'available') patch.lastAction = 'Carrier asked if the load is available - confirmed and asked for a rate';
  else patch.lastAction = 'Carrier gave no rate - asked for it';
  patch.flag = flag;
  const action = plan.kind === 'ladder' ? stageAction[plan.ladder.stage] : plan.kind === 'asks_rate' ? 'reply-asks-rate' : plan.kind === 'agreed' ? 'reply-agreed' : plan.kind === 'available' ? 'reply-available' : 'reply-need-rate';
  return {
    action, intent: plan.intent, ladder: plan.ladder, flag, autoSendSafe: plan.autoSendSafe, reason: plan.reason,
    draft: mkDraft(plan.text, { kind: plan.kind === 'ladder' ? 'Rate response' : 'Carrier reply', autoSendSafe: plan.autoSendSafe }),
    inquiryPatch: { id: log.id, patch },
  };
}
