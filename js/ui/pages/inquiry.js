import { h, toast, modal, confirmDialog, download, pickFile, readFileText, inputEl, selectEl, field, fmtDate, copyText } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { INQUIRY_HEADERS, INQUIRY_KEYS } from '../../core/defaults.js';
import { toDelimited } from '../../core/csv.js';
import { tableToRecords } from '../importer.js';
import { performanceDashboard } from '../../core/stats.js';
import { draftCard } from '../draftcard.js';
import { formatCurrency0 } from '../../core/util.js';

let tab = 'log';
let q = '';
let statusF = 'All';
const mail = { from: '', subject: '', body: '' };
let lastResult = null;

const rerender = () => import('../../main.js').then(m => m.render());

function dashboard() {
  const d = performanceDashboard(state.postings, state.inquiries);
  const t = (k, v, sub) => h('div', { class: 'metric' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), sub ? h('small', null, sub) : null);
  return h('div', null,
    h('div', { class: 'banner' }, 'Metric definitions are inferred from the workbook screenshot; see docs/OPEN-QUESTIONS.md.'),
    h('div', { class: 'metrics' },
      t('Loads processed', d.loadsProcessed, 'original postings on the board'), t('Posting variations', d.variations, 'nearby alternates'),
      t('Carrier inquiries', d.carrierInquiries, `${d.uniqueCarriers} unique carriers`), t('Avg inquiries / load', d.avgInquiriesPerLoad.toFixed(1), `${d.avgInquiriesPerPosting.toFixed(2)} per posting`)),
    h('div', { class: 'panel' }, h('h3', null, 'Best performing posting'), h('p', null, d.bestPosting ? `${d.bestPosting}: ${d.bestPostingInquiries} inquiries` : 'None yet.'),
      h('p', { class: 'muted' }, `Top-5 engagement: ${(d.top5Engagement * 100).toFixed(0)}% of all inquiries`)),
    h('div', { class: 'panel' }, h('h3', null, 'Top markets'),
      d.topMarkets.length ? h('table', null, h('tbody', null, d.topMarkets.map(m => h('tr', null, h('td', null, m.label), h('td', { class: 'num' }, m.inquiries)))))
        : h('p', { class: 'muted' }, 'No inquiry counts yet.')));
}

function editInquiry(rec) {
  const r = { ...rec };
  const inputs = {};
  const body = h('div', { class: 'grid3' }, INQUIRY_KEYS.map((k, i) => { inputs[k] = h('input', { value: r[k] ?? '' }); return field(INQUIRY_HEADERS[i], inputs[k]); }));
  modal({ title: 'Edit inquiry', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => { for (const k of INQUIRY_KEYS) r[k] = inputs[k].value; await actions.saveInquiry(r); } }] });
}

function importDialog() {
  const ta = h('textarea', { placeholder: 'Paste rows from your Excel Inquiry Log (with header row), or choose a CSV file.' });
  const mode = h('select', null, h('option', { value: 'append' }, 'Add to existing log'), h('option', { value: 'replace' }, 'Replace the log'));
  modal({ title: 'Import inquiries', wide: true,
    body: h('div', null, ta, h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: async () => { const f = await pickFile('.csv,.tsv,.txt'); if (f) ta.value = await readFileText(f); } }, 'Choose file…'), mode)),
    actions: [{ label: 'Cancel' }, { label: 'Import', kind: 'primary', onClick: async () => {
      const { rows, note } = tableToRecords(ta.value, INQUIRY_HEADERS, INQUIRY_KEYS);
      if (!rows.length) { toast('Nothing to import.', 'warn'); return false; }
      if (mode.value === 'replace' && !(await confirmDialog('Replace log', `This deletes all ${state.inquiries.length} current log rows first.`, 'Replace'))) return false;
      const n = await actions.importInquiries(rows, mode.value); toast(`${n} row(s) imported. ${note}`, 'ok', 7000);
    } }] });
}

