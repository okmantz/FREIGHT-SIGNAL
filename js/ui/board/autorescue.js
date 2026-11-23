// AUTO RESCUE UI (v17): the button on a load, the live progress strip, and the window with the timeline, the limit you authorise and the log.
// Nothing here sends mail: every offer the engine makes is a draft, exactly like Carrier outreach.
import { h, modal, toast, confirmDialog } from '../dom.js';
import { icon } from '../icons.js';
import { state, actions } from '../../store/state.js';
import { STAGES, rescueSummary, minutesIn, stageAt } from '../../core/autorescue.js';
import { matchesForLoad, QUALIFIED } from '../../core/matching.js';
import { money } from '../../core/netcommon.js';
import { safeNumeric } from '../../core/util.js';

const rerender = () => import('../../main.js').then(m => m.render());
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dur = (m) => (m < 90 ? m + ' min' : Math.round(m / 6) / 10 + ' h');

export const rescueOf = (head) => state.autoRescues.find(r => r.id === head.id) || null;

/** The button in the load's action bar. */
export function rescueButton(b, head) {
  const r = rescueOf(head); const on = r && r.status === 'active';
  return h('button', { class: 'btn rescuebtn' + (on ? ' on' : ''), type: 'button', 'data-act': 'auto-rescue',
    title: on ? 'Auto Rescue is working this load. Click for the timeline.' : 'Keep working this load until it is covered: match, offer, widen, reprice within your limit, then ask the team.',
    onclick: () => openRescue(b, head) }, icon('bolt', 15), on ? 'Auto Rescue on' : 'Auto Rescue');
}

/** A slim strip under the load header: where the rescue is, and the trucks that already fit. */
export function rescueStrip(head) {
  const r = rescueOf(head); const ms = matchesForLoad(state.matches, head.id); const q = ms.filter(m => QUALIFIED.includes(m.tier));
  if (!r && !q.length) return null;
  const now = Date.now(); const on = r && r.status === 'active'; const sum = r && on ? rescueSummary(r, now) : null;
  return h('div', { class: 'rescuestrip' + (on ? ' on' : ''), 'data-test': 'rescue-strip' },
    r ? h('div', { class: 'rs-steps', 'aria-label': 'Auto Rescue progress' }, STAGES.map((s, i) => h('span', { class: 'rs-dot' + (r.fired[s.id] ? ' done' : '') + (sum && sum.index === i ? ' now' : ''), title: s.label + ' – ' + s.blurb }))) : null,
    h('span', { class: 'rs-text' }, r ? (on ? (r.auto ? 'Auto Rescue (started for you): ' : 'Auto Rescue: ') + sum.text : r.status === 'covered' ? 'Auto Rescue: covered' : 'Auto Rescue ' + r.status) : null,
      q.length ? h('b', { class: 'rs-match' }, (r ? ' · ' : '') + q.length + ' qualified truck' + (q.length === 1 ? '' : 's') + ' matched') : null),
    r || q.length ? h('button', { class: 'btn small', type: 'button', onclick: () => openRescueFor(head) }, r ? 'Details' : 'See matches') : null);
}

export const openRescueFor = (head) => openRescue({ head, members: state.postings.filter(p => (p.groupId || p.id) === (head.groupId || head.id)) }, head);

function stageRow(s, r, now) {
  const done = r && r.fired[s.id]; const cur = r && stageAt(minutesIn(r, now)).id === s.id && r.status === 'active';
  const when = r ? (done ? 'Done ' + clock(done) : 'At ' + dur(s.at)) : 'At ' + dur(s.at);
  return h('li', { class: 'rs-row' + (done ? ' done' : '') + (cur ? ' now' : '') },
    h('span', { class: 'rs-mark' }, done ? icon('check', 13) : ''),
    h('div', null, h('b', null, s.label), h('small', null, s.blurb)), h('span', { class: 'rs-when' }, when));
}

