// "Coverage" strip + window on each load card (v16): the suggested rate, the trucks that match right now, who wants this lane, and a backhaul to offer.
// One quiet strip; everything else is one click away in the window. Nothing here sends mail.
import { h, modal, toast, copyText } from '../dom.js';
import { icon } from '../icons.js';
import { state, actions } from '../../store/state.js';
import * as net from '../../store/net.js';
import { suggestRate } from '../../core/raterec.js';
import { activeTrucks, matchTrucksToLoad, carrierHistoryFromLog, freshLabel } from '../../core/truckbook.js';
import { corridorCarriers, findBackhaulLoads, backhaulPitch, laneDifficulty, swapOpportunities, headsOf } from '../../core/corridor.js';
import { money, placeText } from '../../core/netcommon.js';
import { equipLabel } from '../../core/equipment.js';
import { safeNumeric } from '../../core/util.js';

const teamTrucks = () => { try { return net.joined() ? net.resolvedTrucks() : []; } catch { return []; } };

/** Everything the strip and the window need for one load. Cheap enough to run on every render. */
export function coverageData(head, now = Date.now()) {
  const zipMap = state.zip;
  const mine = activeTrucks(state.trucks, now), team = activeTrucks(teamTrucks(), now).filter(t => !mine.some(m => m.key && m.key === t.key));
  const ctx = { zipMap, now, carrierHistory: carrierHistoryFromLog(state.coverLog), radius: Number(state.settings.carrierRadiusMiles) > 0 ? Math.max(100, Number(state.settings.carrierRadiusMiles)) : 125 };
  const trucks = matchTrucksToLoad(head, [...mine, ...team], ctx);
  const rate = suggestRate(head, { zipMap, coverLog: state.coverLog, inquiries: state.inquiries, settings: state.settings, now });
  const heads = headsOf(state.postings).filter(p => p.status !== 'Covered');
  const backhaul = findBackhaulLoads(head, heads, { zipMap });
  return { trucks, rate, backhaul, ctx, heads };
}

export function coverageStrip(b, head) {
  if (!head || head.status === 'Covered') return null;
  const ids = b.members.map(m => m.id);
  const d = coverageData(head);
  const target = safeNumeric(head.targetRate);
  const bits = [];
  if (head.targetSource === 'suggested' && target > 0) {
    bits.push(h('span', { class: 'cv-chip warn', title: head.targetNote || 'Suggested from your own results' }, 'Suggested target ' + money(target)));
    bits.push(h('button', { class: 'btn small primary', type: 'button', 'data-act': 'confirm-target', title: 'Yes, this is my target. Auto-send may answer rates once it is confirmed.', onclick: async () => { await actions.confirmTarget(ids); toast('Target confirmed.', 'ok'); } }, 'Confirm'));
  } else if (d.rate.rate > 0 && d.rate.confidence !== 'low' && target > 0 && Math.abs(d.rate.rate / target - 1) >= 0.08) {
    bits.push(h('span', { class: 'cv-chip', title: d.rate.basis.join('\n') }, 'Your results say ~' + money(d.rate.rate)));
    bits.push(h('button', { class: 'btn small', type: 'button', 'data-act': 'use-suggested-rate', onclick: async () => { await actions.setTargetRate(ids, String(d.rate.rate)); toast('Target set to ' + money(d.rate.rate), 'ok'); } }, 'Use'));
  } else if (!(target > 0) && d.rate.rate > 0) {
    bits.push(h('span', { class: 'cv-chip' }, 'Suggested ' + money(d.rate.rate) + ' (' + d.rate.confidence + ')'));
    bits.push(h('button', { class: 'btn small', type: 'button', 'data-act': 'apply-suggested-rate', onclick: async () => { await actions.applySuggestedRate(ids, String(d.rate.rate), d.rate.basis[0] || ''); } }, 'Apply'));
  }
  const hot = d.trucks.filter(t => t.tier === 'hot').length;
  bits.push(h('span', { class: 'cv-chip ' + (d.trucks.length ? 'ok' : ''), title: 'Available trucks near the pickup, from your Truck Book' + (net.joined() ? ' and the team board' : '') }, icon('truck', 13), d.trucks.length ? d.trucks.length + ' truck' + (d.trucks.length === 1 ? '' : 's') + ' match' + (hot ? ' (' + hot + ' hot)' : '') : 'No trucks on file'));
  if (d.backhaul.length) bits.push(h('span', { class: 'cv-chip', title: 'You have a load that starts where this one ends' }, 'Backhaul ' + d.backhaul.length));
  bits.push(h('button', { class: 'btn small', type: 'button', 'data-act': 'open-coverage', onclick: () => openCoverage(head, b) }, 'Coverage'));
  return h('div', { class: 'coverstrip', 'data-test': 'coverage-strip' }, bits);
}

