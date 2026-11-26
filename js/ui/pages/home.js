import { h } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { outlookConnected } from '../../store/bridge.js';
import { homeMetrics } from '../../core/stats.js';
import { ventuskyUrl } from '../../core/links.js';
import { TOOLKIT } from '../../core/resources.js';
import { icon } from '../icons.js';
import { greeting } from '../chrome.js';
import { startTour } from '../tour.js';
import { analyseBoard, rankLoads } from '../../core/worklist.js';
import { exceptionQueue } from '../../core/ledger.js';
import { boardCtx } from '../board/ctx.js';
import { loadStatus } from '../board/status.js';
import { coverModal } from '../board/cover.js';
import { focusLoad } from './board.js';

const TILES = [
  ['board', 'board', 'LOAD BOARD', 'Paste TQL loads, set one target rate, download the DAT CSV', 'OPEN BOARD'],
  ['coverdesk', 'sparkle', 'COVER DESK', 'Who to call first, held carrier e-mails and the trucks that are free', 'OPEN COVER DESK'],
  ['covers', 'covers', 'COVER LOG', 'Every cover, your weekly pace and what is working', 'OPEN COVER LOG'],
  ['spare', 'spare', 'SPARE LOAD DETAILS', 'Parked loads you can restore later', 'OPEN SPARES'],
  ['carriers', 'carriers', 'CARRIER DATABASE', 'Approved carriers by lane', 'OPEN DATABASE'],
  ['inquiry', 'inquiry', 'INQUIRY LOG', 'Carrier inquiries and performance dashboard', 'OPEN LOG'],
  ['team', 'customers', 'TEAM', 'Shared trucks, load rescue and lane intelligence with your teammates', 'OPEN TEAM'],
  ['zipmap', 'zipmap', 'ZIP MAP', 'Market and distance lookup', 'OPEN ZIP MAP'],
];


/** The "Get started" checklist: each step ticks itself off from what is actually in the app, so it never lies. */
function startSteps() {
  const posted = state.postings.some(p => (p.ops || []).some(o => o.type === 'posted'));
  return [
    { id: 'load', done: state.postings.length > 0 || state.coverLog.length > 0, title: 'Add your first load', text: 'Paste a load from TQL. It becomes nine nearby postings automatically.', href: '#/board', cta: 'Add a load' },
    { id: 'post', done: posted || state.coverLog.length > 0, title: 'Download the DAT CSV and post it', text: 'Set one target rate, press Download DAT CSV and upload it in DAT\u2019s bulk posting tool.', href: '#/board', cta: 'Open the board' },
    { id: 'carriers', done: state.carriers.length > 0, title: 'Add your carriers', text: 'Import the carriers you work with once. Outreach drafts go to the best match for each lane.', href: '#/carriers', cta: 'Add carriers' },
    { id: 'cover', done: state.coverLog.length > 0, title: 'Mark your first load covered', text: 'It goes to the Cover Log and counts toward your weekly pace.', href: '#/board', cta: 'Open the board' },
    { id: 'outlook', done: outlookConnected(), optional: true, title: 'Connect Outlook (optional, two minutes)', text: 'Carrier replies land in the app and drafts save to your Outlook Drafts.', href: '#/system', cta: 'Set up Outlook' },
  ];
}

function startCard() {
  const ui = state.settings.ui || {};
  if (ui.startDismissed) return null;
  const steps = startSteps();
  const doneN = steps.filter(x => x.done).length;
  const nextId = (steps.find(x => !x.done) || {}).id;
  return h('section', { class: 'startcard panel', 'data-test': 'start-card' },
    h('div', { class: 'sc-head' }, h('div', null, h('h3', null, 'Get started'), h('p', { class: 'muted' }, `${doneN} of ${steps.length} done. Each step ticks itself off.`)),
      h('button', { class: 'btn small ghost', type: 'button', 'data-act': 'dismiss-start', title: 'Hide this checklist. It will not come back.', onclick: () => actions.savePrefs({ ui: { ...ui, startDismissed: true } }) }, 'Hide')),
    h('ol', { class: 'sc-list' }, steps.map((x, i) => h('li', { class: 'sc-item' + (x.done ? ' done' : '') + (x.id === nextId ? ' next' : '') },
      h('span', { class: 'sc-mark', 'aria-hidden': 'true' }, x.done ? icon('check', 14) : String(i + 1)),
      h('div', { class: 'sc-text' }, h('b', null, x.title), h('span', null, x.text)),
      x.done ? h('span', { class: 'sc-ok' }, 'Done') : h('a', { class: 'btn small' + (x.id === nextId ? ' primary' : ''), href: x.href }, x.cta)))));
}

/**
 * "Work next" (v23): the loads most worth your time right now, with the two things you do to them all day one click away.
 * Open scrolls the board to the load; Covered opens the Mark covered dialog. Same ranking as the board's own worklist.
 */
