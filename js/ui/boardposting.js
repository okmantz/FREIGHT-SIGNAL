// "Post to other boards": TruckSmarter and Trucker Path. Builds the files and texts; nothing is sent by the app.
import { h, toast, modal, download, copyText, openExternal } from './dom.js';
import { state, actions } from '../store/state.js';
import { icon } from './icons.js';
import { BOARD_LINKS, boardSettings, trucksmarterCsv, tsFileName, tsEmailDraft, truckerPathCsv, tpFileName, postText } from '../core/boards.js';

const problemList = (r) => r.problems.length ? h('div', { class: 'banner' }, h('b', null, `${r.problems.length} posting${r.problems.length === 1 ? '' : 's'} left out:`),
  h('ul', null, r.problems.slice(0, 6).map(p => h('li', null, `${p.label || p.id}: needs ${p.missing.join(', ')}`)))) : null;

/** `members`: the postings to put on the other boards (one lane box, or the whole active board). */
export function openBoardPosting(members, { all } = {}) {
  const live = members.filter(p => p.status !== 'Covered');
  const ctx = { settings: state.settings, zip: state.zip, all: all || members };
  const b = boardSettings(state.settings);
  const ts = trucksmarterCsv(live, ctx), tp = truckerPathCsv(live, ctx);
  const fixes = h('div', { class: 'grid2' });
  const need = (key, label, ph) => { const i = h('input', { class: 'cell', value: b[key] || '', placeholder: ph, 'aria-label': label, 'data-live': '1' }); i.addEventListener('change', async () => { await actions.saveSettings({ boards: { ...(state.settings.boards || {}), [key]: i.value.trim() } }); toast('Saved. Reopen this window to refresh.', 'ok'); }); return h('label', { class: 'field' }, h('span', { class: 'lbl' }, label), i); };
  if (!b.contactPhone) fixes.append(need('contactPhone', 'Your phone (required by TruckSmarter)', '(312) 555-0100'));
  if (!b.contactEmail) fixes.append(need('contactEmail', 'Your e-mail', 'you@tql.com'));
  const section = (name, r, getName, extra) => h('div', { class: 'panel' }, h('h3', null, name), h('p', { class: 'muted' }, `${r.count} load${r.count === 1 ? '' : 's'} ready.`), problemList(r),
    r.notes.length ? h('ul', { class: 'muted small' }, r.notes.slice(0, 5).map(n => h('li', null, n))) : null,
    h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', disabled: !r.count, 'data-act': 'download-' + name.split(' ')[0].toLowerCase(), onclick: () => download(getName(), r.csv, 'text/csv;charset=utf-8') }, icon('download', 14), 'Download CSV'), extra));
  const tsExtra = [
    h('button', { class: 'btn', type: 'button', disabled: !ts.count, onclick: async () => { const d = tsEmailDraft(state.settings, ts.count); await copyText(`To: ${d.to}\nSubject: ${d.subject}\n\n${d.body}`, 'E-mail text copied. Attach the CSV you downloaded.'); } }, icon('mail', 14), 'Copy e-mail text'),
    h('button', { class: 'btn', type: 'button', onclick: () => openExternal(BOARD_LINKS.trucksmarter.site) }, icon('external', 14), 'TruckSmarter'),
  ];
  const tpExtra = [
    h('button', { class: 'btn', type: 'button', disabled: !tp.count, onclick: () => copyText(live.map(p => postText(p, ctx)).join('\n\n'), 'Post text copied.') }, icon('copy', 14), 'Copy post text'),
    h('button', { class: 'btn', type: 'button', onclick: () => openExternal(BOARD_LINKS.truckerpath.site) }, icon('external', 14), 'Trucker Path'),
  ];
  const tpt = h('textarea', { class: 'cell', rows: 2, placeholder: 'Optional: paste the header row of the Trucker Path upload template so the file matches it exactly', 'aria-label': 'Trucker Path template header row', 'data-live': '1' }); tpt.value = b.tpHeaders || '';
  tpt.addEventListener('change', async () => { await actions.saveSettings({ boards: { ...(state.settings.boards || {}), tpHeaders: tpt.value.trim() } }); toast('Template saved. Reopen this window to use it.', 'ok'); });
  modal({ title: 'Post to other load boards', wide: true, body: h('div', null,
    h('p', { class: 'muted' }, 'Freight Signal prepares the files; you upload them on each board. Delivery dates are estimates from the miles.'), fixes.children.length ? fixes : null,
    section('TruckSmarter', ts, tsFileName, tsExtra), section('Trucker Path', tp, tpFileName, tpExtra), h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Trucker Path template (optional)'), tpt)),
  actions: [{ label: 'Close' }] });
}
