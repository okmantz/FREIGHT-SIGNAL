// Shared building blocks for the list pages (Carrier Database, Customer Database, Cover Log, Inquiry Log, Spare Load Details), v17.
// One look everywhere: a toolbar with big search + quick views, quiet filters, optional grouping, compact rows that open into a detail card.
// Builds elements with h() only (no innerHTML, no style attributes), so the strict CSP stays valid.

import { h, wirePopover } from './dom.js';
import { icon } from './icons.js';
import { highlightParts } from '../core/search.js';

export const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');

/** "Today", "3 d ago", "5 wk ago", "4 mo ago", "Never". */
export function relDate(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return 'Never';
  const d = Math.floor((now - t) / DAY);
  if (d < 0) return 'Upcoming'; if (d === 0) return 'Today'; if (d === 1) return 'Yesterday'; if (d < 14) return d + ' d ago'; if (d < 60) return Math.round(d / 7) + ' wk ago'; if (d < 700) return Math.round(d / 30) + ' mo ago'; return Math.round(d / 365) + ' yr ago';
}
/** A colour class for how recent something is: fresh (< 7 d), warm (< 30 d), cold (older), none (never). */
export function recency(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return 'none';
  const d = (now - t) / DAY; return d < 7 ? 'fresh' : d < 30 ? 'warm' : 'cold';
}
export const shortDate = (iso) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : `${t.getMonth() + 1}/${t.getDate()}/${String(t.getFullYear()).slice(2)}`; };

const hashOf = (s) => { let x = 0; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x; };
/** Round initials chip, colour picked from the name so the same company always looks the same. */
export function avatar(name, { square = false } = {}) {
  const parts = String(name || '').replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const ini = ((parts[0] || '?')[0] + (parts.length > 1 ? parts[1][0] : '')).toUpperCase();
  return h('span', { class: 'dir-av av-' + (hashOf(name || '?') % 8) + (square ? ' sq' : ''), 'aria-hidden': 'true' }, ini);
}
export const chip = (text, cls = '') => (String(text || '').trim() ? h('span', { class: 'dir-chip ' + cls }, text) : null);
export function chips(list, max = 2) {
  const l = list.filter(Boolean); if (!l.length) return h('span', { class: 'dir-none' }, '—');
  return h('span', { class: 'dir-chips' }, l.slice(0, max).map(x => chip(x)), l.length > max ? h('span', { class: 'dir-chip more', title: l.slice(max).join(', ') }, '+' + (l.length - max)) : null);
}
/** Status as a dot + word. tone: good | warn | bad | muted | accent (guessed from the text when omitted). */
export function statusPill(text, tone) {
  const t = String(text || '').trim() || 'Active'; const l = t.toLowerCase();
  const tn = tone || (/^(active|covered|approved|yes|open|won|booked)/.test(l) ? 'good' : /(inactive|expired|closed|declined|no$|lost|dnc|do not)/.test(l) ? 'muted' : /(pending|follow|review|new|hold)/.test(l) ? 'warn' : 'accent');
  return h('span', { class: 'stat-pill s-' + tn }, h('i', { 'aria-hidden': 'true' }), t);
}
/** Dot + relative date for "last contacted" style columns. */
export const whenCell = (iso, now = Date.now()) => h('span', { class: 'when r-' + recency(iso, now), title: iso ? shortDate(iso) : 'Never' }, h('i', { 'aria-hidden': 'true' }), relDate(iso, now));

/** Quick views: a row of pill buttons with counts. options = [[value, label, count]] */
export function segmented(options, value, onChange, label = 'View') {
  return h('div', { class: 'dir-seg', role: 'group', 'aria-label': label }, options.map(([v, l, n]) =>
    h('button', { type: 'button', class: 'seg' + (v === value ? ' on' : ''), 'aria-pressed': String(v === value), 'data-view': v, onclick: () => onChange(v) }, l, n !== undefined ? h('b', null, n) : null)));
}

