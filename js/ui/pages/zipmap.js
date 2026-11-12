import { h, field, openExternal } from '../dom.js';
import { pageHead, emptyState } from '../chrome.js';
import { state } from '../../store/state.js';
import { ventuskyUrl } from '../../core/links.js';

let mode = 'search';
let query = '';
let center = '';
let minM = 20, maxM = 60;
const rerender = () => import('../../main.js').then(m => m.render());

export function render() {
  if (!state.zip) return h('div', { class: 'banner err' }, 'ZIP Map not loaded. Import uszips.csv in System.');
  const zm = state.zip;
  let out = [], note = '';
  if (mode === 'search') { out = zm.search(query, 150); note = query ? `${out.length}${out.length === 150 ? '+' : ''} match(es)` : 'First 150 rows. Search by ZIP, city, state or county.'; }
  else {
    const c = zm.findZip(center);
    if (!c) note = center ? 'Centre ZIP not found in the ZIP Map.' : 'Enter a centre ZIP.';
    else { out = zm.searchRadius(center, minM, maxM, 400); note = `${out.length} market(s) between ${minM} and ${maxM} miles of ${c.city}, ${c.state} ${c.zip} (best ZIP per city, nearest first).`; }
  }
  const inp = (val, set, props = {}) => { const el = h('input', { value: val, 'data-rerender': '', ...props }); el.addEventListener('input', () => set(el.value)); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') rerender(); }); return el; };
  return h('div', null,
    pageHead({ icon: 'zipmap', title: 'ZIP Map', sub: `${zm.size.toLocaleString()} rows • ${state.zipInfo.source || ''}` }),
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn' + (mode === 'search' ? ' primary' : ''), type: 'button', onclick: () => { mode = 'search'; rerender(); } }, 'Search'),
      h('button', { class: 'btn' + (mode === 'radius' ? ' primary' : ''), type: 'button', onclick: () => { mode = 'radius'; rerender(); } }, 'Nearby markets')),
    h('div', { class: 'toolbar' }, mode === 'search' ? inp(query, (v) => { query = v; }, { type: 'search', placeholder: 'ZIP, city, state…' }) : [
      field('Centre ZIP', inp(center, (v) => { center = v; }, { size: 8 })),
      field('Min miles', inp(minM, (v) => { minM = Number(v) || 0; }, { size: 5 })), field('Max miles', inp(maxM, (v) => { maxM = Number(v) || 0; }, { size: 5 }))],
      h('button', { class: 'btn', type: 'button', onclick: rerender }, 'Go'), h('span', { class: 'muted' }, note)),
    h('div', { class: 'tablewrap' }, h('table', { class: 'zip' },
      h('thead', null, h('tr', null, ['ZIP', 'City', 'State', 'Population', 'Lat', 'Lng', mode === 'radius' ? 'Miles' : '', 'Weather'].map(x => h('th', null, x)))),
      h('tbody', null, out.map(r => h('tr', null, h('td', null, r.zip), h('td', null, r.city), h('td', null, r.state), h('td', { class: 'num' }, r.population), h('td', null, r.lat), h('td', null, r.lng),
        h('td', { class: 'num' }, mode === 'radius' ? r.miles.toFixed(1) : ''),
        h('td', null, h('button', { class: 'btn small', type: 'button', onclick: () => openExternal(ventuskyUrl(r.lat, r.lng)) }, 'Wx'))))))));
}
