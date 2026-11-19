// Load rescue: "this load has been sitting, help me cover it".
//
// The load's owner stays responsible for the load. A rescue request is a small, privacy-safe summary of it: the lane, equipment, pickup
// day, how long it has been on the board, what has been tried, and the target rate. It never includes the customer, the load text, the
// reference number or any contact details. Teammates answer with "tips": a carrier that works the lane, a market with trucks, a rate
// that is moving freight, another city to post from. The owner marks the tips that helped.

import { normalizeZip, safeNumeric } from './util.js';
import { rankCarriers } from './ranking.js';
import { HOUR, MIN, oneLine, multiLine, stateCode, emailOf, phoneOf, isoDay, placeText, marketKey, repriceTotal } from './netcommon.js';
import { parseMcDot } from './resources.js';

export const RESCUE_TTL_HOURS = 12;
export const KEEP_RESCUE_MS = 3 * 24 * HOUR;
export const TIP_TYPES = [
  ['carrier', 'A carrier who could take it'],
  ['market', 'A market with trucks'],
  ['rate', 'Rate intelligence'],
  ['city', 'Another city to post from'],
  ['note', 'Other idea'],
];

/* ------------------------------------------------------------------------------------------------ the owner's side */
/** What has been tried on a load, from the board's own records. members = the load's postings. */
export function rescueFacts(members, { outreach = [], inquiries = [], now = Date.now() } = {}) {
  const head = members.find(m => m.variant === 'Original') || members[0] || {};
  const ids = new Set(members.map(m => m.id));
  const created = members.map(m => Date.parse(m.createdAt)).filter(Number.isFinite);
  const ageMin = created.length ? Math.max(0, Math.round((now - Math.min(...created)) / MIN)) : 0;
  const contacted = new Set(outreach.filter(o => ids.has(o.postingId)).map(o => String(o.email || '').toLowerCase()).filter(Boolean));
  const inq = inquiries.filter(q => ids.has(q.postingId));
  const replied = new Set(inq.map(q => String(q.senderEmail || '').toLowerCase()).filter(Boolean));
  const ops = Array.isArray(head.ops) ? head.ops : [];
  const raised = repriceTotal(ops);
  return {
    ageMin, contacted: contacted.size, inquiries: replied.size || members.reduce((n, m) => n + safeNumeric(m.inquiryCount), 0),
    raised, waves: ops.filter(o => o && (o.type === 'wave2' || o.type === 'outreach')).length,
    target: safeNumeric(head.targetRate) || safeNumeric(head.datRate) || 0,
  };
}

/** Build the shared request. members = the load's postings; facts = rescueFacts(); me = { uid, name, email }. */
export function buildRescue(members, facts, me, { note = '', now = Date.now(), ttlHours = RESCUE_TTL_HOURS, miles = null, id = '' } = {}) {
  const head = members.find(m => m.variant === 'Original') || members[0];
  if (!head) return { ok: false, error: 'That load has no postings.' };
  if (!oneLine(head.originCity, 60) || !stateCode(head.originState) || !oneLine(head.destCity, 60) || !stateCode(head.destState)) return { ok: false, error: 'The load needs an origin and a destination first.' };
  return {
    ok: true,
    rescue: {
      id, uid: me.uid, by: oneLine(me.name, 60), byEmail: emailOf(me.email), at: now, exp: now + Math.min(Math.max(ttlHours, 1), 72) * HOUR, status: 'open',
      oCity: oneLine(head.originCity, 60), oState: stateCode(head.originState), oZip: normalizeZip(head.originZip),
      dCity: oneLine(head.destCity, 60), dState: stateCode(head.destState), dZip: normalizeZip(head.destZip),
      equip: oneLine(head.equip || 'V', 4).toUpperCase(), pickup: isoDay(head.pickupEarliest), weight: Math.round(safeNumeric(head.weight)) || 0,
      miles: Number.isFinite(miles) ? Math.round(miles) : 0, target: Math.round(facts.target || 0),
      ageMin: Math.round(facts.ageMin || 0), contacted: facts.contacted || 0, inquiries: facts.inquiries || 0, raised: Math.round(facts.raised || 0), waves: facts.waves || 0,
      note: multiLine(note, 400),
    },
  };
}

