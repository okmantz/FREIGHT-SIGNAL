// The guided first-login tour: a spotlight on the part of the app each step is about, with a small card beside it.
// Shown once after the first sign-in (state.settings.tour.done remembers it) and any time from "Take the tour" on Home.
// Wording and targets live in core/tourSteps.js. Everything is built with h() (no innerHTML) and positioned through the CSSOM, which the
// app's strict CSP allows.

import { h } from './dom.js';
import { icon } from './icons.js';
import { state, actions } from '../store/state.js';
import { TOUR_STEPS, TOUR_VERSION } from '../core/tourSteps.js';

export const tourDone = () => !!(state.settings.tour && state.settings.tour.done);

let open = null;                    // the running tour, if any

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (list) => { for (const sel of list || []) { const el = document.querySelector(sel); if (el && el.getClientRects().length) return el; } return null; };

async function waitFor(list, ms = 2400) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const el = find(list); if (el) return el; await sleep(80); }
  return null;
}

/** Start the tour. `from` = step index to begin at (default 0). Safe to call twice: a running tour is left alone. */
export function startTour({ from = 0 } = {}) {
  if (open) return;
  const steps = TOUR_STEPS;
  let i = Math.max(0, Math.min(steps.length - 1, from));
  const returnFocus = document.activeElement;

  const dim = h('div', { class: 'tour-dim' });
  const spot = h('div', { class: 'tour-spot', hidden: true });
  const title = h('h3', { id: 'tour-title' });
  const body = h('p', { class: 'tour-body' });
  const count = h('span', { class: 'tour-count' });
  const bar = h('span', { class: 'tour-bar' }, h('i'));
  const ico = h('span', { class: 'tour-ico' });
  const back = h('button', { class: 'btn', type: 'button' }, 'Back');
  const next = h('button', { class: 'btn primary', type: 'button' });
  const skip = h('button', { class: 'tour-skip', type: 'button' }, 'Skip tour');
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tour-title' },
    h('div', { class: 'tour-head' }, ico, count, skip), bar, title, body, h('div', { class: 'tour-foot' }, back, next));
  const layer = h('div', { class: 'tour-layer' }, dim, spot, card);
  document.body.appendChild(layer);
  document.documentElement.classList.add('touring');

  let target = null; let token = 0; let raf = 0;
  const app = document.getElementById('app');

  const place = () => {
    raf = 0;
    target = find(steps[i].target);
    const small = window.innerWidth < 720;
    card.classList.toggle('sheet', small);
    dim.classList.toggle('solid', !target);
    if (!target) { spot.hidden = true; card.style.left = ''; card.style.top = ''; card.classList.add('center'); return; }
    card.classList.remove('center');
    const r = target.getBoundingClientRect();
    const pad = 7;
    spot.hidden = false;
    spot.style.left = `${Math.round(r.left - pad)}px`; spot.style.top = `${Math.round(r.top - pad)}px`;
    spot.style.width = `${Math.round(r.width + pad * 2)}px`; spot.style.height = `${Math.round(r.height + pad * 2)}px`;
    if (small) { card.style.left = ''; card.style.top = ''; return; }
    const vw = window.innerWidth, vh = window.innerHeight, cw = card.offsetWidth || 380, ch = card.offsetHeight || 230, gap = 18;
    const clampX = (x) => Math.max(12, Math.min(vw - cw - 12, x)); const clampY = (y) => Math.max(12, Math.min(vh - ch - 12, y));
    let x, y;
    if (r.right + gap + cw <= vw - 12) { x = r.right + gap; y = clampY(r.top); }                       // beside it
    else if (r.left - gap - cw >= 12) { x = r.left - gap - cw; y = clampY(r.top); }
    else if (r.bottom + gap + ch <= vh - 12) { x = clampX(r.left); y = r.bottom + gap; }               // under it
    else if (r.top - gap - ch >= 12) { x = clampX(r.left); y = r.top - gap - ch; }                     // over it
    else { x = clampX((vw - cw) / 2); y = vh - ch - 16; }                                              // a huge target: dock at the bottom
    card.style.left = `${Math.round(x)}px`; card.style.top = `${Math.round(y)}px`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(place); };
  window.addEventListener('resize', schedule); window.addEventListener('scroll', schedule, true);
  const poll = setInterval(schedule, 350);                // the page re-renders now and then; follow the element, not a stale reference

  const finish = (completed) => {
    clearInterval(poll); window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); document.removeEventListener('keydown', onKey, true);
    cancelAnimationFrame(raf);
    layer.remove(); document.documentElement.classList.remove('touring'); if (app) app.classList.remove('nav-open');
    open = null; token++;
    actions.savePrefs({ tour: { done: true, at: new Date().toISOString(), v: TOUR_VERSION, completed: !!completed } }).catch(() => {});
    if (completed) location.hash = '#/board';
    try { if (returnFocus && returnFocus.focus) returnFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  };

  const show = async (n) => {
    i = n; const mine = ++token; const s = steps[i];
    ico.replaceChildren(icon(s.icon || 'info', 18));
    title.textContent = s.title; body.textContent = s.body;
    count.textContent = `Step ${i + 1} of ${steps.length}`;
    bar.firstChild.style.width = `${Math.round(((i + 1) / steps.length) * 100)}%`;
    back.disabled = i === 0; back.hidden = i === 0;
    next.textContent = s.next || (i === steps.length - 1 ? 'Finish' : 'Next');
    next.replaceChildren(next.textContent, icon(i === steps.length - 1 ? 'check' : 'chevright', 15));
    // go to the right page, then find the thing to point at
    if (s.route && location.hash !== s.route) location.hash = s.route;
    const wantsNav = (s.target || []).some((t) => t.startsWith('#nav'));
    if (app) app.classList.toggle('nav-open', wantsNav && window.innerWidth < 900);
    const el = await waitFor(s.target);
    if (mine !== token) return;
    if (el) { try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* ignore */ } }
    place();
    next.focus({ preventScroll: true });
  };

  next.addEventListener('click', () => { if (i >= steps.length - 1) finish(true); else show(i + 1); });
  back.addEventListener('click', () => { if (i > 0) show(i - 1); });
  skip.addEventListener('click', () => finish(false));
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next.click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); back.click(); }
    else if (e.key === 'Tab') {                                   // keep keyboard focus inside the card
      const f = [...card.querySelectorAll('button:not([disabled]):not([hidden])')]; if (!f.length) return;
      const a = f.indexOf(document.activeElement);
      if (e.shiftKey && a <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && a === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  }
  document.addEventListener('keydown', onKey, true);
  open = { finish };
  show(i);
}

/** First visit: show the tour once. Called after the first render, so the page behind it is ready. */
export function maybeStartTour() {
  if (!tourDone() && !open) startTour();
}
