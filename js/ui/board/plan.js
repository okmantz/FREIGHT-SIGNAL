// Plan strip on every posted load: how hard it is, the carrier to reach first, and the action plan. Click "Plan" for the proof (every factor, every number).
import { h, modal, toast, copyText } from '../dom.js';
import { icon } from '../icons.js';
import { state, actions, loadPlan } from '../../store/state.js';
import { APPROACHES } from '../../core/difficulty.js';
import { competitiveness } from '../../core/rateintel.js';
import { money, placeText } from '../../core/netcommon.js';
import { reachOutDialog, assignDialog } from '../assign.js';

const memo = new Map();
const keyFor = (head) => [state.coverLog.length, state.history.length, state.assignments.length, state.approaches.length, state.carrierRev, state.inquiries.length, state.outreach.length, state.trucks.length, head.targetRate, head.datRate, head.pickupEarliest, head.equip, Math.floor(Date.now() / 300000)].join('|');
export function planFor(head) {
  const k = keyFor(head); const hit = memo.get(head.id);
  if (hit && hit.k === k) return hit.v;
  const v = loadPlan(head); memo.set(head.id, { k, v }); return v;
}
const TONE = { easy: 'good', moderate: 'info', hard: 'warn', 'very hard': 'bad' };
const badge = (d) => h('span', { class: 'pl-badge t-' + (TONE[d.level] || 'info'), title: 'Difficulty ' + d.score + ' of 100, based on ' + d.confidence + '% of the data the app looks at' }, d.level.toUpperCase() + ' ' + d.score);

export function planStrip(head) {
  if (!head || String(head.status || 'Active').toLowerCase() === 'covered') return null;
  let p; try { p = planFor(head); } catch (e) { console.warn('Plan unavailable:', e); return null; }
  if (!head.planSnap) queueMicrotask(() => actions.snapPlan(head.id).catch(() => {}));
  const a = p.assignMatches[0]; const top = p.plan.find(x => x.key !== 'primary') || null;
  return h('div', { class: 'planstrip', 'data-test': 'plan-strip' },
    badge(p.diff),
    a ? h('span', { class: 'pl-primary' }, icon('star', 13), ' ', h('b', null, a.name || a.email), ' ', h('small', null, a.priority === 'primary' ? 'is your primary for this lane' : 'is your backup for this lane')) : null,
    a ? h('button', { class: 'btn small primary', type: 'button', 'data-act': 'reach-primary', onclick: () => reachOutDialog(head, a) }, 'Reach out first') : null,
    top ? h('span', { class: 'pl-next muted' }, 'Next: ', top.title) : p.diff.reasons.length ? null : h('span', { class: 'muted' }, 'No special strategy needed.'),
    h('button', { class: 'btn small', type: 'button', 'data-act': 'open-plan', onclick: () => openPlan(head) }, 'Plan'));
}

const bar = (f) => h('div', { class: 'pl-bar', title: f.note }, h('span', { class: 'pl-bl' }, f.label), h('span', { class: 'pl-track' }, f.score === null ? null : h('i', { class: 'pl-fill', style: null, dataset: { w: String(Math.round(f.score / 10)) } })), h('span', { class: 'pl-bv' }, f.score === null ? 'no data' : String(f.score)), h('small', { class: 'muted' }, f.note));