export function openRescue(b, head) {
  const r = rescueOf(head); const now = Date.now(); const ms = matchesForLoad(state.matches, head.id);
  const target = safeNumeric(head.targetRate) || safeNumeric(head.datRate) || 0;
  const maxIn = h('input', { class: 'cell', inputmode: 'decimal', size: 8, placeholder: target ? String(Math.round(target * 1.15)) : '$ max', value: r && r.maxRate ? String(r.maxRate) : '', 'aria-label': 'Highest rate Auto Rescue may offer' });
  const team = h('input', { type: 'checkbox', role: 'switch', checked: r ? !!r.includeTeam : state.settings.rescueAskTeam !== false, 'aria-label': 'Ask the team when nothing works' });
  const fields = h('div', { class: 'rs-auth' },
    h('label', { class: 'dfield' }, h('span', null, 'Highest rate it may offer'), maxIn, h('small', { class: 'muted' }, target ? `Your target is ${money(target)}. Leave blank to never raise it.` : 'Leave blank to never raise the rate.')),
    h('label', { class: 'tgl' }, team, h('span', null, 'Ask the team for help if there is still no cover after 2 hours')));
  const body = h('div', { class: 'rs-win' },
    h('p', { class: 'muted' }, 'Auto Rescue keeps working this load until it is covered. Each step changes the approach based on what has happened, and no carrier gets a pile of similar offers (a cap per carrier and per load). Everything it makes is a draft. These are proposed intervals, not guaranteed response times, and it works while Freight Signal is open (it catches up when you return).'),
    h('ol', { class: 'rs-list' }, STAGES.map(s => stageRow(s, r, now)), h('li', { class: 'rs-row' }, h('span', { class: 'rs-mark' }, icon('refresh', 13)), h('div', null, h('b', null, 'Always re-checking'), h('small', null, 'A new truck, quote, availability update or reply triggers another matching cycle straight away')), h('span', { class: 'rs-when' }, 'Ongoing'))),
    fields,
    ms.length ? h('div', { class: 'rs-matches' }, h('b', null, `${ms.length} truck match${ms.length === 1 ? '' : 'es'} so far`),
      h('ul', null, ms.slice(0, 6).map(m => h('li', null, h('span', { class: 'dir-chip ' + (m.tier === 'hot' ? 'ok' : '') }, m.tier), ' ', (m.carrierName || m.email || 'Carrier') + (m.origin ? ' · ' + m.origin : ''), m.deadhead ? h('small', { class: 'muted' }, ` · ${Math.round(m.deadhead)} mi to pickup`) : null)))) : null,
    r && r.calls && r.calls.length ? h('div', { class: 'rs-matches' }, h('b', null, 'Worth a call'), h('ul', null, r.calls.slice(0, 6).map(c => h('li', null, (c.name || 'Carrier') + ' ', h('a', { class: 'xlink', href: 'tel:' + String(c.phone).replace(/[^\d+]/g, '') }, c.phone))))) : null,
    r && r.log.length ? h('div', { class: 'rs-log' }, h('b', null, 'What it has done'), h('ul', null, [...r.log].reverse().slice(0, 14).map(e => h('li', null, h('time', null, clock(e.at)), h('span', null, e.text)))), r.drafts ? h('p', { class: 'muted small' }, `${r.drafts} draft${r.drafts === 1 ? '' : 's'} created (see Drafts).`) : null) : null);
  const active = r && r.status === 'active';
  const acts = [{ label: 'Close' }];
  if (!r || r.status !== 'active') acts.push({ label: r ? 'Start again' : 'Start Auto Rescue', kind: 'primary', onClick: async () => { await actions.startAutoRescue(head.id, { maxRate: maxIn.value, includeTeam: team.checked }); toast('Auto Rescue started. It will keep working this load.', 'ok'); rerender(); } });
  if (active) {
    acts.push({ label: 'Run next step now', onClick: async () => { const n = await actions.tickAutoRescue({ force: nextDue(r, now) }); toast(n ? 'Ran a step. Check the log.' : 'Nothing more to do right now.', 'ok'); rerender(); } });
    acts.push({ label: 'Save limit', onClick: async () => { await actions.updateAutoRescue(head.id, { maxRate: Math.max(0, Math.round(safeNumeric(maxIn.value))), includeTeam: team.checked }); toast('Saved.', 'ok'); rerender(); } });
    acts.push({ label: 'Stop', kind: 'danger', onClick: async () => { await actions.stopAutoRescue(head.id, 'stopped'); rerender(); } });
  }
  modal({ title: 'Auto Rescue: ' + [head.originCity, head.originState].filter(Boolean).join(', ') + ' → ' + [head.destCity, head.destState].filter(Boolean).join(', '), body, wide: true, actions: acts });
}
const nextDue = (r, now) => (STAGES.find(s => !r.fired[s.id]) || STAGES[1]).id;