export function cleanRescue(raw, id = '') {
  if (!raw || typeof raw !== 'object') return null;
  const r = {
    id: oneLine(raw.id || id, 40), uid: oneLine(raw.uid, 80), by: oneLine(raw.by, 60), byEmail: emailOf(raw.byEmail),
    at: Number(raw.at), exp: Number(raw.exp), status: ['open', 'covered', 'closed'].includes(raw.status) ? raw.status : 'open',
    oCity: oneLine(raw.oCity, 60), oState: stateCode(raw.oState), oZip: normalizeZip(raw.oZip),
    dCity: oneLine(raw.dCity, 60), dState: stateCode(raw.dState), dZip: normalizeZip(raw.dZip),
    equip: oneLine(raw.equip || 'V', 4).toUpperCase(), pickup: isoDay(raw.pickup),
    weight: Math.max(0, Math.round(Number(raw.weight)) || 0), miles: Math.max(0, Math.round(Number(raw.miles)) || 0), target: Math.max(0, Math.round(Number(raw.target)) || 0),
    ageMin: Math.max(0, Math.round(Number(raw.ageMin)) || 0), contacted: Math.max(0, Math.round(Number(raw.contacted)) || 0), inquiries: Math.max(0, Math.round(Number(raw.inquiries)) || 0),
    raised: Math.round(Number(raw.raised)) || 0, waves: Math.max(0, Math.round(Number(raw.waves)) || 0), note: multiLine(raw.note, 400),
    closedAt: Number.isFinite(Number(raw.closedAt)) ? Number(raw.closedAt) : 0,
  };
  if (!r.id || !r.uid || !Number.isFinite(r.at) || !Number.isFinite(r.exp) || !r.oCity || !r.oState || !r.dCity || !r.dState) return null;
  return r;
}

/** 'open' | 'covered' | 'closed' | 'expired' */
export const rescueState = (r, now = Date.now()) => (r.status !== 'open' ? r.status : now >= r.exp ? 'expired' : 'open');
export const rescuePrunable = (r, now = Date.now()) => now - Math.max(r.exp, r.closedAt || 0) > KEEP_RESCUE_MS;

/** Does a load on the board look like it needs help? No replies after `afterMin` minutes and not already requested. */
export function needsHelp(facts, { afterMin = 90, alreadyAsked = false } = {}) {
  return !alreadyAsked && facts.inquiries === 0 && facts.ageMin >= afterMin;
}

/* ------------------------------------------------------------------------------------------------ the helpers' side */
const rate = (v) => { const n = Math.round(safeNumeric(v)); return n >= 100 && n <= 25000 ? n : 0; };

/** Validate a tip. input: { type, text, carrierName, mc, email, phone, rate, city, state }. */
export function buildTip(input, rescue, me, { now = Date.now(), id = '' } = {}) {
  const type = TIP_TYPES.some(t => t[0] === input.type) ? input.type : 'note';
  const tip = { id, rid: rescue.id, uid: me.uid, by: oneLine(me.name, 60), at: now, type, text: multiLine(input.text, 400), carrierName: '', mc: '', email: '', phone: '', rate: 0, city: '', state: '' };
  if (type === 'carrier') {
    tip.carrierName = oneLine(input.carrierName, 80); const mc = parseMcDot(input.mc); tip.mc = mc ? (mc.type === 'DOT' ? 'DOT ' : 'MC ') + mc.num : oneLine(input.mc, 30);
    tip.email = emailOf(input.email); tip.phone = phoneOf(input.phone);
    if (!tip.carrierName && !tip.mc) return { ok: false, error: 'Give the carrier a name or an MC number.' };
    if (!tip.email && !tip.phone) return { ok: false, error: 'Add an e-mail or phone so the owner can reach the carrier.' };
  } else if (type === 'rate') {
    tip.rate = rate(input.rate);
    if (!tip.rate && !tip.text) return { ok: false, error: 'Enter a rate (for example 2350) or describe what you are seeing.' };
  } else if (type === 'city') {
    tip.city = oneLine(input.city, 60); tip.state = stateCode(input.state);
    if (!tip.city || !tip.state) return { ok: false, error: 'Enter the city and state to post from.' };
  } else if (type === 'market') {
    tip.city = oneLine(input.city, 60); tip.state = stateCode(input.state);
    if (!tip.text && !tip.city) return { ok: false, error: 'Say which market has trucks, or add a note.' };
  } else if (!tip.text) return { ok: false, error: 'Write your idea first.' };
  return { ok: true, tip };
}