/**
 * A search box with a magnifier. It filters as you type (a short pause after the last key, never while an IME is composing),
 * Enter filters at once, Escape clears. The page redraws itself, so the box carries data-fk and keeps focus and the caret.
 */
export function searchBox(value, placeholder, onInput, onEnter) {
  const input = h('input', { type: 'search', placeholder, value, 'data-rerender': '', 'data-fk': 'dir:search', autocomplete: 'off', spellcheck: 'false', 'aria-label': placeholder });
  let timer = 0, composing = false;
  const fire = () => { clearTimeout(timer); onEnter(); };
  input.addEventListener('compositionstart', () => { composing = true; });
  input.addEventListener('compositionend', () => { composing = false; onInput(input.value); timer = setTimeout(fire, 120); });
  input.addEventListener('input', () => { onInput(input.value); if (composing) return; clearTimeout(timer); timer = setTimeout(fire, 130); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') fire();
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; onInput(''); fire(); }
  });
  return h('label', { class: 'dir-search' }, icon('search', 16), input);
}

/** Text with the parts that matched the search marked. terms = the parsed query's terms. */
export function marked(text, terms) {
  const parts = highlightParts(text, terms);
  if (parts.length === 1 && !parts[0].hit) return parts[0].text;
  return parts.map(p => (p.hit ? h('mark', { class: 'hl' }, p.text) : p.text));
}

/**
 * The gold star that marks a primary carrier (a backup carrier gets a quieter outlined one). info = { level, lanes[] } from primaryMap().
 * Sits on the corner of the avatar so the name line stays clean; hover shows which lanes the carrier is first for.
 */
export function primaryBadge(info, { size = 11 } = {}) {
  if (!info) return null;
  const lanes = info.lanes.slice(0, 3).join('; ') + (info.lanes.length > 3 ? ' and ' + (info.lanes.length - 3) + ' more' : '');
  const label = (info.level === 'backup' ? 'Backup carrier for ' : 'Primary carrier for ') + lanes;
  return h('span', { class: 'pstar ' + info.level, title: label, role: 'img', 'aria-label': label, 'data-primary': info.level }, icon('star', size));
}
/** The initials avatar with the primary star pinned to its corner (plain avatar when the carrier is not primary). */
export function avatarWithStar(name, info, opts) {
  const a = avatar(name, opts);
  return info ? h('span', { class: 'dir-avwrap' }, a, primaryBadge(info)) : a;
}

/**
 * "More" menu: a button that opens a short list of actions. items = [[label, iconName, onClick, {disabled, danger, title, act}]]
 * v23: the list is placed by wirePopover (fixed to the screen, kept inside the window, flips above when there is no room below), so it can
 * no longer be cut off by the sidebar or the page edge. The old per-render document click listener is gone (one shared listener closes menus).
 */
export function moreMenu(label, items, { iconName = 'more', cls = '' } = {}) {
  const d = h('details', { class: 'dir-menu ' + cls });
  const close = () => { d.open = false; };
  const list = h('div', { class: 'dir-menu-list', role: 'menu' }, items.filter(Boolean).map(([l, ic, fn, o = {}]) =>
    h('button', { type: 'button', role: 'menuitem', class: 'dir-mi' + (o.danger ? ' danger' : ''), disabled: o.disabled, title: o.title, 'data-act': o.act, onclick: () => { close(); fn(); } }, ic ? icon(ic, 15) : null, l)));
  d.append(h('summary', { class: 'btn', 'aria-label': label || 'More', 'aria-haspopup': 'menu', title: 'More actions: import, export, copy for Excel and clean-up' }, label ? [label, icon('chevdown', 13)] : icon(iconName, 16)), list);
  return wirePopover(d, list);
}

