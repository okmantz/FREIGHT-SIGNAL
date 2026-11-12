import { h, clear, toast } from './ui/dom.js';
import { state, subscribe, loadAll, actions } from './store/state.js';
import * as home from './ui/pages/home.js';
import * as board from './ui/pages/board.js';
import * as spare from './ui/pages/spare.js';
import * as carriers from './ui/pages/carriers.js';
import * as customers from './ui/pages/customers.js';
import * as covers from './ui/pages/covers.js';
import * as inquiry from './ui/pages/inquiry.js';
import * as zipmap from './ui/pages/zipmap.js';
import * as drafts from './ui/pages/drafts.js';
import * as manual from './ui/pages/manual.js';
import * as system from './ui/pages/system.js';
import * as account from './ui/pages/account.js';
import { initBridge, onBridge } from './store/bridge.js';
import { startWeather } from './store/weather.js';
import { paceStats } from './core/coverlog.js';
import { icon } from './ui/icons.js';
import { initials } from './ui/chrome.js';
import { initAppearance, syncFromStore, readMirror, getAppearance, resolvedMode, toggleMode, onAppearance } from './ui/appearance.js';

// group = heading in the sidebar. `icon` = ui/icons.js name.
export const TABS = [
  { id: 'home', label: 'Home', icon: 'home', group: 'Workspace', page: home },
  { id: 'board', label: 'Freight Signal', icon: 'board', group: 'Workspace', page: board },
  { id: 'covers', label: 'Cover Log', icon: 'covers', group: 'Workspace', page: covers },
  { id: 'spare', label: 'Spare Load Details', icon: 'spare', group: 'Workspace', page: spare },
  { id: 'carriers', label: 'Carrier Database', icon: 'carriers', group: 'Network', page: carriers },
  { id: 'customers', label: 'Customer Database', icon: 'customers', group: 'Network', page: customers },
  { id: 'inquiry', label: 'Inquiry Log', icon: 'inquiry', group: 'Network', page: inquiry },
  { id: 'drafts', label: 'Drafts', icon: 'drafts', group: 'Network', page: drafts },
  { id: 'zipmap', label: 'ZIP Map', icon: 'zipmap', group: 'Tools', page: zipmap },
  { id: 'manual', label: 'User Manual', icon: 'manual', group: 'Tools', page: manual },
  { id: 'system', label: 'System', icon: 'system', group: 'Settings', page: system },
  { id: 'account', label: 'Account Settings', icon: 'palette', group: 'Settings', page: account },
];

const view = document.getElementById('view');
const nav = document.getElementById('nav');
let current = null;
let editing = false;

const tabFromHash = () => { const id = location.hash.replace(/^#\/?/, '').split('?')[0] || 'home'; return TABS.find(t => t.id === id) || TABS[0]; };

function renderNav() {
  clear(nav);
  let grp = '';
  for (const t of TABS) {
    if (t.group !== grp) { grp = t.group; nav.appendChild(h('div', { class: 'grp' }, grp)); }
    const badge = t.id === 'drafts' && state.drafts.length ? h('span', { class: 'badge' }, state.drafts.length) : null;
    nav.appendChild(h('a', { href: '#/' + t.id, dataset: { tab: t.id }, title: t.label, class: current && current.id === t.id ? 'active' : '', 'aria-current': current && current.id === t.id ? 'page' : null },
      icon(t.icon, 19), h('span', { class: 'lbl' }, t.label), badge));
  }
  nav.appendChild(h('div', { class: 'side-foot' }, icon('shield', 15), h('span', null, 'All data stays in this browser. Nothing is sent automatically.')));
  renderChrome();
}

/** Header pieces that depend on state: ZIP status, theme button, profile chip. */
export function renderChrome() {
  const zs = document.getElementById('zipstat');
  zs.textContent = state.zip ? `ZIP Map: ${state.zip.size.toLocaleString()} rows` : 'ZIP Map: not loaded';
  zs.className = 'pill' + (state.zip ? '' : ' warn');
  renderPace();
  const light = resolvedMode() === 'light';
  const tb = document.getElementById('themebtn');
  clear(tb); tb.append(icon(light ? 'moon' : 'sun', 16), h('span', null, light ? 'Dark mode' : 'Light mode'));
  const ab = document.getElementById('appearbtn'); if (!ab.firstChild) ab.appendChild(icon('palette', 17));
  const nt = document.getElementById('navtoggle'); if (!nt.firstChild) nt.appendChild(icon('menu', 18));
  const pf = state.settings.profile || {};
  const chip = document.getElementById('profilechip'); clear(chip);
  const ini = initials(pf.name);
  chip.append(h('span', { class: 'avatar' }, ini || icon('user', 16)),
    h('span', { class: 'who' }, h('b', null, pf.name || 'Account'), h('small', null, pf.title || 'Settings and themes')));
}

/** Top-right cover pace tracker: covers today, covers this week, and where the week is heading against the floor. */
export function renderPace() {
  const el = document.getElementById('pace'); if (!el) return;
  clear(el);
  const p = paceStats(state.coverLog, state.settings, new Date(), null);
  el.className = 'pace-strip ' + p.status;
  el.title = p.text + (p.status === 'early' ? '' : ` You need about ${p.perDay} a day for the rest of the week.`) + ' Click for the Cover Log.';
  el.append(
    h('span', { class: 'pc' }, h('b', null, p.today), h('small', null, 'today')),
    h('span', { class: 'pc' }, h('b', null, p.week), h('small', null, `week / ${p.floor}`)),
    h('span', { class: 'pc proj' }, h('b', null, p.projection === null ? '–' : p.projection), h('small', null, p.projection === null ? 'early' : (p.status === 'on' ? 'on pace' : p.status === 'close' ? 'just short' : 'short'))));
}

let renderPending = false;

/** Typing detection: an input/textarea the user has changed but not yet committed must never be wiped by a re-render. */
view.addEventListener('input', (e) => { const t = e.target; if (t && t.dataset && !('live' in t.dataset) && !('rerender' in t.dataset)) t.dataset.dirty = '1'; });
view.addEventListener('change', (e) => { const t = e.target; if (t && t.dataset) delete t.dataset.dirty; });
view.addEventListener('focusout', (e) => {
  const t = e.target;
  if (t && t.dataset && t.dataset.dirty) { delete t.dataset.dirty; }
  if (renderPending) setTimeout(() => { if (renderPending) render(); }, 0);
});

const isTextual = (el) => /^(INPUT|TEXTAREA)$/.test(el.tagName) && !/^(checkbox|radio|button|submit|file)$/.test(el.type || '');

export async function render() {
  const t = tabFromHash();
  const changed = !current || current.id !== t.id;
  current = t;
  renderNav();
  const a = document.activeElement;
  // Never wipe the page while the user is mid-typing (a cell with uncommitted text). Re-render as soon as they leave it.
  if (!changed && a && view.contains(a) && isTextual(a) && a.dataset.dirty) { renderPending = true; return; }
  renderPending = false;
  const scroll = view.scrollTop;
  // Remember which control had focus so the re-render does not kick the user out of the cell they just edited.
  const fk = !changed && a && view.contains(a) ? a.getAttribute('data-fk') : null;
  const sel = fk && isTextual(a) ? (() => { try { return [a.selectionStart, a.selectionEnd]; } catch { return null; } })() : null;
  clear(view);
  if (changed) {
    document.getElementById('app').classList.remove('nav-open');
    view.classList.add('route-enter'); setTimeout(() => view.classList.remove('route-enter'), 520);
  }
  try { view.appendChild(await t.page.render()); }
  catch (e) { console.error(e); view.appendChild(h('div', { class: 'banner err' }, 'This page failed to render: ' + (e.message || e))); }
  if (!changed) view.scrollTop = scroll;
  if (fk) {
    const el = [...view.querySelectorAll('[data-fk]')].find(x => x.getAttribute('data-fk') === fk);
    if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* number inputs */ } } }
  }
}

