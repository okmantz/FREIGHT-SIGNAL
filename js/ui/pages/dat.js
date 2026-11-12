import { h, copyText, download, toast } from '../dom.js';
import { state } from '../../store/state.js';
import { datLayout, datRows, datCsv, datTsv } from '../../core/dat.js';
import { groupMembers } from '../../core/model.js';

export function render() {
  const layout = datLayout(state.settings);
  const rows = datRows(state.postings, state.settings);
  const live = state.postings.filter(p => String(p.status).toLowerCase() !== 'covered');
  const groups = new Set(live.map(p => p.groupId).filter(Boolean));
  const bad = groups.size ? [...groups].filter(g => groupMembers(live, g).length !== 9) : [];
  const copyRow = (i) => copyText(rows[i].join('\t'), 'Row copied (tab-separated). Paste into the DAT template.');
  return h('div', null,
    h('div', { class: 'pagehead' }, h('h2', null, 'DAT'), h('p', null, 'Rows from the FREIGHT SIGNAL board, in DAT bulk-posting column order. Covered loads are already removed.')),
    state.settings.datHeaderOverride ? null : h('div', { class: 'banner' }, 'Header text for several columns is unverified (the screenshots truncate it). Paste your real DAT template header row in System → DAT header override.'),
    bad.length ? h('div', { class: 'banner err' }, `${bad.length} load group(s) do not have exactly 9 postings.`) : null,
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => copyText(datTsv(state.postings, state.settings), `${rows.length} row(s) copied, no header (paste under the template header).`) }, 'Copy all rows'),
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(datTsv(state.postings, state.settings, true), 'Rows + header copied.') }, 'Copy with header'),
      h('button', { class: 'btn', type: 'button', onclick: () => { download('freight-signal-dat.csv', '﻿' + datCsv(state.postings, state.settings), 'text/csv;charset=utf-8'); toast('CSV saved.', 'ok'); } }, 'Download CSV'),
      h('span', { class: 'muted' }, `${rows.length} posting(s)`)),
    h('div', { class: 'tablewrap' }, h('table', { class: 'dat' },
      h('thead', null, h('tr', null, h('th', null, ''), layout.map(c => h('th', null, c.header)))),
      h('tbody', null, rows.length ? rows.map((r, i) => h('tr', { class: i === 0 || state.postings[i]?.variant === 'Original' ? 'orig' : '' },
        h('td', null, h('button', { class: 'btn small', type: 'button', onclick: () => copyRow(i) }, 'Copy')), r.map(v => h('td', null, v)))) :
        h('tr', null, h('td', { colspan: layout.length + 1, class: 'muted' }, 'No postings yet.'))))));
}
