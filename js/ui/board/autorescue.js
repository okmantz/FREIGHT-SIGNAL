// AUTO RESCUE UI (v17, v21): the button on a load, the live progress strip, and the window with the timeline, the limit you authorise and the log.
// v21 adds: the "upload a fresh DAT file" banner after Auto Rescue changes the postings, Standard / Fast pace, who it will reach first (primary carriers
// starred), the phone list with one-click call outcomes, and "Reshuffle postings now".
// Nothing here sends mail: every offer the engine makes is a draft, exactly like Carrier outreach.
import { h, modal, toast } from '../dom.js';
import { icon } from '../icons.js';
import { state, actions } from '../../store/state.js';
import { STAGES, ALL_STAGES, CYCLE_STAGE, rescueSummary, minutesIn, stageAt, paceOf, callState, callCooling, CALL_RESULTS } from '../../core/autorescue.js';
import { matchesForLoad, QUALIFIED } from '../../core/matching.js';
import { money } from '../../core/netcommon.js';
import { safeNumeric } from '../../core/util.js';

const rerender = () => import('../../main.js').then(m => m.render());
const clock = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const dur = (m) => (m < 90 ? Math.round(m * 10) / 10 + ' min' : Math.round(m / 6) / 10 + ' h');

export const rescueOf = (head) => state.autoRescues.find(r => r.id === head.id) || null;

/** The button in the load's action bar. */
export function rescueButton(b, head, opts = {}) {
  const r = rescueOf(head); const on = r && r.status === 'active';
  return h('button', { class: 'btn rescuebtn' + (on ? ' on' : ''), type: 'button', 'data-act': 'auto-rescue',
    title: on ? 'Auto Rescue is working this load. Click for the timeline.' : 'Keep working this load until it is covered: match, offer, reshuffle the postings, reprice within your limit, escalate every hour.',
    onclick: () => openRescue(b, head, opts) }, icon('bolt', 15), on ? 'Auto Rescue on' : 'Auto Rescue');
}

/** The reminder that DAT still shows the OLD postings: Auto Rescue changed the cities or the rate inside the app, and only a fresh upload changes DAT. */
function repostBanner(r, csv) {
  if (!r || !r.repost || r.status !== 'active') return null;
  return h('div', { class: 'rs-repost', 'data-test': 'rescue-repost', role: 'status' },
    h('span', { class: 'rs-repost-ic' }, icon('upload', 15)),
    h('span', { class: 'rs-repost-tx' }, h('b', null, 'Upload to DAT to put the changes live.'), ' Auto Rescue ' + (r.repost.why || 'changed the postings') + ' at ' + clock(r.repost.at) + '. DAT still shows the old postings until you upload the new file.'),
    csv ? h('button', { class: 'btn small primary', type: 'button', 'data-act': 'rescue-csv', onclick: () => csv() }, icon('download', 14), 'Download DAT CSV') : null);
}

/** A slim strip under the load header: where the rescue is, and the trucks that already fit. opts.csv = download this load's DAT CSV. */
export function rescueStrip(head, opts = {}) {
  const r = rescueOf(head); const ms = matchesForLoad(state.matches, head.id); const q = ms.filter(m => QUALIFIED.includes(m.tier));
  if (!r && !q.length) return null;
  const now = Date.now(); const on = r && r.status === 'active'; const sum = r && on ? rescueSummary(r, now, state.settings) : null;
  const strip = h('div', { class: 'rescuestrip' + (on ? ' on' : ''), 'data-test': 'rescue-strip' },
    r ? h('div', { class: 'rs-steps', 'aria-label': 'Auto Rescue progress' }, ALL_STAGES.map((s, i) => h('span', { class: 'rs-dot' + (s.id === 'cycle' ? (r.cycles ? ' done' : '') : (r.fired[s.id] ? ' done' : '')) + (sum && sum.index === i ? ' now' : ''), title: s.label + ' – ' + s.blurb }))) : null,
    h('span', { class: 'rs-text' }, r ? (on ? (r.auto ? 'Auto Rescue (started for you): ' : 'Auto Rescue' + (paceOf(r) === 2 ? ' (Fast)' : '') + ': ') + sum.text : r.status === 'covered' ? 'Auto Rescue: covered' : 'Auto Rescue ' + r.status) : null,
      on && sum.reshuffles ? h('span', { class: 'rs-tag', title: 'Times Auto Rescue has reshuffled the DAT posting cities' }, icon('refresh', 11), sum.reshuffles + ' reshuffle' + (sum.reshuffles === 1 ? '' : 's')) : null,
      q.length ? h('b', { class: 'rs-match' }, (r ? ' · ' : '') + q.length + ' qualified truck' + (q.length === 1 ? '' : 's') + ' matched') : null),
    r || q.length ? h('button', { class: 'btn small', type: 'button', onclick: () => openRescueFor(head, opts) }, r ? 'Details' : 'See matches') : null);
  const banner = repostBanner(r, opts.csv);
  return banner ? h('div', { class: 'rescuewrap' }, strip, banner) : strip;
}

