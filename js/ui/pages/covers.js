import { h, toast, modal, confirmDialog, download, field } from '../dom.js';
import { pageHead, statTiles, emptyState } from '../chrome.js';
import { state, actions } from '../../store/state.js';
import { attributionFromLog, cityPerformance, paceStats, topCarriersByCovers } from '../../core/coverlog.js';
import { toDelimited } from '../../core/csv.js';
import { fmtDate } from '../dom.js';
import { money } from '../board/util.js';
import { safeNumeric } from '../../core/util.js';

let outcome = 'All';
const rerender = () => import('../../main.js').then(m => m.render());
const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '-');

function manualDialog() {
  const mk = (ph, w) => h('input', { placeholder: ph, size: w || 14, 'data-live': '' });
  const f = { originCity: mk('Origin city'), originState: mk('ST', 3), destCity: mk('Destination city'), destState: mk('ST', 3), name: mk('Carrier name'), email: mk('Carrier e-mail'), rate: mk('$ rate', 8), when: h('input', { type: 'date', 'data-live': '' }) };
  const brokers = state.settings.brokers || [];
  const brokerSel = brokers.length ? h('select', { 'data-live': '' }, h('option', { value: '' }, 'Unassigned'), brokers.map(b => h('option', { value: b }, b))) : null;
  modal({
    title: 'Log a cover by hand', wide: true,
    body: h('div', null, h('p', { class: 'muted' }, 'For loads covered by phone or before you used the app. It counts toward the pace tracker, lane memory and carrier ranking.'),
      h('div', { class: 'grid2' }, field('Origin city', f.originCity), field('Origin state', f.originState), field('Destination city', f.destCity), field('Destination state', f.destState), field('Carrier', f.name), field('Carrier e-mail', f.email), field('Rate paid', f.rate), field('Date covered', f.when), brokerSel ? field('Broker', brokerSel) : null)),
    actions: [{ label: 'Cancel' }, { label: 'Log cover', kind: 'primary', onClick: async () => {
      if (!f.originCity.value.trim() || !f.destCity.value.trim()) { toast('Enter the origin and destination city.', 'warn'); return false; }
      await actions.addManualCover({ originCity: f.originCity.value.trim(), originState: f.originState.value.trim(), destCity: f.destCity.value.trim(), destState: f.destState.value.trim(), carrier: { name: f.name.value.trim(), email: f.email.value.trim() }, rate: safeNumeric(f.rate.value) || '', closedAt: f.when.value ? new Date(f.when.value + 'T12:00:00').toISOString() : undefined, broker: brokerSel ? brokerSel.value : '', counts: true });
      toast('Cover logged.', 'ok');
    } }],
  });
}

const gridTable = (a) => h('table', { class: 'lanetable gridtable' }, h('thead', null, h('tr', null, h('th', null, 'Posting'), ['A', 'B', 'C'].map(x => h('th', null, 'Dest ' + x)))),
  h('tbody', null, ['A', 'B', 'C'].map(o => h('tr', null, h('th', null, 'Origin ' + o), ['A', 'B', 'C'].map(d => { const g = a.grid[o + '-' + d]; return h('td', { class: g.wins ? 'win' : '' }, h('b', null, g.wins), h('small', { class: 'muted' }, ` of ${g.appear} · ${pct(g.wins, g.appear)}`)); })))));

const cityTable = (rows, title) => h('div', { class: 'panel' }, h('h4', null, title), rows.length ? h('table', { class: 'lanetable' }, h('thead', null, h('tr', null, ['City', 'Covers', 'Posted', 'Hit rate'].map(x => h('th', null, x)))),
  h('tbody', null, rows.slice(0, 8).map(r => h('tr', null, h('td', null, r.label), h('td', null, r.wins), h('td', null, r.appear), h('td', null, pct(r.wins, r.appear)))))) : h('p', { class: 'muted' }, 'Appears after loads are covered from a 3 × 3 matrix.'));

