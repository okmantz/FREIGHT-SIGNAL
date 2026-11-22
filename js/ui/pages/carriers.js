import { h, toast, modal, confirmDialog, download, pickFile, readFileText, inputEl, field, copyText } from '../dom.js';
import { duplicateRows } from '../../core/prospects.js';
import { pageHead, emptyState, statTiles } from '../chrome.js';
import { summaryOutreach } from '../board/outreachview.js';
import { topCarriersByCovers, weekStart } from '../../core/coverlog.js';
import { icon } from '../icons.js';
import { state, actions } from '../../store/state.js';
import { CARRIER_HEADERS, CARRIER_KEYS } from '../../core/defaults.js';
import { toDelimited } from '../../core/csv.js';
import { tableToRecords } from '../importer.js';
import { storedWhere } from '../../store/cloud.js';
import { createTableSort } from '../tablesort.js';
import { telHref, mailHref, fmcsaUrl } from '../../core/resources.js';
import { avatar, chips, statusPill, whenCell, segmented, searchBox, moreMenu, filterSelect, expandRows, groupRow, groupBy, detailCard, contactStack, countLine, DAY, relDate } from '../directory.js';
import { openPublish } from './trucks.js';
import * as net from '../../store/net.js';
import { openHistoryImport } from '../history.js';
import { assignDialog, assignmentsDialog } from '../assign.js';
import { describeAssignment } from '../../core/assignments.js';

let q = '';
let view = 'all', groupKey = '';
const F = { equip: '', state: '', status: '' };
const open = new Set();
const rerender = () => import('../../main.js').then(m => m.render());
const sorter = createTableSort(rerender);   // click a header: A-Z, Z-A, random

