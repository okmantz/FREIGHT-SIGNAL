// AUTO RESCUE (v17): keeps working a hard load until it is covered. Each step changes the strategy; it never repeats the same outreach.
//
//   0-5 min     Instant match   private carriers, past covers, your Truck Book and the team's trucks -> a ranked list (no mail yet)
//   5-30 min    First wave      the best-ranked qualified prospects get an offer
//   30-60 min   Widen           more geographic markets and corridor matches
//   60-120 min  Commercial      recalculate the rate; raise it WITHIN the limit you authorised; updated offers to anyone who has not answered
//   120+ min    Team rescue     ask the team for help, search every team truck and wider corridors
//   always      Re-evaluate     a new truck, quote or reply triggers another matching cycle straight away
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
import { safeNumeric, safeString } from './util.js';

export const STAGES = [
  { id: 'match', at: 0, label: 'Instant match', blurb: 'Searching your carriers, past covers, Truck Book and team trucks' },
  { id: 'wave1', at: 5, label: 'First outreach wave', blurb: 'Offers to the best-ranked qualified prospects' },
  { id: 'expand', at: 30, label: 'Widen the search', blurb: 'More markets and corridor matches' },
  { id: 'commercial', at: 60, label: 'Rate check', blurb: 'Recalculate the rate and send updated offers within your limit' },
  { id: 'team', at: 120, label: 'Team rescue', blurb: 'Ask the team and search every team truck' },
];
export const STAGE_IDS = STAGES.map(s => s.id);
export const stageIndex = (id) => STAGE_IDS.indexOf(id);

export const RESCUE_DEFAULTS = { rescueWaveSize: 8, rescueMinHoursBetween: 12, rescueMaxPerLoad: 2, rescueRaiseStep: 0.05, rescueMaxHours: 72 };
const cfg = (settings, k) => { const v = Number(settings && settings[k]); return Number.isFinite(v) && v > 0 ? v : RESCUE_DEFAULTS[k]; };

/** The stage you are in after `minutes` minutes. */
export function stageAt(minutes) { let cur = STAGES[0]; for (const s of STAGES) if (minutes >= s.at) cur = s; return cur; }

export function newRescue(head, { now = Date.now(), maxRate = 0, includeTeam = false, auto = false } = {}) {
  return { id: head.id, headId: head.id, groupId: head.groupId || '', startedAt: now, status: 'active', maxRate: Math.max(0, Math.round(safeNumeric(maxRate))), includeTeam: !!includeTeam, auto: !!auto,
    fired: {}, contacts: {}, calls: [], log: [{ at: now, stage: 'start', text: auto ? 'Started automatically: this is a hard lane with no replies yet.' : 'Started.' }], offerRate: 0, raised: 0, sig: '', lastEvalAt: 0, drafts: 0 };
}

/** Which stages are due and not yet done, oldest first. */
export function dueStages(rescue, now = Date.now()) {
  if (!rescue || rescue.status !== 'active') return [];
  const mins = (now - rescue.startedAt) / MIN;
  return STAGES.filter(s => mins >= s.at && !rescue.fired[s.id]).map(s => s.id);
}

