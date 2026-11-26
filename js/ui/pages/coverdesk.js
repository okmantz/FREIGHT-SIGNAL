// Cover Desk (v16): the one screen for "what needs me right now".
//   1. Needs your eyes   : carrier e-mails the engine would not answer by itself, with the carrier's words and a ready reply
//   2. Call these first  : one list across ALL your loads, hardest and soonest first, live trucks on top
//   3. Trucks available  : your Truck Book (paste a list or an e-mail, it finds the trucks)
//   4. Loads that fit together, and posting effectiveness
import { h, toast, modal, copyText, field } from '../dom.js';
import { pageHead, emptyState, statTiles } from '../chrome.js';
import { state, actions, subscribe } from '../../store/state.js';
import * as net from '../../store/net.js';
import { exceptionQueue, ledgerSummary, shadowStats } from '../../core/ledger.js';
import { TEACHABLE, LEARN_AUTO, teachableLabel, cleanLessons } from '../../core/replylearn.js';
import { callSheet } from '../../core/prospects.js';
import { activeTrucks, matchLoadsToTruck, carrierHistoryFromLog, freshness, freshLabel } from '../../core/truckbook.js';
import { headsOf, bundleOpportunities } from '../../core/corridor.js';
import { gridEffectiveness, gridSummary } from '../../core/effectiveness.js';
import { mailtoUrl } from '../../core/eml.js';
import { matchStats, matchesForLoad, QUALIFIED } from '../../core/matching.js';
import { rescueButton } from '../board/autorescue.js';
import { placeText, money } from '../../core/netcommon.js';
import { equipLabel } from '../../core/equipment.js';
import { sendModeOf, MODE_LABEL } from '../../core/sendpolicy.js';
import { laneBoxes } from '../../core/model.js';
import { coverModal } from '../board/cover.js';
import { telHref } from '../../core/resources.js';

const rerender = () => import('../../main.js').then(m => m.render());
const sect = (title, sub, ...kids) => h('section', { class: 'panel' }, h('h3', null, title), sub ? h('p', { class: 'muted' }, sub) : null, ...kids);

function replyOf(e) {
  const text = e.suggestText || e.draftText || '';
  return { to: e.draftTo || e.from, subject: e.draftSubject || ('RE: ' + e.subject), body: text };
}

/** "Teach it": for a message the rules could not read, pick what it meant. Next time the same words get your standard reply for that meaning. */
function teachRow(e) {
  if (!(e.intent === 'unclear' || e.learned) || !e.fresh) return null;
  const pick = h('select', { class: 'cell', 'aria-label': 'What this message means', 'data-act': 'teach-pick' },
    h('option', { value: '' }, 'This message means…'), TEACHABLE.map(t => h('option', { value: t.intent, selected: e.learned && e.learned.intent === t.intent }, t.label)));
  const btn = h('button', { class: 'btn small', type: 'button', 'data-act': 'teach-go', onclick: async () => {
    if (!pick.value) { toast('Pick what the carrier meant first.', 'warn'); return; }
    const r = await actions.teachReply(e.id, pick.value);
    if (!r.ok) { toast(r.reason || 'Could not learn that.', 'warn', 5000); return; }
    toast(`Learned: next time this reads as "${r.label}"` + (r.count >= LEARN_AUTO ? ' and it may send itself.' : `. It needs ${LEARN_AUTO - r.count} more confirmation${LEARN_AUTO - r.count === 1 ? '' : 's'} before it can send itself.`), 'ok', 6000); rerender();
  } }, 'Teach');
  return h('div', { class: 'cdesk-teach' }, e.learned ? h('span', { class: 'pill alt' }, `Learned (${Math.min(e.learned.count, LEARN_AUTO)} of ${LEARN_AUTO})`) : null, pick, btn);
}