function workNext() {
  const rows = analyseBoard(boardCtx());
  if (!rows.length) return null;
  const top = rankLoads(rows).slice(0, 5);
  const needs = exceptionQueue(state.ledger).length;
  return h('section', { class: 'panel homework', 'data-test': 'work-next' },
    h('div', { class: 'hw-head' },
      h('div', null, h('h3', null, 'Work next'), h('p', { class: 'muted' }, `The ${top.length === 1 ? 'load' : top.length + ' loads'} most worth your time right now, best first. ${rows.length} open on the board.`)),
      h('a', { class: 'btn' + (needs ? ' primary' : ''), href: '#/coverdesk', 'data-act': 'home-cover-desk', title: 'Who to call first, held carrier e-mails and free trucks' }, icon('sparkle', 15), needs ? `Cover Desk: ${needs} need${needs === 1 ? 's' : ''} you` : 'Open Cover Desk')),
    h('ol', { class: 'wl hw' }, top.map((r, i) => {
      const st = loadStatus(r);
      return h('li', { class: 'wl-' + st.tone, 'data-test': 'work-next-item' },
        h('span', { class: 'wl-rank' }, i + 1),
        h('div', { class: 'wl-main' }, h('b', null, r.box.title), h('small', { class: 'muted' }, r.reasons.slice(0, 3).join(' \u00b7 ') || 'nothing notable yet')),
        h('span', { class: 'badge st-' + st.tone }, icon(st.icon, 12), st.label),
        h('span', { class: 'score ' + r.label.toLowerCase(), title: 'Cover-probability score (0-100)' }, r.score),
        h('button', { class: 'btn small', type: 'button', 'data-act': 'hw-open', onclick: () => focusLoad(r.box.key) }, 'Open'),
        h('button', { class: 'btn small', type: 'button', 'data-act': 'hw-covered', title: 'Log the cover and take it off the board', onclick: () => coverModal(r.box) }, icon('check', 13), 'Covered'));
    })));
}

export function render() {
  const m = homeMetrics(state.postings, state.inquiries, state.counters);
  const name = ((state.settings.profile || {}).name || '').trim().split(/\s+/)[0];
  const metric = (ic, k, v, sub) => h('div', { class: 'metric' }, h('div', { class: 'k' }, h('span', { class: 'ico' }, icon(ic, 15)), k), h('div', { class: 'v' }, v), h('small', null, sub));
  return h('div', null,
    h('div', { class: 'hero' + (state.postings.length ? ' compact' : '') },
      h('div', { class: 'left' },
        h('div', { class: 'greet' }, icon('sparkle', 14), name ? `${greeting()}, ${name}` : greeting()),
        h('h1', null, 'FREIGHT ', h('b', null, 'SIGNAL')),
        h('div', { class: 'tagline' }, 'Intelligent Carrier Sourcing Optimization System'),
        h('div', { class: 'sub' }, 'Post loads on DAT, reach the right carriers, track every reply'),
        h('div', { class: 'accentbar' }),
        h('div', { class: 'btnrow' },
          h('a', { class: 'outline primarycta', href: '#/board' }, 'Add loads'),
          h('button', { class: 'outline', type: 'button', 'data-act': 'take-tour', onclick: () => startTour() }, 'Take the 60-second tour')),
      ),
      h('div', { class: 'logo-wrap' }, h('img', { class: 'logo', src: 'assets/logo-mark.png', alt: 'Freight Signal' }))),
    workNext(),
    startCard(),
    h('div', { class: 'metrics m3' },
      metric('activity', 'Active loads', m.activeLoads, 'load groups on the board'),
      metric('check', 'Covers today', m.coversToday, 'counted when status = Covered'),
      metric('inquiry', 'Inquiries', m.totalInquiries, 'in the Inquiry Log')),
    h('div', { class: 'tourcard' },
      h('span', { class: 'tc-ico' }, icon('play', 20)),
      h('div', { class: 'tc-text' }, h('b', null, 'New here? Take the 60-second tour'), h('span', null, 'A guided walk through posting a load, working carriers and logging a cover. Replay it any time.')),
      h('button', { class: 'btn primary', type: 'button', 'data-act': 'take-tour-card', onclick: () => startTour() }, icon('play', 15), 'Start the tour')),
    h('div', { class: 'toolkit', 'aria-label': 'Cover toolkit' },
      h('span', { class: 'tk-title' }, icon('truck', 15), 'Cover toolkit'),
      TOOLKIT.map(t => h('a', { class: 'tk-link', href: t.url, target: '_blank', rel: 'noopener noreferrer', title: t.note + ' (opens in a new tab)', 'data-tool': t.id }, icon(t.icon, 15), t.label))),
    h('h3', { class: 'sechead' }, 'Where to next'),
    h('div', { class: 'tiles' }, TILES.map(([id, ic, t, s, c]) => h('a', { class: 'tile', href: '#/' + id }, h('span', { class: 't-ico' }, icon(ic, 20)), h('b', null, t), h('span', null, s), h('i', null, c)))),
    !state.zip ? h('div', { class: 'banner err' }, 'The ZIP Map is not loaded. Matrix building needs it: open System and import uszips.csv.') : null,
    h('div', { class: 'footline' }, 'YOUR DATA STAYS ON THIS COMPUTER  •  ONLY WHAT YOU SHARE WITH YOUR TEAM LEAVES IT  •  NOTHING IS EVER SENT AUTOMATICALLY'));
}
