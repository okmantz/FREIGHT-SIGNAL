// Inbound carrier e-mail handling. Port of the Outlook v3 InboxItems_ItemAdd chain:
// ProcessIncomingCarrierEmail -> ProcessCarrierInquiry / rate engine / flags / inquiry log updates.
// The browser cannot watch an Outlook inbox, so the user pastes (or types) the carrier e-mail; the
// decisions below are identical to the macro and the function returns the changes for the caller to apply.

import { normalizeForMatching, safeNumeric, safeString, formatCurrency0, vbaRound, CRLF } from './util.js';
import { DEFAULT_SETTINGS } from './defaults.js';
import { isBlockedOutlook } from './outreach.js';
import { buildOutlookLoadDetails } from './outreach.js';

// ---- Rate engine (InitRegex / ExtractCarrierRate) ----
const RATE_RE_SRC = '(rate|offer|can do|do for|take|counter|all in|all-in|total)[^$0-9]{0,40}\\$?\\s*([0-9]{3,5}(?:,[0-9]{3})?(?:\\.\\d{1,2})?)';
const DOLLAR_RE_SRC = '\\$\\s*([0-9]{3,5}(?:,[0-9]{3})?(?:\\.\\d{1,2})?)';
// Optional fix (Settings -> "Recognise comma-formatted rates"): the macro's number pattern cannot match "1,650" or "12,000".
const NUM_MACRO = '[0-9]{3,5}(?:,[0-9]{3})?', NUM_FIXED = '(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,5})';

const valNum = (s) => { const n = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : 0; }; // VBA Val()

