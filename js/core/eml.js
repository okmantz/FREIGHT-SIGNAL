// Draft hand-off formats. Nothing here sends mail.
//  1. .eml with "X-Unsent: 1"  - Outlook (desktop) opens it as an editable, unsent draft. Drag many into the Drafts folder.
//  2. mailto: link              - opens the default mail client compose window (length-limited by the client).
//  3. Outlook on the web deep link (documented compose URL).
//  4. Copy to clipboard.

import { CRLF } from './util.js';

const b64 = (str) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  const bytes = new TextEncoder().encode(str);
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

const needsEncoding = (s) => /[^\x20-\x7E]/.test(s);
const encodeHeader = (s) => (needsEncoding(s) ? '=?UTF-8?B?' + b64(s) + '?=' : s);

export function buildEml({ to, subject, body, date = new Date() }) {
  const wrapped = (b64(String(body ?? '').replace(/\r?\n/g, CRLF)).match(/.{1,76}/g) || []).join(CRLF);
  return [
    'X-Unsent: 1',
    'To: ' + to,
    'Subject: ' + encodeHeader(subject ?? ''),
    'Date: ' + date.toUTCString().replace('GMT', '+0000'),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped,
    '',
  ].join(CRLF);
}

export function mailtoUrl({ to, subject, body }) {
  const enc = (s) => encodeURIComponent(String(s ?? '').replace(/\r?\n/g, CRLF));
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${enc(subject)}&body=${enc(body)}`;
}

export function owaComposeUrl({ to, subject, body }) {
  const enc = (s) => encodeURIComponent(String(s ?? ''));
  return `https://outlook.office.com/mail/deeplink/compose?to=${enc(to)}&subject=${enc(subject)}&body=${enc(body)}`;
}

export function safeFileName(s) {
  return String(s ?? 'draft').replace(/[^A-Za-z0-9._ -]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'draft';
}