function queueItem(e) {
  const rp = replyOf(e);
  return h('div', { class: 'cdesk-item', 'data-test': 'cdesk-item' },
    h('div', null, h('b', null, e.from), ' ', h('span', { class: 'pill' }, (e.intent || 'message').replace(/_/g, ' ')), ' ', e.flag ? h('span', { class: 'pill alt' }, e.flag) : null),
    h('div', { class: 'muted small' }, e.subject),
    e.fresh ? h('div', { class: 'said' }, e.fresh) : null,
    h('div', { class: 'muted small' }, (e.reason || '') + (e.holdReasons && e.holdReasons.length ? ' Held because: ' + e.holdReasons.join(' ') : '')),
    teachRow(e),
    rp.body ? h('details', null, h('summary', null, 'Suggested reply'), h('pre', { class: 'mono' }, rp.body.slice(0, 900))) : null,
    h('div', { class: 'toolbar' },
      rp.body && rp.to ? h('button', { class: 'btn small primary', type: 'button', onclick: () => { window.location.href = mailtoUrl({ to: rp.to, subject: rp.subject, body: rp.body }); } }, 'Reply with this') : null,
      rp.body ? h('button', { class: 'btn small', type: 'button', onclick: () => copyText(rp.body) }, 'Copy reply') : null,
      h('button', { class: 'btn small', type: 'button', 'data-act': 'cdesk-done', onclick: async () => { await actions.resolveLedger(e.id, ''); rerender(); } }, 'Done'),
      h('button', { class: 'btn small', type: 'button', title: 'Tell Freight Signal it misread this message. It counts against the readiness meter.', onclick: async () => { await actions.resolveLedger(e.id, 'bad'); rerender(); } }, 'It misread this')));
}

function addTrucksDialog() {
  const ta = h('textarea', { rows: 9, class: 'cell wide', placeholder: 'Paste a carrier e-mail, a text, a list (one truck per line) or a CSV with columns like Carrier, MC, Phone, City, State, Equipment, Date.\n\nExample:\nVan in Joliet IL going anywhere, tomorrow. ACME TRUCKING 312-555-0147 MC 123456' });
  modal({ title: 'Add available trucks', body: h('div', null, h('p', { class: 'muted' }, 'Freight Signal finds each truck\'s location, equipment, date and contact. Trucks learned from carrier replies are added automatically.'), ta),
    actions: [{ label: 'Cancel' }, { label: 'Add trucks', kind: 'primary', onClick: async () => {
      const r = await actions.importTruckText(ta.value, 'paste');
      if (!r.found) { toast('No trucks found. Include a city and state for each truck.', 'warn', 6000); return false; }
      toast(r.added + ' added' + (r.updated ? ', ' + r.updated + ' updated' : '') + (r.skipped.length ? ', ' + r.skipped.length + ' skipped (no location)' : ''), 'ok', 6000); rerender();
    } }] });
}

/** "Covered": open the Mark covered dialog for this load with the carrier already filled in (v23: no hunting for the load on the board). */
function coveredBy(load, carrier, rate) {
  const box = laneBoxes(state.postings).find(b => b.head.id === load.id || b.members.some(m => m.id === load.id));
  if (!box) return toast('That load is no longer on the board.', 'warn');
  coverModal(box, { carrier: { name: carrier.carrierName || '', email: carrier.email || '', mc: carrier.mc || '', phone: carrier.phone || '' }, rate });
}

