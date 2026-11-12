// A reviewable draft. Nothing here sends mail: every action either saves a file, opens the user's own mail client
// with a pre-filled compose window (user presses Send), or copies text.
import { h, download, copyText, openExternal } from './dom.js';
import { buildEml, mailtoUrl, owaComposeUrl, safeFileName } from '../core/eml.js';
import { actions, state } from '../store/state.js';

export const draftFile = (d) => safeFileName((d.kind || 'draft') + ' ' + (d.to || '') + ' ' + (d.subject || '')) + '.eml';

export function draftCard(d, { removable = true } = {}) {
  const wrap = h('div', { class: 'draft' },
    h('div', { class: 'meta' },
      h('b', null, d.to || '(no recipient)'), d.kind ? h('span', { class: 'pill' }, d.kind) : null,
      d.tier ? h('span', { class: 'pill alt' }, d.tier) : null,
      d.outlook === 'saved' ? h('span', { class: 'pill ok', title: 'The Outlook macro created this draft in your Drafts folder' }, 'In Outlook Drafts') : null,
      d.outlook === 'queued' ? h('span', { class: 'pill', title: 'Waiting for Outlook to pick it up (click into Outlook, or run FS_DraftsNow)' }, 'Queued for Outlook') : null,
      d.outlook === 'error' ? h('span', { class: 'pill err', title: d.outlookDetail || 'Outlook could not create the draft' }, 'Outlook error') : null),
    h('div', null, h('small', null, 'Subject: '), d.subject),
    h('pre', { class: 'mono' }, d.body),
    h('div', { class: 'toolbar' },
      state.hooks && state.hooks.sendToOutlook && d.id && d.to && d.outlook !== 'saved' && d.outlook !== 'queued'
        ? h('button', { class: 'btn small primary', type: 'button', 'data-act': 'to-outlook', title: 'Create this as a draft in your Outlook Drafts folder (nothing is sent)', onclick: async (e) => { const n = await actions.sendDraftsToOutlook([d.id]); e.currentTarget.textContent = n ? 'Queued for Outlook' : 'Not queued'; e.currentTarget.disabled = true; } }, 'Save to Outlook Drafts') : null,
      h('button', { class: 'btn small primary', type: 'button', title: 'Opens in Outlook as an unsent draft', onclick: () => download(draftFile(d), buildEml(d), 'message/rfc822') }, 'Download .eml'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { window.location.href = mailtoUrl(d); } }, 'Open in mail app'),
      h('button', { class: 'btn small', type: 'button', onclick: () => openExternal(owaComposeUrl(d)) }, 'Outlook on the web'),
      h('button', { class: 'btn small', type: 'button', onclick: () => copyText(`To: ${d.to}\nSubject: ${d.subject}\n\n${d.body}`) }, 'Copy'),
      removable && d.id ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => { await actions.removeDraft(d.id); wrap.remove(); } }, 'Remove') : null));
  return wrap;
}