export function cleanTip(raw, id = '') {
  if (!raw || typeof raw !== 'object') return null;
  const t = {
    id: oneLine(raw.id || id, 40), rid: oneLine(raw.rid, 40), uid: oneLine(raw.uid, 80), by: oneLine(raw.by, 60), at: Number(raw.at),
    type: TIP_TYPES.some(x => x[0] === raw.type) ? raw.type : 'note', text: multiLine(raw.text, 400),
    carrierName: oneLine(raw.carrierName, 80), mc: oneLine(raw.mc, 30), email: emailOf(raw.email), phone: phoneOf(raw.phone),
    rate: rate(raw.rate), city: oneLine(raw.city, 60), state: stateCode(raw.state),
  };
  return t.id && t.rid && t.uid && Number.isFinite(t.at) ? t : null;
}

export function cleanMark(raw, id = '') {
  if (!raw || typeof raw !== 'object') return null;
  const m = { id: oneLine(raw.id || id, 40), rid: oneLine(raw.rid, 40), by: oneLine(raw.by, 80), v: 'helpful', at: Number(raw.at) };
  return m.id && m.rid && m.by && Number.isFinite(m.at) ? m : null;
}

/**
 * What a helper can offer from THEIR OWN database for someone else's load: their best-matched carriers for the lane. Nothing is shared
 * until they press "Suggest" on one. rescue -> a posting-shaped object so the normal ranking can be reused.
 */
export function ownCarrierPicks(rescue, carriers, ctx = {}, limit = 5) {
  const load = { originCity: rescue.oCity, originState: rescue.oState, originZip: rescue.oZip, destCity: rescue.dCity, destState: rescue.dState, destZip: rescue.dZip, equip: rescue.equip };
  return rankCarriers(load, carriers, { ...ctx, requireEmail: false }).filter(r => r.carrier.email || r.carrier.phone).slice(0, limit);
}

/**
 * Bigger markets near the pickup (or the delivery) that carriers search for: city, miles away and population, biggest first.
 * The load's own city is never offered.
 */
export function alternateCities(zipMap, { city, state, zip }, { minMiles = 8, maxMiles = 60, minPop = 20000, limit = 5 } = {}) {
  if (!zipMap || !zipMap.size) return [];
  const z = normalizeZip(zip) || zipMap.bestZipForCityState(city, state); if (!z) return [];
  const own = marketKey(city, state);
  const best = new Map();
  for (const r of zipMap.searchRadius(z, minMiles, maxMiles, 600)) {
    const k = marketKey(r.city, r.state); if (k === own) continue;
    const m = zipMap.market(r.city, r.state); const pop = m ? m.pop : r.population;
    if (pop < minPop) continue;
    if (!best.has(k)) best.set(k, { city: r.city, state: r.state, miles: Math.round(r.miles), pop });
  }
  return [...best.values()].sort((a, b) => b.pop - a.pop || a.miles - b.miles).slice(0, limit);
}

/** Tip summary line for lists and the owner's copy button. */
export function tipLine(t) {
  if (t.type === 'carrier') return [t.carrierName, t.mc, t.phone, t.email].filter(Boolean).join(' · ') + (t.text ? ' — ' + t.text : '');
  if (t.type === 'rate') return (t.rate ? '$' + t.rate.toLocaleString('en-US') : '') + (t.text ? (t.rate ? ' — ' : '') + t.text : '');
  if (t.type === 'city' || t.type === 'market') return [placeText(t.city, t.state), t.text].filter(Boolean).join(' — ');
  return t.text;
}

/** Leaderboard of who helped: tips marked helpful per person. */
export function helperBoard(tips, marks) {
  const helpful = new Set(marks.map(m => m.id));
  const by = new Map();
  for (const t of tips) { const e = by.get(t.uid) || { uid: t.uid, name: t.by, tips: 0, helpful: 0 }; e.tips++; if (helpful.has(t.id)) e.helpful++; e.name = t.by || e.name; by.set(t.uid, e); }
  return [...by.values()].sort((a, b) => b.helpful - a.helpful || b.tips - a.tips || a.name.localeCompare(b.name));
}

