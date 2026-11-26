// Keyboard shortcuts (v23) for the things done all day. They only fire when you are not typing in a field and no dialog is open,
// and never with Ctrl / Alt / Cmd held, so nothing here can get in the way of typing or of the browser's own keys.
//   n   new load: go to the Load Board and put the cursor in the paste box
//   /   search: put the cursor in this page's search box
//   g then h / b / d / l / c / u / i / r   jump to Home, Load Board, Cover Desk, Cover Log, Carriers, Customers, Inquiry Log, dRafts
//   ?   show this list
import { h, modal } from './dom.js';

const GO = { h: ['home', 'Home'], b: ['board', 'Load Board'], d: ['coverdesk', 'Cover Desk'], l: ['covers', 'Cover Log'], c: ['carriers', 'Carrier Database'], u: ['customers', 'Customer Database'], i: ['inquiry', 'Inquiry Log'], r: ['drafts', 'Drafts'] };

const typing = (el) => !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const dialogOpen = () => !!document.querySelector('.overlay, .authgate, .tour-layer');

/** Wait (briefly) for something that a page draws after navigating, then run fn on it. */
function whenThere(selector, fn, tries = 30) {
  const el = document.querySelector(selector);
  if (el) return fn(el);
  if (tries > 0) setTimeout(() => whenThere(selector, fn, tries - 1), 50);
}

export function focusPaste() {
  const go = () => whenThere('textarea.pastebox', (el) => { el.focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  if (location.hash.replace(/^#\/?/, '').split('?')[0] === 'board') go(); else { location.hash = '#/board'; go(); }
}

export function showShortcuts() {
  const row = (keys, text) => h('tr', null, h('td', { class: 'kb-keys' }, keys.map((k, i) => [i ? h('span', { class: 'kb-then' }, 'then') : null, h('kbd', null, k)])), h('td', null, text));
  modal({
    title: 'Keyboard shortcuts', body: h('div', null,
      h('p', { class: 'muted' }, 'These work anywhere except while you are typing in a box. Press Esc to close a dialog or a menu.'),
      h('table', { class: 'kb-table' }, h('tbody', null,
        row(['n'], 'New load: opens the Load Board with the cursor in the paste box'),
        row(['/'], 'Search this page'),
        ...Object.entries(GO).map(([k, [, label]]) => row(['g', k], 'Go to ' + label)),
        row(['?'], 'Show this list'),
        row(['Enter'], 'In a dialog: press the main button (for example, log a cover from the rate box)'),
        row(['Ctrl', 'Enter'], 'In the paste box: add the loads')))),
    actions: [{ label: 'Close', kind: 'primary' }],
  });
}

export function initShortcuts() {
  let pendingG = 0;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if (typing(e.target) || dialogOpen()) { pendingG = 0; return; }
    const k = e.key;
    if (pendingG && Date.now() - pendingG < 1500) {
      pendingG = 0;
      const t = GO[k.toLowerCase()]; if (t) { e.preventDefault(); location.hash = '#/' + t[0]; return; }
    }
    pendingG = 0;
    if (k === 'g') { pendingG = Date.now(); return; }
    if (k === 'n') { e.preventDefault(); focusPaste(); }
    else if (k === '/') { const s = document.querySelector('#view .dir-search input, #view .boardbar input[type=search], #view input[type=search]'); if (s) { e.preventDefault(); s.focus(); s.select(); } }
    else if (k === '?') { e.preventDefault(); showShortcuts(); }
  });
}
