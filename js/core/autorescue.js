// AUTO RESCUE (v17): keeps working a hard load until it is covered. Each step changes the strategy; it never repeats the same outreach.
//
//   0-5 min     Instant match   private carriers, past covers, your Truck Book and the team's trucks -> a ranked list (no mail yet)
//   5-30 min    First wave      the best-ranked qualified prospects get an offer
//   30-60 min   Widen           more geographic markets and corridor matches
//   60-120 min  Commercial      recalculate the rate; raise it WITHIN the limit you authorised; updated offers to anyone who has not answered
//   120+ min    Team rescue     ask the team for help, search every team truck and wider corridors
//   150+ min    Escalation      v21: then every hour (every 30 min on Fast): reshuffle the DAT posting cities and states, step the rate up within the limit,
//                               send a bigger wave to carriers that have not answered, refresh the call list. It keeps escalating until the load is covered.
//   always      Re-evaluate     a new truck, quote or reply triggers another matching cycle straight away
//
// v21 changes: primary and backup carriers are reached first (offer AND call); the 9 DAT postings are reshuffled to new cities and nearby states
// (wider each time, never repeating cities already tried, left alone while replies are coming in); the rate steps up in small increments; the
// per-carrier cooldown shortens as the rescue escalates and for carriers who get a better rate; carriers you already called and who said "no truck"
// are not asked again; "Fast" pace runs every step in half the time.
//
// These are proposed intervals, not promised response times. The engine only runs while Freight Signal is open; it catches up when you return.
// It makes DRAFTS (through the same path as Carrier outreach). A per-carrier frequency cap stops one carrier from receiving a pile of similar offers.
// Pure: no DOM, no storage.

import { rankCarriers } from './ranking.js';
import { corridorCarriers, laneDifficulty } from './corridor.js';
import { matchTrucksToLoad, carrierHistoryFromLog } from './truckbook.js';
import { suggestRate } from './raterec.js';
import { buildExcelSubject, buildExcelBody, cleanLoadDetailsText, buildFallbackLoadDetails } from './outreach.js';
import { carrierKey, emailOf, placeText, roundTo, money, MIN, HOUR } from './netcommon.js';
import { matchAssignments } from './assignments.js';
import { safeNumeric, safeString } from './util.js';

export const STAGES = [
  { id: 'match', at: 0, label: 'Instant match', blurb: 'Searching your carriers, past covers, Truck Book and team trucks' },
  { id: 'wave1', at: 5, label: 'First outreach wave', blurb: 'Offers to the best-ranked qualified prospects' },
  { id: 'expand', at: 30, label: 'Widen the search', blurb: 'More markets and corridor matches, and the DAT postings reshuffled to new cities and nearby states' },
  { id: 'commercial', at: 60, label: 'Rate check', blurb: 'Recalculate the rate, send updated offers within your limit, reshuffle again if it is still quiet' },
  { id: 'team', at: 120, label: 'Team rescue', blurb: 'Ask the team and search every team truck' },
];
export const STAGE_IDS = STAGES.map(s => s.id);
export const stageIndex = (id) => STAGE_IDS.indexOf(id);
/** After the five timed stages the rescue keeps going in escalation rounds (not part of STAGES so older saved rescues and the stage dots still line up). */
export const CYCLE_STAGE = { id: 'cycle', at: 150, label: 'Escalation round', blurb: 'Reshuffle postings, step the rate up, wider wave, fresh call list: repeats until covered' };
export const ALL_STAGES = [...STAGES, CYCLE_STAGE];

export const RESCUE_DEFAULTS = { rescueWaveSize: 8, rescueMinHoursBetween: 12, rescueMaxPerLoad: 2, rescueRaiseStep: 0.05, rescueMaxHours: 72, rescueCycleMinutes: 60, rescueMaxReshuffles: 6 };
const cfg = (settings, k) => { const v = Number(settings && settings[k]); return Number.isFinite(v) && v > 0 ? v : RESCUE_DEFAULTS[k]; };