const eqTokens = (c) => String(c.equipment ?? '').split(/[,/;|]+/).map(x => x.trim()).filter(Boolean);
const uniq = (list) => [...new Set(list)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
const statusOf = (c) => String(c.status || 'Active').trim();
const days = (c) => { const t = Date.parse(c.lastContacted); return Number.isFinite(t) ? (Date.now() - t) / DAY : Infinity; };
const VIEWS = {
  all: () => true,
  active: (c) => statusOf(c).toLowerCase() !== 'inactive',
  reach: (c) => String(c.email || '').trim() && days(c) >= 7,
  never: (c) => days(c) === Infinity,
  proven: (c) => Number(c.coverCount) > 0,
};
const passes = (c) => {
  if (!VIEWS[view](c)) return false;
  if (F.equip && !eqTokens(c).some(x => x.toLowerCase() === F.equip.toLowerCase())) return false;
  if (F.state && String(c.originState ?? '').trim().toUpperCase() !== F.state) return false;
  if (F.status && statusOf(c).toLowerCase() !== F.status.toLowerCase()) return false;
  return true;
};
const filtersOn = () => Object.values(F).some(Boolean) || view !== 'all' || q;
const laneText = (c) => {
  const o = [c.originCity, c.originState].filter(Boolean).join(', '), d = [c.destCity, c.destState].filter(Boolean).join(', ');
  return { o, d };
};
const GROUPS = { '': null, equipment: (c) => eqTokens(c)[0] || 'No equipment listed', originState: (c) => String(c.originState || '').trim().toUpperCase() || 'No home state', status: statusOf };

function toolbar(all, rows) {
  const cs = state.carriers;
  const count = (k) => cs.filter(VIEWS[k]).length;
  return [
    h('div', { class: 'dir-bar' },
      searchBox(q, 'Search name, MC, e-mail, city, equipment…', (v) => { q = v; }, rerender),
      segmented([['all', 'All', count('all')], ['active', 'Active', count('active')], ['reach', 'Ready to contact', count('reach')], ['never', 'Never contacted', count('never')], ['proven', 'Has covered', count('proven')]], view, (v) => { view = v; rerender(); }, 'Quick views'),
      h('span', { class: 'grow' }),
      h('button', { class: 'btn primary', type: 'button', onclick: () => edit(null) }, icon('plus', 15), 'Add carrier'),
      h('button', { class: 'btn', type: 'button', 'data-act': 'import-history', title: 'Read the last 30 or 90 days of Outlook mail and add only the carriers that really booked a load with you', onclick: openHistoryImport }, icon('mail', 15), 'IMPORT HISTORICAL EMAILS'),
      h('button', { class: 'btn', type: 'button', disabled: !rows.length, title: 'Draft a truck-availability e-mail to every carrier shown (with an e-mail address). Use the filters first to ask just one group.', onclick: () => truckCheck(rows) }, icon('mail', 15), `Truck check (${rows.filter(c => String(c.email || '').trim()).length})`),
      moreMenu('More', [
        ['Import from Excel / CSV…', 'upload', importDialog],
        ['Primary carriers (who takes which lane first)…', 'star', assignmentsDialog, { act: 'assignments', title: 'See and edit the carriers that are suggested first for a lane' }],
        ['Export CSV', 'download', () => download('carrier-database.csv', '﻿' + csv(), 'text/csv;charset=utf-8')],
        ['Copy for Excel', 'copy', () => copyText(toDelimited([CARRIER_HEADERS, ...state.carriers.map(c => CARRIER_KEYS.map(k => c[k] ?? ''))], '\t'), 'Copied (paste into Excel).')],
        ['Clean up duplicates', 'layers', async () => {
          const d = duplicateRows(state.carriers); if (!d.drop.length) return toast('No duplicate rows found.', 'ok');
          if (!(await confirmDialog('Clean up duplicates', d.drop.length + ' duplicate row' + (d.drop.length === 1 ? '' : 's') + ' (same carrier, same lane) will be removed. The fullest row of each is kept and fills its blanks from the others.', 'Clean up'))) return;
          const r = await actions.cleanupCarrierDuplicates(); toast(r.removed + ' duplicate row' + (r.removed === 1 ? '' : 's') + ' removed.', 'ok');
        }, { act: 'dedupe', title: 'Remove exact duplicate rows (same carrier and same lane)' }],
      ])),
    h('div', { class: 'dir-filters' }, h('span', { class: 'lbl' }, 'Filter'),
      filterSelect('Any equipment', uniq(cs.flatMap(eqTokens)).map(x => [x]), F.equip, (v) => { F.equip = v; rerender(); }, 'equip'),
      filterSelect('Any home state', uniq(cs.map(c => String(c.originState ?? '').trim().toUpperCase()).filter(Boolean)).map(x => [x]), F.state, (v) => { F.state = v; rerender(); }, 'state'),
      filterSelect('Any status', uniq(cs.map(statusOf)).map(x => [x]), F.status, (v) => { F.status = v; rerender(); }, 'status'),
      h('span', { class: 'lbl' }, 'Group by'),
      filterSelect('No grouping', [['equipment', 'Equipment'], ['originState', 'Home state'], ['status', 'Status']], groupKey, (v) => { groupKey = v; rerender(); }, 'group'),
      filtersOn() ? h('button', { class: 'btn small', type: 'button', onclick: () => { Object.keys(F).forEach(k => { F[k] = ''; }); view = 'all'; q = ''; rerender(); } }, 'Clear filters') : null),
    h('div', { class: 'dir-count' }, h('span', null, `${rows.length} of ${all.length}`), (() => { const top = topCarriersByCovers(state.coverLog, 3).map(t => { const c = cs.find(x => String(x.email || '').toLowerCase() === t.email); return `${(c && c.carrierName) || t.email} (${t.covers})`; }); return top.length ? h('span', { class: 'topline' }, icon('trendup', 14), ' Top in your Cover Log: ' + top.join(', ')) : null; })()),
  ];
}

function row(c) {
  const { o, d } = laneText(c); const mc = String(c.mc || '').trim();
  const cells = [
    h('td', { class: 'c-name' }, h('div', { class: 'dir-id' }, avatar(c.carrierName || c.email),
      h('div', { class: 't' }, h('b', { title: c.carrierName }, c.carrierName || '(no name)'), h('small', null, mc ? (fmcsaUrl(mc) ? h('a', { class: 'xlink', href: fmcsaUrl(mc), target: '_blank', rel: 'noopener', title: 'Look up on FMCSA SAFER' }, 'MC ' + mc.replace(/^mc[\s#:-]*/i, '')) : 'MC ' + mc) : 'No MC on file')))),
    h('td', null, contactStack(c, { telHref, mailHref })),
    h('td', { class: 'c-lane' }, o || d ? h('span', { class: 'dir-lane' }, o || 'Anywhere', icon('chevright', 12), d || 'Anywhere') : h('span', { class: 'dir-none' }, 'No lane on file')),
    h('td', null, chips(eqTokens(c), 2)),
    h('td', null, whenCell(c.lastContacted)),
    h('td', { class: 'c-num' }, Number(c.coverCount) ? h('b', null, c.coverCount) : h('span', { class: 'dir-none' }, '0')),
    h('td', null, statusPill(statusOf(c))),
    h('td', { class: 'c-act' }, h('div', { class: 'rowact' },
      h('button', { class: 'btn small primary', type: 'button', 'data-act': 'truck', title: 'Draft "Do you have any trucks available?" to this carrier', disabled: !String(c.email || '').trim(), onclick: () => truckCheck([c]) }, 'Truck?'),
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Edit carrier', title: 'Edit', onclick: () => edit(c) }, icon('edit', 14)))),
  ];
  const detail = detailCard({
    fields: [['Verified by e-mail', c.verified === 'email' ? 'Booked ' + (c.bookedCount || 1) + ' load' + (Number(c.bookedCount) === 1 ? '' : 's') + (c.lastBookedAt ? ', last ' + relDate(c.lastBookedAt) : '') + (c.lastBookedRate ? ' at $' + Number(c.lastBookedRate).toLocaleString('en-US') : '') + ' (' + c.historyConfidence + '% evidence)' : ''], ['Dispatch phone (from e-mail)', c.dispatchPhone], ['Last driver', [c.driverName, c.driverPhone].filter(Boolean).join(' ')], ['Lanes it ran', Array.isArray(c.ranLanes) ? c.ranLanes.map(l => (l.originCity + ', ' + l.originState + ' to ' + l.destCity + ', ' + l.destState) + (l.count > 1 ? ' x' + l.count : '')).join('; ') : ''], ['Also e-mails from', Array.isArray(c.altEmails) ? c.altEmails.join(', ') : ''], ['Primary for', state.assignments.filter(a => a.carrierId === c.id).map(describeAssignment).join('; ')], ['Preferred pickup', c.preferredPickupDates], ['Usual rate', c.rate], ['Last covered', c.lastCovered ? relDate(c.lastCovered) + ' (' + c.lastCovered + ')' : ''], ['Response rate', c.responseRate], ['Covers', c.coverCount], ['All equipment', eqTokens(c).join(', ')]],
    notes: c.notes,
    actions: [
      net.joined() ? h('button', { class: 'btn small', type: 'button', 'data-act': 'share-truck-row', title: "Share this carrier's truck with the team", onclick: () => openPublish({ carrierName: c.carrierName, mc: c.mc, email: c.email, phone: c.phone, oCity: c.originCity, oState: c.originState, dCity: c.destCity, dState: c.destState, destOpen: !(c.destCity || c.destState), equip: /reef/i.test(c.equipment || '') ? 'R' : /flat/i.test(c.equipment || '') ? 'F' : 'V' }) }, icon('truck', 14), 'Share with team') : null,
      h('button', { class: 'btn small', type: 'button', 'data-act': 'set-primary', title: 'Suggest this carrier first when you post a matching load', onclick: () => assignDialog({ carrier: c, preset: { originCity: c.originCity, originState: c.originState, destCity: c.destCity, destState: c.destState } }) }, icon('star', 14), 'Set as primary…'),
      h('button', { class: 'btn small', type: 'button', onclick: () => edit(c) }, icon('edit', 14), 'Edit all fields'),
      h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete carrier', `Delete ${c.carrierName || c.email}?`, 'Delete')) actions.deleteCarrier(c.id); } }, icon('trash', 14), 'Delete')],
  });
  return { id: c.id, cells, detail };
}

export function render() {
  const rows = sorter.sort(state.carriers.filter(passes).filter(c => !q || CARRIER_KEYS.some(k => String(c[k] ?? '').toLowerCase().includes(q.toLowerCase()))), (c, k) => c[k]);
  const COLS = [['carrierName', 'Carrier'], ['email', 'Contact'], ['originState', 'Lane'], ['equipment', 'Equipment'], ['lastContacted', 'Last contacted'], ['coverCount', 'Covers'], ['status', 'Status']];
  const body = [];
  const gf = GROUPS[groupKey];
  if (gf && rows.length) { for (const [name, list] of groupBy(rows, gf)) { body.push(groupRow(name, list.length, 8)); body.push(...expandRows(list.map(row), open, 8)); } }
  else body.push(...expandRows(rows.map(row), open, 8));
  return h('div', null,
    pageHead({ icon: 'carriers', title: 'Carrier Database', sub: 'Everyone you cover with. Search, pick a quick view, then click a row to open all its details. ' + storedWhere() }),
    !state.carriers.length ? emptyState({ icon: 'carriers', title: 'No carriers yet', text: 'Import the carriers you already work with (an Excel or CSV list), or add one by hand. You can also approve a sender in the Inquiry Log and they land here.',
      actions: [h('button', { class: 'btn primary', type: 'button', onclick: () => edit(null) }, 'Add carrier'), h('button', { class: 'btn', type: 'button', onclick: importDialog }, 'Import from Excel / CSV')] }) : statTilesFor(),
    !state.carriers.length ? null : toolbar(state.carriers, rows),
    !state.carriers.length ? null : h('div', { class: 'dirwrap tablewrap' }, h('table', { class: 'carrier dirtable' },
      h('thead', null, h('tr', null, COLS.map(([k, l]) => sorter.th(k, l)), h('th', null, ''))),
      h('tbody', null, rows.length ? body : h('tr', null, h('td', { colspan: 8, class: 'muted' }, 'No carriers match. Clear the filters or search for something else.'))))));
}

function statTilesFor() {
  const cs = state.carriers; const wk = weekStart(new Date()).getTime();
  const withEmail = cs.filter(c => String(c.email || '').trim()).length;
  const recent = cs.filter(c => { const t = Date.parse(c.lastContacted); return Number.isFinite(t) && t >= wk; }).length;
  const never = cs.filter(c => !Date.parse(c.lastContacted)).length;
  return statTiles([[cs.length, 'Carriers'], [withEmail, 'With e-mail'], [recent, 'Contacted this week'], [never, 'Never contacted', never ? 'act' : '']]);
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
    for (const k of CARRIER_KEYS) { const v = inputs[k].value.trim(); if (rec.fieldMeta && rec.fieldMeta[k] && String(rec[k] ?? '') !== v) { rec.fieldMeta = { ...rec.fieldMeta }; delete rec.fieldMeta[k]; } rec[k] = v; }   // typed by a person = verified: e-mail history can never overwrite it
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

