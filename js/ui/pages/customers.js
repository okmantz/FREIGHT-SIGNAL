import { h, toast, modal, confirmDialog, download, pickFile, readFileText, field, copyText } from '../dom.js';
import { pageHead, statTiles } from '../chrome.js';
import { state, actions } from '../../store/state.js';
import { CUSTOMER_HEADERS, CUSTOMER_KEYS } from '../../core/defaults.js';
import { toDelimited } from '../../core/csv.js';
import { tableToRecords } from '../importer.js';

let q = '';
const DAY = 86400000;
const csv = () => toDelimited([CUSTOMER_HEADERS, ...state.customers.map(c => CUSTOMER_KEYS.map(k => c[k] ?? ''))], ',');

function overview() {
  const cs = state.customers; const now = Date.now();
  const active = cs.filter(c => String(c.status || 'Active').toLowerCase() !== 'inactive').length;
  const companies = new Set(cs.map(c => String(c.company || '').trim().toLowerCase()).filter(Boolean)).size;
  const withEmail = cs.filter(c => String(c.email || '').trim()).length, withPhone = cs.filter(c => String(c.phone || '').trim()).length;
  const states = new Set(cs.map(c => String(c.state || '').trim().toUpperCase()).filter(Boolean)).size;
  const touched = cs.filter(c => { const t = Date.parse(c.lastContacted); return Number.isFinite(t) && now - t < 30 * DAY; }).length;
  const stale = cs.filter(c => { const t = Date.parse(c.lastContacted); return !Number.isFinite(t) || now - t >= 90 * DAY; }).length;
  return statTiles([[cs.length, 'Contacts'], [companies, 'Companies'], [touched, 'Contacted in 30 days'], [stale, 'Not contacted in 90+ days', stale ? 'act' : '']]);
}

function edit(c) {
  const rec = c ? { ...c } : Object.fromEntries(CUSTOMER_KEYS.map(k => [k, '']));
  if (!c) rec.status = 'Active';
  const inputs = {};
  const body = h('div', { class: 'grid3' }, CUSTOMER_KEYS.map((k, i) => { inputs[k] = h('input', { value: rec[k] ?? '' }); return field(CUSTOMER_HEADERS[i], inputs[k]); }));
  modal({ title: c ? 'Edit customer' : 'Add customer', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
    for (const k of CUSTOMER_KEYS) rec[k] = inputs[k].value.trim();
    if (!rec.company && !rec.contactName && !rec.email) { toast('Enter at least a company, a contact name or an e-mail.', 'err'); return false; }
    await actions.saveCustomer(rec);
  } }] });
}

function importDialog() {
  const ta = h('textarea', { placeholder: 'Paste rows copied from Excel (with or without the header row), or choose a CSV/TSV file below.' });
  const note = h('p', { class: 'muted' }, `Columns: ${CUSTOMER_HEADERS.join(' | ')}`);
  const mode = h('select', null, h('option', { value: 'append' }, 'Add to existing customers'), h('option', { value: 'replace' }, 'Replace all customers'));
  modal({
    title: 'Import customers', wide: true,
    body: h('div', null, note, ta, h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: async () => { const f = await pickFile('.csv,.tsv,.txt'); if (f) ta.value = await readFileText(f); } }, 'Choose file…'), mode)),
    actions: [{ label: 'Cancel' }, { label: 'Import', kind: 'primary', onClick: async () => {
      const { rows, note: n } = tableToRecords(ta.value, CUSTOMER_HEADERS, CUSTOMER_KEYS);
      if (!rows.length) { toast('Nothing to import.', 'warn'); return false; }
      if (mode.value === 'replace' && !(await confirmDialog('Replace customers', `This deletes all ${state.customers.length} current customers first. Continue?`, 'Replace'))) return false;
      const count = await actions.importCustomers(rows, mode.value); toast(`${count} customer(s) imported. ${n}`, 'ok', 7000);
    } }],
  });
}

export function render() {
  const rows = state.customers.filter(c => !q || CUSTOMER_KEYS.some(k => String(c[k] ?? '').toLowerCase().includes(q.toLowerCase())));
  const search = h('input', { type: 'search', placeholder: 'Search customers…', value: q, 'data-rerender': '' });
  search.addEventListener('input', () => { q = search.value; });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') import('../../main.js').then(m => m.render()); });
  return h('div', null,
    pageHead({ icon: 'customers', title: 'Customer Database', sub: 'Shippers and customer contacts. Import them from Excel the same way as carriers. Stored only in this browser.' }),
    overview(),
    h('div', { class: 'toolbar' }, search,
      h('button', { class: 'btn primary', type: 'button', onclick: () => edit(null) }, 'Add customer'),
      h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'Import…'),
      h('button', { class: 'btn', type: 'button', disabled: !state.customers.length, onclick: () => download('customer-database.csv', '﻿' + csv(), 'text/csv;charset=utf-8') }, 'Export CSV'),
      h('button', { class: 'btn', type: 'button', disabled: !state.customers.length, onclick: () => copyText(toDelimited([CUSTOMER_HEADERS, ...state.customers.map(c => CUSTOMER_KEYS.map(k => c[k] ?? ''))], '\t'), 'Copied (paste into Excel).') }, 'Copy for Excel'),
      h('span', { class: 'muted' }, `${rows.length} of ${state.customers.length}`)),
    h('div', { class: 'tablewrap' }, h('table', { class: 'carrier' },
      h('thead', null, h('tr', null, h('th', null, ''), CUSTOMER_HEADERS.map(x => h('th', null, x)))),
      h('tbody', null, rows.length ? rows.map(c => h('tr', null,
        h('td', null, h('div', { class: 'rowact' },
          h('button', { class: 'btn small', type: 'button', onclick: () => edit(c) }, 'Edit'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete customer', `Delete ${c.company || c.contactName || c.email}?`, 'Delete')) actions.deleteCustomer(c.id); } }, '✕'))),
        CUSTOMER_KEYS.map(k => h('td', null, c[k] ?? '')))) :
        h('tr', null, h('td', { colspan: CUSTOMER_KEYS.length + 1, class: 'muted' }, 'No customers yet. Add one, or import your contact list from Excel.'))))));
}