export function openPlan(head) {
  const p = loadPlan(head); const d = p.diff, intel = p.intel; const target = Number(String(head.targetRate || '').replace(/[^0-9.]/g, '')) || 0;
  const comp = competitiveness(target, intel);
  const rateRows = [
    ['Average carrier quote', intel.quotes.avg ? money(intel.quotes.avg) + ' (' + intel.quotes.n + ' quote' + (intel.quotes.n === 1 ? '' : 's') + ', ' + money(intel.quotes.low) + ' to ' + money(intel.quotes.high) + ')' : ''],
    ['Average final covered rate', intel.covers.avg ? money(intel.covers.avg) + ' (' + intel.covers.n + ' cover' + (intel.covers.n === 1 ? '' : 's') + ')' : ''],
    ['Typical negotiation difference', intel.negotiation.avgDrop ? money(intel.negotiation.avgDrop) + ' (' + intel.negotiation.avgPct + '%)' + (intel.negotiation.estimated ? ', estimated from quotes vs covers' : '') : ''],
    ['Lowest successful covered rate', intel.covers.lowestSuccessful ? money(intel.covers.lowestSuccessful) : ''],
    ['Rate that covered fastest', intel.fastest ? money(intel.fastest.rate) + ' (' + intel.fastest.hours + ' h)' : ''],
    ['Your rate vs this lane', comp.text],
    ['Confidence', intel.confidence + (intel.n ? ' (' + intel.n + ' comparable deal' + (intel.n === 1 ? '' : 's') + ', newest ' + intel.newest + ' d, oldest ' + intel.oldest + ' d)' : ' (no comparable history yet)')],
  ];
  const learnedRows = Object.entries(p.learned).filter(([, v]) => v.n > 0).sort((x, y) => (y[1].rate ?? -1) - (x[1].rate ?? -1));
  const body = h('div', { class: 'pl' },
    h('div', { class: 'pl-head' }, badge(d), h('span', { class: 'muted' }, placeText(head.originCity, head.originState) + ' to ' + placeText(head.destCity, head.destState)), d.reasons.length ? h('p', null, h('b', null, 'Why it is hard: '), d.reasons.map(r => r.text).join('; ') + '.') : h('p', null, 'Nothing about this load points to trouble.')),
    h('h4', null, 'Action plan'),
    p.plan.length ? h('ol', { class: 'pl-plan' }, p.plan.map(a => h('li', null, h('b', null, a.title), h('div', { class: 'muted' }, a.why + (a.how ? '. ' + a.how : '')), a.evidence ? h('div', { class: 'pl-ev' }, a.evidence) : h('div', { class: 'pl-ev muted' }, 'Not enough finished hard loads yet to know if this works; it is suggested from the reasons above.'),
      a.key === 'primary' && p.assignMatches[0] ? h('button', { class: 'btn small primary', type: 'button', onclick: () => reachOutDialog(head, p.assignMatches[0]) }, 'E-mail draft / call') : null,
      a.key === 'raise-rate' && intel.covers.avg ? h('button', { class: 'btn small', type: 'button', onclick: async () => { await actions.logOp(head.id, 'reprice', 'plan: toward ' + money(intel.covers.avg)); copyText(String(intel.covers.avg), 'Rate copied. Set it as the target rate on the load.'); } }, 'Copy ' + money(intel.covers.avg)) : null))) : h('p', { class: 'muted' }, 'No action needed.'),
    h('h4', null, 'Most likely carriers (ranked by what actually happened)'),
    p.matches.length ? h('table', { class: 'carrier dirtable' }, h('thead', null, h('tr', null, ['Carrier', 'Why', 'Chance', 'Last rate', ''].map(t => h('th', null, t)))),
      h('tbody', null, p.matches.slice(0, 8).map(m => h('tr', null, h('td', null, h('b', null, m.name || m.email), h('div', { class: 'muted small' }, [m.mc, m.email, m.phone].filter(Boolean).join('  ·  '))), h('td', null, m.why.slice(0, 3).join('; ')), h('td', null, m.likelihood), h('td', null, m.lastRate ? money(m.lastRate) : ''),
        h('td', null, m.phone ? h('button', { class: 'btn small', type: 'button', onclick: () => { actions.logOp(head.id, 'call', m.name || m.phone); toast('Call logged for ' + (m.name || m.phone) + '.', 'ok'); } }, 'Log call') : null))))) : h('p', { class: 'muted' }, 'No history-based matches yet. Import your historical e-mails or log more covers.'),
    p.contacted ? h('p', { class: 'muted small' }, p.contacted + ' matching carrier' + (p.contacted === 1 ? ' was' : 's were') + ' already contacted about this load and are hidden.') : null,
    h('h4', null, 'Rate intelligence'), h('dl', { class: 'pl-dl' }, rateRows.filter(r => r[1]).flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])),
    p.opening ? h('p', null, p.opening.note) : null,
    h('h4', null, 'Difficulty breakdown'), h('div', null, d.factors.map(bar)),
    h('h4', null, 'What has worked on similar hard loads'),
    learnedRows.length ? h('table', { class: 'carrier dirtable' }, h('thead', null, h('tr', null, ['Approach', 'Used', 'Covered', 'Median time', 'Without it'].map(t => h('th', null, t)))), h('tbody', null, learnedRows.map(([k, v]) => h('tr', null, h('td', null, APPROACHES[k].label), h('td', null, String(v.n)), h('td', null, v.rate + '%'), h('td', null, v.medianHours ? v.medianHours + ' h' : ''), h('td', null, v.without.n ? v.without.rate + '% of ' + v.without.n : '')))))
      : h('p', { class: 'muted' }, 'Nothing learned yet. Each load you cover or let expire teaches the app which approaches worked; it starts judging after about 3 similar hard loads.'),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', onclick: () => assignDialog({ preset: head }) }, icon('star', 14), 'Set a primary carrier for this lane…')));
  const m = modal({ title: 'Load plan', body, wide: true, actions: [{ label: 'Close' }] });
  // bar widths without inline styles (strict CSP): classes w0..w10
  for (const el of body.querySelectorAll('.pl-fill')) el.classList.add('w' + el.dataset.w);
  return m;
}
