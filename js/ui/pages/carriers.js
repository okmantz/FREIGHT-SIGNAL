import { h, toast, modal, confirmDialog, download, pickFile, readFileText, inputEl, field, copyText } from '../dom.js';
import { pageHead, emptyState, statTiles } from '../chrome.js';
import { summaryOutreach } from '../board/outreachview.js';
import { topCarriersByCovers, weekStart } from '../../core/coverlog.js';
import { icon } from '../icons.js';
import { state, actions } from '../../store/state.js';
import { CARRIER_HEADERS, CARRIER_KEYS } from '../../core/defaults.js';
import { toDelimited } from '../../core/csv.js';
import { tableToRecords } from '../importer.js';

let q = '';
const DAY = 86400000;

function overview() {
  const cs = state.carriers; const now = Date.now();
  const active = cs.filter(c => String(c.status || 'Active').toLowerCase() !== 'inactive');
  const withEmail = cs.filter(c => String(c.email || '').trim()).length, withPhone = cs.filter(c => String(c.phone || '').trim()).length;
  const covers = cs.reduce((n, c) => n + (Number(c.coverCount) || 0), 0);
  const wk = weekStart(new Date(now)).getTime();   // the week starts Monday 12:00 AM, same as the cover pace tracker
  const recent = cs.filter(c => { const t = Date.parse(c.lastContacted); return Number.isFinite(t) && t >= wk; }).length;
  const never = cs.filter(c => !Date.parse(c.lastContacted)).length;
  const states = new Set(cs.flatMap(c => [c.originState, c.destState]).map(x => String(x || '').trim().toUpperCase()).filter(Boolean)).size;
  const top = topCarriersByCovers(state.coverLog, 3).map(t => { const c = cs.find(x => String(x.email || '').toLowerCase() === t.email); return `${(c && c.carrierName) || t.email} (${t.covers})`; });
  return h('div', null, statTiles([[cs.length, 'Carriers'], [withEmail, 'With e-mail'], [recent, 'Contacted this week'], [never, 'Never contacted', never ? 'act' : '']]),
    top.length ? h('p', { class: 'muted small topline' }, icon('trendup', 14), ' Top carriers in your Cover Log: ' + top.join(', ')) : null);
}

/** One-click "Do you have any trucks available?" drafts (never sent; saved to Outlook Drafts when Outlook is connected). */
async function truckCheck(list) {
  const withMail = list.filter(c => String(c.email || '').trim());
  if (!withMail.length) return toast('Those carriers have no e-mail address.', 'warn');
  if (withMail.length > 1 && !(await confirmDialog('Truck check', `Create ${withMail.length} "Do you have any trucks available?" drafts? Nothing is sent. You can change the wording in System > Email wording.`, 'Create drafts'))) return;
  const made = await actions.truckCheck(withMail.map(c => c.id));
  summaryOutreach({ detail: `${made.length} truck-availability draft(s). Wording: System > Email wording.`, drafts: made, created: made.length });
}

const csv = () => toDelimited([CARRIER_HEADERS, ...state.carriers.map(c => CARRIER_KEYS.map(k => c[k] ?? ''))], ',');

function edit(c) {
  const rec = c ? { ...c } : Object.fromEntries(CARRIER_KEYS.map(k => [k, '']));
  if (!c) rec.status = 'Active';
  const inputs = {};
  const body = h('div', { class: 'grid3' }, CARRIER_KEYS.map((k, i) => { inputs[k] = h('input', { value: rec[k] ?? '' }); return field(CARRIER_HEADERS[i], inputs[k]); }));
  modal({ title: c ? 'Edit carrier' : 'Add carrier', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
    for (const k of CARRIER_KEYS) rec[k] = inputs[k].value.trim();
    if (!rec.email) { toast('Email is required (outreach is addressed to it).', 'err'); return false; }
    await actions.saveCarrier(rec);
  } }] });
}

