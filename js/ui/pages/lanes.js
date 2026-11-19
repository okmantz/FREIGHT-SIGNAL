// Lane Intel: what the team's real carrier activity says about each lane. Averages and trends need enough verified data to show a recommendation.
import { h } from '../dom.js';
import * as net from '../../store/net.js';
import { pageHead, emptyState } from '../chrome.js';
import { money, ago } from '../../core/netcommon.js';
import { DEFAULTS } from '../../core/laneintel.js';
import { notJoined } from './team.js';

const view = { q: '', sort: 'busy' };
const cap = (t) => String(t || '').replace(/\b[a-z]/g, c => c.toUpperCase());
const title = (s) => `${cap(s.oc)}, ${s.os} → ${cap(s.dc)}, ${s.ds}`;

function spark(trend) {
  const pts = trend.filter(t => t.paid > 0); if (pts.length < 2) return h('span', { class: 'muted small' }, 'trend needs 2+ months');
  const lo = Math.min(...pts.map(p => p.paid)), hi = Math.max(...pts.map(p => p.paid)), W = 120, H = 28;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'spark'); svg.setAttribute('role', 'img');
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * (W - 4) + 2).toFixed(1)},${(hi === lo ? H / 2 : H - 3 - (p.paid - lo) / (hi - lo) * (H - 6)).toFixed(1)}`).join(' ');
  const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('class', 'spark-line'); svg.appendChild(path);
  const t = document.createElementNS(ns, 'title'); t.textContent = pts.map(p => `${p.month}: ${money(p.paid)}`).join(', '); svg.appendChild(t);
  return svg;
}

function laneCard(s) {
  const eq = Object.entries(s.equipment || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}`).join(' · ');
  return h('div', { class: 'panel lane', 'data-lane': s.o + '>' + s.d },
    h('div', { class: 'truck-head' }, h('b', null, title(s)), s.miles ? h('span', { class: 'pill' }, s.miles + ' mi') : null, h('span', { class: 'pill ' + (s.confidence.ok ? 'orig' : 'warn') }, s.confidence.ok ? 'enough data' : `${s.confidence.n}/${DEFAULTS.minSample} covers`)),
    h('div', { class: 'lmetrics' },
      metric('Inquiries', s.inquiries), metric('Carriers contacted', s.carriersContacted), metric('Covers', s.covers),
      metric('Avg carrier ask', s.avgAsk ? money(s.avgAsk) : '–', s.askN ? `from ${s.askN} verified` : ''),
      metric('Last cover', s.lastCover ? money(s.lastCover.rate) : '–', s.lastCover ? ago(s.lastCover.t) : '')),
    h('div', { class: 'muted small' }, [eq && 'Equipment: ' + eq, `${s.contributors} teammate${s.contributors === 1 ? '' : 's'}`, s.mine ? `${s.mine} from you` : ''].filter(Boolean).join(' · ')),
    s.trend.length ? h('div', { class: 'trendrow' }, h('span', { class: 'muted small' }, 'Paid rate by month'), spark(s.trend)) : null,
    s.responsive.length ? h('div', { class: 'muted small' }, 'Most responsive: ' + s.responsive.map(r => `${r.name || r.mc || 'carrier'} (${r.covers} covers, ${r.inquiries} inquiries)`).join('; ')) : null);
}
const metric = (label, value, sub = '') => h('div', { class: 'lmetric' }, h('small', null, label), h('b', null, String(value)), sub ? h('small', { class: 'muted' }, sub) : null);

export function render() {
  if (!net.joined()) return notJoined('lanes');
  const all = net.laneSummaries();
  const q = view.q.trim().toLowerCase();
  let rows = all.filter(s => !q || `${s.oc} ${s.os} ${s.dc} ${s.ds}`.toLowerCase().includes(q));
  if (view.sort === 'covers') rows = rows.slice().sort((a, b) => b.covers - a.covers);
  const search = h('input', { class: 'cell', type: 'search', placeholder: 'Filter lanes (city or state)', value: view.q, 'aria-label': 'Filter lanes', 'data-live': '1', 'data-fk': 'lane-q' });
  search.addEventListener('change', () => { view.q = search.value; net.net.listeners.forEach(f => f()); });
  return h('div', null,
    pageHead({ icon: 'trendup', title: 'Lane Intel', sub: 'Real carrier activity from the whole team. Rate advice only appears once a lane has enough verified covers from enough teammates.' }),
    !net.net.cfg.shareLane ? h('div', { class: 'banner' }, 'You are not sharing your own lane data (Team page). You still see everyone else\'s.') : null,
    h('div', { class: 'toolbar' }, search),
    rows.length ? h('div', { class: 'cards' }, rows.slice(0, 60).map(laneCard)) : emptyState({ icon: 'trendup', title: 'No lane data yet', text: 'It builds itself as you and your teammates log covers and inquiries. Nothing to enter by hand.' }));
}
