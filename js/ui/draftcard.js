// A reviewable draft. Nothing here sends mail: every action either saves a file, opens the user's own mail client
// with a pre-filled compose window (user presses Send), or copies text.
import { h, download, copyText, openExternal } from './dom.js';
import { buildEml, mailtoUrl, owaComposeUrl, safeFileName } from '../core/eml.js';
import { actions } from '../store/state.js';

export const draftFile = (d) => safeFileName((d.kind || 'draft') + ' ' + (d.to || '') + ' ' + (d.subject || '')) + '.eml';

export function draftCard(d, { removable = true } = {}) {
  const wrap = h('div', { class: 'draft' },
    h('div', { class: 'meta' },
      h('b', null, d.to || '(no recipient)'), d.kind ? h('span', { class: 'pill' }, d.kind) : null,
      d.tier ? h('span', { class: 'pill alt' }, d.tier) : null),
    h('div', null, h('small', null, 'Subject: '), d.subject),
    h('pre', { class: 'mono' }, d.body),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn small primary', type: 'button', title: 'Opens in Outlook as an unsent draft', onclick: () => download(draftFile(d), buildEml(d), 'message/rfc822') }, 'Download .eml'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { window.location.href = mailtoUrl(d); } }, 'Open in mail app'),
      h('button', { class: 'btn small', type: 'button', onclick: () => openExternal(owaComposeUrl(d)) }, 'Outlook on the web'),
      h('button', { class: 'btn small', type: 'button', onclick: () => copyText(`To: ${d.to}\nSubject: ${d.subject}\n\n${d.body}`) }, 'Copy'),
      removable && d.id ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await actions.removeDraft(d.id); wrap.remove(); } }, 'Remove') : null));
  return wrap;
}
