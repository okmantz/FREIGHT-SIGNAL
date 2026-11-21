// Avatars and the profile-picture picker (v18).
//   fillAvatar(el, { pic, text })   put the chosen chess piece (or the initial letter) into an .avatar element
//   profilePicker({ get, set, text })   the "Profile picture" chooser used on the Account page
import { h } from './dom.js';
import { icon } from './icons.js';
import { paint } from './chrome.js';
import { PIECES, picById } from '../core/profilepics.js';

/** Fill an .avatar element. No pic -> the initial letter(s) (or a user icon), exactly as before. */
export function fillAvatar(el, { pic = '', text = '' } = {}) {
  const p = picById(pic);
  el.textContent = '';
  el.classList.toggle('pfp', !!p);
  if (p) {
    paint(el, { '--ring': p.ring });
    el.append(h('img', { src: p.src, alt: '', width: 96, height: 96, draggable: 'false', decoding: 'async' }));
    el.setAttribute('data-pic', p.id);
  } else {
    el.style.removeProperty('--ring');
    el.removeAttribute('data-pic');
    el.append(text || icon('user', 16));
  }
  return el;
}

/** A ready-made avatar span. */
export const avatarEl = (opts = {}, cls = '') => fillAvatar(h('span', { class: ('avatar ' + cls).trim() }), opts);

/**
 * The picker: a row of round options (your initial first, then the six pieces). One is always selected.
 * get() -> current id ('' = initial); set(id) saves it; text = the initial letter(s) shown on the first option.
 * Arrow keys move between options (one tab stop for the whole group), Enter / Space picks.
 */
export function profilePicker({ get, set, text = '' }) {
  const wrap = h('div', { class: 'pp' });
  const grid = h('div', { class: 'pp-grid', role: 'radiogroup', 'aria-label': 'Profile picture' });
  const label = h('output', { class: 'pp-name', 'aria-live': 'polite' });
  const opts = [{ id: '', label: 'Initial', ring: '' }, ...PIECES];
  const btns = opts.map((o) => {
    const face = o.id ? avatarEl({ pic: o.id }, 'pp-face') : h('span', { class: 'avatar pp-face pp-initial' }, text || icon('user', 22));
    const b = h('button', { type: 'button', class: 'pp-opt', role: 'radio', 'aria-checked': 'false', 'aria-label': o.id ? o.label + ' chess piece' : 'Your initial', title: o.label, tabindex: '-1' },
      face, h('span', { class: 'pp-cap' }, o.label), h('i', { class: 'pp-tick', 'aria-hidden': 'true' }, icon('check', 11)));
    if (o.ring) paint(b, { '--ring': o.ring });
    b.dataset.id = o.id;
    b.addEventListener('click', () => { set(o.id); refresh(); b.focus(); });
    return b;
  });
  const refresh = () => {
    const cur = picById(get()) ? get() : '';
    let any = false;
    btns.forEach((b) => { const on = b.dataset.id === cur; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); if (on) any = true; });
    if (!any) btns[0].tabIndex = 0;
    const o = opts.find(x => x.id === cur) || opts[0];
    label.textContent = cur ? o.label : 'Initial';
  };
  grid.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
    if (!(e.key in keys)) return;
    e.preventDefault();
    const i = Math.max(0, btns.indexOf(document.activeElement));
    const n = keys[e.key] === 'first' ? 0 : keys[e.key] === 'last' ? btns.length - 1 : (i + keys[e.key] + btns.length) % btns.length;
    btns[n].click();
  });
  grid.append(...btns);
  wrap.append(h('div', { class: 'pp-head' }, h('b', null, 'Profile picture'), label), grid,
    h('small', { class: 'muted pp-hint' }, 'Pick a piece, or keep your initial. It shows next to your name at the top of every page.'));
  wrap.refresh = refresh; wrap.repaintInitial = (t) => { const i = btns[0].querySelector('.pp-initial'); if (i) { i.textContent = ''; i.append(t || icon('user', 22)); } };
  refresh();
  return wrap;
}