export const openRescueFor = (head, opts = {}) => openRescue({ head, members: state.postings.filter(p => (p.groupId || p.id) === (head.groupId || head.id)) }, head, opts);

function stageRow(s, r, now) {
  const isCycle = s.id === 'cycle';
  const done = r && (isCycle ? r.lastCycleAt : r.fired[s.id]); const pace = r ? paceOf(r) : 1;
  const cur = r && r.status === 'active' && (isCycle ? stageAt(minutesIn(r, now), pace).id === 'team' && STAGES.every(x => r.fired[x.id]) && minutesIn(r, now) * pace >= CYCLE_STAGE.at : stageAt(minutesIn(r, now), pace).id === s.id && !(STAGES.every(x => r.fired[x.id]) && minutesIn(r, now) * pace >= CYCLE_STAGE.at));
  const at = Math.round(s.at / pace * 10) / 10;
  const when = isCycle ? (done ? 'Round ' + (r.cycles || 0) + ' at ' + clock(done) : 'From ' + dur(at) + ', then repeats') : (done ? 'Done ' + clock(done) : 'At ' + dur(at));
  return h('li', { class: 'rs-row' + (done ? ' done' : '') + (cur ? ' now' : '') },
    h('span', { class: 'rs-mark' }, done ? icon('check', 13) : isCycle ? icon('refresh', 12) : ''),
    h('div', null, h('b', null, s.label), h('small', null, s.blurb)), h('span', { class: 'rs-when' }, when));
}

/** "Who it reaches first": the prospects the engine ranks highest, primary and backup carriers marked with the star. */
function whoBlock(head) {
  const list = actions.rescuePreview(head.id, 7);
  if (!list.length) return null;
  return h('div', { class: 'rs-who' }, h('b', null, 'Who it reaches first'),
    h('ul', null, list.map(p => h('li', null,
      h('span', { class: 'rs-who-star' }, p.primary ? h('span', { class: 'pstar inline ' + p.primary, title: (p.primary === 'backup' ? 'Backup' : 'Primary') + ' carrier' }, icon('star', 9)) : null),
      h('span', { class: 'rs-who-n' }, p.name || p.email || p.phone || 'Carrier', h('small', { class: 'muted' }, ' · ' + (p.why[0] || p.sources.join(', ')))),
      h('span', { class: 'rs-who-c muted small' }, p.sources.includes('truck') || p.sources.includes('team truck') ? 'open truck' : p.email ? 'e-mail' : 'phone')))),
    list.some(p => p.primary) ? null : h('p', { class: 'muted small' }, 'Tip: carriers you mark as primary for a lane (Carrier Database, star) are always offered the load first.'));
}