/** How fast the clock runs: 1 = normal, 2 = Fast (every step arrives in half the time). */
export const paceOf = (rescue) => (rescue && Number(rescue.pace) >= 2 ? 2 : 1);
/** The stage you are in after `minutes` minutes (`pace` 2 = Fast). */
export function stageAt(minutes, pace = 1) { let cur = STAGES[0]; for (const s of STAGES) if (minutes * pace >= s.at) cur = s; return cur; }

export function newRescue(head, { now = Date.now(), maxRate = 0, includeTeam = false, auto = false, pace = 1, cycleMinutes = 0 } = {}) {
  return { id: head.id, headId: head.id, groupId: head.groupId || '', startedAt: now, status: 'active', maxRate: Math.max(0, Math.round(safeNumeric(maxRate))), includeTeam: !!includeTeam, auto: !!auto,
    pace: Number(pace) >= 2 ? 2 : 1, cycleEvery: Math.max(0, Math.round(safeNumeric(cycleMinutes))),
    fired: {}, contacts: {}, calls: [], log: [{ at: now, stage: 'start', text: auto ? 'Started automatically: this is a hard lane with no replies yet.' : 'Started.' }], offerRate: 0, raised: 0, sig: '', lastEvalAt: 0, drafts: 0,
    cycles: 0, lastCycleAt: 0, reshuffles: 0, lastReshuffleAt: 0, repliesAtReshuffle: 0, repost: null };
}

/** Minutes between escalation rounds for this rescue (its own setting, else the default), before the pace is applied. */
const cycleEveryOf = (rescue, settings) => (Number(rescue && rescue.cycleEvery) > 0 ? Number(rescue.cycleEvery) : cfg(settings, 'rescueCycleMinutes'));

/** Which stages are due and not yet done, oldest first. After the timed stages, an escalation round ('cycle') is due when it is time for the next one. */
export function dueStages(rescue, now = Date.now(), settings = {}) {
  if (!rescue || rescue.status !== 'active') return [];
  const pace = paceOf(rescue); const mins = (now - rescue.startedAt) / MIN;
  const due = STAGES.filter(s => mins * pace >= s.at && !rescue.fired[s.id]).map(s => s.id);
  if (mins * pace >= CYCLE_STAGE.at && !due.length) {
    const every = cycleEveryOf(rescue, settings) / pace;
    if (!rescue.lastCycleAt || (now - rescue.lastCycleAt) / MIN >= every) due.push('cycle');
  }
  return due;
}

export const minutesIn = (rescue, now = Date.now()) => Math.max(0, Math.floor((now - rescue.startedAt) / MIN));
export function nextStep(rescue, now = Date.now(), settings = {}) {
  const pace = paceOf(rescue); const mins = (now - rescue.startedAt) / MIN;
  const n = STAGES.find(s => !rescue.fired[s.id] && s.at / pace > mins);
  if (n) return { stage: n, inMinutes: Math.max(0, Math.ceil(n.at / pace - mins)) };
  if (rescue.status !== 'active') return null;
  const every = cycleEveryOf(rescue, settings) / pace;
  const at = rescue.lastCycleAt ? rescue.lastCycleAt + every * MIN : rescue.startedAt + (CYCLE_STAGE.at / pace) * MIN;
  return { stage: CYCLE_STAGE, inMinutes: Math.max(0, Math.ceil((at - now) / MIN)) };
}