const sect = (title, ...kids) => h('div', { class: 'panel' }, h('h3', null, title), ...kids);
const muted = (t) => h('p', { class: 'muted' }, t);

export function openCoverage(head, b) {
  const d = coverageData(head);
  const diff = laneDifficulty(head, { zipMap: state.zip, settings: state.settings });
  const ids = (b ? b.members : [head]).map(m => m.id);
  const body = h('div', { class: 'covwin' });
  // rate
  const rateKids = d.rate.rate > 0 ? [
    h('p', null, h('b', null, money(d.rate.rate)), ' ', h('span', { class: 'muted' }, '(' + money(d.rate.low) + ' to ' + money(d.rate.high) + ', ' + d.rate.confidence + ' confidence)'),
      ' ', h('button', { class: 'btn small primary', type: 'button', onclick: async () => { await actions.applySuggestedRate(ids, String(d.rate.rate), d.rate.basis[0] || ''); toast('Suggested target applied. Confirm it on the load card when you agree.', 'ok'); } }, 'Use as target')),
    h('ul', null, d.rate.basis.map(x => h('li', null, x))),
    h('p', { class: 'muted small' }, 'Built from your own covers, carrier quotes and the DAT average you typed. Freight Signal cannot read live DAT RateView data, so type the average for the lane to keep this current.'),
  ] : [muted(d.rate.basis[0] || 'Not enough information yet.')];
  body.append(sect('Rate that should get a truck', ...rateKids));
  if (diff.tough) body.append(sect('Why this load is hard', h('ul', null, diff.notes.map(n => h('li', null, n)))));
  // trucks
  body.append(sect('Trucks that match right now', d.trucks.length ? h('div', null, d.trucks.slice(0, 8).map(m => truckRow(m))) : muted('No available trucks on file near this pickup. Add trucks on the Cover Desk, or paste a carrier\'s e-mail there.')));
  // corridor carriers
  const cc = corridorCarriers(head, { carriers: state.carriers, coverLog: state.coverLog, trucks: activeTrucks(state.trucks), zipMap: state.zip, now: Date.now() }).slice(0, 8);
  body.append(sect('Carriers who want this lane', cc.length ? h('div', null, cc.map(c => h('div', { class: 'cv-row' }, h('b', null, c.name || c.email || c.mc), ' ', h('span', { class: 'muted' }, c.phone || c.email || ''), h('div', { class: 'muted small' }, c.why.join('; ')),
    c.phone || c.email ? h('button', { class: 'btn small', type: 'button', onclick: () => copyText(c.phone || c.email) }, 'Copy ' + (c.phone ? 'number' : 'e-mail')) : null))) : muted('No carriers in your database or recent covers deliver near the pickup or live near the delivery.')));
  // backhaul
  if (d.backhaul.length) {
    const first = d.backhaul[0];
    body.append(sect('Backhaul you can offer', h('div', null, d.backhaul.slice(0, 4).map(x => h('div', { class: 'cv-row' }, placeText(x.load.originCity, x.load.originState) + ' to ' + placeText(x.load.destCity, x.load.destState), h('span', { class: 'muted' }, '  ' + x.gapMiles + ' mi from the delivery' + (x.daysAfter ? ', ready ' + x.daysAfter + ' d later' : ''))))),
      h('button', { class: 'btn small', type: 'button', onclick: () => copyText(backhaulPitch(head, first), 'Copied: paste it into a carrier e-mail.') }, 'Copy a line for carrier e-mails')));
  }
  // swaps
  let sw = []; try { sw = net.joined() ? swapOpportunities(head, net.openRescues(), { zipMap: state.zip }) : []; } catch { sw = []; }
  if (sw.length) body.append(sect('Team swaps', h('ul', null, sw.slice(0, 4).map(x => h('li', null, x.text)))));
  modal({ title: 'Coverage: ' + placeText(head.originCity, head.originState) + ' to ' + placeText(head.destCity, head.destState), body, wide: true, actions: [{ label: 'Close' }] });
}

export function truckRow(m) {
  const t = m.truck;
  return h('div', { class: 'cv-row' },
    h('b', null, t.carrierName || t.email || t.mc || 'Carrier'), ' ', h('span', { class: 'pill ' + (m.tier === 'hot' ? 'ok' : '') }, m.tier), ' ', h('span', { class: 'muted' }, equipLabel(t.equip) + ' · ' + placeText(t.oCity, t.oState) + (t.destOpen ? ' → anywhere' : ' → ' + placeText(t.dCity, t.dState))),
    h('div', { class: 'muted small' }, m.reasons.join('; ')),
    h('div', { class: 'toolbar' },
      t.phone ? h('a', { class: 'btn small', href: 'tel:' + String(t.phone).replace(/[^0-9+]/g, '') }, 'Call ' + t.phone) : null,
      t.email ? h('button', { class: 'btn small', type: 'button', onclick: () => copyText(t.email) }, 'Copy e-mail') : null));
}
export { freshLabel };