/** Labelled <select> that sits quietly in a filter row. */
export function filterSelect(label, options, value, onChange, fk = '') {
  const s = h('select', { class: 'cell dir-sel' + (value ? ' on' : ''), 'aria-label': label, title: label, 'data-fk': fk ? 'f:' + fk : null },
    h('option', { value: '' }, label), options.map(([v, t]) => h('option', { value: v, selected: v === value }, t ?? v)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

/**
 * A table body where each record is two rows: the compact row and a detail row that opens when you click it.
 * rows = [{ id, cells:[td...], detail: Node, cls }]. open = Set of ids that stay open across redraws. colspan = number of columns.
 */
export function expandRows(rows, open, colspan) {
  const out = [];
  for (const r of rows) {
    const isOpen = open.has(r.id);
    const main = h('tr', { class: 'dir-row ' + (r.cls || '') + (isOpen ? ' open' : ''), 'aria-expanded': String(isOpen), 'data-id': r.id, tabindex: '0' }, r.cells);
    const det = h('tr', { class: 'dir-detail', hidden: !isOpen }, h('td', { colspan }, r.detail));
    const toggle = () => { const now = det.hidden; det.hidden = !now; main.classList.toggle('open', now); main.setAttribute('aria-expanded', String(now)); if (now) open.add(r.id); else open.delete(r.id); };
    main.addEventListener('click', (e) => { if (e.target.closest('a, button, input, select, textarea, details, label')) return; toggle(); });
    main.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === main) { e.preventDefault(); toggle(); } });
    out.push(main, det);
  }
  return out;
}

/** A section divider row inside a grouped table. */
export const groupRow = (label, count, colspan) => h('tr', { class: 'dir-group' }, h('td', { colspan }, h('span', { class: 'dir-gname' }, label || '(none)'), h('span', { class: 'dir-gcount' }, count)));

/** Group records by a key function; groups are sorted by name with the empty group last. Returns [[name, [records]]]. */
export function groupBy(list, keyFn) {
  const m = new Map();
  for (const r of list) { const k = String(keyFn(r) || '').trim(); (m.get(k) || m.set(k, []).get(k)).push(r); }
  return [...m.entries()].sort((a, b) => (a[0] === '') - (b[0] === '') || a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }));
}

/** The opened card of a record: a labelled grid of the fields that have a value, then an action row. fields = [[label, value|Node, wide?]] */
export function detailCard({ fields, notes, actions }) {
  const shown = fields.filter(([, v]) => v !== '' && v !== null && v !== undefined && !(typeof v === 'string' && !v.trim()));
  return h('div', { class: 'dir-card' },
    shown.length ? h('dl', { class: 'dir-grid' }, shown.map(([l, v, wide]) => h('div', { class: wide ? 'wide' : '' }, h('dt', null, l), h('dd', null, v)))) : h('p', { class: 'muted' }, 'No more details on file.'),
    notes && String(notes).trim() ? h('div', { class: 'dir-notes' }, h('b', null, 'Notes'), h('p', null, notes)) : null,
    actions && actions.length ? h('div', { class: 'dir-actions' }, actions) : null);
}

/** A link-ish line for contact details: mail and phone stacked, each a one-click link. */
export function contactStack({ email, phone }, { telHref, mailHref }) {
  const e = String(email || '').trim(), p = String(phone || '').trim();
  if (!e && !p) return h('span', { class: 'dir-none' }, '—');
  return h('div', { class: 'dir-stack' },
    e ? (mailHref(e) ? h('a', { class: 'xlink dir-line', href: mailHref(e), title: 'Write to ' + e }, icon('mail', 13), e) : h('span', { class: 'dir-line' }, e)) : null,
    p ? (telHref(p) ? h('a', { class: 'xlink dir-line', href: telHref(p), title: 'Call ' + p }, icon('phone', 13), p) : h('span', { class: 'dir-line' }, p)) : null);
}

/** Totals strip under the toolbar: "37 of 212 shown" + an optional clear button. */
export const countLine = (shown, total, extra) => h('div', { class: 'dir-count' }, h('span', null, `${shown} of ${total} shown`), extra || null);
