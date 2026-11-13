import { h, clear, toast, confirmDialog } from './ui/dom.js';
import { state, subscribe, loadAll, reloadStores, actions } from './store/state.js';
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
import { paceStats, nextWeekStart, weekRangeText } from './core/coverlog.js';
import { icon } from './ui/icons.js';
import { initials } from './ui/chrome.js';
import * as cloud from './store/cloud.js';
import * as local from './store/localacct.js';
import './ui/install.js';
import { showCloudGate } from './ui/cloudgate.js';
import { maybeStartTour } from './ui/tour.js';
import { celebrate } from './ui/celebrate.js';
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
  nav.appendChild(h('div', { class: 'side-foot' }, icon('shield', 15), h('span', null, cloud.enabled() ? 'Your workspace is saved to your own private account. No e-mail is ever sent automatically.' : 'All data stays in this browser. Nothing is sent automatically.')));
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
  const acct = cloud.enabled() ? cloud.user() : local.user();
  const chip = document.getElementById('profilechip'); clear(chip);
  const ini = initials(pf.name) || (acct ? acct.email[0].toUpperCase() : '');
  chip.append(h('span', { class: 'avatar' }, ini || icon('user', 16)),
    h('span', { class: 'who' }, h('b', null, pf.name || (acct ? acct.email.split('@')[0] : 'Account')), h('small', null, pf.title || (acct ? acct.email : 'Settings and themes'))));
  const so = document.getElementById('signoutbtn');
  if (so) { so.hidden = !(cloud.enabled() ? cloud.user() : local.user()); if (!so.firstChild) so.appendChild(icon('logout', 17)); }
  renderSync(cloud.getStatus());
}

/** Header pill showing whether the workspace is saved to the account. Hidden when cloud accounts are not set up. */
const SYNC_TEXT = { synced: ['Saved to account', ''], saving: ['Saving…', ''], offline: ['Offline: will sync', ' warn'], error: ['Sync problem', ' warn'], off: ['', ''] };
function renderSync(st) {
  const el = document.getElementById('syncstat'); if (!el) return;
  if (!cloud.enabled() || !cloud.user()) { el.hidden = true; return; }
  const [text, cls] = SYNC_TEXT[st.status] || SYNC_TEXT.off;
  el.hidden = !text; el.textContent = text; el.className = 'pill' + cls;
  el.title = st.detail || (st.status === 'synced' ? 'Everything is saved to your account.' : '');
}