/** One person to call, with a one-click outcome. The outcome feeds Auto Rescue and the call list. */
function callRow(head, c, now) {
  const prior = callState(head).get(c.key); const holder = h('span', { class: 'rs-call-out' });
  const chip = (res) => { const lab = (CALL_RESULTS.find(x => x[0] === res) || [])[1] || res; return h('span', { class: 'dir-chip ' + (res === 'truck' ? 'ok' : res === 'notruck' ? 'bad' : 'warn') }, lab); };
  const sel = h('select', { class: 'cell dir-sel', 'aria-label': 'Log the call with ' + (c.name || 'this carrier'), 'data-act': 'log-call' }, h('option', { value: '' }, 'Log call…'), CALL_RESULTS.map(([v, l]) => h('option', { value: v }, l)));
  sel.addEventListener('change', async () => { const v = sel.value; if (!v) return; await actions.logCall(head.id, { key: c.key, name: c.name, phone: c.phone, carrierId: c.carrierId }, v); holder.replaceChildren(chip(v)); toast(v === 'truck' ? 'Logged. Send them the load details and rate now.' : 'Logged.', 'ok'); });
  if (prior && callCooling(prior, now)) holder.append(chip(prior.result)); else holder.append(sel);
  return h('li', { class: 'rs-call' },
    h('span', { class: 'rs-who-star' }, c.primary ? h('span', { class: 'pstar inline ' + c.primary, title: (c.primary === 'backup' ? 'Backup' : 'Primary') + ' carrier' }, icon('star', 9)) : null),
    h('span', { class: 'rs-who-n' }, (c.name || 'Carrier') + ' ', h('a', { class: 'xlink', href: 'tel:' + String(c.phone).replace(/[^\d+]/g, '') }, c.phone)), holder);
}