// ------------------------------------------------------------------------------------------------ contact frequency
/** { key -> [timestamps] } from the outreach log, every rescue and each carrier's lastContacted, so no carrier is bombarded. */
export function contactLedger({ outreach = [], rescues = [], carriers = [], drafts = [] } = {}) {
  const m = new Map(); const add = (k, t, loadId) => { if (!k || !Number.isFinite(t)) return; const a = m.get(k) || []; a.push({ t, loadId: loadId || '' }); m.set(k, a); };
  const keyFor = (email) => { const e = emailOf(email); return e ? 'e:' + e : ''; };
  for (const o of outreach) add(keyFor(o.email), Date.parse(o.dateTime), o.postingId);
  for (const c of carriers) add(keyFor(c.email), Date.parse(c.lastContacted), '');
  for (const r of rescues) for (const [k, list] of Object.entries(r.contacts || {})) for (const c of list) add(k, c.at, r.id);
  for (const d of drafts) if (d.rescueId) add(keyFor(d.to), Date.parse(d.createdAt), d.postingId);
  return m;
}
export const keyOfEmail = (email) => { const e = emailOf(email); return e ? 'e:' + e : ''; };

/**
 * May this carrier be contacted about this load right now? { ok, why }
 * opts.cycles: escalation rounds so far (the cooldown shortens and one more offer per load is allowed as a rescue escalates).
 * opts.update: this is a better-rate offer to someone already written to (new information, so a 3 h gap is enough).
 */
export function canContact(key, loadId, ledger, now, settings = {}, opts = {}) {
  const list = (ledger && ledger.get(key)) || [];
  const cycles = Math.max(0, Number(opts.cycles) || 0);
  let gapH = cfg(settings, 'rescueMinHoursBetween') / (1 + 0.5 * Math.min(cycles, 4)); if (cycles) gapH = Math.max(4, gapH); if (opts.update) gapH = Math.min(gapH, 3);
  const gap = gapH * HOUR;
  const maxLoad = cfg(settings, 'rescueMaxPerLoad') + Math.min(2, Math.floor(cycles / 2));
  const forLoad = list.filter(c => c.loadId === loadId).length;
  if (forLoad >= maxLoad) return { ok: false, why: 'already contacted ' + forLoad + ' times about this load' };
  const last = list.reduce((mx, c) => Math.max(mx, c.t), 0);
  if (last && now - last < gap) return { ok: false, why: 'contacted ' + Math.max(1, Math.round((now - last) / HOUR)) + ' h ago (minimum gap ' + Math.round(gapH) + ' h)' };
  return { ok: true, why: '' };
}

const describeSide = (a) => { const side = (c, st) => (c ? placeText(c, st) : st ? 'anywhere in ' + st : 'anywhere'); return side(a.originCity, a.originState) + ' to ' + side(a.destCity, a.destState); };

// ------------------------------------------------------------------------------------------------ finding people
/**
 * Everyone who could move this load, merged into ONE entry per carrier (nine DAT postings and four search strategies finding the same carrier
 * is one prospect, not four). ctx: { carriers, trucks (mine + team, active), coverLog, inquiries, outreach, settings, zipMap, now }
 * opts: { wide } widens the corridor and truck radius.
 */
