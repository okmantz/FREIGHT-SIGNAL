import { h, toast, modal, confirmDialog, download, pickFile, readFileText, field, copyText } from '../dom.js';
import { pageHead, statTiles, emptyState } from '../chrome.js';
import { state, actions } from '../../store/state.js';
import { CUSTOMER_HEADERS, CUSTOMER_KEYS } from '../../core/defaults.js';
import { toDelimited } from '../../core/csv.js';
import { tableToRecords } from '../importer.js';
import { storedWhere } from '../../store/cloud.js';
import { createTableSort } from '../tablesort.js';
import { telHref, mailHref } from '../../core/resources.js';
import { icon } from '../icons.js';
import { avatar, marked, statusPill, whenCell, segmented, searchBox, moreMenu, filterSelect, expandRows, groupRow, groupBy, detailCard, contactStack, DAY, relDate } from '../directory.js';
import { searchRecords, parseQuery, customerSpec } from '../../core/search.js';

let q = '';
const rerender = () => import('../../main.js').then(m => m.render());
let relevance = true;                                                    // with a search typed, best match first until a column header is clicked
const sorter = createTableSort(() => { relevance = false; rerender(); });   // click a header: A-Z, Z-A, random
const SPEC = customerSpec();
let view = 'all', groupKey = 'company';
const F = { state: '', status: '' };
const open = new Set();
const csv = () => toDelimited([CUSTOMER_HEADERS, ...state.customers.map(c => CUSTOMER_KEYS.map(k => c[k] ?? ''))], ',');

