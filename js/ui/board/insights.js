// Overview strip, ranked worklist, per-broker scoreboard, per-load next steps and the aging / second-wave dialog.
import { h, toast, modal, confirmDialog } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { rankLoads, overviewCounts } from '../../core/worklist.js';
import { nextSteps, repriceSuggestion } from '../../core/guidance.js';
import { paceStats, coverStatsByBroker } from '../../core/coverlog.js';
import { safeNumeric } from '../../core/util.js';
import { icon } from '../icons.js';
import { coverModal } from './cover.js';
import { summaryOutreach, callListModal } from './outreachview.js';
import { adviceExtra } from './ctx.js';
import { money } from './util.js';
import { loadStatus } from './status.js';

// ------------------------------------------------------------------ overview strip: the four numbers that matter
export function overviewStrip(rows, ctx, quick, setQuick) {
  const c = overviewCounts(rows, ctx);
  const tiles = [
    { k: 'loads', n: c.loads, label: 'Active loads', sub: `${c.postings} posting${c.postings === 1 ? '' : 's'}`, filter: '' },
    { k: 'attention', n: c.attention, label: 'Need attention', sub: c.urgent ? `${c.urgent} urgent` : 'all clear', tone: c.urgent ? 'urgent' : 'act', filter: 'attention' },
    { k: 'hot', n: c.hot, label: 'Ready to book', sub: c.hot ? 'a carrier is in range' : 'none yet', tone: 'ok', filter: 'hot' },
    { k: 'inquiries', n: c.inquiries, label: 'Inquiries in', sub: `${c.noInquiries} load${c.noInquiries === 1 ? '' : 's'} with none`, filter: null },
  ];
  return h('div', { class: 'ovstrip', role: 'group', 'aria-label': 'Board overview' }, tiles.map((t) => {
    const on = t.filter !== null && t.filter !== '' && quick === t.filter;
    const clickable = t.filter !== null;
    return h(clickable ? 'button' : 'div', { class: `ovtile ${t.tone && t.n ? 't-' + t.tone : ''} ${on ? 'on' : ''}`.trim(), type: clickable ? 'button' : null, 'data-tile': t.k,
      title: clickable ? (t.filter === '' ? 'Show every load' : on ? 'Click to clear this filter' : 'Click to show only these loads') : null,
      onclick: clickable ? () => setQuick(on || t.filter === '' ? '' : t.filter) : null },
      h('span', { class: 'ov-l' }, t.label), h('b', null, t.n), h('small', null, t.sub));
  }));
}

// ------------------------------------------------------------------ ranked worklist
export function worklistPanel(rows, open, onOpen, expanded, setExpanded) {
  const top = rankLoads(rows).slice(0, 6);
  const head = h('button', { class: 'collhead', type: 'button', 'aria-expanded': String(expanded), onclick: () => setExpanded(!expanded) },
    icon(expanded ? 'chevdown' : 'chevright', 16), h('b', null, 'Work these first'), h('span', { class: 'muted' }, top.length ? `best ${top.length} of ${rows.length} loads to work right now` : 'nothing on the board yet'));
  if (!expanded || !top.length) return h('section', { class: 'panel worklist' }, head);
  return h('section', { class: 'panel worklist' }, head, h('ol', { class: 'wl' }, top.map((r, i) => {
    const st = loadStatus(r);
    return h('li', { class: 'wl-' + st.tone },
      h('span', { class: 'wl-rank' }, i + 1),
      h('div', { class: 'wl-main' }, h('b', null, r.box.title), h('small', { class: 'muted' }, r.reasons.slice(0, 3).join(' · ') || 'nothing notable yet')),
      h('span', { class: 'badge st-' + st.tone }, icon(st.icon, 12), st.label),
      h('span', { class: 'score ' + r.label.toLowerCase(), title: 'Cover-probability score (0-100)' }, r.score),
      h('button', { class: 'btn small', type: 'button', onclick: () => onOpen(r.box) }, 'Open'));
  })));
}

// ------------------------------------------------------------------ scoreboard (per broker)
export function scoreboard(tabBroker) {
  const brokers = state.settings.brokers || [];
  const now = new Date();
  const mk = (label, p, name) => h('div', { class: 'sb' }, h('b', null, label),
    h('span', null, h('em', null, p.today), ' today'), h('span', null, h('em', null, p.week), ' / ', p.floor, ' this week'),
    h('span', { class: 'pace ' + p.status }, p.projection === null ? `${p.need} to go` : `on track for ${p.projection}`));
  if (!brokers.length) return null;
  const rows = coverStatsByBroker(state.coverLog, brokers, state.settings, now);
  const all = paceStats(state.coverLog, state.settings, now, null);
  const per = Math.max(1, Math.round(all.floor / brokers.length));
  const view = tabBroker === '__all' ? [mk('All brokers', all)] : rows.filter(r => r.broker === tabBroker && (r.broker || state.postings.some(p => !p.broker))).map(r => mk(r.broker || 'Unassigned', r));
  return h('div', { class: 'scoreboard' }, view, tabBroker !== '__all' && tabBroker ? h('small', { class: 'muted' }, `Floor shown is the team floor (${all.floor}); about ${per} each if you split it evenly.`) : null);
}

