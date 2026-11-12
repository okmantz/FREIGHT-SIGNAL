import { h, clear, toast } from './ui/dom.js';
import { state, subscribe, loadAll, actions } from './store/state.js';
import * as home from './ui/pages/home.js';
import * as board from './ui/pages/board.js';
import * as spare from './ui/pages/spare.js';
import * as carriers from './ui/pages/carriers.js';
import * as inquiry from './ui/pages/inquiry.js';
import * as zipmap from './ui/pages/zipmap.js';
import * as drafts from './ui/pages/drafts.js';
import * as manual from './ui/pages/manual.js';
import * as system from './ui/pages/system.js';
import { initBridge, onBridge } from './store/bridge.js';

export const TABS = [
  { id: 'home', label: 'HOME', page: home },
  { id: 'board', label: 'FREIGHT SIGNAL', page: board },
  { id: 'spare', label: 'Spare Load Details', page: spare },
  { id: 'carriers', label: 'Carrier Database', page: carriers },
  { id: 'inquiry', label: 'Inquiry Log', page: inquiry },
  { id: 'zipmap', label: 'ZIP Map', page: zipmap },
  { id: 'drafts', label: 'Drafts', page: drafts },
  { id: 'manual', label: 'User Manual', page: manual },
  { id: 'system', label: 'System', page: system },
];

const view = document.getElementById('view');
const nav = document.getElementById('nav');
let current = null;
let editing = false;

const tabFromHash = () => { const id = location.hash.replace(/^#\/?/, '').split('?')[0] || 'home'; return TABS.find(t => t.id === id) || TABS[0]; };

function renderNav() {
  clear(nav);
  for (const t of TABS) {
    const badge = t.id === 'drafts' && state.drafts.length ? h('span', { class: 'badge' }, state.drafts.length) : null;
    nav.appendChild(h('a', { href: '#/' + t.id, dataset: { tab: t.id }, class: current && current.id === t.id ? 'active' : '' }, t.label, badge));
    if (t.id === 'manual') nav.appendChild(h('div', { class: 'sep' }));
  }
  const zs = document.getElementById('zipstat');
  zs.textContent = state.zip ? `ZIP Map: ${state.zip.size.toLocaleString()} rows` : 'ZIP Map: not loaded';
  zs.className = 'pill' + (state.zip ? '' : ' warn');
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
  try { view.appendChild(await t.page.render()); }
  catch (e) { console.error(e); view.appendChild(h('div', { class: 'banner err' }, 'This page failed to render: ' + (e.message || e))); }
  if (!changed) view.scrollTop = scroll;
  if (fk) {
    const el = [...view.querySelectorAll('[data-fk]')].find(x => x.getAttribute('data-fk') === fk);
    if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* number inputs */ } } }
  }
}

function applyTheme(t) {
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  document.getElementById('themebtn').textContent = t === 'light' ? 'Dark mode' : 'Light mode';
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
  try { await loadAll(zipFetcher); }
  catch (e) {
    console.error(e);
    view.replaceChildren(h('div', { class: 'banner err' }, 'Storage could not be opened: ' + (e.message || e) + '. Freight Signal needs IndexedDB (not available in some private/guest windows). Use a normal Chrome or Edge profile.'));
    return;
  }
  applyTheme(state.settings.theme);
  document.getElementById('themebtn').addEventListener('click', async () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next); await actions.saveSettings({ theme: next });
  });
  window.addEventListener('hashchange', render);
  subscribe(() => { render(); });
  await render();
  onBridge(() => { if (current && current.id === 'system') render(); });
  initBridge();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
window.addEventListener('error', (e) => toast('Unexpected error: ' + e.message, 'err', 8000));
window.addEventListener('unhandledrejection', (e) => toast('Unexpected error: ' + (e.reason && e.reason.message || e.reason), 'err', 8000));
boot();
