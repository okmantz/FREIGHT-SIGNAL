import { h, toast, modal, confirmDialog, download, pickFile, readFileText, inputEl, selectEl, field, fmtDate, copyText } from '../dom.js';
import { pageHead, emptyState } from '../chrome.js';
import { state, actions } from '../../store/state.js';
import { INQUIRY_HEADERS, INQUIRY_KEYS } from '../../core/defaults.js';
import { toDelimited } from '../../core/csv.js';
import { tableToRecords } from '../importer.js';
import { performanceDashboard } from '../../core/stats.js';
import { draftCard } from '../draftcard.js';
import { formatCurrency0, safeNumeric, safeString } from '../../core/util.js';
import { judgeQuote } from '../../core/quotes.js';
import { buildOutlookLoadDetails } from '../../core/outreach.js';
import { icon } from '../icons.js';
import { avatar, statusPill, segmented, searchBox, moreMenu, expandRows, groupRow, groupBy, detailCard, relDate } from '../directory.js';

let tab = 'log';
let q = '';
let statusF = 'All';
const openRows = new Set();
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


/**
 * The carrier's logged rate. A rate the app does not believe (far from the load's target, a number copied from your own load text, or read
 * by an old macro from the whole e-mail) is crossed out with a warning mark and is NOT counted as a quote on the board.
 * Edit the entry and correct or clear the rate to remove the mark.
 */
function rateCell(i) {
  const post = state.postings.find(p => p.id === i.postingId);
  const target = post ? safeNumeric(post.targetRate) || safeNumeric(post.datRate) : safeNumeric(i.targetRate);
  const ownText = post ? [safeString(post.details) || buildOutlookLoadDetails(post), post.notes].join('\n') : '';
  const v = judgeQuote(i, { target, settings: state.settings, ownText });
  const txt = formatCurrency0(Number(i.lastCarrierRate));
  if (v.ok && !v.unverified) return h('td', { class: 'num' }, txt);
  return h('td', { class: 'num ratecheck ' + (v.ok ? 'unverified' : 'rejected'), title: (v.ok ? 'Not counted as ready to book: ' : 'Not counted as a quote: ') + v.reason },
    h('span', { class: 'rc-mark', 'aria-hidden': 'true' }, '\u26A0 '), h('span', { class: v.ok ? '' : 'rc-struck' }, txt));
}

const dayLabel = (iso) => { const t = new Date(iso); if (Number.isNaN(t.getTime())) return 'Undated'; const d = Math.floor((Date.now() - t.getTime()) / 86400000); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : t.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: t.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); };
const statusTone = (st) => /won|cover|book|accept/i.test(st) ? 'good' : /declin|lost|no /i.test(st) ? 'muted' : /quote|rate|wait|pending/i.test(st) ? 'warn' : 'accent';

function inqRow(i) {
  const lane = [i.originCity, i.originState].filter(Boolean).join(', ') + ((i.destCity || i.destState) ? ' → ' + [i.destCity, i.destState].filter(Boolean).join(', ') : '');
  const rc = (i.lastCarrierRate !== '' && i.lastCarrierRate !== undefined) ? rateCell(i) : h('td', { class: 'num' }, h('span', { class: 'dir-none' }, '—'));
  rc.classList.add('c-num');
  const cells = [
    h('td', null, h('div', { class: 'dir-id' }, avatar(i.senderEmail), h('div', { class: 't' }, h('b', { title: i.senderEmail }, i.senderEmail || '(unknown sender)'), h('small', { title: i.subject }, i.subject || '')))),
    h('td', { class: 'c-lane' }, lane ? h('span', { class: 'dir-lane' }, lane) : h('span', { class: 'dir-none' }, 'No lane')),
    rc,
    h('td', null, statusPill(i.status || 'New', statusTone(String(i.status || '')))),
    h('td', null, i.lastAction ? h('span', { class: 'dir-sub' }, i.lastAction) : h('span', { class: 'dir-none' }, '—')),
    h('td', null, selectEl(['No', 'Yes'], i.approved || 'No', async (v) => { const c = await actions.setApproved(i.id, v); if (c) toast('Carrier added/updated in the Carrier Database.', 'ok'); })),
    h('td', { class: 'c-act' }, h('div', { class: 'rowact' },
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Edit entry', title: 'Edit', onclick: () => editInquiry(i) }, icon('edit', 14)),
      h('button', { class: 'btn small danger', type: 'button', 'aria-label': 'Delete entry', onclick: async () => { if (await confirmDialog('Delete entry', 'Delete this inquiry row?', 'Delete')) actions.deleteInquiry(i.id); } }, '✕'))),
  ];
  return { id: i.id, cells, detail: detailCard({ fields: [['Counted', fmtDate(i.dateCounted) + (i.dateCounted ? ' (' + relDate(i.dateCounted) + ')' : '')], ['Posting row', i.postingRow], ['Stage', i.stage], ['Your target', i.targetRate], ['Inquiries on the load', i.countAfterInquiry], ['Rate reply sent', i.rateResponseSent], ['Events', i.eventCount], ['Added', fmtDate(i.dateAdded)], ['Conversation', i.conversationId, true]] }) };
}