export const minutesIn = (rescue, now = Date.now()) => Math.max(0, Math.floor((now - rescue.startedAt) / MIN));
export function nextStep(rescue, now = Date.now()) {
  const mins = (now - rescue.startedAt) / MIN; const n = STAGES.find(s => !rescue.fired[s.id] && s.at > mins);
  return n ? { stage: n, inMinutes: Math.max(0, Math.ceil(n.at - mins)) } : null;
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

/** May this carrier be contacted about this load right now? { ok, why } */
export function canContact(key, loadId, ledger, now, settings = {}) {
  const list = (ledger && ledger.get(key)) || [];
  const gap = cfg(settings, 'rescueMinHoursBetween') * HOUR;
  const maxLoad = cfg(settings, 'rescueMaxPerLoad');
  const forLoad = list.filter(c => c.loadId === loadId).length;
  if (forLoad >= maxLoad) return { ok: false, why: 'already contacted ' + forLoad + ' times about this load' };
  const last = list.reduce((mx, c) => Math.max(mx, c.t), 0);
  if (last && now - last < gap) return { ok: false, why: 'contacted ' + Math.max(1, Math.round((now - last) / HOUR)) + ' h ago (minimum gap ' + Math.round(gap / HOUR) + ' h)' };
  return { ok: true, why: '' };
}

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
    const o = out.get(ek) || out.get(k) || { key: ek, name: '', email, phone: '', mc: '', score: 0, why: [], sources: [] };
    o.name = o.name || who.name || ''; o.phone = o.phone || who.phone || ''; o.mc = o.mc || who.mc || ''; o.email = o.email || email;
    o.score += add; if (why && !o.why.includes(why)) o.why.push(why); if (!o.sources.includes(src)) o.sources.push(src); Object.assign(o, extra);
    out.set(o.key, o);
  };
  // 1. private capacity + past covers: the carrier database, ranked on lane fit, cover history, replies and recency
  const asked = ctx.exclude || new Set();
  for (const r of rankCarriers(load, ctx.carriers || [], { zip: zipMap, settings, coverLog: ctx.coverLog, inquiries: ctx.inquiries, now: new Date(now), exclude: asked }).slice(0, wide ? 60 : 30)) {
    put({ name: r.carrier.carrierName, email: r.carrier.email, phone: r.carrier.phone, mc: r.carrier.mc }, Number(r.score) || 0, (r.reasons || []).slice(0, 2).join('; '), 'database', { carrierId: r.carrier.id, tier: r.tierLabel });
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
  const step = cfg(ctx.settings, 'rescueRaiseStep');
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
  const opener = update ? 'We have improved the rate on this load:' : t ? 'I saw you have a truck open in ' + placeText(t.oCity, t.oState) + (t.destOpen ? '' : (t.dCity ? ' heading toward ' + placeText(t.dCity, t.dState) : '')) + '. We have a load that fits:' : 'We have the following load available:';
  const rateLine = rate > 0 ? (update ? 'New rate: ' : 'We can offer ') + money(rate) + ' all-in.' + '\r\n\r\n' : '';
  const body = hello + '\r\n\r\n' + opener + '\r\n\r\n' + details + '\r\n\r\n' + rateLine + 'Please reply with availability and your best rate.' + '\r\n\r\n' + 'Thank you,';
  return { to: p.email, subject: (update ? 'Updated rate: ' : '') + buildExcelSubject(load), body, carrierId: p.carrierId || '', why: p.why.join('; '), tier: stage === 'commercial' ? 'Auto Rescue (rate)' : 'Auto Rescue', score: p.score };
}

// ------------------------------------------------------------------------------------------------ one step
/**
 * Plan one stage. Returns { prospects, drafts, calls, raise, askTeam, note, skipped } and changes nothing.
 * ctx = { carriers, trucks, coverLog, inquiries, outreach, rescues, drafts, settings, zipMap, now }
 */
export function planStage(stage, rescue, load, ctx = {}) {
  const now = ctx.now || Date.now(); const settings = ctx.settings || {};
  const ledger = contactLedger({ outreach: ctx.outreach, rescues: ctx.rescues, carriers: ctx.carriers, drafts: ctx.drafts });
  const mine = rescue.contacts || {};
  const answered = new Set((ctx.inquiries || []).filter(q => q.postingId === load.id).map(q => keyOfEmail(q.senderEmail)).filter(Boolean));
  const wave = cfg(settings, 'rescueWaveSize');
  const res = { stage, prospects: [], drafts: [], calls: [], raise: null, askTeam: false, note: '', skipped: [] };
  const wide = stage === 'expand' || stage === 'team';
  const prospects = gatherProspects(load, ctx, { wide });
  res.prospects = prospects;
  const used = new Set();
  const pick = (list, n, { update = false, rate = 0 } = {}) => {
    for (const p of list) {
      if (res.drafts.length >= n) break;
      if (used.has(p.key)) continue;
      if (!p.email) { if (p.phone && !res.calls.some(c => c.key === p.key) && !(mine[p.key] || []).length) res.calls.push({ key: p.key, name: p.name, phone: p.phone, why: p.why[0] || '' }); continue; }
      const first = !(mine[p.key] || []).length;
      if (!update && !first) { res.skipped.push({ p, why: 'already offered this load' }); continue; }
      if (answered.has(p.key) && !update) { res.skipped.push({ p, why: 'already replied to this load' }); continue; }
      const c = canContact(p.key, load.id, ledger, now, settings);
      if (!c.ok) { res.skipped.push({ p, why: c.why }); continue; }
      used.add(p.key); res.drafts.push({ ...offerDraft(load, p, { rate, update, stage }), key: p.key });
    }
  };
  if (stage === 'match') { res.note = prospects.length + ' prospect' + (prospects.length === 1 ? '' : 's') + ' found (' + prospects.filter(p => p.sources.includes('truck') || p.sources.includes('team truck')).length + ' with an open truck).'; return res; }
  if (stage === 'wave1') {
    pick(prospects.filter(p => p.sources.includes('truck') || p.sources.includes('team truck') || p.sources.includes('database')), wave, { rate: safeNumeric(load.targetRate) });
    res.note = res.drafts.length + ' offer' + (res.drafts.length === 1 ? '' : 's') + ' drafted' + (res.calls.length ? ', ' + res.calls.length + ' to call' : '') + '.'; return res;
  }
  if (stage === 'expand') {
    pick(prospects, wave, { rate: safeNumeric(load.targetRate) });
    res.note = 'Widened to ' + (wide ? 'a larger radius and the corridor' : 'more markets') + ': ' + res.drafts.length + ' new offer' + (res.drafts.length === 1 ? '' : 's') + '.'; return res;
  }
  if (stage === 'commercial') {
    const pr = proposeRate(load, ctx, rescue); res.raise = pr.raise ? pr : null; const rate = pr.raise ? pr.rate : safeNumeric(rescue.offerRate) || safeNumeric(load.targetRate);
    // updated offers go to people we already wrote to who have not answered, then to anyone new
    const silent = prospects.filter(p => (mine[p.key] || []).length && !answered.has(p.key));
    if (pr.raise) pick(silent, wave, { update: true, rate });
    pick(prospects.filter(p => !(mine[p.key] || []).length), wave, { rate });
    res.note = pr.reason + ' ' + res.drafts.length + ' offer' + (res.drafts.length === 1 ? '' : 's') + ' drafted.'; return res;
  }
  if (stage === 'team') {
    res.askTeam = !!rescue.includeTeam;
    pick(prospects.filter(p => p.sources.includes('team truck') || p.sources.includes('corridor')), wave, { rate: safeNumeric(rescue.offerRate) || safeNumeric(load.targetRate) });
    res.note = (res.askTeam ? 'Asked the team for help. ' : 'Team help is switched off for this rescue. ') + res.drafts.length + ' offer' + (res.drafts.length === 1 ? '' : 's') + ' drafted from all team trucks and corridors.'; return res;
  }
  return res;
}