export function gatherProspects(load, ctx = {}, { wide = false } = {}) {
  const { zipMap = null, now = Date.now(), settings = {} } = ctx; const out = new Map();
  const put = (who, add, why, src, extra = {}) => {
    const email = emailOf(who.email); const k = carrierKey({ mc: who.mc, email }) || (email ? 'e:' + email : '') || (who.phone ? 'p:' + String(who.phone).replace(/\D/g, '') : '');
    if (!k) return; const ek = email ? 'e:' + email : k;
    const o = out.get(ek) || out.get(k) || { key: ek, ck: '', name: '', email, phone: '', mc: '', score: 0, why: [], sources: [] };
    o.name = o.name || who.name || ''; o.phone = o.phone || who.phone || ''; o.mc = o.mc || who.mc || ''; o.email = o.email || email; o.ck = callKeyOf(o);
    o.score += add; if (why && !o.why.includes(why)) o.why.push(why); if (!o.sources.includes(src)) o.sources.push(src);
    const keepPrimary = o.primary === 'primary' || (o.primary === 'backup' && extra.primary !== 'primary') ? o.primary : extra.primary;      // never downgrade a primary
    Object.assign(o, extra); if (keepPrimary) o.primary = keepPrimary;
    out.set(o.key, o);
  };
  // 0. v21: carriers you made primary (or backup) for this kind of lane come first, for the offer AND for the phone. A primary with no e-mail still makes the call list.
  for (const a of matchAssignments(load, ctx.assignments || [], ctx.carriers || [], { zipMap })) {
    if (!a.email && !a.phone) continue;
    put({ name: a.name, email: a.email, phone: a.phone, mc: a.mc || (a.carrier && a.carrier.mc) }, (a.priority === 'backup' ? 70 : 120) * (a.fit / 100), (a.priority === 'backup' ? 'backup' : 'primary') + ' carrier for ' + describeSide(a), 'primary', { carrierId: a.carrierId || (a.carrier && a.carrier.id) || '', primary: a.priority === 'backup' ? 'backup' : 'primary', tier: a.priority === 'backup' ? 'Backup carrier' : 'Primary carrier' });
  }
  // 1. private capacity + past covers: the carrier database, ranked on lane fit, cover history, replies and recency
  const asked = ctx.exclude || new Set();
  for (const r of rankCarriers(load, ctx.carriers || [], { zip: zipMap, settings, coverLog: ctx.coverLog, inquiries: ctx.inquiries, assignments: ctx.assignments, now: new Date(now), exclude: asked, requireEmail: false }).slice(0, wide ? 60 : 30)) {
    put({ name: r.carrier.carrierName, email: r.carrier.email, phone: r.carrier.phone, mc: r.carrier.mc }, Number(r.score) || 0, (r.reasons || []).slice(0, 2).join('; '), 'database', { carrierId: r.carrier.id, tier: r.tierLabel, ...(r.primary ? { primary: r.primary } : {}) });
  }
  // 2. trucks that are open right now (Truck Book + team): the strongest signal there is
  const tctx = { zipMap, now, carrierHistory: carrierHistoryFromLog(ctx.coverLog), radius: wide ? 400 : 200 };
  for (const t of matchTrucksToLoad(load, ctx.trucks || [], tctx)) {
    put({ name: t.truck.carrierName, email: t.truck.email, phone: t.truck.phone, mc: t.truck.mc }, 40 + t.score, t.reasons.slice(0, 3).join(', '), t.truck.source === 'team' || t.truck.by ? 'team truck' : 'truck', { truck: t.truck, hot: t.tier === 'hot' });
  }
  // 3. corridor: carriers that deliver near the pickup or live near the delivery
  for (const c of corridorCarriers(load, { carriers: ctx.carriers, coverLog: ctx.coverLog, trucks: ctx.trucks, zipMap, now, radius: wide ? 250 : 125 })) {
    put({ name: c.name, email: c.email, phone: c.phone, mc: c.mc }, c.score * 0.6, c.why[0] || 'on the corridor', 'corridor');
  }
  return [...out.values()].map(o => ({ ...o, score: Math.round(o.score * 10) / 10 })).sort((a, b) => b.score - a.score);
}