export function extractCarrierRate(subject, body, settings = DEFAULT_SETTINGS) {
  const text = String(subject ?? '') + CRLF + String(body ?? '');
  const ok = (v) => v >= settings.minReasonableRate && v <= settings.maxReasonableRate;
  let m;
  const fix = (src) => (settings.recogniseCommaRates ? src.replace(NUM_MACRO, NUM_FIXED) : src);
  const re1 = new RegExp(fix(RATE_RE_SRC), 'gim');
  while ((m = re1.exec(text)) !== null) { const v = valNum(m[2]); if (ok(v)) return { found: true, rate: v }; if (m.index === re1.lastIndex) re1.lastIndex++; }
  const re2 = new RegExp(fix(DOLLAR_RE_SRC), 'gim');
  while ((m = re2.exec(text)) !== null) { const v = valNum(m[1]); if (ok(v)) return { found: true, rate: v }; if (m.index === re2.lastIndex) re2.lastIndex++; }
  return { found: false, rate: 0 };
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
  return sender.includes('mailer-daemon') || sender.includes('postmaster') || subj.includes('out of office') || subj.includes('automatic reply');
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

/**
 * Decide what the Outlook macro would do with one inbound e-mail.
 * Returns:
 *  { action, reason, draft?, flag?, newInquiry?, inquiryPatch?, postingPatch?, display? }
 * `inquiries` and `postings` are read-only here.
 */
export function processIncomingEmail({ mail, postings, inquiries, settings = DEFAULT_SETTINGS, now = new Date() }) {
  if (isBlockedOutlook(mail.from, settings.inboundBlocklist)) return { action: 'ignored', reason: 'Sender is on the inbound blocklist.' };
  if (isAutomatedMessage(mail)) return { action: 'ignored', reason: 'Automated message (mailer-daemon / postmaster / out of office / automatic reply).' };
  if (isForward(mail)) return { action: 'ignored', reason: 'Forwarded message (FW:/FWD:).' };

  const convId = deriveConversationId(mail);
  const log = inquiries.find(q => String(q.conversationId).toLowerCase() === convId.toLowerCase());

  // New conversation -> ProcessCarrierInquiry
  if (!log) {
    const m = findMatchingLoad(mail.subject, mail.body, postings);
    if (!m || !m.details) return { action: 'no-match', reason: 'No posting lane was found in the subject or body, so no inquiry draft was created.' };
    const draft = {
      to: mail.from, subject: replySubject(mail.subject),
      body: m.details + CRLF + CRLF + 'What is your best all-in rate? ETA to pickup?' + CRLF + CRLF + quotedOriginal(mail).trimStart(),
      display: true, kind: 'Inquiry reply',
    };
    const count = safeNumeric(m.posting.inquiryCount) + 1;
    return {
      action: 'inquiry-reply', reason: 'Matched posting row ' + (m.index + 2) + ' (' + m.posting.originCity + ', ' + m.posting.originState + ' -> ' + m.posting.destCity + ', ' + m.posting.destState + ').',
      draft,
      postingPatch: { id: m.posting.id, patch: { inquiryCount: count } },
      newInquiry: {
        conversationId: convId, dateCounted: now.toISOString(), senderEmail: mail.from, subject: mail.subject || '',
        postingId: m.posting.id, postingRow: m.index + 2,
        originCity: m.posting.originCity, originState: m.posting.originState, destCity: m.posting.destCity, destState: m.posting.destState,
        countAfterInquiry: count, targetRate: safeNumeric(m.posting.targetRate), status: 'INQUIRY', stage: 'INQUIRY_REPLY_SENT',
        rateResponseSent: 'NO', lastCarrierRate: '', lastAction: 'Inquiry reply draft created', eventCount: 1, approved: 'No', dateAdded: '',
      },
    };
  }

  const stage = String(log.stage || '').toUpperCase();
  const evt = safeNumeric(log.eventCount) + 1;

  if (stage === 'RATE_RESPONSE_SENT' || stage === 'FOLLOWUP_FLAGGED') {
    return {
      action: 'flag-repeat', reason: 'Repeat carrier e-mail after a rate response; flagged for manual review, no reply drafted.',
      flag: 'FOLLOW-UP - MANUAL REVIEW - NO AUTO REPLY',
      inquiryPatch: { id: log.id, patch: { stage: 'FOLLOWUP_FLAGGED', lastAction: 'Repeat carrier email flagged - no auto reply', eventCount: evt, flag: 'FOLLOW-UP - MANUAL REVIEW - NO AUTO REPLY' } },
    };
  }

  const posting = postings.find(p => p.id === log.postingId) ||
    (log.postingId ? null : postings[Number(log.postingRow) - 2]);
  if (!posting) return { action: 'no-posting', reason: 'The posting this inquiry was logged against no longer exists (it was covered/removed), so nothing was drafted.' };

  const targetRate = safeNumeric(posting.targetRate);
  const { found, rate } = extractCarrierRate(mail.subject, mail.body, settings);

  if (!found) {
    if (stage === 'INQUIRY_REPLY_SENT') {
      return {
        action: 'flag-no-rate', reason: 'No carrier rate detected in the e-mail.', flag: 'MANUAL REVIEW - NO RATE DETECTED',
        inquiryPatch: { id: log.id, patch: { lastAction: 'Carrier email received without detectable rate', eventCount: evt, flag: 'MANUAL REVIEW - NO RATE DETECTED' } },
      };
    }
    return {
      action: 'followup-received', reason: 'Follow-up received with no detectable rate.',
      inquiryPatch: { id: log.id, patch: { stage: 'FOLLOWUP_RECEIVED', lastAction: 'Carrier follow-up received - no detectable rate' } },
    };
  }

  const diff = Math.abs(rate - targetRate);
  const within = diff <= settings.rateProximity;
  const text = within ? 'Please confirm your ETA to pickup.' : 'How close can you come to ' + formatCurrency0(targetRate) + '?';
  return {
    action: within ? 'rate-within-target' : 'rate-negotiate',
    reason: 'Carrier rate ' + formatCurrency0(rate) + ' vs target ' + formatCurrency0(targetRate) + '.',
    draft: { to: mail.from, subject: replySubject(mail.subject), body: text + CRLF + CRLF + quotedOriginal(mail).trimStart(), display: false, kind: 'Rate response' },
    flag: within ? 'RATE RECEIVED - REVIEW / ETA' : '',
    inquiryPatch: {
      id: log.id,
      patch: {
        stage: 'RATE_RESPONSE_SENT', rateResponseSent: 'YES', lastCarrierRate: rate, eventCount: evt,
        lastAction: within ? 'Rate within $' + Math.round(settings.rateProximity) + ' of target - ETA confirmation drafted'
          : 'Rate $' + vbaRound(diff, 0) + ' from target - negotiation draft created',
        flag: within ? 'RATE RECEIVED - REVIEW / ETA' : '',
      },
    },
  };
}