// Apply the last saved look immediately (from the localStorage mirror), then reconcile with IndexedDB once it has loaded.
initAppearance({ read: readMirror, write: (a) => actions.savePrefs({ appearance: a, theme: resolvedMode(a) }) });

async function boot() {
  const zipFetcher = async () => {
    // Single-file build: the ZIP Map is embedded (gzip + base64) so the page works when opened straight from disk.
    if (typeof globalThis.__FS_EMBEDDED_ZIP === 'string') {
      const bin = Uint8Array.from(atob(globalThis.__FS_EMBEDDED_ZIP), (c) => c.charCodeAt(0));
      const text = await new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
      return { text, source: 'embedded uszips.csv' };
    }
    const r = await fetch('data/uszips.csv'); if (!r.ok) throw new Error('HTTP ' + r.status);
    return { text: await r.text(), source: 'bundled data/uszips.csv' };
  };
  try { await loadAll(zipFetcher); }
  catch (e) {
    console.error(e);
    view.replaceChildren(h('div', { class: 'banner err' }, 'Storage could not be opened: ' + (e.message || e) + '. Freight Signal needs IndexedDB (not available in some private/guest windows). Use a normal Chrome or Edge profile.'));
    return;
  }
  // The stored appearance wins over the localStorage mirror used for the flash-free first paint.
  syncFromStore(state.settings.appearance);
  document.getElementById('themebtn').addEventListener('click', () => { toggleMode(); });
  onAppearance(() => renderChrome());
  document.getElementById('navtoggle').addEventListener('click', () => document.getElementById('app').classList.toggle('nav-open'));
  document.getElementById('navscrim').addEventListener('click', () => document.getElementById('app').classList.remove('nav-open'));
  const startPage = (state.settings.profile || {}).startPage;
  if (!location.hash && startPage && startPage !== 'home' && TABS.some(t => t.id === startPage)) location.hash = '#/' + startPage;
  window.addEventListener('hashchange', render);
  subscribe(() => { syncFromStore(state.settings.appearance); render(); });
  await render();
  onBridge(() => { if (current && (current.id === 'system' || current.id === 'drafts')) render(); });
  initBridge();
  startWeather();
  // Housekeeping: retire loads past pickup, refresh the time-based flags and the pace tracker.
  const tick = async () => { try { const n = await actions.expireDue(); if (n) toast(`${n} load${n === 1 ? '' : 's'} past pickup moved to the Cover Log (Expired). You can restore them there.`, 'info', 8000); } catch (e) { console.error(e); } };
  tick();
  let beat = 0;
  setInterval(() => { renderPace(); if (++beat % 5 === 0 && !document.hidden) { tick().then(() => render()); } }, 60000);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
window.addEventListener('error', (e) => toast('Unexpected error: ' + e.message, 'err', 8000));
window.addEventListener('unhandledrejection', (e) => toast('Unexpected error: ' + (e.reason && e.reason.message || e.reason), 'err', 8000));
boot();
