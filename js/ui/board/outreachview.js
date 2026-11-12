// Result dialogs for outreach: the drafts (never sent), and the call list.
import { h, modal, toast, copyText } from '../dom.js';
import { state } from '../../store/state.js';
import { draftCard } from '../draftcard.js';
import { callList } from '../../core/ranking.js';

export function summaryOutreach(res) {
  const body = [h('p', null, res.detail || '')];
  if (res.error) body.push(h('div', { class: 'banner err' }, res.error));
  const queued = (res.drafts || []).some(d => d.outlook);
  body.push(h('div', { class: 'banner ok' }, queued
    ? 'These drafts were handed to Outlook and will appear in your Drafts folder in a few seconds (Outlook picks them up when you click into it, when mail arrives, or when you run FS_DraftsNow). Nothing is ever sent for you.'
    : 'These are DRAFTS only. Nothing has been sent. Download the .eml files (they open in Outlook as unsent drafts) or open each in your mail app and press Send yourself. Connect Outlook in System to have them saved straight into your Drafts folder.'));
  (res.drafts || []).forEach(d => body.push(draftCard(d)));
  modal({ title: `Carrier outreach: ${res.created ?? (res.drafts || []).length} draft(s)`, body, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
}

/** "Start calling out": best-ranked carriers that have a phone number. */
export function callListModal(box) {
  const list = callList(box.head, state.carriers, { zip: state.zip, settings: state.settings, coverLog: state.coverLog, inquiries: state.inquiries }, 12);
  const body = list.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'lanetable' },
    h('thead', null, h('tr', null, ['Carrier', 'Phone', 'Why', ''].map(x => h('th', null, x)))),
    h('tbody', null, list.map(r => h('tr', null,
      h('td', null, h('b', null, r.carrier.carrierName || r.carrier.email || '(unnamed)')),
      h('td', { class: 'mono' }, r.carrier.phone),
      h('td', { class: 'muted small' }, `${r.tierLabel}: ${r.reasons.join('; ')}`),
      h('td', null, h('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.carrier.phone, 'Phone number copied.') }, 'Copy')))))))
    : h('p', { class: 'muted' }, 'No carrier in the database that fits this lane has a phone number. Add phone numbers in the Carrier Database, or call the carriers that replied (Inquiry Log).');
  modal({ title: `Call list: ${box.title}`, body, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
  if (list.length) toast(`${list.length} carriers with phone numbers, best match first.`, 'info');
  return list.length;
}