// ------------------------------------------------------------------------------------------------ the commercial step
/** What the engine would pay now: your own results first, then a step up, never above the limit you authorised. */
export function proposeRate(load, ctx = {}, rescue = {}) {
  const current = Math.max(safeNumeric(rescue.offerRate), safeNumeric(load.targetRate));
  const sg = suggestRate(load, { zipMap: ctx.zipMap, coverLog: ctx.coverLog, inquiries: ctx.inquiries, settings: ctx.settings, now: ctx.now });
  const diff = laneDifficulty(load, { zipMap: ctx.zipMap, settings: ctx.settings });
  const step = cfg(ctx.settings, 'rescueRaiseStep') + 0.01 * Math.min(Number(rescue.cycles) || 0, 3);   // each escalation round steps a little further
  let want = current;
  if (sg.rate > current && sg.confidence !== 'none' && sg.confidence !== 'low') want = sg.rate;
  if (want <= current) want = current * (1 + step + (diff.tough ? 0.01 : 0));
  want = roundTo(want, 25);
  const cap = safeNumeric(rescue.maxRate);
  if (!(cap > 0)) return { rate: current, raise: false, reason: 'No raise authorised: set "Highest rate I will pay" so Auto Rescue can improve the offer.', suggested: sg.rate || 0, capped: false };
  if (current >= cap) return { rate: current, raise: false, reason: 'Already at your limit of ' + money(cap) + '.', suggested: sg.rate || 0, capped: true };
  const rate = Math.min(want, cap);
  if (rate <= current) return { rate: current, raise: false, reason: 'Already at your limit.', suggested: sg.rate || 0, capped: true };
  return { rate, raise: true, from: current, reason: 'From ' + money(current) + ' to ' + money(rate) + (rate < want ? ' (held at your limit of ' + money(cap) + ')' : '') + '. ' + (sg.rate > current && sg.confidence !== 'low' ? 'Your own results say about ' + money(sg.rate) + '.' : 'Standard step up.'), suggested: sg.rate || 0, capped: rate >= cap };
}

// ------------------------------------------------------------------------------------------------ the messages
export function offerDraft(load, p, { rate = 0, update = false, stage = 'wave1' } = {}) {
  const name = safeString(p.name); const hello = name ? 'Hello ' + name + ',' : 'Hello,';
  let details = cleanLoadDetailsText(load.details); if (!details) details = buildFallbackLoadDetails(load);
  const t = p.truck;
  const opener = update ? 'We have improved the rate on this load:' : p.primary ? 'You usually run this lane for us, so you get the first look:' : t ? 'I saw you have a truck open in ' + placeText(t.oCity, t.oState) + (t.destOpen ? '' : (t.dCity ? ' heading toward ' + placeText(t.dCity, t.dState) : '')) + '. We have a load that fits:' : 'We have the following load available:';
  const rateLine = rate > 0 ? (update ? 'New rate: ' : 'We can offer ') + money(rate) + ' all-in.' + '\r\n\r\n' : '';
  const body = hello + '\r\n\r\n' + opener + '\r\n\r\n' + details + '\r\n\r\n' + rateLine + 'Please reply with availability and your best rate.' + '\r\n\r\n' + 'Thank you,';
  return { to: p.email, subject: (update ? 'Updated rate: ' : '') + buildExcelSubject(load), body, carrierId: p.carrierId || '', why: p.why.join('; '), tier: p.primary ? (p.primary === 'backup' ? 'Auto Rescue (backup carrier)' : 'Auto Rescue (primary carrier)') : stage === 'commercial' ? 'Auto Rescue (rate)' : 'Auto Rescue', score: p.score, primary: p.primary || '' };
}

// ------------------------------------------------------------------------------------------------ calls and replies
/** The key a call outcome is filed under: the e-mail when there is one, otherwise the phone digits. Same for a prospect and for a carrier row. */
export const callKeyOf = (who) => { const e = emailOf(who && who.email); if (e) return 'e:' + e; const d = String((who && who.phone) || '').replace(/\D/g, ''); return d.length >= 7 ? 'p:' + d.slice(-10) : ''; };
export const CALL_RESULTS = [
  ['truck', 'Has a truck'],
  ['callback', 'Call back later'],
  ['voicemail', 'Left voicemail'],
  ['noanswer', 'No answer'],
  ['notruck', 'No truck'],
];
/** { callKey -> { result, at } } : the latest call outcome for each carrier on this load (load.calls is written by the call list). */
export function callState(load) {
  const m = new Map();
  for (const c of Array.isArray(load && load.calls) ? load.calls : []) { if (!c || !c.key) continue; const o = m.get(c.key); if (!o || c.at >= o.at) m.set(c.key, { result: c.result, at: c.at }); }
  return m;
}
/** Should this carrier be left out of the next phone round? "No truck" holds for a day and a half, "no answer" and "voicemail" for three hours, "call back" for one. */
export function callCooling(entry, now) {
  if (!entry) return '';
  const age = (now - entry.at) / HOUR;
  if (entry.result === 'notruck' && age < 36) return 'said they have no truck';
  if ((entry.result === 'noanswer' || entry.result === 'voicemail') && age < 3) return entry.result === 'voicemail' ? 'left a voicemail' + (age < 1 ? ' just now' : ' ' + Math.round(age) + ' h ago') : 'did not answer ' + (age < 1 ? 'just now' : Math.round(age) + ' h ago');
  if (entry.result === 'callback' && age < 1) return 'asked for a call back later';
  return '';
}

