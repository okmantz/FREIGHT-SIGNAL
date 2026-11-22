// Historical e-mail import (v20): read the last 30 / 90 days of Outlook mail and keep ONLY the carriers that really booked a load with you.
// Pure logic (no DOM, no storage, no Outlook): the app feeds it messages, it returns a reviewable plan.
//
// WHY THIS IS STRICT. "Please send driver and dispatch info" is what you write when you book a load, but it does not prove
//   1. that the carrier answered,   2. that the load was booked at that rate,   3. that the carrier did a good job.
// So nothing is imported on one clue. Every conversation is scored from independent pieces of evidence, each counted once and only from text the
// sender actually typed (quoted history, signatures and our own wording are removed first, so a quoted old message can never count twice):
//
//   we sent a rate confirmation (attached)      45     carrier returned / signed it                 50 (40 when only the file name suggests it)
//   we said "you're booked / all set"           25     carrier sent driver + truck info AFTER that  35 (15 when nothing asked for it)
//   we asked for driver / dispatch info         10     carrier accepted a rate or the booking       15
//   rate clearly agreed (stated or converged)   20     carrier replied after the rate confirmation  10
//   delivered / POD / "thanks for the load"     25 / 10
//
//   HIGH   score >= 70 AND at least one strong item (rate confirmation, signed rate con, driver info after a booking, proof of delivery)
//   MEDIUM score 40-69  (shown for review, NOT selected)       LOW  below 40 (counted, never shown as a carrier)
//   EXCLUDED  we never engaged the carrier (customers send US rate confirmations), a cancellation / no-show / problem came after the booking,
//             the sender is a coworker, a customer, a load board or an automatic mailbox.
//
// The result is a plan. Existing carriers are matched by MC/DOT, e-mail or phone and are NEVER duplicated. A field you typed (or imported
// from your own spreadsheet) is never overwritten by something read from an e-mail; a different value is kept beside it as a conflict.

import { freshText, extractRate, classify, RULES } from './carrierreply.js';
import { parseMcDot } from './resources.js';
import { STATES } from './truckbook.js';
import { normalizeText, safeNumeric } from './util.js';
import { carrierKey, emailOf, oneLine, hash, HOUR, DAY, MIN } from './netcommon.js';
import { decodeField, encodeField } from './bridge.js';
import { classForMiles } from './lanes.js';

export const HISTORY_VERSION = 'v1';
export const FILES = { request: 'freight-signal-history-request.tsv', data: 'freight-signal-history.tsv', status: 'freight-signal-history-status.txt' };
export const MESSAGE_COLS = ['MsgId', 'ConvId', 'Time', 'Dir', 'FromName', 'FromEmail', 'To', 'Cc', 'Bcc', 'Subject', 'Attachments', 'Folder', 'Body'];

export const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com', 'comcast.net',
  'att.net', 'sbcglobal.net', 'bellsouth.net', 'verizon.net', 'cox.net', 'charter.net', 'protonmail.com', 'proton.me', 'mail.com', 'gmx.com', 'zoho.com', 'earthlink.net', 'windstream.net', 'frontier.com']);

const AUTOMATED_ADDR = /^(?:no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|notifications?|alerts?|bounces?|newsletter|news|marketing|noreply|auto|system|admin|webmaster|billing|invoices?|statements?|support|helpdesk|survey|updates?)\b/i;
const AUTOMATED_DOMAIN = /(?:^|\.)(?:dat\.com|datasolutions\.com|truckstop\.com|123loadboard\.com|truckersedge\.net|loadlink\.ca|sendgrid\.net|mailchimp\.com|constantcontact\.com|linkedin\.com|facebookmail\.com|google\.com|microsoft\.com|office365\.com|docusign\.net|docusign\.com|adobesign\.com|echosign\.com|zoom\.us|calendly\.com|fmcsa\.dot\.gov|dot\.gov)$/i;

/* ------------------------------------------------------------------------------------------------ small helpers */
export const domainOf = (email) => { const m = /@([^@\s>]+)$/.exec(String(email || '').trim().toLowerCase()); return m ? m[1] : ''; };
const registrable = (d) => { const p = String(d || '').split('.'); return p.length <= 2 ? p.join('.') : (/^(?:co|com|org|net|ac)$/.test(p[p.length - 2]) && p[p.length - 1].length === 2 ? p.slice(-3).join('.') : p.slice(-2).join('.')); };
const isFree = (email) => FREE_MAIL.has(registrable(domainOf(email)));
export const digits = (s) => String(s ?? '').replace(/\D/g, '');
export const phoneKey = (s) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : ''; };
const fmtPhone = (d10) => (d10 && d10.length === 10 ? `(${d10.slice(0, 3)}) ${d10.slice(3, 6)}-${d10.slice(6)}` : '');
const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s\-'])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const uniq = (list) => [...new Set(list)];
const normSubject = (s) => String(s ?? '').replace(/^(?:\s*(?:re|fw|fwd|aw|sv)\s*:\s*|\s*\[(?:external|ext|caution)[^\]]*\]\s*)+/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();

