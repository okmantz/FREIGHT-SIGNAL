import { h, download, confirmDialog, toast } from '../dom.js';
import { pageHead, emptyState } from '../chrome.js';
import { state, actions } from '../../store/state.js';
import { draftCard, draftFile } from '../draftcard.js';
import { buildEml } from '../../core/eml.js';
import { makeZip } from '../../core/ziparchive.js';

export function render() {
  const d = state.drafts;
  return h('div', null,
    pageHead({ icon: 'drafts', title: 'Drafts', sub: 'Every outreach, inquiry-reply and rate-response draft. Freight Signal never sends mail.' }),
    h('div', { class: 'banner ok' }, 'To use in Outlook: download the .eml (opens as an unsent draft with X-Unsent), or use "Download all (.zip)" and drag the files into your Outlook Drafts folder. You review and press Send.'),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', type: 'button', disabled: !d.length, onclick: () => {
        const used = new Set();
        const files = d.map((x, i) => { let n = draftFile(x); if (used.has(n)) n = n.replace(/\.eml$/, ` (${i}).eml`); used.add(n); return { name: n, data: buildEml(x) }; });
        download('freight-signal-drafts.zip', new Blob([makeZip(files)], { type: 'application/zip' }), 'application/zip'); toast(`${files.length} draft(s) zipped.`, 'ok');
      } }, 'Download all (.zip of .eml)'),
      state.hooks.sendToOutlook ? h('button', { class: 'btn', type: 'button', 'data-act': 'all-to-outlook', disabled: !d.some(x => x.to && !x.outlook), title: 'Create every draft that is not yet in Outlook as a draft in your Outlook Drafts folder', onclick: async () => { const n = await actions.sendDraftsToOutlook(d.filter(x => x.to && !x.outlook).map(x => x.id)); toast(n ? `${n} draft(s) queued for Outlook.` : 'Nothing to queue.', n ? 'ok' : 'info'); } }, 'Save all to Outlook Drafts') : null,
      h('button', { class: 'btn danger', type: 'button', disabled: !d.length, onclick: async () => { if (await confirmDialog('Clear drafts', `Remove all ${d.length} saved drafts from this app? (Nothing in Outlook is touched.)`, 'Clear')) actions.clearDrafts(); } }, 'Clear all'),
      h('span', { class: 'muted' }, `${d.length} draft(s)`)),
    d.length ? d.map(x => draftCard(x)) : emptyState({ icon: 'drafts', title: 'No drafts yet', text: 'Run carrier outreach from the board and the drafts will collect here.' }));
}