/** Every posting id that has belonged to this load while the rescue ran (a reshuffle replaces the nearby postings, but replies to the old ones still count). */
const idsOf = (load, rescue, ctx) => new Set([load.id, ...(ctx.groupIds || []), ...((rescue && rescue.pastIds) || []), ...(ctx.pastIds || [])]);
export const repliesOn = (load, rescue, ctx) => { const ids = idsOf(load, rescue, ctx); return (ctx.inquiries || []).filter(q => ids.has(q.postingId)).length; };

// ------------------------------------------------------------------------------------------------ reshuffling the DAT postings
/**
 * Should the nine DAT postings get new cities (and nearby states) now? null = no, or { level, reach, crossState, replies }.
 *  - only from the 30 minute mark on, at most every 25 min (12 on Fast), and at most `rescueMaxReshuffles` times
 *  - not while the postings are working: first time only if fewer than 3 replies; later only if NO new reply came in since the last reshuffle
 *  - each time reaches further (reach 1.0, 1.3, 1.6 ... up to 2.4 x the lane class's normal distance) and always tries to include at least one market across a state line
 * The caller does the reshuffle (it needs the store); the postings change in the app, and DAT only changes when the new CSV is uploaded.
 */
export function reshuffleDecision(stage, rescue, load, ctx = {}) {
  if (!['expand', 'commercial', 'team', 'cycle'].includes(stage)) return null;
  const now = ctx.now || Date.now(); const level = Number(rescue.reshuffles) || 0; const pace = paceOf(rescue);
  if (level >= cfg(ctx.settings, 'rescueMaxReshuffles')) return null;
  if (rescue.lastReshuffleAt && now - rescue.lastReshuffleAt < (25 * MIN) / pace) return null;
  const replies = repliesOn(load, rescue, ctx);
  if (level === 0 ? replies >= 3 : replies > (Number(rescue.repliesAtReshuffle) || 0)) return null;
  return { level: level + 1, reach: Math.round(Math.min(2.4, 1 + level * 0.3) * 100) / 100, crossState: true, replies };
}

// ------------------------------------------------------------------------------------------------ one step
const waveSizeOf = (rescue, settings) => Math.max(1, Math.round(cfg(settings, 'rescueWaveSize') * (paceOf(rescue) === 2 ? 1.5 : 1) * (1 + 0.5 * Math.min(Number(rescue.cycles) || 0, 3))));

/**
 * Plan one stage. Returns { prospects, drafts, calls, raise, reshuffle, askTeam, note, skipped } and changes nothing.
 * ctx = { carriers, assignments, trucks, coverLog, inquiries, outreach, rescues, drafts, settings, zipMap, groupIds, now }
 */