/** Top-right cover pace tracker: covers today, covers this week, and where the week is heading against the floor. */
export function renderPace() {
  const el = document.getElementById('pace'); if (!el) return;
  clear(el);
  const p = paceStats(state.coverLog, state.settings, new Date(), null);
  el.className = 'pace-strip ' + p.status;
  el.title = p.text + (p.status === 'early' ? '' : ` You need about ${p.perDay} a day for the rest of the week.`) + ` Week: ${weekRangeText(new Date())}; the count resets Monday 12:00 AM.` + ' Click for the Cover Log.';
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

/** First sign-in on a browser that already holds data from before accounts existed: offer to move it into the account. */
async function offerLegacyImport() {
  const c = await cloud.legacySummary();
  if (!c) { cloud.markLegacyHandled(); return; }
  const parts = [[c.postings, 'load posting'], [c.carriers, 'carrier'], [c.customers, 'customer'], [c.inquiries, 'inquiry'], [c.spares, 'spare load']].filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? '' : 's'}`);
  const yes = await confirmDialog('Add your existing data to this account?', `This browser already holds Freight Signal data from before accounts existed (${parts.join(', ') || 'settings only'}). Add it to the account you just signed in with? It will then be saved to the cloud and follow you to other computers. Only say yes if this data is yours.`, 'Add it to my account');
  cloud.markLegacyHandled();
  if (yes) await cloud.importLegacy();
}

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
  const cloudOn = cloud.enabled();
  if (!cloudOn) {
    // Local accounts: several people can each have an account on this computer; each gets their own on-device database.
    if (!local.restoreSession()) await showCloudGate({ local: true });
    try { await local.activate(); }
    catch (e) { console.error(e); view.replaceChildren(h('div', { class: 'banner err' }, 'Storage could not be opened: ' + (e.message || e) + '. Freight Signal needs IndexedDB (not available in some private/guest windows). Use a normal Chrome or Edge profile.')); return; }
  }
  if (cloudOn) {
    // Cloud accounts: sign in first (the saved sign-in needs no network), then open THIS person's copy of the data.
    if (!cloud.restoreSession()) await showCloudGate();
    try {
      await cloud.activate();
      const { fresh } = await cloud.initialSync();
      if (fresh && !cloud.legacyHandled()) await offerLegacyImport();
    } catch (e) {
      console.error(e);
      if (e.code === 'auth') { await cloud.dropSession(); location.reload(); return; }
      view.replaceChildren(h('div', { class: 'banner err' }, 'Your workspace could not be loaded: ' + (e.message || e)),
        h('p', null, h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, 'Try again'), ' ',
          h('button', { class: 'btn', type: 'button', onclick: async () => { await cloud.dropSession(); location.reload(); } }, 'Sign out')));
      return;
    }
  }
  try { await loadAll(zipFetcher); }
  catch (e) {
    console.error(e);
    view.replaceChildren(h('div', { class: 'banner err' }, 'Storage could not be opened: ' + (e.message || e) + '. Freight Signal needs IndexedDB (not available in some private/guest windows). Use a normal Chrome or Edge profile.'));
    return;
  }
  // The stored appearance wins over the localStorage mirror used for the flash-free first paint.
  syncFromStore(state.settings.appearance);
  // First visit: ask for an e-mail and a password. Later visits: sign in. (Skipped when the person chose "Skip for now".)
  document.getElementById('signoutbtn').addEventListener('click', async () => {
    if (!cloudOn) { local.signOut(); location.reload(); return; }
    toast('Saving your changes, then signing out…', 'info', 6000);
    try { await cloud.signOut(); } catch (e) { console.error(e); await cloud.dropSession(); }
    location.reload();
  });
  document.getElementById('themebtn').addEventListener('click', () => { toggleMode(); });
  onAppearance(() => renderChrome());
  document.getElementById('navtoggle').addEventListener('click', () => document.getElementById('app').classList.toggle('nav-open'));
  document.getElementById('navscrim').addEventListener('click', () => document.getElementById('app').classList.remove('nav-open'));
  const startPage = (state.settings.profile || {}).startPage;
  if (!location.hash && startPage && startPage !== 'home' && TABS.some(t => t.id === startPage)) location.hash = '#/' + startPage;
  window.addEventListener('hashchange', render);
  subscribe(() => { syncFromStore(state.settings.appearance); render(); });
  await render();
  // The weekly cover count resets at 12:00 AM Monday (the moment Sunday ends). Re-draw exactly then, even if the app was left open all weekend.
  const rollover = () => { const ms = Math.max(1000, nextWeekStart(new Date()).getTime() - Date.now() + 2000); setTimeout(() => { renderPace(); render(); rollover(); }, Math.min(ms, 2 ** 31 - 1)); };
  rollover();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderPace(); render(); } });   // a laptop that slept through the rollover catches up on wake
  state.hooks.onWeeklyGoal = (g) => celebrate(g);
  if (cloudOn) {
    const NAMES = { postings: 'loads', carriers: 'carriers', inquiries: 'the inquiry log', outreach: 'outreach history', spares: 'spare loads', drafts: 'drafts', kv: 'settings', customers: 'customers', coverLog: 'the cover log' };
    const list = (ss) => ss.map(s => NAMES[s] || s).join(', ');
    cloud.setHooks({
      onRemoteChange: async (stores) => { await reloadStores(); toast('Updated from your other device: ' + list(stores) + '.', 'info', 6000); },
      onConflict: (stores) => toast('Another device saved changes to ' + list(stores) + ' while you were editing here. This device\'s version was kept.', 'warn', 12000),
      onAuthLost: () => { toast('Your sign-in has expired. Please sign in again.', 'err', 6000); setTimeout(async () => { await cloud.dropSession(); location.reload(); }, 2500); },
    });
    cloud.onStatus(renderSync);
    cloud.start();
  }
  setTimeout(maybeStartTour, 350);                        // first login only: the 60-second guided tour
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