function log() {
  const statuses = ['All', ...new Set(state.inquiries.map(i => i.status).filter(Boolean))];
  const rows = state.inquiries.filter(i => (statusF === 'All' || i.status === statusF) && (!q || INQUIRY_KEYS.some(k => String(i[k] ?? '').toLowerCase().includes(q.toLowerCase()))));
  const search = h('input', { type: 'search', placeholder: 'Search the log…', value: q, 'data-rerender': '' });
  search.addEventListener('input', () => { q = search.value; });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') rerender(); });
  const csv = () => toDelimited([INQUIRY_HEADERS, ...state.inquiries.map(i => INQUIRY_KEYS.map(k => i[k] ?? ''))], ',');
  return h('div', null,
    h('div', { class: 'toolbar' }, search, selectEl(statuses, statusF, (v) => { statusF = v; rerender(); }, { 'data-rerender': '' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editInquiry(Object.fromEntries(INQUIRY_KEYS.map(k => [k, k === 'dateCounted' ? new Date().toISOString() : k === 'approved' ? 'No' : '']))) }, 'Add entry'),
      h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'Import…'),
      h('button', { class: 'btn', type: 'button', disabled: !state.inquiries.length, onclick: () => download('inquiry-log.csv', '﻿' + csv(), 'text/csv;charset=utf-8') }, 'Export CSV'),
      h('span', { class: 'muted' }, `${rows.length} of ${state.inquiries.length}`)),
    h('div', { class: 'tablewrap' }, h('table', { class: 'inq' },
      h('thead', null, h('tr', null, h('th', null, ''), INQUIRY_HEADERS.map(x => h('th', null, x)))),
      h('tbody', null, rows.length ? rows.map(i => h('tr', null,
        h('td', null, h('div', { class: 'rowact' },
          h('button', { class: 'btn small', type: 'button', onclick: () => editInquiry(i) }, 'Edit'),
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete entry', 'Delete this inquiry row?', 'Delete')) actions.deleteInquiry(i.id); } }, '✕'))),
        INQUIRY_KEYS.map(k => {
          if (k === 'approved') return h('td', null, selectEl(['No', 'Yes'], i.approved || 'No', async (v) => { const c = await actions.setApproved(i.id, v); if (c) toast('Carrier added/updated in the Carrier Database.', 'ok'); }));
          if (k === 'dateCounted' || k === 'dateAdded') return h('td', null, fmtDate(i[k]));
          if (k === 'lastCarrierRate' && i[k] !== '' && i[k] !== undefined) return h('td', { class: 'num' }, formatCurrency0(Number(i[k])));
          return h('td', null, i[k] ?? '');
        }))) : h('tr', null, h('td', { colspan: 20, class: 'muted' }, 'No inquiries logged.'))))));
}

function processor() {
  const f = (k, label, big) => { const el = big ? h('textarea', { 'data-rerender': '' }) : h('input', { 'data-rerender': '' }); el.value = mail[k]; el.addEventListener('input', () => { mail[k] = el.value; }); return field(label, el); };
  return h('div', null,
    h('div', { class: 'banner' }, 'Outlook-free workflow: paste a carrier e-mail here. The app applies the same rules as the Outlook macro (match to a posting, log the inquiry, draft the reply) and creates a DRAFT. It never reads your mailbox and never sends.'),
    h('div', { class: 'panel' },
      h('div', { class: 'grid2' }, f('from', 'From (carrier e-mail address)'), f('subject', 'Subject')), f('body', 'Body', true),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        if (!mail.from.trim()) return toast('Enter the sender address.', 'warn');
        lastResult = await actions.processEmail({ from: mail.from.trim(), subject: mail.subject, body: mail.body, sent: new Date().toLocaleString(), to: '' });
        if (lastResult.action && lastResult.draft) toast('Draft created.', 'ok'); rerender();
      } }, 'Process e-mail'), h('button', { class: 'btn', type: 'button', onclick: () => { mail.from = mail.subject = mail.body = ''; lastResult = null; rerender(); } }, 'Clear'))),
    lastResult ? h('div', { class: 'panel' }, h('h3', null, 'Result: ' + lastResult.action), h('p', null, lastResult.reason || ''),
      lastResult.flag ? h('div', { class: 'banner' }, lastResult.flag) : null, lastResult.draft ? draftCard(lastResult.draft) : null) : null);
}

export function render() {
  const tabs = [['log', 'Log'], ['dash', 'Performance dashboard'], ['email', 'Process carrier e-mail']];
  return h('div', null,
    h('div', { class: 'pagehead' }, h('h2', null, 'Inquiry Log')),
    h('div', { class: 'toolbar' }, tabs.map(([id, l]) => h('button', { class: 'btn' + (tab === id ? ' primary' : ''), type: 'button', onclick: () => { tab = id; rerender(); } }, l))),
    tab === 'log' ? log() : tab === 'dash' ? dashboard() : processor());
}