function importDialog() {
  const ta = h('textarea', { placeholder: 'Paste rows copied from Excel (with or without the header row), or choose a CSV/TSV file below.' });
  const note = h('p', { class: 'muted' }, `Columns: ${CARRIER_HEADERS.join(' | ')}`);
  const mode = h('select', null, h('option', { value: 'append' }, 'Add to existing carriers'), h('option', { value: 'replace' }, 'Replace all carriers'));
  modal({
    title: 'Import carriers', wide: true,
    body: h('div', null, note, ta, h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: async () => { const f = await pickFile('.csv,.tsv,.txt'); if (f) ta.value = await readFileText(f); } }, 'Choose file…'), mode)),
    actions: [{ label: 'Cancel' }, { label: 'Import', kind: 'primary', onClick: async () => {
      const { rows, note: n } = tableToRecords(ta.value, CARRIER_HEADERS, CARRIER_KEYS);
      if (!rows.length) { toast('Nothing to import.', 'warn'); return false; }
      if (mode.value === 'replace' && !(await confirmDialog('Replace carriers', `This deletes all ${state.carriers.length} current carriers first. Continue?`, 'Replace'))) return false;
      const count = await actions.importCarriers(rows, mode.value); toast(`${count} carrier(s) imported. ${n}`, 'ok', 7000);
    } }],
  });
}

export function render() {
  const rows = state.carriers.filter(c => !q || CARRIER_KEYS.some(k => String(c[k] ?? '').toLowerCase().includes(q.toLowerCase())));
  const search = h('input', { type: 'search', placeholder: 'Search carriers…', value: q, 'data-rerender': '' });
  search.addEventListener('input', () => { q = search.value; });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') import('../../main.js').then(m => m.render()); });
  return h('div', null,
    pageHead({ icon: 'carriers', title: 'Carrier Database', sub: 'Approved carriers used by outreach. Stored only in this browser. Use the Truck? button to ask any carrier if they have trucks available.' }),
    overview(),
    h('div', { class: 'toolbar' }, search,
      h('button', { class: 'btn primary', type: 'button', onclick: () => edit(null) }, 'Add carrier'),
      h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'Import…'),
      h('button', { class: 'btn', type: 'button', disabled: !rows.length, title: 'Draft a truck-availability e-mail to every carrier shown (with an e-mail address)', onclick: () => truckCheck(rows) }, icon('mail', 15), `Truck check (${rows.filter(c => String(c.email || '').trim()).length})`),
      h('button', { class: 'btn', type: 'button', disabled: !state.carriers.length, onclick: () => download('carrier-database.csv', '﻿' + csv(), 'text/csv;charset=utf-8') }, 'Export CSV'),
      h('button', { class: 'btn', type: 'button', disabled: !state.carriers.length, onclick: () => copyText(toDelimited([CARRIER_HEADERS, ...state.carriers.map(c => CARRIER_KEYS.map(k => c[k] ?? ''))], '\t'), 'Copied (paste into Excel).') }, 'Copy for Excel'),
      h('span', { class: 'muted' }, `${rows.length} of ${state.carriers.length}`)),
    h('div', { class: 'tablewrap' }, h('table', { class: 'carrier' },
      h('thead', null, h('tr', null, h('th', null, ''), CARRIER_HEADERS.map(x => h('th', null, x)))),
      h('tbody', null, rows.length ? rows.map(c => h('tr', null,
        h('td', null, h('div', { class: 'rowact' },
          h('button', { class: 'btn small primary', type: 'button', 'data-act': 'truck', title: 'Draft "Do you have any trucks available?" to this carrier', disabled: !String(c.email || '').trim(), onclick: () => truckCheck([c]) }, 'Truck?'),
          h('button', { class: 'btn small', type: 'button', onclick: () => edit(c) }, 'Edit'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete carrier', `Delete ${c.carrierName || c.email}?`, 'Delete')) actions.deleteCarrier(c.id); } }, '✕'))),
        CARRIER_KEYS.map(k => h('td', null, c[k] ?? '')))) :
        h('tr', null, h('td', { colspan: 18, class: 'muted' }, 'No carriers yet. Add one, import from Excel, or approve a sender in the Inquiry Log.'))))));
}
