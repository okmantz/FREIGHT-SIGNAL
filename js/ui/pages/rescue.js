// Load Rescue: ask the team for help on a load that has gone quiet, and help on other people's loads. The owner stays responsible.
import { h, toast, modal, field } from '../dom.js';
import { state } from '../../store/state.js';
import * as net from '../../store/net.js';
import { pageHead, emptyState, iconBtn } from '../chrome.js';
import { icon } from '../icons.js';
import { placeText, ago, usDate, until, money } from '../../core/netcommon.js';
import { equipLabel } from '../../core/equipment.js';
import { TIP_TYPES, tipLine, helperBoard, ownCarrierPicks, alternateCities } from '../../core/rescue.js';
import { laneOf } from '../../core/laneintel.js';
import { liftAdvice, liftText } from '../../core/laneintel.js';
import { notJoined } from './team.js';

/** "Ask the team" from a board lane: summarises what was tried and lets the owner add a note. */
export function askTeamDialog(members, { miles = 0 } = {}) {
  if (!net.joined()) { toast('Join or create a team first (Team page).', 'warn'); location.hash = '#/team'; return; }
  const existing = net.rescueFor(members[0]);
  if (existing) { toast('You already asked the team about this lane.', 'info'); location.hash = '#/rescue'; return; }
  let note = '';
  const ta = h('textarea', { class: 'cell', rows: 3, placeholder: 'Anything that helps: dock window, commodity (no customer names), what the carriers keep saying', maxlength: 300, 'data-live': '1' });
  ta.addEventListener('input', () => { note = ta.value; });
  const err = h('div', { class: 'banner err', hidden: true });
  const p = members[0];
  modal({ title: 'Ask the team for help', body: h('div', null,
    h('p', null, h('b', null, `${placeText(p.originCity, p.originState)} → ${placeText(p.destCity, p.destState)}`), '  ', h('span', { class: 'muted' }, equipLabel(p.equip))),
    h('p', { class: 'muted' }, 'Your teammates see the lane, equipment, pickup date, target rate and what you have tried. They do not see the customer, load details or your notes. You stay responsible for the load.'), err, field('Note for the team (optional)', ta)),
  actions: [{ label: 'Cancel' }, { label: 'Ask the team', kind: 'primary', onClick: async () => {
    const r = await net.askForHelp(members, { note, miles }); if (!r.ok) { err.hidden = false; err.textContent = r.error; return false; }
    toast('Sent. Answers show up on the Load Rescue page.', 'ok'); location.hash = '#/rescue';
  } }] });
}

function tipForm(rescue) {
  const f = { type: 'carrier' }; const box = h('div', { class: 'tipform' }); const err = h('div', { class: 'banner err', hidden: true });
  const inp = (key, ph, props = {}) => { const i = h('input', { class: 'cell', placeholder: ph, 'aria-label': ph, 'data-live': '1', ...props }); i.addEventListener('input', () => { f[key] = i.value; }); return i; };
  const fields = {
    carrier: () => [inp('carrierName', 'Carrier name'), inp('mc', 'MC'), inp('phone', 'Phone'), inp('email', 'E-mail'), inp('text', 'Why (ran it before, looking there now)')],
    market: () => [inp('city', 'City'), inp('state', 'ST', { maxlength: 2 }), inp('text', 'Why this market')],
    rate: () => [inp('rate', 'Rate that would cover it', { inputmode: 'numeric' }), inp('text', 'Where that number comes from')],
    city: () => [inp('city', 'Posting city'), inp('state', 'ST', { maxlength: 2 }), inp('text', 'Why')],
    note: () => [inp('text', 'Your idea')],
  };
  const sel = h('select', { class: 'cell', 'aria-label': 'What do you want to add?' }, TIP_TYPES.map(([id, label]) => h('option', { value: id }, label)));
  const draw = () => { box.replaceChildren(...fields[f.type]()); };
  sel.addEventListener('change', () => { for (const k of Object.keys(f)) if (k !== 'type') delete f[k]; f.type = sel.value; draw(); });
  draw();
  return h('div', { class: 'toolbar tipbar' }, sel, box, err, iconBtn('send', 'Add', { class: 'primary', 'data-act': 'add-tip', onclick: async () => {
    const r = await net.addTip(rescue, f); if (!r.ok) { err.hidden = false; err.textContent = r.error; return; } toast('Thanks. Added to the request.', 'ok');
  } }));
}