/** "Name <a@b.com>; c@d.com" -> [{name, email}] (only valid addresses). */
export function parseAddressList(text) {
  const out = []; const t = String(text ?? '');
  const re = /(?:"?([^"<>;,]*?)"?\s*)?<([^<>\s]+@[^<>\s]+)>|([^\s<>;,"]+@[^\s<>;,"]+)/g;
  let m;
  while ((m = re.exec(t))) {
    const email = emailOf((m[2] || m[3] || '').replace(/^mailto:/i, ''));
    if (email) out.push({ name: oneLine(m[1] || '', 80).replace(/^['"]|['"]$/g, ''), email });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------ export file (Outlook macro -> app) */
/** The request the app writes for the Outlook macro: how many days, and an id so an old export is never mistaken for the new one. */
export function requestFile({ days = 30, requestId = '' } = {}) {
  return ['#FREIGHT-SIGNAL-HISTORY-REQUEST', HISTORY_VERSION].join('\t') + '\r\n' + ['days', Number(days) === 90 ? 90 : 30].join('\t') + '\r\n' + ['requestId', requestId].join('\t') + '\r\n';
}

const localTime = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || '').trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)).getTime();
  const t = Date.parse(s); return Number.isFinite(t) ? t : NaN;
};

/** Parse freight-signal-history.tsv. Returns { ok, meta:{requestId,days,exportedAt,count}, messages, error }. A file without its #END line is "still being written". */
export function parseExport(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const head = (lines[0] || '').split('\t');
  if (head[0] !== '#FREIGHT-SIGNAL-HISTORY') return { ok: false, error: 'This is not a Freight Signal history export.', messages: [] };
  const meta = { version: head[1] || '', requestId: head[2] || '', days: Number(head[3]) || 0, exportedAt: head[4] || '', count: Number(head[5]) || 0 };
  const endLine = lines.slice().reverse().find(l => l.startsWith('#END'));
  if (!endLine) return { ok: false, partial: true, meta, error: 'The export is still being written. Wait for Outlook to finish.', messages: [] };
  const cols = (lines[1] || '').split('\t');
  const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
  const messages = [];
  for (let i = 2; i < lines.length; i++) {
    const ln = lines[i]; if (!ln || ln.startsWith('#')) continue;
    const f = ln.split('\t').map(decodeField);
    const g = (k) => (ix[k] === undefined ? '' : f[ix[k]] || '');
    const m = normalizeMessage({
      id: g('MsgId'), convId: g('ConvId'), at: localTime(g('Time')), dir: /^s|^o/i.test(g('Dir')) ? 'out' : 'in',
      from: { name: g('FromName'), email: g('FromEmail') }, to: parseAddressList(g('To')), cc: parseAddressList(g('Cc')), bcc: parseAddressList(g('Bcc')),
      subject: g('Subject'), attachments: g('Attachments').split('|').map(x => x.trim()).filter(Boolean), folder: g('Folder'), body: g('Body'),
    });
    if (m) messages.push(m);
  }
  return { ok: true, meta, messages };
}

/** One message in the shape the analysis needs, or null when it has no usable sender and time. */
export function normalizeMessage(r) {
  const from = { name: oneLine(r.from && r.from.name, 80), email: emailOf(r.from && r.from.email) };
  const at = Number(r.at);
  if (!Number.isFinite(at)) return null;
  const list = (l) => (Array.isArray(l) ? l : []).map(x => ({ name: oneLine(x.name, 80), email: emailOf(x.email) })).filter(x => x.email);
  const body = String(r.body ?? '').replace(/\r\n?/g, '\n').slice(0, 40000);
  const m = {
    id: String(r.id || '') || 'm-' + hash(String(at) + (from.email || '') + String(r.subject || '') + body.slice(0, 200)),
    mid: String(r.mid || ''), refs: Array.isArray(r.refs) ? r.refs : [], convId: String(r.convId || ''),
    at, dir: r.dir === 'out' ? 'out' : r.dir === 'in' ? 'in' : '', from, to: list(r.to), cc: list(r.cc), bcc: list(r.bcc),
    subject: oneLine(r.subject, 300), attachments: (r.attachments || []).map(a => oneLine(a, 160)).filter(Boolean), folder: oneLine(r.folder, 80), body,
  };
  if (!from.email && m.dir !== 'out') return null;
  return m;
}

/* ------------------------------------------------------------------------------------------------ .eml reader (for people who drag e-mails in instead of using the macro) */
const decodeBytes = (bytes, charset) => {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(/^(?:us-ascii|ascii)$/.test(cs) ? 'utf-8' : cs, { fatal: false }).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
};
const b64bytes = (s) => { const t = String(s).replace(/[^A-Za-z0-9+/=]/g, ''); try { if (typeof atob === 'function') { const bin = atob(t); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } } catch { /* fall through */ } return Uint8Array.from(Buffer.from(t, 'base64')); };
const qpBytes = (s) => {
  const t = String(s).replace(/=\r?\n/g, ''); const out = [];
  for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '=' && /^[0-9a-f]{2}$/i.test(t.substr(i + 1, 2))) { out.push(parseInt(t.substr(i + 1, 2), 16)); i += 2; } else out.push(t.charCodeAt(i) & 255); }
  return Uint8Array.from(out);
};
/** RFC 2047: "=?utf-8?B?...?=" in a header. */
export function decodeWords(s) {
  return String(s ?? '').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (m, cs, enc, data) => decodeBytes(/^b$/i.test(enc) ? b64bytes(data) : qpBytes(data.replace(/_/g, ' ')), cs)).replace(/\?=\s+=\?/g, '');
}
function splitHeaders(raw) {
  const m = /\r?\n\r?\n/.exec(raw);
  const head = m ? raw.slice(0, m.index) : raw, body = m ? raw.slice(m.index + m[0].length) : '';
  const map = {}; let key = '';
  for (const ln of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(ln) && key) { map[key] += ' ' + ln.trim(); continue; }
    const i = ln.indexOf(':'); if (i < 1) continue;
    key = ln.slice(0, i).trim().toLowerCase(); map[key] = (map[key] === undefined ? '' : map[key] + ' ') + ln.slice(i + 1).trim();
  }
  return { map, body };
}
const param = (v, name) => { const m = new RegExp(name + '\\*?\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))', 'i').exec(String(v || '')); return m ? (m[1] !== undefined ? m[1] : m[2]) : ''; };
const htmlToText = (h) => String(h).replace(/<(?:style|script)[\s\S]*?<\/(?:style|script)>/gi, ' ').replace(/<br\s*\/?>|<\/(?:p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');

function walkMime(raw, out) {
  const { map, body } = splitHeaders(raw);
  const ct = map['content-type'] || 'text/plain', type = (ct.split(';')[0] || 'text/plain').trim().toLowerCase();
  const dispo = map['content-disposition'] || '';
  const name = decodeWords(param(dispo, 'filename') || param(ct, 'name'));
  const enc = (map['content-transfer-encoding'] || '7bit').trim().toLowerCase();
  if (type.startsWith('multipart/')) {
    const b = param(ct, 'boundary'); if (!b) return;
    const parts = body.split(new RegExp('\\r?\\n?--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*\\r?\\n?'));
    for (const p of parts.slice(1)) if (p.trim() && !/^--\s*$/.test(p.trim())) walkMime(p, out);
    return;
  }
  if (name || /^attachment/i.test(dispo) || (type !== 'text/plain' && type !== 'text/html')) { if (name) out.attachments.push(name); return; }
  const bytes = enc === 'base64' ? b64bytes(body) : enc === 'quoted-printable' ? qpBytes(body) : Uint8Array.from(Array.from(body, c => c.charCodeAt(0) & 255));
  const text = decodeBytes(enc === '7bit' || enc === '8bit' || enc === 'binary' ? new TextEncoder().encode(body) : bytes, param(ct, 'charset') || 'utf-8');
  if (type === 'text/html') out.html += text + '\n'; else out.text += text + '\n';
}
/** One .eml file -> message (dir stays '' until the own addresses are known). null when it is not a readable message. */
export function parseEml(raw, fallbackId = '') {
  const { map } = splitHeaders(String(raw));
  const out = { text: '', html: '', attachments: [] };
  walkMime(String(raw), out);
  const from = parseAddressList(decodeWords(map.from || ''))[0] || { name: '', email: '' };
  const refs = String(map.references || '').match(/<[^>]+>/g) || [];
  const reply = (String(map['in-reply-to'] || '').match(/<[^>]+>/) || [])[0];
  const mid = (String(map['message-id'] || '').match(/<[^>]+>/) || [])[0] || '';
  const body = (out.text.trim() ? out.text : htmlToText(out.html)).trim();
  return normalizeMessage({
    id: mid || fallbackId, mid, refs: uniq([...refs, ...(reply ? [reply] : [])]), convId: '', at: Date.parse(map.date || ''), dir: '',
    from, to: parseAddressList(decodeWords(map.to || '')), cc: parseAddressList(decodeWords(map.cc || '')), bcc: parseAddressList(decodeWords(map.bcc || '')),
    subject: decodeWords(map.subject || ''), attachments: out.attachments, folder: '', body,
  });
}

/* ------------------------------------------------------------------------------------------------ who is "us" */
/** Own addresses: the ones given, every sender of a message the macro marked as sent, and (for loose .eml files) the address present in most messages. */
export function inferOwn(messages, given = []) {
  const own = new Set((given || []).map(emailOf).filter(Boolean));
  for (const m of messages) if (m.dir === 'out' && m.from.email) own.add(m.from.email);
  if (!own.size && messages.length >= 3) {
    const n = new Map();
    for (const m of messages) for (const e of new Set([m.from.email, ...m.to.map(x => x.email), ...m.cc.map(x => x.email)].filter(Boolean))) n.set(e, (n.get(e) || 0) + 1);
    const [top, c] = [...n.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (top && c / messages.length >= 0.5) own.add(top);
  }
  const domains = new Set([...own].map(domainOf).filter(d => d && !FREE_MAIL.has(registrable(d))).map(registrable));
  return { own, domains };
}

/* ------------------------------------------------------------------------------------------------ attachments */
const RC_NAME = /rate[\s_.\-]*con(?:f(?:irmation)?)?|ratecon|(?:^|[^a-z])rc(?:[^a-z]|$)|load[\s_.\-]*(?:conf(?:irmation)?|tender)|carrier[\s_.\-]*(?:conf(?:irmation)?|agreement)|dispatch[\s_.\-]*(?:sheet|confirmation)/i;
const SIGNED_NAME = /signed|executed|countersigned|\bsig(?:ned)?\b/i;
const POD_NAME = /\bpod\b|proof[\s_.\-]*of[\s_.\-]*delivery|delivery[\s_.\-]*receipt|signed[\s_.\-]*bol|\bbol\b|bill[\s_.\-]*of[\s_.\-]*lading/i;
const DOC_EXT = /\.(?:pdf|docx?|xlsx?|png|jpe?g|tiff?|heic|gif)$/i;
export const attachmentKinds = (names) => {
  const k = { ratecon: false, signed: false, pod: false, other: 0 };
  for (const n of names || []) {
    const s = String(n);
    if (RC_NAME.test(s) && DOC_EXT.test(s)) { k.ratecon = true; if (SIGNED_NAME.test(s)) k.signed = true; }
    else if (POD_NAME.test(s)) k.pod = true;
    else if (!/^(?:image\d+|outlook-|~|logo|signature)/i.test(s)) k.other++;
  }
  return k;
};

/* ------------------------------------------------------------------------------------------------ text signals */
const R = {
  rcText: /\b(?:rate\s*con(?:firmation)?|ratecon|load\s+confirmation|carrier\s+confirmation|rc)\b[^.\n]{0,60}\b(?:attached|enclosed|below|is here|are here|sent|please sign|sign (?:and|&) return|to sign)\b|\b(?:attached|enclosed|attaching|find|see|here(?:'s| is| are))\b[^.\n]{0,50}\b(?:rate\s*con(?:firmation)?|ratecon|load confirmation|rc)\b|\bplease (?:sign|review and sign|review|sign and return)\b[^.\n]{0,50}\b(?:rate\s*con(?:firmation)?|ratecon|confirmation|rc)\b/i,
  bookOut: /\b(?:you(?:'re| are|'ve| have been)\s+(?:all set|booked|confirmed|awarded|good to go|on the load)|you got (?:the|this) load|(?:the |this )?load is (?:yours|booked|covered|confirmed)|(?:we(?:'ll| will| are)|i(?:'ll| will| am)) (?:book|award|give|put)\b[^.\n]{0,25}\b(?:you|with you|it to you)|booked (?:with|you|it|at|for)|let'?s (?:book|do it|move forward|get (?:it|you) booked|lock)|go ahead and (?:book|cover|pick|load)|(?:i|we) (?:can |will )?(?:book|confirm) (?:it|this|you)|(?:confirmed|booked|covered|locked in|we(?:'re| are) set) (?:at|for|with|on)|awarded)\b/i,
  driverReq: /\b(?:send|need|provide|get|share|forward|email|e-?mail|confirm|give)\b[^.\n]{0,45}\b(?:driver|dispatch(?:er)?|truck)\b[^.\n]{0,45}\b(?:info|information|name|phone|number|details|contact|cell)\b|\b(?:driver|dispatch)\b[^.\n]{0,14}(?:and|&|\/|,)[^.\n]{0,14}\b(?:dispatch|driver)\b[^.\n]{0,14}(?:info|information|name|phone|number|details)/i,
  takeIt: /\b(?:(?:i|we)(?:'ll| will| can| are going to)\s+(?:take|cover|haul|run|do|book)\b|book (?:it|me|us)\b|we(?:'re| are) (?:in|good|on it)\b|count (?:me|us) in|confirmed?\b|sounds good|deal\b|you got (?:it|a truck)|(?:we|i) accept)/i,
  thanks: /\b(?:thanks? (?:for|again for) (?:the |this |that )?(?:load|business|getting|hauling|covering|moving|delivering|help)|great job|good job|appreciate (?:the|your) (?:help|service|work|business|quick)|thank you for (?:the |your )?(?:delivery|load|business|work|service)|pleasure (?:working|doing business)|(?:driver|carrier) (?:did|was) (?:great|awesome|excellent|a pro))\b/i,
  delivered: /\b(?:delivered|unloaded|empty(?: now| in)?|dropped (?:it|the load|the trailer)|delivery (?:complete|done)|pod (?:attached|is attached)|attached (?:is )?(?:the )?(?:pod|bol|signed bol)|signed (?:pod|bol)|got (?:the )?pod)\b/i,
  transit: /\b(?:picked up|loaded|just loaded|rolling|in transit|on (?:the |our )?way|en route|enroute|eta (?:is |to )?(?:delivery|del)|at (?:the )?(?:shipper|receiver|pickup|delivery))\b/i,
  cancelled: /\b(?:(?:load|it|this|order|booking)\s+(?:was|has been|got|is)\s+(?:cancel(?:l?ed)|pulled|killed)|(?:we|i|they|shipper|customer)\s+(?:had to |have to |need to |must )?cancel(?:l?ed)?\b|cancel(?:l?ing)?\s+(?:the |this |that |your )?(?:load|order|pickup|booking|truck)|fell\s+(?:off|through)|falling off|no[- ]?show|(?:did(?:n'?t| not)|never) show(?:ed)?(?: up)?|broke ?down|truck broke|backed out|unable to (?:cover|pick|make)|(?:can'?t|cannot|won'?t be able to) (?:make it|cover|haul|do it|pick (?:it )?up)|pull(?:ing|ed)? (?:off|the truck|out of))\b/i,
  problem: /\b(?:cargo (?:claim|damage)|(?:file|filed|filing|submit(?:ted)?) (?:a )?claim|damaged\b|damage to (?:the )?(?:freight|load|cargo|trailer)|(?:was|were|is|are|running|delivered|arrived) late|late (?:to|for) (?:the )?(?:pickup|delivery|appointment)|missed (?:the |our )?(?:appointment|pickup|delivery|window)|refused (?:the )?load|double[- ]?broker|scam|fraud|shortage)\b/i,
  driverName: /\bdriver(?:'s| name| is| will be)?\s*(?:name)?\s*(?:is\s*)?[:\-]\s*([A-Za-z][A-Za-z.'\- ]{2,40}?)(?=\s*(?:[,;\n(]|\d|phone|cell|ph\b|tel|#|$))/i,
  driverNameLoose: /\bdriver\s+(?:is|will be|name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  truckNo: /\b(?:truck|tractor|unit)\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{1,11})\b/i,
  trailerNo: /\btrailer\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{1,11})\b/i,
  plate: /\b(?:plate|tag|license)\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\- ]{3,9})\b/i,
};
const PHONE = /(?:\+?1[\s.\-]*)?\(?\b([2-9]\d{2})\)?[\s.\-]*(\d{3})[\s.\-]*(\d{4})\b/g;
const phonesIn = (s) => [...String(s).matchAll(PHONE)].map(m => m[1] + m[2] + m[3]);
const COMPANY_WORDS = /\b(?:llc|l\.l\.c\.?|inc\.?|incorporated|corp\.?|corporation|co\.|company|transport(?:ation)?|trucking|logistics|freight|express|carriers?|hauling|lines|transit|enterprises?|services|group|solutions|cartage|trans|motor|lines?|brokerage|dispatch(?:ing)?|llp|ltd)\b/i;

/** Only what the person typed, signature included (freshText stops at the sign-off; this keeps it, because that is where MC and phone live). */
export function authoredText(body) {
  const cut = RULES.cutLine.filter(s => s !== String.raw`^\s*--\s*$`).map(s => new RegExp(s, 'i'));
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n'); const out = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (cut.some(r => r.test(ln))) break;
    if (/^\s*on\s.{3,}$/i.test(ln) && i + 1 < lines.length && /wrote:\s*$/i.test(lines[i + 1])) break;
    if (/^\s*from:\s/i.test(ln)) { let hdr = 0; for (let j = i + 1; j <= Math.min(i + 7, lines.length - 1); j++) if (/^\s*(?:sent|date|to|subject|cc):/i.test(lines[j])) hdr++; if (hdr >= 2) break; }
    if (/^\s*>/.test(ln)) continue;
    out.push(ln);
  }
  return out.join('\n').trim();
}

/** Driver / truck details typed by the carrier. { found, name, phone, truck, trailer, plate, fields } */
export function readDriverInfo(text) {
  const t = String(text ?? '');
  const lines = t.split('\n');
  const info = { name: '', phone: '', truck: '', trailer: '', plate: '' };
  let m = R.driverName.exec(t) || R.driverNameLoose.exec(t);
  if (m) info.name = title(m[1].trim().replace(/\s{2,}/g, ' ')).slice(0, 40);
  if (/^(?:name|phone|cell|number|info|and|the|is|will|has)\b/i.test(info.name)) info.name = '';
  for (let i = 0; i < lines.length; i++) {
    if (/\bdriver\b/i.test(lines[i])) { const p = phonesIn(lines[i] + ' ' + (lines[i + 1] || '')); if (p.length) { info.phone = p[0]; break; } }
  }
  if (!info.phone && /\b(?:cell|phone|mobile|ph|tel)\b/i.test(t) && info.name) { const p = phonesIn(t); if (p.length === 1) info.phone = p[0]; }
  m = R.truckNo.exec(t); if (m && /\d/.test(m[1])) info.truck = m[1].toUpperCase();
  m = R.trailerNo.exec(t); if (m && /\d/.test(m[1])) info.trailer = m[1].toUpperCase();
  m = R.plate.exec(t); if (m && /\d/.test(m[1])) info.plate = m[1].trim().toUpperCase();
  const fields = ['name', 'phone', 'truck', 'trailer', 'plate'].filter(k => info[k]).length;
  const found = (!!info.name && !!info.phone) || (!!info.phone && (!!info.truck || !!info.trailer)) || fields >= 3;
  return { found, fields, ...info };
}

/** MC / DOT numbers a person wrote about THEMSELVES (authored text only). */
export function readIds(text) {
  const t = String(text ?? ''); const mc = [], dot = [];
  for (const m of t.matchAll(/\b(?:mc|m\.c\.)\s*(?:#|no\.?|number|num)?\s*[:\-#]?\s*0*(\d{4,8})\b/gi)) mc.push(m[1]);
  for (const m of t.matchAll(/\b(?:us\s*)?dot\s*(?:#|no\.?|number|num)?\s*[:\-#]?\s*(\d{5,8})\b/gi)) dot.push(m[1]);
  return { mc, dot };
}
const mostCommon = (list) => { const n = new Map(); for (const x of list) n.set(x, (n.get(x) || 0) + 1); const s = [...n.entries()].sort((a, b) => b[1] - a[1]); if (!s.length) return ''; if (s.length > 1 && s[0][1] === s[1][1]) return ''; return s[0][0]; };

/** Company name from the signature block, a labelled line, the display name or (last resort) the e-mail domain. { name, conf } */
export function readCompany(authored, displayNames = [], email = '') {
  const lines = String(authored || '').split('\n').map(l => l.trim()).filter(Boolean);
  const tail = lines.slice(-14);
  const clean = (l) => l.replace(/^(?:company|carrier|from|co|name)\s*[:\-]\s*/i, '').replace(/[|•·*]+.*$/, '').replace(/\s{2,}/g, ' ').replace(/[,;.\s]+$/, '').trim();
  for (const l of tail) { const m = /^(?:company|carrier|company name)\s*[:\-]\s*(.{3,60})$/i.exec(l); if (m) return { name: clean(m[1]), conf: 'high' }; }
  for (const l of tail.slice().reverse()) {
    if (l.length < 4 || l.length > 64 || /@|https?:|www\./i.test(l) || phonesIn(l).length || /\b(?:mc|dot)\s*#?\s*\d/i.test(l) || /^(?:thanks|thank you|regards|best|sent from)/i.test(l)) continue;
    if (COMPANY_WORDS.test(l)) return { name: clean(l), conf: 'high' };
  }
  for (const n of displayNames) if (n && COMPANY_WORDS.test(n) && !/@/.test(n)) return { name: clean(n), conf: 'high' };
  const d = domainOf(email);
  if (d && !FREE_MAIL.has(registrable(d))) return { name: title(registrable(d).split('.')[0].replace(/[-_]+/g, ' ')), conf: 'low' };
  const person = displayNames.find(n => n && !/@/.test(n));
  return person ? { name: title(person), conf: 'low' } : { name: '', conf: 'none' };
}

/** The phone to reach the carrier: a labelled dispatch / office number, else the first number in the signature (never the driver's). */
export function readPhones(authored) {
  const lines = String(authored || '').split('\n');
  let dispatch = '', office = '', first = '';
  const driverLine = (l) => /\bdriver\b/i.test(l);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]; if (driverLine(l)) continue;
    for (const p of phonesIn(l)) {
      if (!first && i >= Math.max(0, lines.length - 14)) first = p;
      if (/\bdispatch(?:er)?\b/i.test(l) && !dispatch) dispatch = p;
      else if (/\b(?:office|main|direct|ph|phone|tel|p:|o:|work)\b/i.test(l) && !office) office = p;
    }
  }
  return { dispatch: phoneKey(dispatch), office: phoneKey(office), first: phoneKey(first) };
}

const EQUIP = [[/\bpower[- ]?only\b/i, 'PO'], [/\bstep[- ]?deck\b/i, 'SD'], [/\bflat[- ]?bed\b/i, 'F'], [/\b(?:reefer|refrigerated|temp(?:erature)?[- ]controlled)\b/i, 'R'], [/\b(?:box truck|straight truck)\b/i, 'SB'], [/\bsprinter\b/i, 'SV'], [/\b(?:dry van|53'?\s*van|53 ?ft van|\bvan\b)\b/i, 'V']];
export const equipFromMail = (text) => { const t = String(text || ''); for (const [re, code] of EQUIP) if (re.test(t)) return code; return ''; };

/* ------------------------------------------------------------------------------------------------ lanes */
const WORDS = String.raw`[A-Za-z][A-Za-z.'\-]*(?:[ \t]+[A-Za-z][A-Za-z.'\-]*){0,3}`;
const STOP = new Set('to from at in on the a an for load pickup pick up picking delivery deliver delivering destination origin drop drops going headed heading out of near by via thru and or is are our your my this that with will can have has about'.split(' '));

/** Every "City, ST" in a piece of text, validated against the ZIP Map when there is one. [{ city, state, start, end }] */
export function findPlaces(text, zipMap = null) {
  const out = []; const t = String(text ?? '');
  const re = new RegExp(`(${WORDS})[ \\t]*,?[ \\t]+([A-Za-z]{2})\\b(?:[ \\t]+\\d{5}(?:-\\d{4})?)?`, 'g');
  let m;
  while ((m = re.exec(t))) {
    const st = m[2].toUpperCase();
    if (!STATES.has(st)) { re.lastIndex = m.index + Math.max(1, m[1].length); continue; }
    const hadComma = /,/.test(m[0].slice(m[1].length, m[1].length + 3)); const upper = m[2] === st;
    let words = m[1].trim().split(/[ \t]+/); let city = '';
    while (words.length) {
      const cand = words.join(' ');
      if (zipMap && zipMap.size) { if (zipMap.market(cand, st)) { city = cand; break; } }
      else if (!STOP.has(words[0].toLowerCase()) && (hadComma || upper)) { city = cand; break; }
      words = words.slice(1);
    }
    if (!city) { re.lastIndex = m.index + Math.max(1, m[1].length); continue; }
    if (!hadComma && !upper && !(zipMap && zipMap.size)) continue;
    const start = m.index + m[0].indexOf(city);
    out.push({ city: zipMap && zipMap.size ? zipMap.market(city, st).city : title(city), state: st, start, end: m.index + m[0].length });
    re.lastIndex = m.index + m[0].length;
  }
  return out;
}

/** The lanes one message talks about: [{ lane, via }] via = 'subject' | 'label' | 'arrow'. A lane is { originCity, originState, destCity, destState }. */
export function lanesInText(text, zipMap = null, via = 'arrow') {
  const found = []; const t = String(text ?? '');
  const mk = (a, b, v) => ({ lane: { originCity: a.city, originState: a.state, destCity: b.city, destState: b.state }, via: v });
  // labelled lines: Pickup: City, ST / Delivery: City, ST (TQL layout and our own outreach)
  let po = null, dl = null;
  for (const line of t.split('\n')) {
    const lo = /^\s*(?:pick ?up|pickup|origin|from|shipper|pu)\b[^:\n]{0,20}[:\-]\s*(.+)$/i.exec(line), ld = /^\s*(?:delivery|deliver|destination|to|drop|consignee|del)\b[^:\n]{0,20}[:\-]\s*(.+)$/i.exec(line);
    if (lo && !po) po = findPlaces(lo[1], zipMap)[0] || po;
    if (ld) dl = findPlaces(ld[1], zipMap)[0] || dl;
  }
  if (po && dl && !(po.city === dl.city && po.state === dl.state)) found.push(mk(po, dl, 'label'));
  // "City, ST to City, ST" (also -> / - / >)
  const places = findPlaces(t, zipMap);
  for (let i = 0; i + 1 < places.length; i++) {
    const between = t.slice(places[i].end, places[i + 1].start);
    if (/^\s*(?:to|->|→|–|—|-|>|=>|thru|towards?|into|and then|then)\s*$/i.test(between) && !(places[i].city === places[i + 1].city && places[i].state === places[i + 1].state)) found.push(mk(places[i], places[i + 1], via));
  }
  return found;
}
const laneKeyOf = (l) => [l.originCity, l.originState, l.destCity, l.destState].map(normalizeText).join('|');

/* ------------------------------------------------------------------------------------------------ threads */
/** Group messages into conversations: Outlook ConversationID when there is one; otherwise Message-ID / References chains; otherwise subject + counterpart. */
export function groupThreads(messages) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); return x; };
  const union = (a, b) => { const ra = find(add(a)), rb = find(add(b)); if (ra !== rb) parent.set(ra, rb); };
  for (const m of messages) {
    const keys = [];
    if (m.convId) keys.push('c:' + m.convId);
    if (m.mid) keys.push('m:' + m.mid);
    for (const r of m.refs || []) keys.push('m:' + r);
    if (!keys.length) { const other = m.dir === 'out' ? (m.to[0] && m.to[0].email) : m.from.email; keys.push('s:' + normSubject(m.subject) + '|' + domainOf(other || '')); }
    keys.forEach(add); for (let i = 1; i < keys.length; i++) union(keys[0], keys[i]);
    m._k = keys[0];
  }
  const groups = new Map();
  for (const m of messages) { const k = find(m._k); (groups.get(k) || groups.set(k, []).get(k)).push(m); }
  return [...groups.entries()].map(([k, list]) => ({ key: k, messages: list.sort((a, b) => a.at - b.at) }));
}

const isAutomatedParty = (email) => { const local = String(email).split('@')[0], d = domainOf(email); return AUTOMATED_ADDR.test(local) || AUTOMATED_DOMAIN.test(d); };
const blockedBy = (email, list) => { const e = String(email).toLowerCase(); return (list || []).some(x => { const s = String(x || '').trim().toLowerCase(); return s && e.includes(s.replace(/^@/, '')); }); };

/* ------------------------------------------------------------------------------------------------ the analysis */
/**
 * analyzeHistory(messages, ctx) -> { threads, candidates, excluded, stats }
 *   ctx: { zipMap, settings, own:[addresses], customers:[emails/domains], now, since }
 * candidates: one per carrier, with bookings[] (each with level / score / evidence / lane / rate).
 * threads: one compact record per (conversation, carrier) that went beyond a cold mass mailing: used for rate intelligence and response rates.
 */
export function analyzeHistory(messagesIn, ctx = {}) {
  const settings = ctx.settings || {};
  const zipMap = ctx.zipMap || null;
  const since = Number(ctx.since) || 0;
  const seenMsg = new Set();
  const all = [];
  for (const raw of messagesIn || []) {
    const m = raw && raw.at !== undefined && raw.from ? raw : null; if (!m) continue;
    if (since && m.at < since) continue;
    const key = m.mid || m.id; if (seenMsg.has(key)) continue; seenMsg.add(key);
    all.push(m);
  }
  const { own, domains } = inferOwn(all, ctx.own);
  const customerSet = (ctx.customers || []).map(x => String(x || '').toLowerCase()).filter(Boolean);
  const block = [...(settings.inboundBlocklist || []), ...(settings.outreachBlocklist || [])];
  for (const m of all) { if (!m.dir) m.dir = own.has(m.from.email) ? 'out' : 'in'; }
  const stats = { messages: all.length, threads: 0, parties: 0, high: 0, medium: 0, low: 0, excluded: {}, own: [...own] };
  const excluded = [];
  const exclude = (why, who, extra = {}) => { stats.excluded[why] = (stats.excluded[why] || 0) + 1; if (excluded.length < 400) excluded.push({ why, who, ...extra }); };
  const external = (email) => {
    if (!email || own.has(email)) return false;
    const d = registrable(domainOf(email));
    if (domains.has(d)) return false;
    if (isAutomatedParty(email)) return false;
    if (blockedBy(email, block)) return false;
    if (customerSet.some(c => email === c || (!isFree(email) && c.includes('@') && registrable(domainOf(c)) === d) || (!c.includes('@') && c === d))) return false;
    return true;
  };

  const threads = []; const bookings = [];
  for (const conv of groupThreads(all)) {
    stats.threads++;
    const msgs = conv.messages;
    // who is on each message (external people only)
    const partiesOf = (m) => uniq((m.dir === 'in' ? [m.from.email] : [...m.to, ...m.cc, ...m.bcc].map(x => x.email)).filter(external));
    const byParty = new Map();
    for (const m of msgs) {
      const ps = partiesOf(m);
      const mass = m.dir === 'out' && ps.length > 3;
      for (const p of ps) { (byParty.get(p) || byParty.set(p, []).get(p)).push({ m, mass, recipients: ps }); }
    }
    if (!byParty.size) continue;
    // same carrier, two mailboxes: same company domain, or both on one booking message
    const par = new Map([...byParty.keys()].map(k => [k, k])); const f = (x) => { while (par.get(x) !== x) x = par.get(x); return x; };
    const un = (a, b) => { const ra = f(a), rb = f(b); if (ra !== rb) par.set(ra, rb); };
    const keys = [...byParty.keys()];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (!isFree(keys[i]) && registrable(domainOf(keys[i])) === registrable(domainOf(keys[j]))) un(keys[i], keys[j]);
    for (const m of msgs) if (m.dir === 'out') { const ps = partiesOf(m); if (ps.length >= 2 && ps.length <= 3) for (let i = 1; i < ps.length; i++) un(ps[0], ps[i]); }
    const clusters = new Map();
    for (const k of keys) { const r = f(k); (clusters.get(r) || clusters.set(r, []).get(r)).push(k); }
    for (const members of clusters.values()) {
      stats.parties++;
      const evs = []; const seen = new Set();
      for (const k of members) for (const e of byParty.get(k)) { if (!seen.has(e.m.id)) { seen.add(e.m.id); evs.push(e); } }
      evs.sort((a, b) => a.m.at - b.m.at);
      const res = evaluateCluster({ conv, members, evs, msgs, zipMap, settings, own });
      if (!res) continue;
      threads.push(res.thread);
      if (res.exclude) { exclude(res.exclude, res.thread.carrier.name || res.thread.carrier.email, { email: res.thread.carrier.email, lane: res.thread.lane }); continue; }
      if (res.thread.booked) bookings.push(res);
    }
  }
  // fold bookings into carriers
  const candidates = foldCandidates(bookings);
  for (const c of candidates) { if (c.level === 'high') stats.high++; else if (c.level === 'medium') stats.medium++; else stats.low++; }
  return { threads, candidates, excluded, stats, own: [...own] };
}

function evaluateCluster({ conv, members, evs, msgs, zipMap, settings }) {
  const pts = {}; const evidence = []; let firstEvidence = 0, firstEngaged = 0, bookAt = 0;
  const add = (k, p, text, at) => { if (pts[k]) return; pts[k] = p; evidence.push({ k, text, at }); if (!firstEvidence || at < firstEvidence) firstEvidence = at; };
  const state = { rcOut: 0, bookOut: 0, driverReq: 0, offerOut: 0, lastOutRate: 0 };
  const authoredIn = []; const displayNames = []; const emailCount = new Map();
  const quotes = []; const rateEvents = []; let cancelAt = 0, problemAt = 0, inCount = 0, outCount = 0, outDirect = 0, firstOut = 0, firstIn = 0;
  const laneVotes = new Map(); let equipVote = '';
  const driver = { name: '', phone: '', truck: '', trailer: '' };
  let rcFile = '', acceptedAfterOffer = false, replyAfterRc = false;
  // lanes from ANY message in the conversation (our mass outreach carries the lane for everyone)
  for (const m of msgs) {
    const subj = lanesInText(m.subject, zipMap, 'subject');
    const fresh = freshText(m.body);
    const body = lanesInText(fresh, zipMap, m.dir === 'out' ? 'label' : 'arrow');
    for (const l of [...subj.map(x => ({ ...x, w: 3 })), ...body.map(x => ({ ...x, w: x.via === 'label' ? 3 : 2 }))]) {
      const k = laneKeyOf(l.lane); const v = laneVotes.get(k) || { lane: l.lane, w: 0 }; v.w += l.w; laneVotes.set(k, v);
    }
  }
  for (const { m, mass } of evs) {
    const fresh = freshText(m.body);
    const att = attachmentKinds(m.attachments);
    const t = fresh;
    const em = m.dir === 'in' ? m.from.email : '';
    if (m.dir === 'in') {
      inCount++; if (!firstIn) firstIn = m.at;
      if (em) emailCount.set(em, (emailCount.get(em) || 0) + 1);
      authoredIn.push(authoredText(m.body)); if (m.from.name) displayNames.push(m.from.name);
      const ex = extractRate(t, settings);
      if (ex.found && ex.confidence === 'strong') { quotes.push({ at: m.at, rate: ex.rate }); rateEvents.push({ at: m.at, dir: 'in', rate: ex.rate }); }
      const di = readDriverInfo(authoredText(m.body));
      const engagedBefore = state.rcOut || state.bookOut || state.driverReq;
      if (di.found) {
        if (engagedBefore && m.at - Math.max(state.rcOut, state.bookOut, state.driverReq) <= 14 * DAY) add('driverInfoAfter', 35, 'Carrier sent driver / truck details after we asked or booked' + (di.name ? ' (' + di.name + ')' : ''), m.at);
        else add('driverInfoAny', 15, 'Carrier sent driver details' + (di.name ? ' (' + di.name + ')' : ''), m.at);
        for (const k of ['name', 'phone', 'truck', 'trailer']) if (di[k] && !driver[k]) driver[k] = di[k];
      }
      if (state.rcOut && att.ratecon && !pts.signedRc) {
        const signed = att.signed || /\b(?:signed|executed|countersigned)\b/i.test(t);
        add('signedRc', signed ? 50 : 40, signed ? 'Carrier returned the signed rate confirmation' : 'Carrier sent a rate confirmation file back after ours', m.at);
      } else if (state.rcOut && R.rcText.test(t) && /\b(?:signed|executed)\b/i.test(t) && !pts.signedRc) add('signedRc', 40, 'Carrier says the rate confirmation is signed / attached', m.at);
      if (state.rcOut && !replyAfterRc && m.at > state.rcOut) { replyAfterRc = true; add('replyAfterRc', 10, 'Carrier replied after the rate confirmation', m.at); }
      if ((state.offerOut || state.bookOut || state.rcOut) && classify(t, settings).intent === 'accepts' || ((state.offerOut || state.bookOut || state.rcOut) && R.takeIt.test(t) && t.length < 260 && !/\?/.test(t))) { acceptedAfterOffer = true; add('accept', 15, 'Carrier accepted: "' + oneLine(t, 70) + '"', m.at); }
      const dd = att.pod || R.delivered.test(t); if (dd && (state.rcOut || state.bookOut || state.driverReq || pts.driverInfoAfter)) add('ranDelivery', 25, att.pod ? 'Carrier sent the POD / BOL' : 'Carrier reported the load delivered', m.at);
      else if (R.transit.test(t) && (state.rcOut || state.bookOut || pts.driverInfoAfter)) add('ranTransit', 10, 'Carrier reported the load moving', m.at);
      if (R.cancelled.test(t) && !cancelAt) cancelAt = m.at;
      if (R.problem.test(t) && !problemAt) problemAt = m.at;
    } else {
      outCount++; if (!firstOut) firstOut = m.at;
      if (!mass) outDirect++;
      const ex = extractRate(t, settings);
      const outRate = ex.found && ex.confidence === 'strong' ? ex.rate : 0;
      if (outRate) rateEvents.push({ at: m.at, dir: 'out', rate: outRate, mass });
      if (mass) continue;                                           // a cold e-mail to many carriers proves nothing about any one of them
      if (outRate) { state.offerOut = m.at; state.lastOutRate = outRate; }
      const rc = att.ratecon || R.rcText.test(t);
      if (att.ratecon) { state.rcOut = state.rcOut || m.at; rcFile = m.attachments.find(n => RC_NAME.test(n)) || rcFile; add('rcSentAttach', 45, 'Rate confirmation sent: ' + (rcFile || 'attachment'), m.at); if (!bookAt) bookAt = m.at; }
      else if (R.rcText.test(t)) { state.rcOut = state.rcOut || m.at; add('rcSentText', 20, 'Our message says the rate confirmation is attached', m.at); if (!bookAt) bookAt = m.at; }
      if (R.bookOut.test(t)) { state.bookOut = state.bookOut || m.at; add('bookOut', 25, 'We told the carrier they were booked: "' + oneLine((/.{0,30}(?:booked|all set|confirmed|awarded|yours|book it).{0,40}/i.exec(t) || [t])[0], 80) + '"', m.at); if (!bookAt) bookAt = m.at; }
      if (R.driverReq.test(t)) { state.driverReq = state.driverReq || m.at; add('driverReq', 10, 'We asked for driver / dispatch info', m.at); if (!bookAt) bookAt = m.at; }
      if (R.thanks.test(t) && (state.rcOut || state.bookOut || pts.driverInfoAfter)) add('thanks', 10, 'We thanked the carrier for the load', m.at);
      if (R.cancelled.test(t) && !cancelAt && (rc || state.bookOut || state.rcOut)) cancelAt = m.at;
      if (R.problem.test(t) && !problemAt) problemAt = m.at;
      if (!firstEngaged && (rc || R.bookOut.test(t) || R.driverReq.test(t))) firstEngaged = m.at;
    }
  }
  if (!inCount && !outDirect) return null;

  // ---- who is the carrier
  const emails = [...emailCount.entries()].sort((a, b) => b[1] - a[1]).map(x => x[0]);
  const primaryEmail = emails[0] || members.slice().sort((a, b) => (isFree(a) ? 1 : 0) - (isFree(b) ? 1 : 0))[0];
  const authored = authoredIn.join('\n');
  const ids = readIds(authored);
  const mc = mostCommon(ids.mc), dot = mostCommon(ids.dot);
  const phones = readPhones(authored);
  const co = readCompany(authored, uniq(displayNames), primaryEmail);
  const phone = phones.dispatch || phones.office || phones.first;
  const lane = (() => { const v = [...laneVotes.values()].sort((a, b) => b.w - a.w); if (!v.length) return null; if (v.length > 1 && v[0].w === v[1].w) return null; return v[0].lane; })();
  const laneOk = !!(lane && zipMap && zipMap.size ? zipMap.market(lane.originCity, lane.originState) && zipMap.market(lane.destCity, lane.destState) : lane);
  const equip = equipFromMail(msgs.map(x => freshText(x.body)).join('\n') + ' ' + msgs.map(x => x.subject).join(' '));

  // ---- rate
  const rr = resolveRate({ rateEvents, bookAt, acceptedAfterOffer, evs });
  if (rr.rate && !pts.rateAgreed && (rr.basis === 'stated' || rr.basis === 'agreed' || rr.basis === 'accepted')) { pts.rateAgreed = 20; evidence.push({ k: 'rateAgreed', text: 'Rate $' + rr.rate.toLocaleString('en-US') + ' ' + rr.note, at: bookAt || firstEvidence }); }

  // ---- score
  const engaged = !!(pts.rcSentAttach || pts.rcSentText || pts.bookOut || pts.driverReq);
  let score = Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0));
  const strong = !!(pts.rcSentAttach || pts.signedRc || pts.driverInfoAfter || pts.ranDelivery);
  let level = score >= 70 && strong ? 'high' : score >= 40 ? 'medium' : 'low';
  if (score >= 70 && !strong) score = 69;
  const stage = !engaged ? (quotes.length ? 'quoted' : inCount ? 'inquiry' : 'contacted') : 'booked';
  const thread = {
    id: 'th:' + hash(conv.key + '|' + (mc || primaryEmail)), kind: 'thread', convKey: conv.key, subject: oneLine(msgs[0].subject, 120),
    first: msgs[0].at, last: msgs[msgs.length - 1].at, inquiredAt: firstIn || 0, contactedAt: firstOut || 0,
    carrier: { key: carrierKey({ mc: mc ? 'MC ' + mc : '', email: primaryEmail }), name: co.name, mc: mc ? 'MC ' + mc : '', dot: dot ? 'DOT ' + dot : '', email: primaryEmail, emails, phone: fmtPhone(phone), dispatchPhone: fmtPhone(phones.dispatch), driverName: driver.name, driverPhone: fmtPhone(driver.phone), equipment: equip },
    lane: laneOk ? lane : null, equip, stage, responded: inCount > 0, quotes: quotes.slice(0, 12), firstQuote: quotes[0] ? quotes[0].rate : 0, lastQuote: quotes.length ? quotes[quotes.length - 1].rate : 0,
    finalRate: rr.rate || 0, rateBasis: rr.basis || '', rateConf: rr.conf || 'none', booked: false, score, level: stage === 'booked' ? level : 'low', evidence: evidence.map(e => e.text),
    inMessages: inCount, outMessages: outCount,
  };
  if (stage !== 'booked') return { thread };
  if (level === 'low') { thread.booked = false; return { thread, exclude: 'weak evidence' }; }
  const eventAt = bookAt || firstEvidence;
  if (cancelAt && cancelAt >= (firstEngaged || eventAt) - HOUR) return { thread, exclude: 'cancelled / fell off after booking' };
  if (problemAt && problemAt >= (firstEngaged || eventAt)) return { thread, exclude: 'problem reported (late, damage or claim)' };
  thread.booked = true;
  thread.bookedAt = eventAt;
  return {
    thread, bookedAt: eventAt, score, level, strong, evidence, lane: laneOk ? lane : null, rate: rr.rate, rateConf: rr.conf, rateBasis: rr.basis, quotes, equip, driver, negotiationMinutes: firstIn && eventAt ? Math.max(0, Math.round((eventAt - Math.min(firstIn, firstOut || firstIn)) / MIN)) : 0,
    carrier: { name: co.name, nameConf: co.conf, mc, dot, email: primaryEmail, emails, phone, dispatchPhone: phones.dispatch, equipment: equip, contactName: displayNames[0] || '' },
    ran: !!(pts.ranDelivery || pts.thanks), threadId: thread.id,
  };
}

/** What was the load actually booked at? Only a rate that is typed clearly and agreed is returned; anything else is "unknown" (never guessed). */
export function resolveRate({ rateEvents, bookAt, acceptedAfterOffer, evs }) {
  const ev = rateEvents.filter(e => !e.mass).sort((a, b) => a.at - b.at);
  if (!ev.length) return { rate: 0, conf: 'none', basis: '' };
  // a. stated inside the booking / rate-con message itself
  const bookMsgs = new Set((evs || []).filter(e => e.m.dir === 'out' && !e.mass && (attachmentKinds(e.m.attachments).ratecon || R.rcText.test(freshText(e.m.body)) || R.bookOut.test(freshText(e.m.body)))).map(e => e.m.at));
  const stated = uniq(ev.filter(e => e.dir === 'out' && bookMsgs.has(e.at)).map(e => e.rate));
  if (stated.length === 1) return later(ev, stated[0], bookAt) || { rate: stated[0], conf: 'high', basis: 'stated', note: '(stated in our booking message)' };
  if (stated.length > 1) return { rate: 0, conf: 'none', basis: 'conflict' };
  const pivot = bookAt || Infinity;
  const before = ev.filter(e => e.at <= pivot);
  if (!before.length) return { rate: 0, conf: 'none', basis: '' };
  const last = before[before.length - 1], prev = before[before.length - 2];
  if (prev && prev.dir !== last.dir && prev.rate === last.rate) return later(ev, last.rate, bookAt) || { rate: last.rate, conf: 'high', basis: 'agreed', note: '(both sides typed the same number)' };
  if (last.dir === 'out' && acceptedAfterOffer) return later(ev, last.rate, bookAt) || { rate: last.rate, conf: 'high', basis: 'accepted', note: '(our last offer, accepted)' };
  if (last.dir === 'in' && bookAt && last.at <= bookAt) return later(ev, last.rate, bookAt) || { rate: last.rate, conf: 'medium', basis: 'carrier-last-quote', note: '(carrier\'s last quote before we booked)' };
  return { rate: 0, conf: 'none', basis: '' };
}
// a different carrier rate typed AFTER the booking means it was renegotiated: unknown, not guessed
function later(ev, rate, bookAt) {
  if (!bookAt) return null;
  const after = ev.filter(e => e.at > bookAt + 5 * MIN && e.dir === 'in' && e.rate !== rate);
  return after.length ? { rate: 0, conf: 'none', basis: 'renegotiated' } : null;
}

/* ------------------------------------------------------------------------------------------------ carriers */
function foldCandidates(bookings) {
  const by = new Map();
  const keyOf = (b) => (b.carrier.mc ? 'mc:' + b.carrier.mc : b.carrier.dot ? 'dot:' + b.carrier.dot : b.carrier.email ? 'em:' + b.carrier.email : '');
  // merge by MC, then by any shared e-mail
  const aliases = new Map();
  for (const b of bookings) {
    const k = keyOf(b); if (!k) continue;
    let target = by.get(k);
    if (!target) for (const e of b.carrier.emails || []) { const t2 = aliases.get(e); if (t2) { target = by.get(t2); break; } }
    if (!target) {
      target = { key: k, name: '', nameConf: 'none', mc: '', dot: '', email: '', emails: [], phone: '', dispatchPhone: '', driverName: '', driverPhone: '', equipment: '', contactName: '', bookings: [], level: 'low', score: 0, ran: false, issues: [] };
      by.set(k, target);
    }
    const c = b.carrier;
    const rank = { high: 3, low: 1, none: 0 };
    if (c.name && (!target.name || (rank[c.nameConf] || 0) > (rank[target.nameConf] || 0))) { target.name = c.name; target.nameConf = c.nameConf; }
    for (const f of ['mc', 'dot', 'email', 'phone', 'dispatchPhone', 'equipment', 'contactName']) if (c[f] && !target[f]) target[f] = c[f];
    for (const e of c.emails || [c.email]) if (e) { if (!target.emails.includes(e)) target.emails.push(e); aliases.set(e, target.key); }
    if (b.driver && b.driver.name && !target.driverName) { target.driverName = b.driver.name; target.driverPhone = b.driver.phone; }
    target.bookings.push({ threadId: b.threadId, at: b.bookedAt, lane: b.lane, rate: b.rate, rateConf: b.rateConf, rateBasis: b.rateBasis, level: b.level, score: b.score, evidence: b.evidence.map(e => e.text), equip: b.equip, quotes: b.quotes.length, negotiationMinutes: b.negotiationMinutes, ran: b.ran });
    if (b.ran) target.ran = true;
  }
  const out = [...by.values()];
  for (const c of out) {
    c.bookings.sort((a, b) => b.at - a.at);
    const order = { high: 3, medium: 2, low: 1 };
    c.level = c.bookings.reduce((a, b) => (order[b.level] > order[a] ? b.level : a), 'low');
    c.score = Math.max(...c.bookings.map(b => b.score));
    c.lastBookedAt = c.bookings[0].at;
    const rates = c.bookings.filter(b => b.rate > 0 && (b.rateConf === 'high' || b.rateConf === 'medium')).map(b => b.rate);
    c.lastRate = (c.bookings.find(b => b.rate > 0 && b.rateConf === 'high') || {}).rate || 0;
    c.avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : 0;
    c.ranLanes = [];
    for (const b of c.bookings) if (b.lane) { const k = laneKeyOf(b.lane); let l = c.ranLanes.find(x => x.key === k); if (!l) { l = { key: k, ...b.lane, count: 0, lastAt: 0, lastRate: 0 }; c.ranLanes.push(l); } l.count++; if (b.at > l.lastAt) { l.lastAt = b.at; l.lastRate = b.rateConf === 'high' ? b.rate : l.lastRate; } }
    if (!c.mc && !c.dot) c.issues.push('No MC / DOT number found in the e-mails');
    if (!c.name || c.nameConf === 'low') c.issues.push('Company name was guessed from the e-mail address');
    if (!c.phone) c.issues.push('No phone number found');
  }
  return out.sort((a, b) => ({ high: 3, medium: 2, low: 1 })[b.level] - ({ high: 3, medium: 2, low: 1 })[a.level] || b.score - a.score || b.lastBookedAt - a.lastBookedAt);
}

/* ------------------------------------------------------------------------------------------------ matching + merging with the carrier database */
const emailsOfRow = (c) => uniq([c.email, c.dispatchEmail, ...(Array.isArray(c.altEmails) ? c.altEmails : [])].map(emailOf).filter(Boolean));
const mcOfRow = (c) => { const p = parseMcDot(c.mc); return p ? p.type + ':' + p.num : ''; };

/** The existing carrier rows that are the same company as this candidate: MC/DOT, any e-mail, or the phone number. */
export function findExisting(cand, carriers) {
  const mcs = [cand.mc ? 'MC:' + cand.mc : '', cand.dot ? 'DOT:' + cand.dot : ''].filter(Boolean);
  const em = new Set(cand.emails && cand.emails.length ? cand.emails : [cand.email].filter(Boolean));
  const ph = new Set([phoneKey(cand.phone), phoneKey(cand.dispatchPhone)].filter(Boolean));
  const nm = normalizeText(cand.name).replace(/[^a-z0-9]/g, '').replace(/(?:llc|inc|corp|co|ltd)$/, '');
  const dom = cand.email && !isFree(cand.email) ? registrable(domainOf(cand.email)) : '';
  return (carriers || []).filter(c => {
    const own = mcOfRow(c); if (own && mcs.includes(own)) return true;
    if (emailsOfRow(c).some(e => em.has(e))) return true;
    const cp = phoneKey(c.phone); if (cp && ph.has(cp) && (!c.carrierName || !cand.name || normalizeText(c.carrierName).slice(0, 4) === normalizeText(cand.name).slice(0, 4))) return true;
    if (dom && nm.length >= 4 && emailsOfRow(c).some(e => registrable(domainOf(e)) === dom) && normalizeText(c.carrierName).replace(/[^a-z0-9]/g, '').replace(/(?:llc|inc|corp|co|ltd)$/, '') === nm) return true;
    return false;
  });
}

const conf = { high: 85, medium: 60, low: 35 };
/**
 * How a candidate changes the carrier list. NEVER overwrites a value a person typed (or imported from their own sheet): rows without field
 * metadata are treated as person-entered. Returns { fill:{field:value}, conflicts:[{field, have, found}], extra:{...} }.
 */
export function mergeCarrierPatch(row, cand) {
  const meta = row.fieldMeta || {};
  const fill = {}, conflicts = [];
  const same = (a, b) => normalizeText(a).replace(/[^a-z0-9@.]/g, '') === normalizeText(b).replace(/[^a-z0-9@.]/g, '');
  const put = (field, value, found = true) => {
    if (!value) return;
    const have = String(row[field] ?? '').trim();
    if (!have) { fill[field] = value; return; }
    if (field === 'phone' ? phoneKey(have) === phoneKey(value) : same(have, value)) return;
    const m = meta[field];
    const mine = !m || m.src !== 'email';                                  // typed or imported by a person: locked
    if (!mine && (m.conf || 0) < (conf[cand.level] || 0) && found) { fill[field] = value; return; }
    conflicts.push({ field, have, found: value });
  };
  put('carrierName', cand.nameConf === 'low' ? '' : cand.name);
  put('mc', cand.mc ? 'MC ' + cand.mc : cand.dot ? 'DOT ' + cand.dot : '');
  put('email', cand.email);
  put('phone', fmtPhone(phoneKey(cand.dispatchPhone || cand.phone)));
  put('equipment', cand.equipment);
  return { fill, conflicts };
}

/**
 * planImport(analysis, ctx, opts) -> { adds, patches, covers, threads, skipped, stats }
 *   ctx  { carriers, coverLog, history (stored thread records) }
 *   opts { levels:['high'] | ['high','medium'], only:Set(candidate keys) | null }
 */
export function planImport(analysis, ctx = {}, opts = {}) {
  const levels = new Set(opts.levels || ['high']);
  const carriers = ctx.carriers || [];
  const picked = (analysis.candidates || []).filter(c => levels.has(c.level) && (!opts.only || opts.only.has(c.key)));
  const adds = [], patches = [], covers = [], skipped = [];
  const claimed = new Map();                                          // rows already created in THIS plan, so two candidates for one company never make two rows
  const stamp = new Date(Number(ctx.now) || Date.now()).toISOString();
  for (const c of picked) {
    const matches = findExisting(c, [...carriers, ...adds]);
    const lastLane = (c.bookings.find(b => b.lane) || {}).lane || null;
    const extras = {
      verified: 'email', verifiedAt: stamp, historyConfidence: Math.round(c.score), bookedCount: c.bookings.length, lastBookedAt: new Date(c.lastBookedAt).toISOString(), lastBookedRate: c.lastRate || '',
      dispatchPhone: fmtPhone(phoneKey(c.dispatchPhone)), driverName: c.driverName || '', driverPhone: fmtPhone(phoneKey(c.driverPhone)), contactName: c.contactName || '',
      ranLanes: c.ranLanes.map(({ key, ...l }) => ({ ...l, lastAt: new Date(l.lastAt).toISOString() })), altEmails: c.emails.filter(e => e !== c.email),
    };
    if (matches.length) {
      const row = matches.find(m => m.id) || matches[0];
      if (!row.id) { skipped.push({ key: c.key, name: c.name, why: 'matches a carrier added a moment ago in this same import' }); continue; }
      const { fill, conflicts } = mergeCarrierPatch(row, c);
      const meta = { ...(row.fieldMeta || {}) }; for (const f of Object.keys(fill)) meta[f] = { src: 'email', conf: conf[c.level] || 50, at: stamp };
      // new knowledge that is not a user-typed field (never replaces anything the person typed)
      const patch = { ...fill, fieldMeta: meta };
      for (const k of ['verified', 'verifiedAt', 'historyConfidence', 'bookedCount', 'lastBookedAt', 'lastBookedRate', 'driverName', 'driverPhone', 'contactName', 'ranLanes', 'altEmails']) {
        if (k === 'ranLanes') patch.ranLanes = mergeRanLanes(row.ranLanes, extras.ranLanes);
        else if (k === 'altEmails') patch.altEmails = uniq([...(row.altEmails || []), ...extras.altEmails.filter(e => !emailsOfRow(row).includes(e))]);
        else if (k === 'bookedCount') patch.bookedCount = Math.max(Number(row.bookedCount) || 0, extras.bookedCount);
        else if (extras[k] !== '' && extras[k] !== undefined) patch[k] = extras[k];
      }
      // the carrier's number from the e-mails is kept in its own field when it differs from the phone you typed (yours stays in Phone)
      const mailPhone = extras.dispatchPhone || fmtPhone(phoneKey(c.phone));
      if (mailPhone && !row.dispatchPhone && phoneKey(row.phone) !== phoneKey(mailPhone)) patch.dispatchPhone = mailPhone; else delete patch.dispatchPhone;
      if (!row.originCity && !row.destCity && lastLane) { patch.originCity = lastLane.originCity; patch.originState = lastLane.originState; patch.destCity = lastLane.destCity; patch.destState = lastLane.destState; meta.originCity = { src: 'email', conf: conf[c.level] || 50, at: stamp }; }
      if (!String(row.rate ?? '').trim() && c.lastRate) { patch.rate = String(c.lastRate); meta.rate = { src: 'email', conf: conf[c.level] || 50, at: stamp }; }
      const real = Object.keys(fill).length || conflicts.length || (row.verified !== 'email') || (Number(row.bookedCount) || 0) < extras.bookedCount;
      patches.push({ id: row.id, name: row.carrierName || c.name, patch, fill, conflicts, candidate: c.key, rows: matches.length });
      if (!real) skipped.push({ key: c.key, name: c.name, why: 'already in the carrier database, nothing new to add' });
    } else {
      const meta = {};
      const rec = {
        originCity: lastLane ? lastLane.originCity : '', originState: lastLane ? lastLane.originState : '', destCity: lastLane ? lastLane.destCity : '', destState: lastLane ? lastLane.destState : '',
        carrierName: c.nameConf === 'low' && c.name && !c.mc ? c.name : c.name, mc: c.mc ? 'MC ' + c.mc : c.dot ? 'DOT ' + c.dot : '', email: c.email, phone: fmtPhone(phoneKey(c.dispatchPhone || c.phone)), equipment: c.equipment || '',
        preferredPickupDates: '', rate: c.lastRate ? String(c.lastRate) : '', lastCovered: new Date(c.lastBookedAt).toISOString(), coverCount: String(c.bookings.length), lastContacted: '', responseRate: '', status: 'Active',
        notes: 'Added from e-mail history (' + Math.round(c.score) + '% confidence, ' + c.bookings.length + ' booked load' + (c.bookings.length === 1 ? '' : 's') + ').',
        ...extras, source: 'email-history', addedAt: stamp,
      };
      for (const f of ['carrierName', 'mc', 'email', 'phone', 'equipment', 'rate', 'originCity']) if (rec[f]) meta[f] = { src: 'email', conf: conf[c.level] || 50, at: stamp };
      rec.fieldMeta = meta;
      adds.push({ ...rec, _cand: c.key });
    }
    // cover-log entries (verified bookings with a clear lane); duplicates of covers you already logged are skipped
    for (const b of c.bookings) {
      if (!b.lane || !levels.has(b.level)) continue;
      const dup = (ctx.coverLog || []).some(e => e.threadId === b.threadId || (e.outcome === 'Covered' && sameCarrier(e.carrier, c) && laneKeyOf({ originCity: (e.lane || {}).originCity, originState: (e.lane || {}).originState, destCity: (e.lane || {}).destCity, destState: (e.lane || {}).destState }) === laneKeyOf(b.lane) && Math.abs(Date.parse(e.closedAt) - b.at) <= 2 * DAY));
      if (dup) continue;
      covers.push({ candidate: c.key, threadId: b.threadId, at: b.at, lane: b.lane, rate: b.rateConf === 'high' ? b.rate : '', rateConf: b.rateConf, carrier: { name: c.name, email: c.email, mc: c.mc ? 'MC ' + c.mc : '', phone: fmtPhone(phoneKey(c.dispatchPhone || c.phone)) }, equip: b.equip || c.equipment || '', score: b.score, negotiationMinutes: b.negotiationMinutes, quotes: b.quotes, evidence: b.evidence });
    }
  }
  const have = new Set((ctx.history || []).map(t => t.id));
  const threads = (analysis.threads || []).filter(t => t.stage !== 'contacted' || t.responded).map(t => ({ ...t, scanned: stamp, imported: have.has(t.id) ? 'updated' : 'new' }));
  return { adds, patches, covers, threads, skipped, stats: { carriersAdded: adds.length, carriersUpdated: patches.filter(p => Object.keys(p.fill).length || p.patch.verified).length, conflicts: patches.reduce((n, p) => n + p.conflicts.length, 0), covers: covers.length, threads: threads.length, skipped: skipped.length } };
}
function sameCarrier(a, c) {
  if (!a) return false;
  const p = parseMcDot(a.mc), q = c.mc ? { num: c.mc } : null;
  if (p && q && p.num === q.num) return true;
  const e = emailOf(a.email); return !!e && (e === c.email || (c.emails || []).includes(e));
}
function mergeRanLanes(a = [], b = []) {
  const out = [...a]; const k = (l) => laneKeyOf(l);
  for (const l of b) { const i = out.findIndex(x => k(x) === k(l)); if (i < 0) out.push(l); else out[i] = { ...out[i], count: Math.max(out[i].count || 0, l.count || 0), lastAt: l.lastAt > out[i].lastAt ? l.lastAt : out[i].lastAt, lastRate: l.lastRate || out[i].lastRate }; }
  return out;
}

/** Cover-log record for one verified booking (same shape as buildCoverEntry so lane memory, ranking and statistics read it unchanged). */
export function coverEntryFor(c, { uid, zipMap = null, settings = {} } = {}) {
  const lane = c.lane;
  const miles = zipMap && zipMap.size ? (() => { try { const a = zipMap.market(lane.originCity, lane.originState), b = zipMap.market(lane.destCity, lane.destState); return a && b ? zipMap.distanceBetweenZips(a.zip, b.zip) * 1.15 : null; } catch { return null; } })() : null;
  return {
    id: uid(), closedAt: new Date(c.at).toISOString(), outcome: 'Covered', groupId: '', broker: '', laneClass: miles ? classForMiles(miles, settings) : '',
    lane: { ...lane }, covered: { variant: '', grid: '', originCity: lane.originCity, originState: lane.originState, destCity: lane.destCity, destState: lane.destState, datRate: '', targetRate: '', inquiryCount: 0, contact: '' },
    carrier: { id: '', name: c.carrier.name, email: c.carrier.email, mc: c.carrier.mc, phone: c.carrier.phone },
    rate: c.rate === '' ? '' : safeNumeric(c.rate), datRate: '', targetRate: '', pickup: '', equip: c.equip || '', postings: [], inquiries: c.quotes || 0, ageHours: '',
    note: 'Imported from e-mail history (' + Math.round(c.score) + '% confidence' + (c.rateConf === 'medium' ? ', rate not certain so it was left out' : '') + ').', rows: [],
    imported: true, source: 'email', threadId: c.threadId, fx: { v: 1, imported: true, negotiationMinutes: c.negotiationMinutes || 0 },
  };
}

export { encodeField };
