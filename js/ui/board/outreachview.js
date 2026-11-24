// Result dialogs for outreach: the drafts (never sent), and the call list.
import { h, modal, toast, copyText } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { draftCard } from '../draftcard.js';
import { callList } from '../../core/ranking.js';
import { icon } from '../icons.js';
import { callKeyOf, callState, callCooling, CALL_RESULTS } from '../../core/autorescue.js';

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

/**
 * "Start calling out": best-ranked carriers that have a phone number. Primary and backup carriers carry the gold star and come first.
 * After each call, pick what happened: it is remembered for this load (Auto Rescue leaves out "No truck" and does not re-dial a no-answer for 3 hours).
 */
export function callListModal(box) {
  const head = box.head; const now = Date.now();
  const list = callList(head, state.carriers, { zip: state.zip, settings: state.settings, coverLog: state.coverLog, inquiries: state.inquiries, assignments: state.assignments }, 14);
  const done = callState(head);
  const cooling = (r) => !!callCooling(done.get(callKeyOf(r.carrier)), now);
  const rows = [...list.filter(r => !cooling(r)), ...list.filter(cooling)];
  const chip = (res) => { const lab = (CALL_RESULTS.find(x => x[0] === res) || [])[1] || res; return h('span', { class: 'dir-chip ' + (res === 'truck' ? 'ok' : res === 'notruck' ? 'bad' : 'warn') }, lab); };
  const outcome = (r) => {
    const key = callKeyOf(r.carrier); const prior = done.get(key); const cell = h('span', { class: 'rs-call-out' });
    const sel = h('select', { class: 'cell dir-sel', 'aria-label': 'Log the call with ' + (r.carrier.carrierName || 'this carrier'), 'data-act': 'log-call' }, h('option', { value: '' }, 'Log call…'), CALL_RESULTS.map(([v, l]) => h('option', { value: v }, l)));
    sel.addEventListener('change', async () => { const v = sel.value; if (!v) return; await actions.logCall(head.id, { key, name: r.carrier.carrierName, phone: r.carrier.phone, carrierId: r.carrier.id }, v); cell.replaceChildren(chip(v)); toast(v === 'truck' ? 'Logged. Send them the load details and rate now.' : 'Logged.', 'ok'); });
    if (prior && callCooling(prior, now)) cell.append(chip(prior.result)); else cell.append(sel);
    return cell;
  };
  const body = rows.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'lanetable' },
    h('thead', null, h('tr', null, ['Carrier', 'Phone', 'Why', 'How did it go?', ''].map(x => h('th', null, x)))),
    h('tbody', null, rows.map(r => h('tr', { class: cooling(r) ? 'dim' : '' },
      h('td', null, r.primary ? h('span', { class: 'pstar inline ' + r.primary, title: (r.primary === 'backup' ? 'Backup' : 'Primary') + ' carrier for this lane' }, icon('star', 9)) : null, h('b', null, r.carrier.carrierName || r.carrier.email || '(unnamed)')),
      h('td', { class: 'mono' }, h('a', { class: 'xlink', href: 'tel:' + String(r.carrier.phone).replace(/[^\d+]/g, '') }, r.carrier.phone)),
      h('td', { class: 'muted small' }, `${r.tierLabel}: ${r.reasons.join('; ')}`),
      h('td', null, outcome(r)),
      h('td', null, h('button', { class: 'btn small', type: 'button', onclick: () => copyText(r.carrier.phone, 'Phone number copied.') }, 'Copy')))))))
    : h('p', { class: 'muted' }, 'No carrier in the database that fits this lane has a phone number. Add phone numbers in the Carrier Database, or call the carriers that replied (Inquiry Log).');
  modal({ title: `Call list: ${box.title}`, body, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
  if (list.length) toast(`${list.length} carriers with phone numbers, ${list.some(r => r.primary) ? 'primary carriers first, then ' : ''}best match first.`, 'info');
  return list.length;
}