const statusOf = (c) => String(c.status || 'Active').trim();
const age = (c) => { const t = Date.parse(c.lastContacted); return Number.isFinite(t) ? (Date.now() - t) / DAY : Infinity; };
const VIEWS = { all: () => true, active: (c) => statusOf(c).toLowerCase() !== 'inactive', recent: (c) => age(c) < 30, stale: (c) => age(c) >= 90 };
const uniq = (l) => [...new Set(l)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
const passes = (c) => VIEWS[view](c) && (!F.state || String(c.state || '').trim().toUpperCase() === F.state) && (!F.status || statusOf(c).toLowerCase() === F.status.toLowerCase());
const GROUPS = { '': null, company: (c) => c.company || 'No company', state: (c) => String(c.state || '').trim().toUpperCase() || 'No state', status: statusOf };
const nameOf = (c) => c.contactName || c.company || c.email || '(no name)';

function overview() {
  const cs = state.customers; const now = Date.now();
  const companies = new Set(cs.map(c => String(c.company || '').trim().toLowerCase()).filter(Boolean)).size;
  const touched = cs.filter(c => age(c) < 30).length, stale = cs.filter(c => age(c) >= 90).length;
  return statTiles([[cs.length, 'Contacts'], [companies, 'Companies'], [touched, 'Contacted in 30 days'], [stale, 'Not contacted in 90+ days', stale ? 'act' : '']]);
}

function row(c, terms = []) {
  const place = [c.city, c.state].filter(Boolean).join(', ');
  const cells = [
    h('td', { class: 'c-name' }, h('div', { class: 'dir-id' }, avatar(c.company || nameOf(c), { square: true }),
      h('div', { class: 't' }, h('b', { title: c.company }, marked(c.company || nameOf(c), terms)), h('small', null, marked(c.company ? (c.contactName || c.title || '') : (c.title || ''), terms))))),
    h('td', null, contactStack(c, { telHref, mailHref })),
    h('td', null, place || h('span', { class: 'dir-none' }, '—')),
    h('td', null, whenCell(c.lastContacted)),
    h('td', null, statusPill(statusOf(c))),
    h('td', { class: 'c-act' }, h('div', { class: 'rowact' }, h('button', { class: 'btn small', type: 'button', 'aria-label': 'Edit customer', title: 'Edit', onclick: () => edit(c) }, icon('edit', 14)))),
  ];
  const shown = new Set(['company', 'contactName', 'email', 'phone', 'city', 'state', 'lastContacted', 'status', 'notes']);
  const extra = CUSTOMER_KEYS.map((k, i) => [CUSTOMER_HEADERS[i], c[k], k]).filter(([, v, k]) => !shown.has(k) && String(v ?? '').trim()).map(([l, v]) => [l, v]);
  return { id: c.id, cells, detail: detailCard({ fields: [['Last contacted', c.lastContacted ? relDate(c.lastContacted) : ''], ...extra], notes: c.notes, actions: [
    h('button', { class: 'btn small', type: 'button', onclick: () => edit(c) }, icon('edit', 14), 'Edit all fields'),
    h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete customer', `Delete ${c.company || c.contactName || c.email}?`, 'Delete')) actions.deleteCustomer(c.id); } }, icon('trash', 14), 'Delete')] }) };
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
  const base = state.customers.filter(passes);
  const found = q.trim() ? searchRecords(base, q, SPEC) : { results: [], partial: false, terms: [] };
  const terms = q.trim() ? parseQuery(q, SPEC.aliases).terms : [];
  const rows = q.trim() ? (relevance ? found.results.map(r => r.record) : sorter.sort(found.results.map(r => r.record), (c, k) => c[k])) : sorter.sort(base, (c, k) => c[k]);
  const cs = state.customers; const count = (k) => cs.filter(VIEWS[k]).length;
  const COLS = [['company', 'Company'], ['email', 'Contact'], ['state', 'Location'], ['lastContacted', 'Last contacted'], ['status', 'Status']];
  const body = []; const gf = q.trim() && relevance ? null : GROUPS[groupKey];   // grouping sorts by name, so it waits while results are ranked by best match
  if (gf && rows.length) { for (const [name, list] of groupBy(rows, gf)) { body.push(groupRow(name, list.length, 6)); body.push(...expandRows(list.map(c => row(c, terms)), open, 6)); } }
  else body.push(...expandRows(rows.map(c => row(c, terms)), open, 6));
  const on = Object.values(F).some(Boolean) || view !== 'all' || q;
  return h('div', null,
    pageHead({ icon: 'customers', title: 'Customer Database', sub: 'Shippers and customer contacts, grouped by company. Click a row to open it. ' + storedWhere() }),
    !cs.length ? emptyState({ icon: 'customers', title: 'No customers yet', text: 'Import your shipper contact list from Excel or CSV, or add a customer by hand.',
      actions: [h('button', { class: 'btn primary', type: 'button', onclick: () => edit(null) }, 'Add customer'), h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'Import from Excel / CSV')] }) : overview(),
    !cs.length ? null : [
      h('div', { class: 'dir-bar' }, searchBox(q, 'Search company, contact, phone, e-mail, city…', (v) => { if (v !== q) relevance = true; q = v; }, rerender),
        segmented([['all', 'All', count('all')], ['active', 'Active', count('active')], ['recent', 'Contacted lately', count('recent')], ['stale', 'Gone quiet', count('stale')]], view, (v) => { view = v; rerender(); }, 'Quick views'),
        h('div', { class: 'dir-acts' },
          h('button', { class: 'btn primary', type: 'button', 'data-act': 'add-customer', onclick: () => edit(null) }, icon('plus', 15), 'Add customer'),
          moreMenu('More', [['Import from Excel / CSV…', 'upload', importDialog], ['Export CSV', 'download', () => download('customer-database.csv', '﻿' + csv(), 'text/csv;charset=utf-8')],
            ['Copy for Excel', 'copy', () => copyText(toDelimited([CUSTOMER_HEADERS, ...cs.map(c => CUSTOMER_KEYS.map(k => c[k] ?? ''))], '\t'), 'Copied (paste into Excel).')]]))),
      h('div', { class: 'dir-filters' }, h('span', { class: 'lbl' }, 'Filter'),
        filterSelect('Any state', uniq(cs.map(c => String(c.state || '').trim().toUpperCase()).filter(Boolean)).map(x => [x]), F.state, (v) => { F.state = v; rerender(); }, 'state'),
        filterSelect('Any status', uniq(cs.map(statusOf)).map(x => [x]), F.status, (v) => { F.status = v; rerender(); }, 'status'),
        h('span', { class: 'lbl' }, 'Group by'),
        filterSelect('No grouping', [['company', 'Company'], ['state', 'State'], ['status', 'Status']], groupKey, (v) => { groupKey = v; rerender(); }, 'group'),
        on ? h('button', { class: 'btn small', type: 'button', onclick: () => { F.state = F.status = ''; view = 'all'; q = ''; rerender(); } }, 'Clear filters') : null),
      h('div', { class: 'dir-count' }, h('span', null, `${rows.length} of ${cs.length}`), q.trim() && found.partial ? h('span', { class: 'dir-hint warn' }, 'No customer matches every word. Showing the closest matches.') : q.trim() && found.terms.length ? h('span', { class: 'dir-hint' }, relevance && !sorter.state ? [h('b', null, 'Best match first.'), ' Click a column header to sort instead.'] : relevance ? [h('b', null, 'Best match first.')] : h('button', { class: 'linkbtn', type: 'button', onclick: () => { relevance = true; rerender(); } }, 'Sort by best match')) : null),
      h('div', { class: 'dirwrap tablewrap' }, h('table', { class: 'carrier dirtable' },
        h('thead', null, h('tr', null, COLS.map(([k, l]) => sorter.th(k, l)), h('th', null, ''))),
        h('tbody', null, rows.length ? body : h('tr', null, h('td', { colspan: 6, class: 'muted' }, q.trim() ? 'No customer matches "' + q.trim() + '". Try fewer words, part of the company or contact name, or clear the filters.' : 'No customers match. Clear the filters or search for something else.'))))),
    ]);
}
