import { h } from '../dom.js';
import { state } from '../../store/state.js';
import { homeMetrics } from '../../core/stats.js';

const TILES = [
  ['board', 'FREIGHT SIGNAL', 'Paste TQL loads, build the 3 x 3 matrix, run outreach', 'OPEN BOARD'],
  ['dat', 'DAT', 'Posting export for the DAT bulk template', 'OPEN DAT'],
  ['spare', 'SPARE LOAD DETAILS', 'Parked loads you can restore later', 'OPEN SPARES'],
  ['carriers', 'CARRIER DATABASE', 'Approved carriers by lane', 'OPEN DATABASE'],
  ['inquiry', 'INQUIRY LOG', 'Carrier inquiries and performance dashboard', 'OPEN LOG'],
  ['zipmap', 'ZIP MAP', 'Market and distance lookup', 'OPEN ZIP MAP'],
];

export function render() {
  const m = homeMetrics(state.postings, state.inquiries, state.counters);
  const metric = (k, v, sub) => h('div', { class: 'metric' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v), h('small', null, sub));
  return h('div', null,
    h('div', { class: 'hero' },
      h('div', { class: 'left' },
        h('h1', null, 'FREIGHT SIGNAL'),
        h('div', { class: 'sub' }, 'By O.K. Mantz  |  Load posting, carrier outreach and inquiry tracking'),
        h('div', { class: 'accentbar' }),
        h('div', { class: 'btnrow' },
          h('a', { class: 'outline', href: '#/board' }, 'Add loads'),
          h('a', { class: 'outline', href: '#/drafts' }, 'Drafts' + (state.drafts.length ? ` (${state.drafts.length})` : '')),
          h('a', { class: 'outline', href: '#/system' }, 'System / backup'),
          h('a', { class: 'outline', href: '#/manual' }, 'User manual')),
      ),
      h('img', { class: 'logo', src: 'assets/logo-mark.png', alt: 'Freight Signal' })),
    h('div', { class: 'metrics' },
      metric('Active loads', m.activeLoads, 'load groups on the board'),
      metric('Covers today', m.coversToday, 'counted when status = Covered'),
      metric('Total inquiries', m.totalInquiries, 'rows in the Inquiry Log'),
      metric('Lifetime covers', m.lifetimeCovers, 'all-time counter')),
    h('div', { class: 'tiles' }, TILES.map(([id, t, s, c]) => h('a', { class: 'tile', href: '#/' + id }, h('b', null, t), h('span', null, s), h('i', null, c)))),
    !state.zip ? h('div', { class: 'banner err' }, 'The ZIP Map is not loaded. Matrix building needs it: open System and import uszips.csv.') : null,
    h('div', { class: 'footline' }, 'ALL DATA STAYS IN THIS BROWSER  •  NOTHING IS EVER SENT AUTOMATICALLY'));
}