// ------------------------------------------------------------------ next steps per load
async function runAction(box, a, hooks = {}) {
  const head = box.head; const ids = box.members.map(m => m.id);
  switch (a.type) {
    case 'reprice': {
      const cur = Math.max(0, ...box.members.map(m => safeNumeric(m.targetRate) || safeNumeric(m.datRate)));
      const step = Math.round(a.to - cur);
      if (!(step > 0)) return toast('The rate is already at or above that.', 'info');
      const n = await actions.repriceGroup(head.id, step);
      toast(`Target rate raised by ${money(step)} on ${n} posting(s). Download the DAT CSV again and re-upload it.`, 'ok', 7000); return;
    }
    case 'setRate': { await actions.setTargetRate(ids, a.rate); toast(`Target rate set to ${money(a.rate)} for the whole load.`, 'ok'); return; }
    case 'outreach': case 'wave2': {
      const res = await actions.runOutreach(head.id, { wave2: a.type === 'wave2' });
      if (res) { if (res.drafts.length) summaryOutreach(res); else toast(res.detail || 'No carriers left to contact.', 'warn', 7000); }
      return;
    }
    case 'recities': {
      if (!(await confirmDialog('Swap the alternate cities', 'The 8 alternate postings are replaced with new ones in different high-traffic markets. They keep the load\'s target rate and details.', 'Rebuild'))) return;
      const r = await actions.rebuildMatrix(head.id);
      if (!r.ok) return toast(r.error, 'err', 7000);
      toast('New alternates built. Download the DAT CSV again and re-upload it.', 'ok', 7000); return;
    }
    case 'call': { await actions.logOp(head.id, 'call', 'opened the call list'); callListModal(box); return; }
    case 'cover': return coverModal(box);
    case 'csv': return hooks.csv ? hooks.csv() : undefined;
    default: return undefined;
  }
}

export function guidanceBlock(row, ctx, hooks = {}) {
  const adv = nextSteps(row.stats, adviceExtra(row.box, ctx));
  const [first, ...rest] = adv.steps;
  const btn = (s, primary) => (s.action ? h('button', { class: 'btn small' + (primary ? ' primary' : ''), type: 'button', onclick: () => runAction(row.box, s.action, hooks) }, s.action.label || 'Do it') : null);
  const checks = (s) => (s.checks && s.checks.length ? h('ul', { class: 'gchecks' }, s.checks.map(c => h('li', null, c))) : null);
  return h('div', { class: 'guide g-' + adv.level },
    h('div', { class: 'guide-head' }, icon('bulb', 16), h('b', null, adv.headline || 'Next step'), h('span', { class: 'pill' }, adv.phase)),
    first ? h('div', { class: 'gstep' }, h('div', null, h('b', null, first.title), h('p', null, first.detail), checks(first)), btn(first, true)) : null,
    rest.length ? h('details', { class: 'gmore' }, h('summary', null, `${rest.length} other option${rest.length === 1 ? '' : 's'}`),
      rest.map(s => h('div', { class: 'gstep sub' }, h('div', null, h('b', null, s.title), h('p', null, s.detail), checks(s)), btn(s, false)))) : null,
    adv.wait ? h('p', { class: 'muted small' }, adv.wait) : null);
}

// ------------------------------------------------------------------ aging loads: one-click reprice + second wave
export function agingModal(rows, ctx) {
  const aging = rows.filter(r => r.flags.some(f => f.kind === 'aging' || f.kind === 'closing'));
  if (!aging.length) return toast('Nothing is aging right now.', 'info');
  const picks = aging.map(r => {
    const iter = r.stats.ops.filter(o => o.type === 'reprice').length;
    const rp = repriceSuggestion(r.stats, iter);
    const cb = h('input', { type: 'checkbox', checked: true, 'data-live': '' });
    const wave = h('input', { type: 'checkbox', checked: true, 'data-live': '' });
    return { r, rp, cb, wave };
  });
  const body = h('div', null, h('p', { class: 'muted' }, 'Each load below has had no inquiries for longer than its lane type allows (or its pickup is closing). Tick what to do. Rate changes apply to every posting in the box; the second wave drafts outreach to carriers not yet contacted about that load.'),
    h('div', { class: 'tablewrap' }, h('table', { class: 'lanetable' },
      h('thead', null, h('tr', null, ['Load', 'Age', 'Reprice', 'Second wave'].map(x => h('th', null, x)))),
      h('tbody', null, picks.map(({ r, rp, cb, wave }) => h('tr', null,
        h('td', null, h('b', null, r.box.title), h('div', { class: 'muted small' }, r.flags.map(f => f.text).join(' · '))),
        h('td', null, `${Math.round(r.stats.ageHours * 10) / 10} h`),
        h('td', null, rp ? h('label', { class: 'inl' }, cb, ` ${money(rp.from)} → ${money(rp.to)}`) : h('span', { class: 'muted small' }, 'set a target rate first')),
        h('td', null, h('label', { class: 'inl' }, wave, ' draft outreach'))))))));
  modal({ title: 'Aging loads', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Apply', kind: 'primary', onClick: async () => {
    let rp = 0, wv = 0, dr = 0;
    for (const { r, rp: sug, cb, wave } of picks) {
      if (sug && cb.checked) { const cur = Math.max(0, ...r.box.members.map(m => safeNumeric(m.targetRate) || safeNumeric(m.datRate))); const step = Math.round(sug.to - cur); if (step > 0) { await actions.repriceGroup(r.box.head.id, step); rp++; } }
      if (wave.checked) { const res = await actions.runOutreach(r.box.head.id, { wave2: true }); if (res) { wv++; dr += res.drafts.length; } }
    }
    toast(`${rp} load(s) repriced, ${wv} second wave(s) drafted (${dr} draft${dr === 1 ? '' : 's'}).${rp ? ' Re-upload the DAT CSV for repriced loads.' : ''}`, 'ok', 8000);
  } }] });
}