export function render() {
  const now = Date.now();
  const heads = headsOf(state.postings).filter(p => p.status !== 'Covered' && p.status !== 'Expired');
  const queue = exceptionQueue(state.ledger);
  const sum = ledgerSummary(state.ledger, now);
  const trucks = activeTrucks(state.trucks, now).sort((a, b) => (b.at || 0) - (a.at || 0));
  const mode = sendModeOf(state.settings);
  const ready = shadowStats(state.ledger);
  const root = h('div', { class: 'cdesk' },
    pageHead({ icon: 'sparkle', title: 'Cover Desk', sub: 'What needs you right now: held e-mails, who to call, trucks that are free.', actions: [h('button', { class: 'btn primary', type: 'button', 'data-act': 'add-trucks', onclick: addTrucksDialog }, 'Add trucks')] }),
    statTiles ? statTiles([[queue.length, 'Needs your eyes', queue.length ? 'warn' : ''], [Math.max(0, sum.today - sum.review), 'Handled today'], [sum.auto, 'Sent by itself today'], [trucks.length, 'Trucks available']]) : null);

  // 1. exception queue
  root.append(sect('Needs your eyes', queue.length ? 'Everything here is a message Freight Signal chose not to answer by itself. Each has a suggested reply when one makes sense.' : null,
    ...(queue.length ? queue.slice(0, 30).map(queueItem) : [emptyState({ icon: 'check', title: 'Nothing is waiting for you', text: 'Carrier e-mails that need a person will show up here with the carrier\'s words and a ready reply.' })])));

  // 1a. what you taught it (only when something was taught)
  const lessons = cleanLessons(state.settings.replyLessons);
  if (lessons.length) root.append(sect('Wording you taught it', 'Messages like these are read the way you said. A lesson drafts a reply for you until you have confirmed it ' + LEARN_AUTO + ' times, and it can never override a rate, a decline or a stop.',
    ...lessons.slice(0, 12).map(l => h('div', { class: 'cdesk-item compact' }, h('span', { class: 'said' }, l.text), ' ', h('span', { class: 'pill' }, teachableLabel(l.intent)), ' ', h('span', { class: 'muted small' }, `confirmed ${l.count}×`),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'forget-lesson', onclick: async () => { await actions.forgetLesson(l.sig); rerender(); } }, 'Forget')))));

  // 2. call sheet
  const histTrucks = [];
  for (const t of trucks) for (const m of matchLoadsToTruck(t, heads, { zipMap: state.zip, now, carrierHistory: carrierHistoryFromLog(state.coverLog) }).slice(0, 1)) histTrucks.push({ truck: t, load: m.load, score: m.score, reasons: m.reasons });
  const sheet = callSheet(heads, state.carriers, { zip: state.zip, zipMap: state.zip, settings: state.settings, coverLog: state.coverLog, inquiries: state.inquiries, outreach: state.outreach, now: new Date(now), liveTrucks: histTrucks, limit: 15 });
  root.append(sect('Call these first', 'One list across every open load. Hard and urgent loads come first, and trucks that reported in today come before database guesses.',
    ...(sheet.length ? sheet.map(r => { const ph = r.phone || r.carrier.phone || ''; return h('div', { class: 'cv-row' },
      h('b', null, r.carrier.carrierName || r.carrier.email || 'Carrier'), ' ', ph ? h('a', { href: telHref(ph) || ('tel:' + String(ph).replace(/[^0-9+]/g, '')) }, ph) : null, ' ', r.source === 'truck' ? h('span', { class: 'pill ok' }, 'truck free now') : null,
      h('div', { class: 'muted small' }, 'for ' + placeText(r.load.originCity, r.load.originState) + ' to ' + placeText(r.load.destCity, r.load.destState) + (r.urgency ? ' (' + r.urgency + ')' : '') + ' \u00b7 ' + r.why.join('; ')),
      h('div', { class: 'toolbar' },
        ph ? h('a', { class: 'btn small primary', href: telHref(ph) || ('tel:' + String(ph).replace(/[^0-9+]/g, '')), 'data-act': 'sheet-call' }, 'Call ' + ph) : null,
        r.carrier.email ? h('a', { class: 'btn small', href: mailtoUrl({ to: r.carrier.email, subject: 'Truck for ' + placeText(r.load.originCity, r.load.originState) + ' to ' + placeText(r.load.destCity, r.load.destState), body: '' }), 'data-act': 'sheet-mail' }, 'E-mail') : null,
        h('button', { class: 'btn small', type: 'button', 'data-act': 'sheet-covered', title: 'They took it: log the cover with this carrier filled in', onclick: () => coveredBy(r.load, r.carrier) }, 'Covered by them'))); }) : [h('p', { class: 'muted' }, 'Add carriers with phone numbers (or trucks below) and open loads will appear here.')])));

  // 3. trucks
  root.append(sect('Trucks available now', 'Your Truck Book. A truck reported in the last 4 hours ranks highest; after a day and a half it stops counting.',
    ...(trucks.length ? [h('div', null, trucks.slice(0, 40).map(t => {
      const best = matchLoadsToTruck(t, heads, { zipMap: state.zip, now })[0];
      return h('div', { class: 'cv-row' },
        h('b', null, t.carrierName || t.email || t.mc || 'Carrier'), ' ', h('span', { class: 'muted' }, equipLabel(t.equip) + ' · ' + placeText(t.oCity, t.oState) + (t.destOpen ? ' → anywhere' : ' → ' + placeText(t.dCity, t.dState)) + ' · ' + freshLabel(t, now)),
        best ? h('div', { class: 'muted small' }, 'Best load for it: ' + placeText(best.load.originCity, best.load.originState) + ' to ' + placeText(best.load.destCity, best.load.destState)) : null,
        h('div', { class: 'toolbar' }, t.phone ? h('a', { class: 'btn small primary', href: 'tel:' + String(t.phone).replace(/[^0-9+]/g, '') }, 'Call ' + t.phone) : null,
          best ? h('button', { class: 'btn small', type: 'button', 'data-act': 'truck-covered', title: 'This truck took its best load: log the cover with the carrier filled in', onclick: () => coveredBy(best.load, { carrierName: t.carrierName, email: t.email, mc: t.mc, phone: t.phone }) }, 'Covered: best load') : null,
          h('button', { class: 'btn small', type: 'button', onclick: async () => { await actions.setTruckStatus(t.id, 'booked'); rerender(); } }, 'Booked'),
          h('button', { class: 'btn small', type: 'button', onclick: async () => { await actions.removeTruck(t.id); rerender(); } }, 'Remove')));
    }))] : [emptyState({ icon: 'truck', title: 'No trucks on file', text: 'Press Add trucks and paste a carrier e-mail or a list.', actions: [h('button', { class: 'btn primary', type: 'button', onclick: addTrucksDialog }, 'Add trucks')] })])));

  // 1b. two-way matching: every open load against every available truck (yours and the team's)
  const ms = matchStats(state.matches, heads);
  root.append(sect('Truck matches per load', 'Every new load is checked against every available truck, and every new truck against every open load. The number to watch is how many qualified trucks each load has.',
    ...(heads.length ? [h('div', { class: 'mstats' }, h('div', { class: 'metric' }, h('div', { class: 'k' }, 'Avg qualified trucks per load'), h('div', { class: 'v' }, ms.avgPerLoad.toFixed(1))),
      h('div', { class: 'metric' }, h('div', { class: 'k' }, 'Loads with a match'), h('div', { class: 'v' }, `${ms.withMatch} / ${ms.loads}`)), h('div', { class: 'metric' }, h('div', { class: 'k' }, 'Hot matches'), h('div', { class: 'v' }, ms.hot))),
      h('div', null, heads.map(hd => { const list = matchesForLoad(state.matches, hd.id).filter(m => QUALIFIED.includes(m.tier)); return h('div', { class: 'cv-row' },
        h('b', null, placeText(hd.originCity, hd.originState) + ' to ' + placeText(hd.destCity, hd.destState)), ' ', h('span', { class: 'dir-chip ' + (list.length ? 'ok' : 'warn') }, list.length + ' qualified truck' + (list.length === 1 ? '' : 's')),
        list.length ? h('div', { class: 'muted small' }, list.slice(0, 4).map(m => (m.carrierName || m.email || 'Carrier') + (m.phone ? ' ' + m.phone : '')).join(' · ')) : null,
        h('div', { class: 'toolbar' }, rescueButton({ head: hd, members: [hd] }, hd))); }))] : [emptyState({ icon: 'truck', title: 'No open loads', text: 'Add a load on the Load board and its truck matches appear here.' })])));

  // 4. bundling + effectiveness + readiness
  const chains = bundleOpportunities(heads, { zipMap: state.zip, limit: 6 });
  if (chains.length) root.append(sect('Loads that fit together', 'One truck could run these back to back: offer both.', h('ul', null, chains.map(c => h('li', null, c.text + ' (' + c.gapMiles + ' mi apart)')))));
  const eff = gridEffectiveness(state.coverLog);
  root.append(sect('What is working', null, h('p', null, gridSummary(eff))));
  const pct = ready.judged ? Math.min(100, Math.round(ready.judged / 30 * 100)) : 0;
  root.append(sect('Is auto-send ready?', 'Mode: ' + MODE_LABEL[mode] + '.',
    h('div', { class: 'cdesk-meter' }, (() => { const i = h('i'); i.style.width = pct + '%'; return i; })()),
    h('p', { class: 'muted' }, ready.ready ? 'Agreement ' + ready.pct + '% over ' + ready.judged + ' judged replies. You can turn on auto-send in System.' : ready.judged ? ready.judged + ' of 30 judged replies so far' + (ready.pct !== null ? ' (' + ready.pct + '% agree)' : '') + '. Use Shadow mode in System, then mark the replies it got wrong.' : 'Turn on Shadow mode in System. It drafts as usual and keeps score of what it would have sent.')));
  return root;
}