export function planStage(stage, rescue, load, ctx = {}) {
  const now = ctx.now || Date.now(); const settings = ctx.settings || {}; const cycles = Number(rescue.cycles) || 0;
  const ledger = contactLedger({ outreach: ctx.outreach, rescues: ctx.rescues, carriers: ctx.carriers, drafts: ctx.drafts });
  const mine = rescue.contacts || {};
  const ids = idsOf(load, rescue, ctx);
  const answered = new Set((ctx.inquiries || []).filter(q => ids.has(q.postingId)).map(q => keyOfEmail(q.senderEmail)).filter(Boolean));
  const calledNow = callState(load);
  const wave = waveSizeOf(rescue, settings);
  const res = { stage, prospects: [], drafts: [], calls: [], raise: null, reshuffle: null, askTeam: false, note: '', skipped: [] };
  const wide = stage === 'expand' || stage === 'team' || stage === 'cycle';
  const prospects = gatherProspects(load, ctx, { wide });
  res.prospects = prospects;
  const used = new Set();
  const addCall = (p) => { if (!p.phone || res.calls.some(c => c.key === p.ck)) return; if (callCooling(calledNow.get(p.ck), now)) return; res.calls.push({ key: p.ck, name: p.name, phone: p.phone, why: p.why[0] || '', primary: p.primary || '', hot: !!p.hot, carrierId: p.carrierId || '' }); };
  const pick = (list, n, { update = false, rate = 0 } = {}) => {
    for (const p of list) {
      if (res.drafts.length >= n) break;
      if (used.has(p.key)) continue;
      const cool = callCooling(calledNow.get(p.ck), now);
      if (cool === 'said they have no truck') { res.skipped.push({ p, why: cool }); continue; }
      if (!p.email) { if (p.phone && !(mine[p.key] || []).length) addCall(p); continue; }
      const first = !(mine[p.key] || []).length;
      if (!update && !first) { res.skipped.push({ p, why: 'already offered this load' }); continue; }
      if (answered.has(p.key) && !update) { res.skipped.push({ p, why: 'already replied to this load' }); continue; }
      const c = canContact(p.key, load.id, ledger, now, settings, { cycles, update });
      if (!c.ok) { res.skipped.push({ p, why: c.why }); continue; }
      used.add(p.key); res.drafts.push({ ...offerDraft(load, p, { rate, update, stage }), key: p.key });
    }
  };
  // the phone list: primary and backup carriers first, then open trucks, then the best of the rest; anyone who just said "no truck" or did not pick up is left out for now
  const fillCalls = (limit = 6) => {
    const order = [...prospects].filter(p => p.phone && !answered.has(p.key)).sort((a, b) => (b.primary === 'primary') - (a.primary === 'primary') || (!!b.primary) - (!!a.primary) || (!!b.hot) - (!!a.hot) || b.score - a.score);
    for (const p of order) { if (res.calls.length >= limit) break; addCall(p); }
    res.calls.sort((a, b) => (b.primary === 'primary') - (a.primary === 'primary') || (!!b.primary) - (!!a.primary) || (!!b.hot) - (!!a.hot));
  };
  const offers = () => res.drafts.length + ' offer' + (res.drafts.length === 1 ? '' : 's') + ' drafted';
  const target = safeNumeric(load.targetRate); const curRate = safeNumeric(rescue.offerRate) || target;
  if (stage === 'match') {
    fillCalls();
    const prim = prospects.filter(p => p.primary).length; const trk = prospects.filter(p => p.sources.includes('truck') || p.sources.includes('team truck')).length;
    res.note = prospects.length + ' prospect' + (prospects.length === 1 ? '' : 's') + ' found (' + prim + ' primary or backup, ' + trk + ' with an open truck).' + (res.calls.length ? ' ' + res.calls.length + ' worth a call right now.' : ''); return res;
  }
  if (stage === 'wave1') {
    pick(prospects.filter(p => p.sources.some(x => x === 'truck' || x === 'team truck' || x === 'database' || x === 'primary')), wave, { rate: target });
    fillCalls();
    res.note = offers() + (res.calls.length ? ', ' + res.calls.length + ' to call' : '') + '.'; return res;
  }
  if (stage === 'expand') {
    res.reshuffle = reshuffleDecision(stage, rescue, load, ctx);
    pick(prospects, wave, { rate: target }); fillCalls();
    res.note = 'Widened to ' + (wide ? 'a larger radius and the corridor' : 'more markets') + ': ' + res.drafts.length + ' new offer' + (res.drafts.length === 1 ? '' : 's') + '.'; return res;
  }
  if (stage === 'commercial' || stage === 'cycle') {
    const pr = proposeRate(load, ctx, rescue); res.raise = pr.raise ? pr : null; const rate = pr.raise ? pr.rate : curRate;
    res.reshuffle = reshuffleDecision(stage, rescue, load, ctx);
    // updated offers go to people we already wrote to who have not answered, then to anyone new
    const silent = prospects.filter(p => (mine[p.key] || []).length && !answered.has(p.key));
    if (pr.raise) pick(silent, wave, { update: true, rate });
    pick(prospects.filter(p => !(mine[p.key] || []).length), wave, { rate });
    fillCalls();
    res.note = (stage === 'cycle' ? 'Escalation round ' + (cycles + 1) + '. ' : '') + pr.reason + ' ' + offers() + '.'; return res;
  }
  if (stage === 'team') {
    res.askTeam = !!rescue.includeTeam;
    res.reshuffle = reshuffleDecision(stage, rescue, load, ctx);
    pick(prospects.filter(p => p.sources.includes('team truck') || p.sources.includes('corridor')), wave, { rate: curRate });
    fillCalls();
    res.note = (res.askTeam ? 'Asked the team for help. ' : 'Team help is switched off for this rescue. ') + res.drafts.length + ' offer' + (res.drafts.length === 1 ? '' : 's') + ' drafted from all team trucks and corridors.'; return res;
  }
  return res;
}

