// Sortable column headers for a database table. One instance per table; the pages keep it at module level so the order survives
// navigating away and back. Header click: A-Z, then Z-A, then random, then back to A-Z (see core/tablesort.js).
// Builds elements with h() only (no innerHTML), so the strict CSP stays valid.

import { h } from './dom.js';
import { nextSort, sortRows } from '../core/tablesort.js';

const MARK = { asc: '▲', desc: '▼', random: '⇄' };      // ▲ ▼ ⇄
const WORD = { asc: 'A to Z', desc: 'Z to A', random: 'random order' };

export function createTableSort(onChange) {
  let cur = null;
  return {
    get state() { return cur; },
    /** The rows in the current order (a new array). */
    sort(rows, get, id) { return sortRows(rows, cur, get, id); },
    /** A <th> whose label is a button. */
    th(key, label) {
      const on = cur && cur.key === key ? cur.mode : '';
      const after = on === 'asc' ? 'Z to A' : on === 'desc' ? 'random order' : on === 'random' ? 'A to Z' : 'A to Z';
      return h('th', { class: on ? 'sorted' : null, 'aria-sort': on === 'asc' ? 'ascending' : on === 'desc' ? 'descending' : 'none' },
        h('button', { class: 'thbtn', type: 'button', 'data-sort': key, 'data-fk': 'sort:' + key,
          title: on ? `Sorted ${WORD[on]}. Click for ${after}.` : `Sort by ${label} (click again for Z to A, then random)`,
          onclick: () => { cur = nextSort(cur, key); onChange(); } },
        label, h('span', { class: 'sortmark', 'aria-hidden': 'true' }, on ? MARK[on] : '↕')));
    },
  };
}