/** A fingerprint of what the engine can see about this load. When it changes (new truck, new quote, new reply) another cycle runs at once. */
export function signatureOf(load, ctx = {}) {
  const now = ctx.now || Date.now();
  const tr = matchTrucksToLoad(load, ctx.trucks || [], { zipMap: ctx.zipMap, now, radius: 200 }).filter(t => t.tier !== 'maybe').map(t => (t.truck.key || t.truck.id) + ':' + (t.truck.at || 0)).sort().join(',');
  const inq = (ctx.inquiries || []).filter(q => q.postingId === load.id).length;
  const rate = (ctx.inquiries || []).filter(q => q.postingId === load.id).reduce((n, q) => n + (safeNumeric(q.lastCarrierRate) > 0 ? 1 : 0), 0);
  return tr + '|' + inq + '|' + rate;
}

/** Is this load hard enough, and quiet enough, to escalate by itself? */
export function shouldAutoStart(head, { zipMap = null, settings = {}, now = Date.now(), minutesQuiet = 30 } = {}) {
  if (settings.autoEscalateHard === false) return { start: false, why: 'switched off' };
  if (!head || head.status === 'Covered') return { start: false, why: 'not open' };
  const d = laneDifficulty(head, { zipMap, settings });
  if (!d.tough) return { start: false, why: 'not a hard lane' };
  const posted = (Array.isArray(head.ops) ? head.ops : []).filter(o => o.type === 'posted').map(o => Date.parse(o.at)).filter(Number.isFinite);
  if (!posted.length) return { start: false, why: 'not posted yet' };
  const first = Math.min(...posted); if (now - first < minutesQuiet * MIN) return { start: false, why: 'posted less than ' + minutesQuiet + ' min ago' };
  if (safeNumeric(head.inquiryCount) > 0) return { start: false, why: 'carriers are already replying' };
  return { start: true, why: d.notes[0] || 'hard lane', notes: d.notes };
}

export function rescueSummary(r, now = Date.now()) {
  const mins = minutesIn(r, now); const cur = stageAt(mins); const nx = nextStep(r, now);
  return { minutes: mins, stage: cur, index: stageIndex(cur.id), next: nx, drafts: r.drafts || 0, contacts: Object.keys(r.contacts || {}).length, text: cur.label + ' · ' + (mins < 90 ? mins + ' min' : Math.round(mins / 6) / 10 + ' h') + ' in' + (nx ? ' · next: ' + nx.stage.label.toLowerCase() + ' in ' + nx.inMinutes + ' min' : '') };
}
