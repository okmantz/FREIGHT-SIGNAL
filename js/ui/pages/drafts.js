import { h, download, confirmDialog, toast } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { draftCard, draftFile } from '../draftcard.js';
import { buildEml } from '../../core/eml.js';
import { makeZip } from '../../core/ziparchive.js';

export function render() {
  const d = state.drafts;
  return h('div', null,
    h('div', { class: 'pagehead' }, h('h2', null, 'Drafts'), h('p', null, 'Every outreach, inquiry-reply and rate-response draft. Freight Signal never sends mail.')),
    h('div', { class: 'banner ok' }, 'To use in Outlook: download the .eml (opens as an unsent draft with X-Unsent), or use "Download all (.zip)" and drag the files into your Outlook Drafts folder. You review and press Send.'),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', type: 'button', disabled: !d.length, onclick: () => {
        const used = new Set();
        const files = d.map((x, i) => { let n = draftFile(x); if (used.has(n)) n = n.replace(/\.eml$/, ` (${i}).eml`); used.add(n); return { name: n, data: buildEml(x) }; });
        download('freight-signal-drafts.zip', new Blob([makeZip(files)], { type: 'application/zip' }), 'application/zip'); toast(`${files.length} draft(s) zipped.`, 'ok');
      } }, 'Download all (.zip of .eml)'),
      h('button', { class: 'btn danger', type: 'button', disabled: !d.length, onclick: async () => { if (await confirmDialog('Clear drafts', `Remove all ${d.length} saved drafts from this app? (Nothing in Outlook is touched.)`, 'Clear')) actions.clearDrafts(); } }, 'Clear all'),
      h('span', { class: 'muted' }, `${d.length} draft(s)`)),
    d.length ? d.map(x => draftCard(x)) : h('p', { class: 'muted' }, 'No drafts yet.'));
}