/** "From my database" suggestions the helper can send with one click. */
function ownPicks(rescue) {
  const picks = ownCarrierPicks(rescue, state.carriers, { zip: state.zip, settings: state.settings, coverLog: state.coverLog, inquiries: state.inquiries });
  const cities = alternateCities(state.zip, { city: rescue.oCity, state: rescue.oState, zip: rescue.oZip }, { limit: 4 });
  const mk = (label, ic, onclick) => h('button', { class: 'btn small', type: 'button', onclick }, icon(ic, 13), label);
  return h('div', { class: 'toolbar' },
    ...picks.slice(0, 3).map(p => mk('Suggest ' + p.carrier.carrierName, 'carriers', async () => { const r = await net.addTip(rescue, { type: 'carrier', carrierName: p.carrier.carrierName, mc: p.carrier.mc, phone: p.carrier.phone, email: p.carrier.email, text: 'From my carrier list for this lane' }); toast(r.ok ? 'Suggested.' : r.error, r.ok ? 'ok' : 'warn'); })),
    ...cities.slice(0, 3).map(c => mk(`Post from ${c.city}, ${c.state} (${Math.round(c.miles)} mi)`, 'route', async () => { const r = await net.addTip(rescue, { type: 'city', city: c.city, state: c.state, text: `${Math.round(c.miles)} miles from pickup` }); toast(r.ok ? 'Suggested.' : r.error, r.ok ? 'ok' : 'warn'); })));
}

function rescueCard(r) {
  const mine = r.uid === net.myUid(); const tips = net.tipsFor(r.id); const marks = new Set(net.net.marks.map(m => m.id));
  const advice = liftAdvice(net.net.lane, { ...laneOf({ originCity: r.oCity, originState: r.oState, destCity: r.dCity, destState: r.dState }), equip: r.equip, miles: r.miles }, {});
  const tipRow = (t) => h('div', { class: 'tip' + (marks.has(t.id) ? ' helpful' : '') }, h('span', { class: 'pill' }, (TIP_TYPES.find(x => x[0] === t.type) || [, t.type])[1]), h('span', null, tipLine(t)), h('span', { class: 'muted small' }, `${t.byName || t.by} ${ago(t.at)}`),
    mine ? h('button', { class: 'btn small', type: 'button', 'data-act': 'mark-helpful', onclick: () => net.markTip(t, !marks.has(t.id)) }, marks.has(t.id) ? 'Helpful ✓' : 'Mark helpful') : (marks.has(t.id) ? h('span', { class: 'pill orig' }, 'Helpful') : null));
  return h('div', { class: 'panel rescue', 'data-rescue': r.id },
    h('div', { class: 'truck-head' }, h('b', null, `${placeText(r.oCity, r.oState)} → ${placeText(r.dCity, r.dState)}`), h('span', { class: 'pill' }, equipLabel(r.equip)), r.pickup ? h('span', { class: 'pill' }, 'pickup ' + usDate(r.pickup)) : null, mine ? h('span', { class: 'pill orig' }, 'yours') : null),
    h('div', { class: 'muted small' }, `${r.by || 'A teammate'} asked ${ago(r.at)} · ${r.miles ? r.miles + ' mi · ' : ''}${r.target ? 'target ' + money(r.target) + ' · ' : ''}posted ${Math.round(r.ageMin / 60 * 10) / 10} h · ${r.contacted} carriers contacted · ${r.inquiries} inquiries · raised ${money(r.raised)} · ${r.waves} outreach waves · closes ${until(r.exp)}`),
    r.note ? h('div', { class: 'truck-note' }, r.note) : null,
    advice.ok ? h('div', { class: 'banner ok' }, liftText(advice, r.raised)) : null,
    tips.length ? h('div', { class: 'tips' }, tips.map(tipRow)) : h('p', { class: 'muted' }, mine ? 'No answers yet. People are usually quick.' : 'Be the first to help.'),
    mine ? h('div', { class: 'toolbar' }, iconBtn('check', 'Covered', { class: 'primary', onclick: () => net.closeRescue(r.id, 'covered') }), iconBtn('close', 'Close request', { onclick: () => net.closeRescue(r.id, 'closed') }))
      : h('div', null, ownPicks(r), tipForm(r)));
}

export function render() {
  if (!net.joined()) return notJoined('rescue');
  const open = net.openRescues();
  const mine = open.filter(r => r.uid === net.myUid()), others = open.filter(r => r.uid !== net.myUid());
  const board = helperBoard(net.net.tips, net.net.marks).slice(0, 5);
  return h('div', null,
    pageHead({ icon: 'sparkle', title: 'Load Rescue', sub: 'Stuck load? Ask the team from the board (Ask the team). Everyone adds carriers, markets, rates and posting cities. You stay in charge of the load.' }),
    mine.length ? h('h3', null, 'Your requests') : null, ...mine.map(rescueCard),
    h('h3', null, 'Help a teammate'), ...(others.length ? others.map(rescueCard) : [emptyState({ icon: 'sparkle', title: 'Nobody needs help right now', text: 'When a teammate asks, it shows up here and in the sidebar.' })]),
    board.length ? h('div', { class: 'panel' }, h('h3', null, 'Top helpers'), board.map(b => h('div', { class: 'member' }, h('b', null, b.name), h('span', { class: 'muted small' }, `${b.tips} answers · ${b.helpful} marked helpful`)))) : null);
}