export function openRescue(b, head, opts = {}) {
  const r = rescueOf(head); const now = Date.now(); const ms = matchesForLoad(state.matches, head.id);
  const target = safeNumeric(head.targetRate) || safeNumeric(head.datRate) || 0;
  const suggested = target ? Math.round(target * 1.12 / 25) * 25 : 0;           // about 12% above your target: enough room to matter, not a blank cheque
  const maxIn = h('input', { class: 'cell', inputmode: 'decimal', size: 8, placeholder: suggested ? String(suggested) : '$ max', value: r ? (r.maxRate ? String(r.maxRate) : '') : (suggested ? String(suggested) : ''), 'aria-label': 'Highest rate Auto Rescue may offer' });
  const team = h('input', { type: 'checkbox', role: 'switch', checked: r ? !!r.includeTeam : state.settings.rescueAskTeam !== false, 'aria-label': 'Ask the team when nothing works' });
  let pace = r ? paceOf(r) : 1;
  const paceBtns = [[1, 'Standard', 'Steps at 5, 30, 60 and 120 min, then an escalation round every hour'], [2, 'Fast', 'Every step in half the time: 2.5, 15, 30 and 60 min, then a round every 30 min']].map(([v, l, t]) => {
    const btn = h('button', { type: 'button', class: 'seg' + (v === pace ? ' on' : ''), 'aria-pressed': String(v === pace), title: t, 'data-pace': String(v) }, l);
    btn.addEventListener('click', () => { pace = v; paceBtns.forEach(x => { const on = x.dataset.pace === String(v); x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); }); return btn;
  });
  const fields = h('div', { class: 'rs-auth' },
    h('label', { class: 'dfield' }, h('span', null, 'Highest rate it may offer'), maxIn, h('small', { class: 'muted' }, target ? `Your target is ${money(target)}. ${r ? '' : suggested ? 'Filled in at about 12% above it. ' : ''}Clear the box to never raise it.` : 'Leave blank to never raise the rate.')),
    h('div', { class: 'dfield' }, h('span', null, 'Pace'), h('div', { class: 'dir-seg', role: 'group', 'aria-label': 'Pace' }, paceBtns)),
    h('label', { class: 'tgl' }, team, h('span', null, 'Ask the team for help if there is still no cover after 2 hours')));
  const who = whoBlock(head);
  const calls = r && r.calls && r.calls.length ? r.calls.slice(0, 8) : [];
  const body = h('div', { class: 'rs-win' },
    repostBanner(r, opts.csv),
    h('p', { class: 'muted' }, 'Auto Rescue keeps working this load until it is covered. It reaches your primary carriers first, reshuffles the nine DAT postings to new cities and nearby states when nothing is moving, steps the rate up within the limit you set, and keeps escalating every hour. No carrier gets a pile of similar offers. Everything it makes is a draft. These are proposed intervals, not guaranteed response times, and it works while Freight Signal is open (it catches up when you return).'),
    h('ol', { class: 'rs-list' }, ALL_STAGES.map(s => stageRow(s, r, now)), h('li', { class: 'rs-row' }, h('span', { class: 'rs-mark' }, icon('refresh', 13)), h('div', null, h('b', null, 'Always re-checking'), h('small', null, 'A new truck, quote, availability update or reply triggers another matching cycle straight away')), h('span', { class: 'rs-when' }, 'Ongoing'))),
    fields, who,
    calls.length ? h('div', { class: 'rs-matches' }, h('b', null, 'Worth a call'), h('ul', { class: 'rs-calls' }, calls.map(c => callRow(head, c, now)))) : null,
    ms.length ? h('div', { class: 'rs-matches' }, h('b', null, `${ms.length} truck match${ms.length === 1 ? '' : 'es'} so far`),
      h('ul', null, ms.slice(0, 6).map(m => h('li', null, h('span', { class: 'dir-chip ' + (m.tier === 'hot' ? 'ok' : '') }, m.tier), ' ', (m.carrierName || m.email || 'Carrier') + (m.origin ? ' · ' + m.origin : ''), m.deadhead ? h('small', { class: 'muted' }, ` · ${Math.round(m.deadhead)} mi to pickup`) : null)))) : null,
    r && r.log.length ? h('div', { class: 'rs-log' }, h('b', null, 'What it has done'), h('ul', null, [...r.log].reverse().slice(0, 14).map(e => h('li', null, h('time', null, clock(e.at)), h('span', null, e.text)))), r.drafts ? h('p', { class: 'muted small' }, `${r.drafts} draft${r.drafts === 1 ? '' : 's'} created (see Drafts).`) : null) : null);
  const active = r && r.status === 'active';
  const acts = [{ label: 'Close' }];
  if (!r || r.status !== 'active') acts.push({ label: r ? 'Start again' : 'Start Auto Rescue', kind: 'primary', onClick: async () => { await actions.startAutoRescue(head.id, { maxRate: maxIn.value, includeTeam: team.checked, pace }); toast('Auto Rescue started. It will keep working this load.', 'ok'); rerender(); } });
  if (active) {
    acts.push({ label: 'Run next step now', onClick: async () => { const n = await actions.tickAutoRescue({ force: nextDue(r), only: r.id }); toast(n ? 'Ran a step. Check the log.' : 'Nothing more to do right now.', 'ok'); rerender(); } });
    acts.push({ label: 'Reshuffle postings now', onClick: async () => { const res = await actions.rescueReshuffleNow(head.id); toast(res.ok ? 'Postings reshuffled. Download the DAT CSV and upload it.' : 'Could not reshuffle: ' + res.error, res.ok ? 'ok' : 'err', 7000); rerender(); } });
    acts.push({ label: 'Save settings', onClick: async () => { await actions.updateAutoRescue(head.id, { maxRate: Math.max(0, Math.round(safeNumeric(maxIn.value))), includeTeam: team.checked, pace }); toast('Saved.', 'ok'); rerender(); } });
    acts.push({ label: 'Stop', kind: 'danger', onClick: async () => { await actions.stopAutoRescue(head.id, 'stopped'); rerender(); } });
  }
  modal({ title: 'Auto Rescue: ' + [head.originCity, head.originState].filter(Boolean).join(', ') + ' → ' + [head.destCity, head.destState].filter(Boolean).join(', '), body, wide: true, actions: acts });
}
/** The step "Run next step now" runs: the next timed stage that has not run yet, and once they all have, an escalation round. */
const nextDue = (r) => (STAGES.find(s => !r.fired[s.id]) || CYCLE_STAGE).id;
