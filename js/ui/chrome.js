// Small shared building blocks so every page looks like it belongs to the same app.
import { h } from './dom.js';
import { icon } from './icons.js';

/** The heading every page starts with: icon chip, title, one-line description and optional actions. */
export function pageHead({ icon: ic, title, sub, actions }) {
  return h('div', { class: 'pagehead' },
    ic ? h('div', { class: 'ph-icon' }, icon(ic, 24)) : null,
    h('div', { class: 'ph-text' }, h('h2', null, title), sub ? h('p', null, sub) : null),
    actions && actions.length ? h('div', { class: 'ph-actions' }, actions) : null);
}

/** Friendly empty state (a dashed card with an icon). */
export function emptyState({ icon: ic = 'info', title, text, actions }) {
  return h('div', { class: 'empty' }, icon(ic, 30), h('b', null, title), text ? h('span', null, text) : null,
    actions && actions.length ? h('div', { class: 'toolbar' }, actions) : null);
}

/** A button with a leading icon. */
export function iconBtn(ic, label, props = {}) {
  const { class: cls = '', ...rest } = props;
  return h('button', { type: 'button', ...rest, class: ('btn ' + cls).trim() }, icon(ic, 15), label ? h('span', null, label) : null);
}

/** "Owen K Mantz" -> "OK". Empty name -> ''. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Time-of-day greeting for the Home page. */
export function greeting(d = new Date()) {
  const hr = d.getHours();
  return hr < 5 ? 'Working late' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

/**
 * Set inline-style properties THROUGH the CSSOM. The app's CSP forbids style="" attributes, but changing el.style
 * from script is allowed, so dynamic colours (swatches, previews) go through here instead of h({ style }).
 */
export function paint(el, props) {
  for (const [k, v] of Object.entries(props)) { if (k.startsWith('--')) el.style.setProperty(k, v); else el.style[k] = v; }
  return el;
}

/** Briefly mark a button as done (used after a copy). */
export function flash(btn, ms = 1300) {
  if (!btn) return;
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), ms);
}

/** A strip of stat tiles: [[value, label, tone?], ...]. tone = ok | act | urgent (colours the number). */
export function statTiles(items) {
  return h('div', { class: 'ovstrip', role: 'group', 'aria-label': 'Overview' }, items.filter(Boolean).map(([n, label, tone]) =>
    h('div', { class: 'ovtile ' + (tone && n ? 't-' + tone : '') }, h('b', null, n), h('span', null, label))));
}