export function render() {
  const now = new Date();
  const log = state.coverLog;
  const covered = log.filter(e => e.outcome === 'Covered');
  const pace = paceStats(log, state.settings, now, null);
  const rated = covered.filter(e => safeNumeric(e.rate) > 0);
  const avg = rated.length ? Math.round(rated.reduce((n, e) => n + safeNumeric(e.rate), 0) / rated.length) : 0;
  const a = attributionFromLog(log);
  const top = topCarriersByCovers(log, 5);
  const shown = log.filter(e => outcome === 'All' || e.outcome === outcome);
  const csv = () => toDelimited([['Closed', 'Outcome', 'Broker', 'Origin', 'Destination', 'Grid', 'Carrier', 'Carrier e-mail', 'Rate', 'DAT rate', 'Target', 'Inquiries', 'Age hours', 'Note'],
    ...log.map(e => [e.closedAt, e.outcome, e.broker || '', `${(e.covered || e.lane || {}).originCity || ''}, ${(e.covered || e.lane || {}).originState || ''}`, `${(e.covered || e.lane || {}).destCity || ''}, ${(e.covered || e.lane || {}).destState || ''}`, e.covered && e.covered.grid || '', e.carrier && e.carrier.name || '', e.carrier && e.carrier.email || '', e.rate, e.datRate, e.targetRate, e.inquiries, e.ageHours === '' ? '' : Math.round(e.ageHours * 10) / 10, e.note || ''])], ',');
  return h('div', null,
    pageHead({ icon: 'covers', title: 'Cover Log', sub: 'Every load that leaves the board is recorded here first: which posting covered it, which carrier, at what rate. It feeds lane memory, carrier ranking, the matrix and the pace tracker.',
      actions: [h('button', { class: 'btn primary', type: 'button', onclick: manualDialog }, 'Log a cover by hand'), h('button', { class: 'btn', type: 'button', disabled: !log.length, onclick: () => download('cover-log.csv', '﻿' + csv(), 'text/csv;charset=utf-8') }, 'Export CSV')] }),
    statTiles([[pace.today, 'Covers today'], [`${pace.week} / ${pace.floor}`, 'This week'], [pace.projection === null ? '-' : pace.projection, 'Projected for the week', pace.status === 'on' ? 'ok' : pace.status === 'short' ? 'urgent' : 'act'], [avg ? money(avg) : '-', 'Average rate']]),
    h('p', { class: 'muted pacetext' }, pace.text + (pace.status !== 'on' && pace.status !== 'early' ? ` You need about ${pace.perDay} a day for the rest of the week.` : '')),
    covered.length ? h('div', { class: 'grid2 insightgrid' },
      h('div', { class: 'panel' }, h('h4', null, 'Which of the 9 postings covers loads'), gridTable(a), h('p', { class: 'muted small' }, 'Rows are origin A (original) to C, columns destination A to C. Each box: covers of postings in that position.')),
      h('div', { class: 'panel' }, h('h4', null, 'Top carriers'), top.length ? h('table', { class: 'lanetable' }, h('thead', null, h('tr', null, ['Carrier', 'Covers', 'Avg rate'].map(x => h('th', null, x)))),
        h('tbody', null, top.map(t => { const c = state.carriers.find(x => String(x.email || '').toLowerCase() === t.email); return h('tr', null, h('td', null, (c && c.carrierName) || t.email), h('td', null, t.covers), h('td', null, t.avgRate ? money(t.avgRate) : '-')); }))) : h('p', { class: 'muted' }, 'No carriers credited yet.')),
      cityTable(cityPerformance(log, 'origin'), 'Origin cities that produce covers'), cityTable(cityPerformance(log, 'dest'), 'Destination cities that produce covers')) : null,
    h('div', { class: 'toolbar' }, h('label', { class: 'inl' }, 'Show ', h('select', { class: 'cell', 'data-live': '', onchange: (e) => { outcome = e.target.value; rerender(); } }, ['All', 'Covered', 'Expired', 'Manual'].map(o => h('option', { value: o, selected: o === outcome }, o === 'Manual' ? 'Closed without cover' : o)))), h('span', { class: 'muted' }, `${shown.length} of ${log.length}`)),
    shown.length ? h('div', { class: 'tablewrap' }, h('table', { class: 'lanetable' }, h('thead', null, h('tr', null, ['Closed', 'Result', 'Lane', 'Posting', 'Carrier', 'Rate', 'DAT / target', 'Inq', 'Broker', ''].map(x => h('th', null, x)))),
      h('tbody', null, shown.slice(0, 400).map(e => { const l = e.covered || e.lane || {}; return h('tr', { class: 'o-' + e.outcome.toLowerCase() },
        h('td', null, fmtDate(e.closedAt)), h('td', null, h('span', { class: 'pill ' + (e.outcome === 'Covered' ? 'ok' : '') }, e.outcome === 'Manual' ? 'Closed' : e.outcome)),
        h('td', null, `${l.originCity || '?'}, ${l.originState || ''} → ${l.destCity || '?'}, ${l.destState || ''}`), h('td', null, e.covered && e.covered.grid || ''),
        h('td', null, (e.carrier && (e.carrier.name || e.carrier.email)) || ''), h('td', null, e.rate ? money(e.rate) : ''), h('td', { class: 'muted' }, [e.datRate ? money(e.datRate) : '', e.targetRate ? money(e.targetRate) : ''].filter(Boolean).join(' / ')),
        h('td', null, e.inquiries || 0), h('td', null, e.broker || ''),
        h('td', null, h('div', { class: 'rowact' },
          e.rows && e.rows.length ? h('button', { class: 'btn small', type: 'button', title: 'Put this load back on the board', onclick: async () => { const n = await actions.restoreFromLog(e.id); toast(n ? `Restored ${n} posting(s) to the board.` : 'Nothing to restore.', n ? 'ok' : 'warn'); } }, 'Restore') : null,
          h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete log entry', 'Remove this record? Lane memory and statistics forget it.', 'Delete')) actions.deleteLogEntry(e.id); } }, '✕')))); })))) :
      emptyState({ icon: 'covers', title: 'Nothing logged yet', text: 'Use "Mark covered" on a load (or Log a cover by hand). Expired loads are logged here too, and can be restored.' }));
}