function log() {
  const all = state.inquiries;
  const statuses = [...new Set(all.map(i => i.status).filter(Boolean))];
  const rows = all.filter(i => (statusF === 'All' || i.status === statusF) && (!q || INQUIRY_KEYS.some(k => String(i[k] ?? '').toLowerCase().includes(q.toLowerCase()))));
  const csv = () => toDelimited([INQUIRY_HEADERS, ...all.map(i => INQUIRY_KEYS.map(k => i[k] ?? ''))], ',');
  const blank = () => Object.fromEntries(INQUIRY_KEYS.map(k => [k, k === 'dateCounted' ? new Date().toISOString() : k === 'approved' ? 'No' : '']));
  if (!all.length) return h('div', null, emptyState({ icon: 'inquiry', title: 'No carrier replies logged yet', text: 'When a carrier answers one of your posts, paste their e-mail into "Process carrier e-mail" (or let Outlook do it once connected). It is logged here and a reply is drafted for you.',
    actions: [h('button', { class: 'btn primary', type: 'button', 'data-act': 'go-process', onclick: () => { tab = 'email'; rerender(); } }, 'Process a carrier e-mail'), h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'Import a log'), h('button', { class: 'btn', type: 'button', onclick: () => editInquiry(blank()) }, 'Add one by hand')] }));
  const sorted = [...rows].sort((a, b) => (Date.parse(b.dateCounted) || 0) - (Date.parse(a.dateCounted) || 0));
  const body = groupBy(sorted, (i) => dayLabel(i.dateCounted)).sort(() => 0).flatMap(([day, list]) => [groupRow(day, list.length, 7), ...expandRows(list.map(inqRow), openRows, 7)]);
  return h('div', null,
    h('div', { class: 'dir-bar' }, searchBox(q, 'Search sender, subject, city, status…', (v) => { q = v; }, rerender),
      segmented([['All', 'All', all.length], ...statuses.map(st => [st, st, all.filter(i => i.status === st).length])], statusF, (v) => { statusF = v; rerender(); }, 'Status'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => editInquiry(blank()) }, icon('plus', 15), 'Add entry'),
      moreMenu('More', [['Import…', 'upload', importDialog], ['Export CSV', 'download', () => download('inquiry-log.csv', '﻿' + csv(), 'text/csv;charset=utf-8')]])),
    h('div', { class: 'dir-count' }, h('span', null, `${rows.length} of ${all.length}`), h('span', { class: 'muted' }, 'Newest first. Click a row for the full record.')),
    h('div', { class: 'dirwrap tablewrap' }, h('table', { class: 'inq dirtable' },
      h('thead', null, h('tr', null, ['Carrier', 'Lane', 'Their rate', 'Status', 'Last action', 'Approved', ''].map(x => h('th', null, x)))),
      h('tbody', null, rows.length ? body : h('tr', null, h('td', { colspan: 7, class: 'muted' }, 'No inquiries match.'))))));
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
    pageHead({ icon: 'inquiry', title: 'Inquiry Log', sub: 'Carrier inquiries, replies and your performance dashboard.' }),
    h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Inquiry Log sections' }, tabs.map(([id, l]) => h('button', { class: 'tab' + (tab === id ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; rerender(); } }, l))),
    tab === 'log' ? log() : tab === 'dash' ? dashboard() : processor());
}
