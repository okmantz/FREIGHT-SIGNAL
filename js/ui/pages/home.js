import { h } from '../dom.js';
import { state } from '../../store/state.js';
import { homeMetrics } from '../../core/stats.js';
import { ventuskyUrl } from '../../core/links.js';
import { icon } from '../icons.js';
import { greeting } from '../chrome.js';
import { startTour } from '../tour.js';

const TILES = [
  ['board', 'board', 'FREIGHT SIGNAL', 'Paste TQL loads, build the 3 x 3 matrix, set one target rate, download the DAT CSV', 'OPEN BOARD'],
  ['spare', 'spare', 'SPARE LOAD DETAILS', 'Parked loads you can restore later', 'OPEN SPARES'],
  ['carriers', 'carriers', 'CARRIER DATABASE', 'Approved carriers by lane', 'OPEN DATABASE'],
  ['inquiry', 'inquiry', 'INQUIRY LOG', 'Carrier inquiries and performance dashboard', 'OPEN LOG'],
  ['zipmap', 'zipmap', 'ZIP MAP', 'Market and distance lookup', 'OPEN ZIP MAP'],
];

export function render() {
  const m = homeMetrics(state.postings, state.inquiries, state.counters);
  const name = ((state.settings.profile || {}).name || '').trim().split(/\s+/)[0];
  const metric = (ic, k, v, sub) => h('div', { class: 'metric' }, h('div', { class: 'k' }, h('span', { class: 'ico' }, icon(ic, 15)), k), h('div', { class: 'v' }, v), h('small', null, sub));
  return h('div', null,
    h('div', { class: 'hero' },
      h('div', { class: 'left' },
        h('div', { class: 'greet' }, icon('sparkle', 14), name ? `${greeting()}, ${name}` : greeting()),
        h('h1', null, 'FREIGHT ', h('b', null, 'SIGNAL')),
        h('div', { class: 'tagline' }, 'Intelligent Carrier Sourcing Optimization System'),
        h('div', { class: 'sub' }, 'By O.K. Mantz  |  Load posting, carrier outreach and inquiry tracking'),
        h('div', { class: 'accentbar' }),
        h('div', { class: 'btnrow' },
          h('a', { class: 'outline', href: '#/board' }, 'Add loads'),
          h('button', { class: 'outline', type: 'button', 'data-act': 'take-tour', onclick: () => startTour() }, 'Take the 60-second tour'),
          h('a', { class: 'outline', href: '#/drafts' }, 'Drafts' + (state.drafts.length ? ` (${state.drafts.length})` : '')),
          h('a', { class: 'outline', href: '#/system' }, 'System / backup'),
          h('a', { class: 'outline', href: '#/manual' }, 'User manual'),
          h('a', { class: 'outline', href: '#/account' }, 'Themes'),
          h('a', { class: 'outline wx', href: ventuskyUrl(NaN, NaN), target: '_blank', rel: 'noopener noreferrer', title: 'Opens Ventusky weather in a new tab' }, 'Ventusky weather \u2197')),
      ),
      h('div', { class: 'logo-wrap' }, h('img', { class: 'logo', src: 'assets/logo-mark.png', alt: 'Freight Signal' }))),
    h('div', { class: 'metrics m3' },
      metric('activity', 'Active loads', m.activeLoads, 'load groups on the board'),
      metric('check', 'Covers today', m.coversToday, 'counted when status = Covered'),
      metric('inquiry', 'Inquiries', m.totalInquiries, 'in the Inquiry Log')),
    h('div', { class: 'tourcard' },
      h('span', { class: 'tc-ico' }, icon('play', 20)),
      h('div', { class: 'tc-text' }, h('b', null, 'The 60-second tour'), h('span', null, 'Setting up Outlook, posting your first load, the carrier database and logging a cover. Replay it any time.')),
      h('button', { class: 'btn primary', type: 'button', 'data-act': 'take-tour-card', onclick: () => startTour() }, icon('play', 15), 'Start the tour')),
    h('div', { class: 'tiles' }, TILES.map(([id, ic, t, s, c]) => h('a', { class: 'tile', href: '#/' + id }, h('span', { class: 't-ico' }, icon(ic, 20)), h('b', null, t), h('span', null, s), h('i', null, c)))),
    !state.zip ? h('div', { class: 'banner err' }, 'The ZIP Map is not loaded. Matrix building needs it: open System and import uszips.csv.') : null,
    h('div', { class: 'footline' }, 'ALL DATA STAYS IN THIS BROWSER  •  NOTHING IS EVER SENT AUTOMATICALLY'));
}