/** A fingerprint of what the engine can see about this load. When it changes (new truck, new quote, new reply) another cycle runs at once. */
export function signatureOf(load, ctx = {}) {
  const now = ctx.now || Date.now();
  const tr = matchTrucksToLoad(load, ctx.trucks || [], { zipMap: ctx.zipMap, now, radius: 200 }).filter(t => t.tier !== 'maybe').map(t => (t.truck.key || t.truck.id) + ':' + (t.truck.at || 0)).sort().join(',');
  const ids = new Set([load.id, ...(ctx.groupIds || []), ...(ctx.pastIds || [])]);
  const mineQ = (ctx.inquiries || []).filter(q => ids.has(q.postingId));
  const rate = mineQ.reduce((n, q) => n + (safeNumeric(q.lastCarrierRate) > 0 ? 1 : 0), 0);
  return tr + '|' + mineQ.length + '|' + rate;
}

/** Auto Rescue never starts by itself any more: it only runs when the user presses Auto Rescue on a load and clicks Start. Kept so older callers get a clear "no". */
export function shouldAutoStart() { return { start: false, why: 'Auto Rescue only starts when you start it' }; }

export function rescueSummary(r, now = Date.now(), settings = {}) {
  const mins = minutesIn(r, now); const pace = paceOf(r);
  const timed = stageAt(mins, pace); const inCycle = mins * pace >= CYCLE_STAGE.at && STAGES.every(s => r.fired[s.id]);
  const cur = inCycle ? CYCLE_STAGE : timed; const nx = nextStep(r, now, settings);
  const nxMin = nx ? nx.inMinutes : 0; const nxText = nx ? (nxMin >= 90 ? Math.round(nxMin / 6) / 10 + ' h' : nxMin + ' min') : '';
  return { minutes: mins, stage: cur, index: ALL_STAGES.findIndex(x => x.id === cur.id), next: nx, drafts: r.drafts || 0, contacts: Object.keys(r.contacts || {}).length, reshuffles: r.reshuffles || 0, cycles: r.cycles || 0,
    text: cur.label + (inCycle && r.cycles ? ' ' + r.cycles : '') + ' · ' + (mins < 90 ? mins + ' min' : Math.round(mins / 6) / 10 + ' h') + ' in' + (nx ? ' · next: ' + nx.stage.label.toLowerCase() + ' in ' + nxText : '') };
}
