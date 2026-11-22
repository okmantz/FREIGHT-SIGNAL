// In-memory application state with write-through persistence. UI reads `state`, mutations go through `actions`.

import { teach as teachLesson, confirm as confirmLesson, forget as forgetLesson, teachableLabel } from '../core/replylearn.js';
import * as db from './db.js';
import { DEFAULT_SETTINGS, CARRIER_KEYS, INQUIRY_KEYS, CUSTOMER_KEYS } from '../core/defaults.js';
import { ZipMap } from '../core/zipmap.js';
import { targetForPriority, blankPosting, reindex, initializeLoadControls, reconcileManualLane, coverPosting, setGroupPriority, setGroupStatus, groupMembers, countAlternates } from '../core/model.js';
import { planMatrix, applyMatrix, hasAlternates } from '../core/matrix.js';
import { planExcelOutreach, planOutlookScan } from '../core/outreach.js';
import { planRankedOutreach, planRankedScan, buildTruckCheck, rankCarriers } from '../core/ranking.js';
import { buildCoverEntry, weeklyGoalHit } from '../core/coverlog.js';
import { expiredGroups } from '../core/expiry.js';
import { classifyLane } from '../core/lanes.js';
import { processIncomingEmail } from '../core/inbound.js';
import { todayKey, uid, safeNumeric, normalizeText, applyOrder } from '../core/util.js';
import { parseTqlLoad } from '../core/parser.js';
import { toast } from '../ui/dom.js';
import { applyLoadText } from '../core/loaddetails.js';
import { decideSend } from '../core/sendpolicy.js';
import { ledgerKey, buildLedgerEntry, sendCounts } from '../core/ledger.js';
import { parseTruckText, parseTruckList, makeTruck, mergeTrucks, isActive } from '../core/truckbook.js';
import { suggestRate } from '../core/raterec.js';
import { duplicateRows, mergePatches } from '../core/prospects.js';
import { reconcileMatches, openLoads } from '../core/matching.js';
import { newRescue, dueStages, planStage, signatureOf, shouldAutoStart, keyOfEmail, minutesIn } from '../core/autorescue.js';
import { activeTrucks } from '../core/truckbook.js';
import { headsOf, findBackhaulLoads } from '../core/corridor.js';
import { cleanAssignment, matchAssignments, recordOutcome } from '../core/assignments.js';
import { rateIntel, openingPlan } from '../core/rateintel.js';
import { scoreLoad, buildPlan, learnApproaches, makeApproachRecord, approachesFromOps } from '../core/difficulty.js';
import { matchCarriers, suggestedKeys } from '../core/networkmatch.js';
import { fxSnapshot } from '../core/performance.js';
import { findExisting, coverEntryFor } from '../core/history.js';
import { carrierKey as netCarrierKey, emailOf as netEmailOf } from '../core/netcommon.js';

/** DAT rates are whole dollars: "$1,650.00" -> "1650"; blank/invalid -> "". */
export function cleanRate(v) {
  const t = String(v ?? '').replace(/[$,\s]/g, '');
  if (!t) return '';
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : '';
}

export const state = {
  ready: false,
  settings: { ...DEFAULT_SETTINGS },
  postings: [], carriers: [], inquiries: [], outreach: [], spares: [], drafts: [], customers: [], coverLog: [], trucks: [], ledger: [], matches: [], autoRescues: [], history: [], assignments: [], approaches: [],
  weather: new Map(),          // "city|st" -> alerts[] (filled by store/weather.js)
  carrierRev: 0,               // bumped whenever the carrier list changes (invalidates cached lane depth)
  hooks: { sendToOutlook: null, onWeeklyGoal: null, teamTrucks: null, teamLane: null, askTeam: null, onMatches: null }, // sendToOutlook: set by store/bridge.js when an Outlook folder is connected. onWeeklyGoal: set by main.js (confetti)
  counters: { lifetimeCovers: 0, coversToday: 0, coversTodayDate: todayKey(), goalWeek: '' },
  zip: null, zipInfo: { source: '', importedAt: '' },
  listeners: new Set(),
  persistError: '',
};

export const subscribe = (fn) => { state.listeners.add(fn); return () => state.listeners.delete(fn); };
const emit = () => state.listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

async function guard(fn) {
  try { return await fn(); } catch (e) { state.persistError = String(e && e.message || e); console.error(e); throw e; }
}

async function loadStores() {
  state.settings = { ...DEFAULT_SETTINGS, ...(await db.kvGet('settings', {})) };
  state.counters = { ...state.counters, ...(await db.kvGet('counters', {})) };
  state.postings = (await db.getAll('postings')).sort((a, b) => a.order - b.order);
  state.carriers = await db.getAll('carriers');
  state.inquiries = (await db.getAll('inquiries')).sort((a, b) => String(a.dateCounted).localeCompare(String(b.dateCounted)));
  state.outreach = await db.getAll('outreach');
  state.spares = await db.getAll('spares');
  state.drafts = (await db.getAll('drafts')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  state.customers = await db.getAll('customers');
  state.coverLog = (await db.getAll('coverLog')).sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
  state.trucks = await db.getAll('trucks');
  state.ledger = (await db.getAll('ledger')).sort((a, b) => b.at - a.at);
  state.matches = await db.getAll('matches');
  state.autoRescues = await db.getAll('autorescues');
  state.history = await db.getAll('history');
  state.assignments = (await db.getAll('assignments')).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  state.approaches = await db.getAll('approaches');
  state.carrierRev++;
}

export async function loadAll(zipFetcher) {
  await db.openDb();
  await loadStores();
  await loadZip(zipFetcher);
  state.ready = true;
  emit();
}

/** Re-read every store from IndexedDB (after changes from another device were applied) and redraw. */
export async function reloadStores() {
  await loadStores();
  emit();
}

/** ZIP Map: cached CSV in IndexedDB, else the bundled data file, else the user must import one. */
export async function loadZip(fetcher) {
  let rec = await db.get('zipmap', 'csv');
  if (!rec && fetcher) {
    try {
      const got = await fetcher();
      if (got && got.text) { rec = { key: 'csv', text: got.text, source: got.source || 'bundled', importedAt: new Date().toISOString() }; await db.put('zipmap', rec); }
    } catch (e) { console.warn('Bundled ZIP Map unavailable:', e); }
  }
  if (rec) {
    try { state.zip = ZipMap.fromCsv(rec.text); state.zipInfo = { source: rec.source, importedAt: rec.importedAt }; }
    catch (e) { state.zip = null; state.persistError = 'ZIP Map could not be read: ' + e.message; }
  }
}

export async function importZipCsv(text, source = 'imported file') {
  const zm = ZipMap.fromCsv(text); // throws with a readable message if headers are missing
  await db.put('zipmap', { key: 'csv', text, source, importedAt: new Date().toISOString() });
  state.zip = zm; state.zipInfo = { source, importedAt: new Date().toISOString() };
  emit();
  return zm.size;
}

const savePostings = () => guard(() => db.replaceAll('postings', reindex(state.postings)));
const saveCounters = () => guard(() => db.kvSet('counters', state.counters));
/** Tell the UI the weekly cover floor was just reached (it plays the confetti). A moment later, so the cover dialog has closed first. */
const announceGoal = (goal) => { if (goal && state.hooks.onWeeklyGoal) setTimeout(() => { try { state.hooks.onWeeklyGoal(goal); } catch (e) { console.error(e); } }, 450); };

/** Things a carrier's e-mail teaches us beyond the reply: a truck, an MC number, a stop request. Returns short notes for the UI. */
async function learnFromEmail(res, mail, now) {
  const notes = [];
  const email = String(mail.from || '').trim().toLowerCase();
  const fresh = (res.analysis && res.analysis.fresh) || '';
  if (res.truckLead && fresh) {
    const t = parseTruckText(fresh + '\n' + (res.analysis && res.analysis.tags && res.analysis.tags.asksOtherLoads ? '' : ''), { now, zipMap: state.zip });
    const known = state.carriers.find(c => String(c.email || '').toLowerCase() === email);
    const tr = t && makeTruck({ ...t, email: t.email || email, carrierName: (known && known.carrierName) || '', mc: t.mc || (known && known.mc) || res.mc || '', phone: t.phone || (known && known.phone) || '' }, { now, zipMap: state.zip, source: 'email', by: 'inbox' });
    if (tr) { await actions.addTrucks([tr]); notes.push('Truck saved: ' + tr.oCity + ', ' + tr.oState); res.truck = tr; }
  }
  if (res.mc && email) {
    const rows = state.carriers.filter(c => String(c.email || '').toLowerCase() === email && !String(c.mc || '').trim());
    for (const c of rows) { c.mc = 'MC ' + res.mc; await guard(() => db.put('carriers', c)); }
    if (rows.length) { state.carrierRev++; notes.push('MC ' + res.mc + ' added to ' + rows.length + ' carrier row' + (rows.length === 1 ? '' : 's')); }
  }
  if (res.markInactive && email) {
    const rows = state.carriers.filter(c => String(c.email || '').toLowerCase() === email && String(c.status || '').toLowerCase() !== 'inactive');
    for (const c of rows) { c.status = 'Inactive'; await guard(() => db.put('carriers', c)); }
    if (rows.length) { state.carrierRev++; notes.push('Marked inactive: ' + email); }
  }
  return notes;
}


/** Run one Auto Rescue stage: plan it (pure), then apply it: drafts, contact ledger, rate change, team request. Returns 1 when something happened. */
async function runRescueStage(r, head, stage, ctx, reason) {
  const now = ctx.now; const planStageId = stage === 'rematch' ? 'wave1' : stage;
  const plan = planStage(planStageId, r, head, ctx);
  const label = { match: 'Instant match', wave1: 'First wave', expand: 'Widened search', commercial: 'Rate check', team: 'Team rescue', rematch: 'New activity' }[stage] || stage;
  let text = plan.note; let acted = false;
  if (plan.raise && plan.raise.raise) {
    const ids = groupMembers(state.postings, head.groupId || '__none__').map(m => m.id); const members = ids.length ? ids : [head.id];
    r.offerRate = plan.raise.rate; r.raised = (r.raised || 0) + 1;
    for (const m of state.postings.filter(x => members.includes(x.id))) { m.targetRate = String(plan.raise.rate); m.targetSource = 'user'; }
    head.ops = [...(Array.isArray(head.ops) ? head.ops : []), { type: 'rescue-rate', at: new Date(now).toISOString(), detail: 'Auto Rescue raised the target to $' + plan.raise.rate }].slice(-40);
    await savePostings(); text += ' Target raised to $' + plan.raise.rate + ' (re-upload the DAT CSV to repost at the new rate).'; acted = true;
  }
  if (plan.drafts.length) {
    const stamped = plan.drafts.map(d => ({ id: uid(), createdAt: new Date(now).toISOString(), postingId: head.id, rescueId: r.id, kind: 'Auto Rescue', to: d.to, subject: d.subject, body: d.body, carrierId: d.carrierId, tier: d.tier, score: d.score, why: d.why }));
    state.drafts.unshift(...stamped);
    const logs = stamped.map(d => ({ key: (String(head.loadNumber || head.id) + '|' + d.to + '|rescue|' + now).toLowerCase(), dateTime: new Date(now).toISOString(), loadNumber: head.loadNumber || '', postingId: head.id, postingRow: 0, email: d.to, carrier: '', result: 'Auto Rescue' }));
    state.outreach.push(...logs); head.outreachCount = state.outreach.filter(o => o.postingId === head.id).length;
    const touched = [];
    for (let i = 0; i < plan.drafts.length; i++) {
      const k = plan.drafts[i].key; (r.contacts[k] = r.contacts[k] || []).push({ at: now, rate: r.offerRate || safeNumeric(head.targetRate) });
      const c = state.carriers.find(x => x.id === plan.drafts[i].carrierId) || state.carriers.find(x => keyOfEmail(x.email) === k); if (c) { c.lastContacted = new Date(now).toISOString(); touched.push(c); }
      const mt = state.matches.find(m => m.loadId === head.id && m.email && keyOfEmail(m.email) === k); if (mt) { mt.status = 'contacted'; await guard(() => db.put('matches', mt)); }
    }
    r.drafts = (r.drafts || 0) + stamped.length;
    await guard(async () => { await db.putMany('drafts', stamped); await db.putMany('outreach', logs); if (touched.length) await db.putMany('carriers', touched); }); if (touched.length) state.carrierRev++;
    await savePostings();
    if (state.settings.draftsToOutlook && state.hooks.sendToOutlook) await actions.sendDraftsToOutlook(stamped.map(d => d.id));
    acted = true;
  }
  if (plan.calls.length) { const known = new Set((r.calls || []).map(c => c.key)); for (const c of plan.calls) if (!known.has(c.key)) { (r.calls = r.calls || []).push({ ...c, at: now }); acted = true; } text += ' To call: ' + plan.calls.slice(0, 3).map(c => (c.name || 'carrier') + ' ' + c.phone).join('; ') + '.'; }
  if (plan.askTeam && state.hooks.askTeam && !r.askedTeam) {
    try { const res = await state.hooks.askTeam(groupMembers(state.postings, head.groupId || '__none__').length ? groupMembers(state.postings, head.groupId) : [head], { note: 'Auto Rescue: no cover yet after ' + Math.round(minutesIn(r, now) / 60 * 10) / 10 + ' h.' }); r.askedTeam = true; text += res && res.ok === false ? ' (Team request failed: ' + res.error + ')' : ' Team request sent.'; acted = true; } catch (e) { text += ' (Team request failed.)'; }
  }
  if (stage === 'rematch' && !plan.drafts.length && !plan.calls.length) return 0;
  if (stage === 'rematch') text = 'Something new appeared (a truck, a quote or a reply). ' + text;
  r.log.push({ at: now, stage, label, text: text || 'Nothing to do yet.' }); r.log = r.log.slice(-60);
  return acted || stage !== 'rematch' ? 1 : 0;
}


/* ------------------------------------------------------------------------------------------------ load plan (difficulty, rate intelligence, carrier matches, learned approaches) */
const teamLaneFor = (load) => { try { return state.hooks.teamLane ? state.hooks.teamLane(load) : null; } catch { return null; } };
const teamTrucksNow = () => { try { return state.hooks.teamTrucks ? state.hooks.teamTrucks() : []; } catch { return []; } };
export function planContext(load, now = Date.now()) {
  return { coverLog: state.coverLog, inquiries: state.inquiries, outreach: state.outreach, history: state.history, carriers: state.carriers, trucks: activeTrucks(state.trucks, now), teamTrucks: teamTrucksNow(), postings: state.postings, zipMap: state.zip, settings: state.settings, now, teamLane: teamLaneFor(load) };
}
/** Everything the app knows about how to cover this load. Pure read: nothing is saved. */
export function loadPlan(load, now = Date.now()) {
  const ctx = planContext(load, now);
  const intel = rateIntel(load, ctx);
  const diff = scoreLoad(load, { ...ctx, intel });
  const assignMatches = matchAssignments(load, state.assignments, state.carriers, { zipMap: state.zip });
  const contacted = new Set(state.outreach.filter(o => o.postingId === load.id).map(o => netEmailOf(o.email)).filter(Boolean));
  const matches = matchCarriers(load, { ...ctx, assignMatches, limit: 15 });
  const fresh = matches.filter(m => !m.email || !contacted.has(m.email));
  const learned = learnApproaches(state.approaches, diff.tags);
  const backhaul = findBackhaulLoads(load, headsOf(state.postings), { zipMap: state.zip });
  const plan = buildPlan(diff, { load, assignMatches, carriersTop: fresh, learned, backhaul, intel, now });
  return { diff, intel, assignMatches, matches: fresh, contacted: matches.length - fresh.length, plan, learned, backhaul, opening: openingPlan(intel, { target: load.targetRate }) };
}
const sameAssigned = (a, c) => { if (!c) return false; const e = netEmailOf(c.email); return (a.carrierId && c.id && a.carrierId === c.id) || (e && netEmailOf(a.email) === e) || (a.mc && c.mc && String(a.mc).replace(/\D/g, '') === String(c.mc).replace(/\D/g, '')); };

export const actions = {
  async saveSettings(patch) {
    state.settings = { ...state.settings, ...patch };
    await guard(() => db.kvSet('settings', state.settings)); emit();
  },
  /** Save settings WITHOUT re-rendering the page (appearance and profile apply themselves, and a re-render would reset sliders mid-drag). */
  async savePrefs(patch) {
    state.settings = { ...state.settings, ...patch };
    await guard(() => db.kvSet('settings', state.settings));
  },

  // ---------- postings ----------
  /** Parse a TQL block and add it as an "Original" posting (the macro's first double-click on AB). */
  async addParsedLoad(fields, extras = {}) {
    const p = blankPosting({ ...fields, variant: 'Original', targetRate: extras.targetRate ?? '', broker: extras.broker ?? '' });
    p.contact = extras.contact || state.settings.defaultContact || 'Email';
    reconcileManualLane(p, state.zip);
    initializeLoadControls(p, state.settings);
    p.groupId = p.groupId || '';
    state.postings.push(p);
    // v16: a load with no target gets a suggested one from your own covers, quotes and the DAT average you typed (never a number you already entered)
    if (state.settings.autoSuggestTarget !== false && !(safeNumeric(p.targetRate) > 0)) {
      const sg = suggestRate(p, { zipMap: state.zip, coverLog: state.coverLog, inquiries: state.inquiries, settings: state.settings, now: Date.now() });
      if (sg.rate > 0 && sg.confidence !== 'none') { p.targetRate = String(sg.rate); p.targetSource = 'suggested'; p.targetNote = sg.confidence + ' confidence: ' + sg.basis[0]; }
    } else if (safeNumeric(p.targetRate) > 0) p.targetSource = 'user';
    await savePostings(); emit();
    actions.runMatching({ newLoadIds: new Set([p.id]) }).catch(() => {});
    return p;
  },
  async updatePosting(id, patch) {
    const p = state.postings.find(x => x.id === id); if (!p) return;
    Object.assign(p, patch);
    if (['originCity', 'originState', 'originZip', 'destCity', 'destState', 'destZip'].some(k => k in patch)) {
      // City/state changed -> the ZIP follows automatically (origin AND destination). A ZIP typed by hand that does not
      // belong to the city/state is replaced too, exactly like the Excel macro's ReconcileManualLane.
      const r = reconcileManualLane(p, state.zip);
      if (r.warning) { state.lastWarning = r.warning; try { toast(r.warning, 'warn', 7000); } catch { /* no DOM (unit tests) */ } }
    }
    if ('datRate' in patch) p.datRate = cleanRate(p.datRate);
    if ('targetRate' in patch && !('targetSource' in patch)) p.targetSource = String(p.targetRate ?? '').trim() ? 'user' : '';
    await savePostings(); emit();
  },
  /** Set (or clear, with '') the DAT-posted rate on specific postings: a per-posting override (Edit dialog). The normal way to price a load is setTargetRate. */
  async setDatRate(ids, rate) {
    const r = cleanRate(rate); const set = new Set(ids);
    let n = 0;
    for (const p of state.postings) if (set.has(p.id)) { p.datRate = r; n++; }
    await savePostings(); emit(); return n;
  },
  /**
   * The ONE target rate per load: sets the Target rate on every posting in the box (or clears it with ''). It judges carrier e-mail replies
   * and, unless "Post target rate on DAT" is switched off, it is the rate in the DAT CSV for postings that have no DAT rate of their own.
   * A posting's own DAT rate (the box on its row) is never touched here: changing the target must not wipe the rates you typed.
   */
  async setTargetRate(ids, rate) {
    const r = cleanRate(rate); const set = new Set(ids);
    let n = 0;
    for (const p of state.postings) if (set.has(p.id)) { p.targetRate = r; p.targetSource = r ? 'user' : ''; n++; }
    await savePostings(); emit(); return n;
  },
  /** Put a SUGGESTED target on a load (from your own results). It stays "suggested" until you confirm it, and a suggested target never lets auto-send answer a rate. */
  async applySuggestedRate(ids, rate, note = '') {
    const r = cleanRate(rate); const set = new Set(ids); let n = 0;
    for (const p of state.postings) if (set.has(p.id)) { p.targetRate = r; p.targetSource = r ? 'suggested' : ''; p.targetNote = note; n++; }
    await savePostings(); emit(); return n;
  },
  /** One click: "yes, that is my target". */
  async confirmTarget(ids) {
    const set = new Set(ids); let n = 0;
    for (const p of state.postings) if (set.has(p.id) && p.targetSource === 'suggested') { p.targetSource = 'user'; n++; }
    if (n) { await savePostings(); emit(); } return n;
  },
  /** The average DAT RateView rate for this load's lane, typed once and kept on every posting of the load ('' clears it). */
  async setDatAvg(id, rate) {
    const p = state.postings.find(x => x.id === id); if (!p) return 0;
    const members = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
    const r = cleanRate(rate); const at = r ? new Date().toISOString() : '';
    for (const m of members) { m.datAvg = r; m.datAvgAt = at; }
    await savePostings(); emit(); return members.length;
  },
  /** Back to "target rate on every posting": clears the DAT rate on every posting of the box that contains `id`. */
  async clearDatRates(id) {
    const p = state.postings.find(x => x.id === id); if (!p) return 0;
    const members = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
    let n = 0; for (const m of members) if (m.datRate) { m.datRate = ''; n++; }
    await savePostings(); emit(); return n;
  },
  /**
   * The load was downloaded for DAT (the person is about to upload it, or re-upload it to refresh it). The Original posting remembers when,
   * so the guided notes can say "posted 34 min ago" instead of guessing from when the load was pasted into the app.
   */
  async markPosted(ids, detail = 'CSV downloaded') {
    const set = new Set(ids); const seen = new Set(); const at = new Date().toISOString();
    for (const p of state.postings.filter(x => set.has(x.id))) {
      const key = String(p.groupId || '').trim().toLowerCase() || p.id;
      if (seen.has(key)) continue; seen.add(key);
      const members = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
      const head = members.find(m => m.variant === 'Original') || members[0];
      head.ops = [...(Array.isArray(head.ops) ? head.ops : []), { type: 'posted', at, detail }].slice(-40);
    }
    await savePostings(); emit(); return seen.size;
  },
  /** Apply basic load details (pickup, weight, equipment, ...) to every posting of the box at once. */
  async updateGroup(id, patch) {
    const p = state.postings.find(x => x.id === id); if (!p) return 0;
    const members = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
    for (const m of members) {
      if ('pickupEarliest' in patch) { const oldE = String(m.pickupEarliest ?? '').trim(); const oldL = String(m.pickupLatest ?? '').trim(); if (!oldL || oldL === oldE) m.pickupLatest = patch.pickupEarliest; }
      Object.assign(m, patch);
    }
    await savePostings(); emit(); return members.length;
  },
  /**
   * v11: edit the load's details text and/or its reply note AFTER the matrix exists. Both are written to every posting of the load
   * (a carrier can answer any of the nine), so the first reply never depends on which posting the e-mail happened to match.
   * `patch` = { details?, notes? }. The note is stored clean ("" when empty; the macro's "::" placeholder is dropped).
   */
  async setLoadText(id, patch) {
    const p = state.postings.find(x => x.id === id); if (!p) return 0;
    const members = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
    applyLoadText(members, patch);
    await savePostings(); emit(); return members.length;
  },
  /** One "include in the next lane scan" switch per box. It lives on the Original posting so the scan drafts for the load once, not nine times. */
  async setLaneScan(id, on) {
    const p = state.postings.find(x => x.id === id); if (!p) return;
    const members = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
    const head = members.find(m => m.variant === 'Original') || members[0];
    for (const m of members) m.outreach = on && m === head ? 'Yes' : 'No';
    await savePostings(); emit();
  },
  /** Delete exactly these postings (individual rows or a ticked selection). */
  async deletePostings(ids) {
    const set = new Set(ids); const before = state.postings.length;
    state.postings = state.postings.filter(p => !set.has(p.id));
    await savePostings(); emit(); return before - state.postings.length;
  },
  async setPriority(id, priority) {
    const p = state.postings.find(x => x.id === id); if (!p) return;
    if (p.groupId) setGroupPriority(state.postings, p.groupId, priority, state.settings);
    else { const t = targetForPriority(priority, state.settings); p.priority = t.priority; p.outreachTarget = t.target; }
    await savePostings(); emit();
  },
  /** Status change. "Covered" from a bare status select still works, but logs the cover (without carrier details) before removing the group. */
  async setStatus(id, status) {
    const p = state.postings.find(x => x.id === id); if (!p) return { removed: 0 };
    if (String(status).toLowerCase() === 'covered') {
      const e = await actions.coverGroup(id, {});
      return { removed: e ? e.rows.length : 0 };
    }
    if (p.groupId) setGroupStatus(state.postings, p.groupId, 'Active'); else p.status = 'Active';
    await savePostings(); emit();
    return { removed: 0 };
  },

  // ---------- cover attribution ----------
  /**
   * Close a load group and LOG it first: which of the 9 postings covered it, which carrier, at what rate. Then the group leaves the board.
   * opts: { coveredId, carrier:{id,name,email,mc,phone}, rate, note, outcome:'Covered'|'Expired'|'Manual', addCarrier:boolean }
   */
  async coverGroup(id, opts = {}) {
    const hit = state.postings.find(x => x.id === id); if (!hit) return null;
    const members = hit.groupId ? groupMembers(state.postings, hit.groupId) : [hit];
    const outcome = opts.outcome || 'Covered';
    const head = members.find(m => m.variant === 'Original') || members[0];
    const lane = classifyLane(head, state.zip, state.settings);
    { const rs = state.autoRescues.find(x => x.id === head.id); if (rs && rs.status === 'active') await actions.stopAutoRescue(head.id, outcome === 'Covered' ? 'covered' : 'stopped'); }
    let carrier = { ...(opts.carrier || {}) };
    let dbCarrier = null;
    if (outcome === 'Covered') {
      const em = String(carrier.email || '').trim().toLowerCase();
      dbCarrier = state.carriers.find(c => (carrier.id && c.id === carrier.id) || (em && String(c.email || '').trim().toLowerCase() === em)) || null;
      if (dbCarrier) carrier = { id: dbCarrier.id, name: carrier.name || dbCarrier.carrierName, email: carrier.email || dbCarrier.email, mc: carrier.mc || dbCarrier.mc, phone: carrier.phone || dbCarrier.phone };
    }
    const entry = buildCoverEntry({
      members, outcome, coveredId: opts.coveredId !== undefined ? opts.coveredId : (outcome === 'Covered' ? id : null),
      carrier, rate: opts.rate ?? '', inquiries: state.inquiries, note: opts.note || '', laneClass: lane.cls,
    });
    // 0) the effectiveness snapshot: how the load went, measured against what the app knew when it was entered (never blocks closing the load)
    let approach = null, assignHits = [];
    try {
      const snap = head.planSnap || null;
      const bp = snap ? null : loadPlan(head);
      const diff = snap ? { score: snap.score, level: snap.level, tags: snap.tags } : bp.diff;
      const keyOf = (c) => netCarrierKey({ mc: c && c.mc, email: c && c.email });
      const outs = state.outreach.filter(o => members.some(m => m.id === o.postingId));
      const plan = snap ? { keys: new Set(snap.keys || []), assignedKeys: new Set(snap.assigned || []) } : null;
      entry.fx = fxSnapshot({ entry, ops: head.ops || [], outreach: outs, carrier, dbCarrier, logBefore: state.coverLog, diff, plan, priorAvgRate: snap ? snap.priorAvg : (bp.intel.covers.avg || null), keyOf });
      approach = makeApproachRecord({ id: entry.id, entry, diff, ops: head.ops || [], coveredVia: entry.fx.assistedBy || (entry.fx.historical ? 'history' : outcome === 'Covered' ? 'new' : '') });
      const offered = (head.ops || []).some(o => o.type === 'assign-offer');
      for (const a of matchAssignments(head, state.assignments, state.carriers, { zipMap: state.zip })) {
        if (!offered && !sameAssigned(a, carrier)) continue;
        const rec = state.assignments.find(x => x.id === a.id); if (rec) assignHits.push(recordOutcome(rec, { won: outcome === 'Covered' && sameAssigned(a, carrier) }));
      }
    } catch (e) { console.warn('Effectiveness snapshot skipped:', e); }
    // 1) log first (if this fails nothing is deleted)
    const goal = weeklyGoalHit({ logBefore: state.coverLog, entry, settings: state.settings, goalWeek: state.counters.goalWeek });
    await guard(() => db.put('coverLog', entry));
    if (approach) { state.approaches.push(approach); await guard(() => db.put('approaches', approach)); }
    for (const a of assignHits) { const i = state.assignments.findIndex(x => x.id === a.id); if (i >= 0) state.assignments[i] = a; await guard(() => db.put('assignments', a)); }
    state.coverLog.unshift(entry);
    // 2) the carrier's own record learns from it
    if (outcome === 'Covered' && (dbCarrier || (opts.addCarrier && carrier.email))) {
      const c = dbCarrier || { id: uid(), ...Object.fromEntries(CARRIER_KEYS.map(k => [k, ''])), carrierName: carrier.name || '', email: carrier.email, mc: carrier.mc || '', phone: carrier.phone || '', status: 'Active' };
      c.coverCount = String((safeNumeric(c.coverCount) || 0) + 1);
      c.lastCovered = entry.closedAt;
      if (entry.rate) c.rate = String(entry.rate);
      if (!dbCarrier) { state.carriers.push(c); }
      state.carrierRev++;
      await guard(() => db.put('carriers', c));
    }
    // 3) the group leaves the board
    const ids = new Set(members.map(m => m.id));
    state.postings = state.postings.filter(p => !ids.has(p.id));
    if (outcome === 'Covered') {
      const today = todayKey();
      if (state.counters.coversTodayDate !== today) { state.counters.coversTodayDate = today; state.counters.coversToday = 0; }
      state.counters.coversToday += 1; state.counters.lifetimeCovers += 1;
      if (goal) state.counters.goalWeek = goal.key;
      await saveCounters();
    }
    await savePostings(); emit();
    announceGoal(goal);
    return entry;
  },
  /** Retire groups whose pickup has passed (logged as "Expired", restorable from the Cover Log). Returns how many groups were retired. */
  async expireDue(now = new Date()) {
    if (!state.settings.autoExpire) return 0;
    const due = expiredGroups(state.postings, now, Number(state.settings.expireGraceDays) || 0);
    let n = 0;
    for (const g of due) { const head = g.members[0]; if (await actions.coverGroup(head.id, { outcome: 'Expired', coveredId: null, note: 'Auto-retired: pickup date passed.' })) n++; }
    return n;
  },
  /** Put a logged group back on the board (undo a cover, or revive an expired load). */
  async restoreFromLog(entryId) {
    const e = state.coverLog.find(x => x.id === entryId); if (!e || !Array.isArray(e.rows) || !e.rows.length) return 0;
    const gid = e.groupId ? e.groupId : '';
    const rows = e.rows.map(r => ({ ...JSON.parse(JSON.stringify(r)), id: uid(), groupId: gid, status: 'Active', outreach: 'No' }));
    const orig = rows.find(r => r.variant === 'Original'); if (orig && !orig.details) orig.details = (e.rows.find(r => r.variant === 'Original') || {}).details || '';
    state.postings.push(...rows);
    state.coverLog = state.coverLog.filter(x => x.id !== entryId);
    await guard(() => db.del('coverLog', entryId));
    if (e.outcome === 'Covered') { state.counters.lifetimeCovers = Math.max(0, state.counters.lifetimeCovers - 1); if (state.counters.coversTodayDate === todayKey()) state.counters.coversToday = Math.max(0, state.counters.coversToday - 1); await saveCounters(); }
    await savePostings(); emit(); return rows.length;
  },
  /** Log a cover that was never on the board (done by phone, or before the app was used). */
  async addManualCover(f) {
    const e = buildCoverEntry({ members: [], outcome: 'Manual', carrier: f.carrier || {}, rate: f.rate ?? '', note: f.note || '' });
    e.lane = { originCity: f.originCity || '', originState: String(f.originState || '').toUpperCase(), destCity: f.destCity || '', destState: String(f.destState || '').toUpperCase() };
    e.broker = f.broker || '';
    if (f.closedAt) e.closedAt = f.closedAt;
    e.outcome = f.counts === false ? 'Manual' : 'Covered';  // "Covered" feeds lane memory, ranking and the pace tracker
    e.postings = []; e.rows = [];
    e.covered = { variant: '', grid: '', originCity: e.lane.originCity, originState: e.lane.originState, destCity: e.lane.destCity, destState: e.lane.destState, datRate: '', targetRate: '', inquiryCount: 0, contact: '' };
    const goal = weeklyGoalHit({ logBefore: state.coverLog, entry: e, settings: state.settings, goalWeek: state.counters.goalWeek });
    state.coverLog.unshift(e); state.coverLog.sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt)));
    await guard(() => db.put('coverLog', e));
    if (goal) { state.counters.goalWeek = goal.key; await saveCounters(); }
    emit(); announceGoal(goal); return e;
  },
  async deleteLogEntry(id) { state.coverLog = state.coverLog.filter(x => x.id !== id); await guard(() => db.del('coverLog', id)); emit(); },
  async saveLogEntry(e) { const i = state.coverLog.findIndex(x => x.id === e.id); if (i >= 0) state.coverLog[i] = e; await guard(() => db.put('coverLog', e)); emit(); },

  // ---------- brokers / contact method ----------
  async addBroker(name) {
    const n = String(name || '').trim(); if (!n) return false;
    const list = state.settings.brokers || [];
    if (list.some(b => b.toLowerCase() === n.toLowerCase())) return false;
    await actions.saveSettings({ brokers: [...list, n] }); return true;
  },
  /** Save a new broker order (drag and drop). `order` is the full list of names in the new order; unknown names are ignored, missing ones keep their place at the end. */
  async reorderBrokers(order) {
    const cur = state.settings.brokers || [];
    const next = applyOrder(cur, order);
    if (next.join('\u0000') === cur.join('\u0000')) return false;
    await actions.saveSettings({ brokers: next }); return true;
  },
  async renameBroker(oldName, newName) {
    const n = String(newName || '').trim(); if (!n) return false;
    const list = (state.settings.brokers || []).map(b => (b === oldName ? n : b));
    for (const p of state.postings) if (p.broker === oldName) p.broker = n;
    for (const e of state.coverLog) if (e.broker === oldName) { e.broker = n; }
    await guard(() => db.putMany('coverLog', state.coverLog));
    await savePostings(); await actions.saveSettings({ brokers: list }); return true;
  },
  async removeBroker(name) {
    for (const p of state.postings) if (p.broker === name) p.broker = '';
    await savePostings();
    await actions.saveSettings({ brokers: (state.settings.brokers || []).filter(b => b !== name) });
  },
  /** Set the owning broker for every posting of a group. */
  async setBroker(id, broker) {
    const p = state.postings.find(x => x.id === id); if (!p) return;
    (p.groupId ? groupMembers(state.postings, p.groupId) : [p]).forEach(m => { m.broker = broker || ''; });
    await savePostings(); emit();
  },
  /** Contact method for the whole group: 'Email' (default) or 'Phone' (DAT shows your phone number instead of an e-mail link). */
  async setContact(id, contact) {
    const p = state.postings.find(x => x.id === id); if (!p) return;
    const v = String(contact).toLowerCase() === 'phone' ? 'Phone' : 'Email';
    (p.groupId ? groupMembers(state.postings, p.groupId) : [p]).forEach(m => { m.contact = v; });
    await savePostings(); emit();
  },

  // ---------- adaptive next steps (every applied step is logged on the load so the advice escalates) ----------
  async logOp(id, type, detail = '') {
    const p = state.postings.find(x => x.id === id); if (!p) return;
    const head = (p.groupId ? groupMembers(state.postings, p.groupId) : [p]).find(m => m.variant === 'Original') || p;
    head.ops = [...(Array.isArray(head.ops) ? head.ops : []), { type, at: new Date().toISOString(), detail }].slice(-40);
    await savePostings(); emit();
  },
  /** Raise (or lower, negative) the box's rate (the Target rate, and any DAT override) by `step` dollars and log it. */
  async repriceGroup(id, step) {
    const p = state.postings.find(x => x.id === id); if (!p) return 0;
    const members = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
    let n = 0;
    // v8: when postings carry their own DAT rate, ONLY those move (the target is the goal and stays put). With no DAT rates, the target is what is posted, so it moves.
    const ownRates = members.some(m => Number(cleanRate(m.datRate)) > 0);
    for (const m of members) {
      const t = Number(cleanRate(m.targetRate)), d = Number(cleanRate(m.datRate));
      if (ownRates) { if (d > 0) { m.datRate = String(Math.max(1, d + Math.round(step))); n++; } }
      else if (t > 0) { m.targetRate = String(Math.max(1, t + Math.round(step))); n++; }
    }
    const head = members.find(m => m.variant === 'Original') || members[0];
    head.ops = [...(Array.isArray(head.ops) ? head.ops : []), { type: 'reprice', at: new Date().toISOString(), detail: (step >= 0 ? '+$' : '-$') + Math.abs(Math.round(step)) }].slice(-40);
    await savePostings(); emit(); return n;
  },
  /** Delete the alternates and rebuild the 3x3 with different cities (the first picks are excluded). Returns the new plan or an error. */
  /** Reshuffle: the same as rebuilding, named for the board button. */
  async reshuffleMatrix(id) { return actions.rebuildMatrix(id); },
  async rebuildMatrix(id) {
    const p = state.postings.find(x => x.id === id); if (!p) return { ok: false, error: 'Posting not found.' };
    const members = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
    const head = members.find(m => m.variant === 'Original') || members[0];
    const current = [];
    for (const m of members) { if (m.variant === 'Original') continue; current.push(normalizeText(m.originCity) + '|' + normalizeText(m.originState), normalizeText(m.destCity) + '|' + normalizeText(m.destState)); }
    // v8 reshuffle: remember every city already tried for this load so repeated reshuffles keep finding NEW markets (the ranking still
    // favours cities with cover history, inquiries and carrier density). If the unused pool runs dry, fall back to excluding only today's picks.
    const tried = Array.isArray(head.triedCities) ? head.triedCities : [];
    const ownRates = new Map(members.filter(m => m.variant !== 'Original' && Number(cleanRate(m.datRate)) > 0).map(m => [m.variant, m.datRate]));
    const ids = new Set(members.filter(m => m.variant !== 'Original').map(m => m.id));
    const copy = JSON.parse(JSON.stringify(head));
    const run = (exclude) => planMatrix({ source: copy, zipMap: state.zip, inquiries: state.inquiries, coverLog: state.coverLog, settings: state.settings, exclude });
    let plan = run([...new Set([...current, ...tried])]);
    let recycled = false;
    if (!plan.ok) { plan = run(current); recycled = true; }
    if (!plan.ok) return plan;
    state.postings = state.postings.filter(x => !ids.has(x.id));
    head.groupId = ''; head.status = 'Active';
    const rows = await actions.createMatrix(head.id, plan);
    const h2 = state.postings.find(x => x.id === head.id);
    const oldOps = Array.isArray(head.ops) ? head.ops : [];
    if (h2) h2.triedCities = recycled ? current : [...new Set([...tried, ...current])].slice(-120);
    // keep each posting's own DAT rate by grid position (A-A stays on the Original; nearby pairings keep theirs)
    for (const m of state.postings) { if (m.groupId && m.groupId === h2?.groupId && m.variant !== 'Original' && ownRates.has(m.variant)) m.datRate = ownRates.get(m.variant); }
    if (h2) h2.ops = [...oldOps, { type: 'recities', at: new Date().toISOString(), detail: plan.origins.slice(1).concat(plan.dests.slice(1)).map(l => l.city).join(', ') }].slice(-40);
    await savePostings(); emit();
    return { ...plan, rows };
  },
  /**
   * Apply Outlook events (from the bridge) to the Inquiry Log. Idempotent: an unseen ConversationId creates one inquiry
   * and bumps the posting's inquiry count once; later events only update that inquiry. Returns how many rows changed.
   */
  async applyBridgeInquiries(plan) {
    const { creates, patches, postingBumps } = plan;
    if (!creates.length && !patches.length) return 0;
    const newQ = creates.map(c => ({ id: uid(), ...c }));
    state.inquiries.push(...newQ);
    const touched = [...newQ];
    for (const { id, patch } of patches) { const q = state.inquiries.find(x => x.id === id); if (q) { Object.assign(q, patch); touched.push(q); } }
    await guard(() => db.putMany('inquiries', touched));
    if (postingBumps.length) {
      for (const b of postingBumps) { const p = state.postings.find(x => x.id === b.id); if (p) p.inquiryCount = b.count; }
      await savePostings();
    }
    emit();
    return newQ.length + patches.length;
  },
  async deleteGroup(id) {
    const { remaining, removed } = coverPosting(state.postings, id);
    state.postings = remaining; await savePostings(); emit(); return removed.length;
  },
  async deleteOnlyPosting(id) {
    state.postings = state.postings.filter(p => p.id !== id); await savePostings(); emit();
  },

  /** Plan only (for the preview dialog). */
  previewMatrix(id) {
    const source = state.postings.find(x => x.id === id);
    if (!source) return { ok: false, error: 'Posting not found.' };
    if (hasAlternates(state.postings, source)) return { ok: false, error: 'This load already has alternate rows. Delete/cover that group before rebuilding it.' };
    const copy = JSON.parse(JSON.stringify(source));
    const plan = planMatrix({ source: copy, zipMap: state.zip, inquiries: state.inquiries, coverLog: state.coverLog, settings: state.settings });
    if (plan.ok) { source.originCity = copy.originCity; source.originState = copy.originState; source.originZip = copy.originZip; source.destState = copy.destState; }
    return plan;
  },
  async createMatrix(id, plan) {
    const idx = state.postings.findIndex(x => x.id === id);
    if (idx < 0) return [];
    const source = state.postings[idx];
    const rows = applyMatrix({
      source, plan, inquiries: state.inquiries, settings: state.settings, sourceRow: idx + 2,
      existingGroupIds: state.postings.map(p => p.groupId).filter(Boolean),
    });
    state.postings.splice(idx + 1, 0, ...rows.slice(1));
    await savePostings(); emit();
    return rows;
  },

  // ---------- outreach ----------
  /** Ranked outreach for one load. opts.wave2 = skip every carrier already contacted about this load (a fresh round). */
  async runOutreach(id, opts = {}) {
    const p = state.postings.find(x => x.id === id); if (!p) return null;
    const ctx = { zip: state.zip, settings: state.settings, coverLog: state.coverLog, inquiries: state.inquiries };
    let res;
    const contacted = new Set(state.outreach.filter(o => o.postingId === p.id).map(o => String(o.email || '').toLowerCase()).filter(Boolean));
    if (state.settings.outreachButtonMode === 'outlook') {
      const clone = [{ ...p, status: 'Active', outreach: 'Yes' }];
      const scan = planRankedScan(clone, state.carriers, opts.wave2 ? [] : state.outreach, { ...ctx, exclude: opts.wave2 ? contacted : undefined });
      res = { drafts: scan.drafts, created: scan.drafts.length, attempted: scan.drafts.length, detail: (opts.wave2 ? 'Second wave: ' : 'Ranked lane scan: ') + scan.drafts.length + ' new draft(s) (max ' + state.settings.maxCarriersPerLoad + ' per load; carriers already drafted are skipped).' };
      if (scan.logEntries.length) { state.outreach.push(...scan.logEntries); await guard(() => db.putMany('outreach', scan.logEntries)); p.outreachCount = state.outreach.filter(o => o.postingId === p.id).length; }
    } else {
      res = planRankedOutreach(p, state.carriers, { ...ctx, exclude: opts.wave2 || state.settings.skipContacted !== false ? contacted : undefined });
      if (res.drafts.length) {
        const logs = res.drafts.map(d => ({ key: (String(p.loadNumber || p.id) + '|' + d.to).toLowerCase() + (opts.wave2 ? '|w2|' + Date.now() : ''), dateTime: new Date().toISOString(), loadNumber: p.loadNumber || '', postingId: p.id, postingRow: 0, carrierName: (state.carriers.find(c => c.id === d.carrierId) || {}).carrierName || '', email: d.to, originCity: p.originCity, originState: p.originState, destCity: p.destCity, destState: p.destState, score: d.score, status: 'DRAFT CREATED' }));
        state.outreach.push(...logs); await guard(() => db.putMany('outreach', logs));
        p.outreachCount = state.outreach.filter(o => o.postingId === p.id).length;
        // remember when each carrier was last contacted so they sink in the next ranking
        const stamp = new Date().toISOString(); const touched = [];
        for (const d of res.drafts) { const c = state.carriers.find(x => x.id === d.carrierId); if (c) { c.lastContacted = stamp; touched.push(c); } }
        if (touched.length) { await guard(() => db.putMany('carriers', touched)); state.carrierRev++; }
      }
    }
    const stamped = res.drafts.map(d => ({ id: uid(), createdAt: new Date().toISOString(), postingId: p.id, kind: opts.wave2 ? 'Carrier outreach (wave 2)' : 'Carrier outreach', ...d }));
    state.drafts.unshift(...stamped);
    await guard(() => db.putMany('drafts', stamped));
    p.draftsCreated = res.created; p.lastRun = new Date().toISOString(); p.result = res.detail; p.outreach = 'No'; // macro resets to "No"
    const head = (p.groupId ? groupMembers(state.postings, p.groupId) : [p]).find(m => m.variant === 'Original') || p;
    head.ops = [...(Array.isArray(head.ops) ? head.ops : []), { type: opts.wave2 ? 'wave2' : 'outreach', at: new Date().toISOString(), detail: res.created + ' draft(s)' }].slice(-40);
    await savePostings(); emit();
    if (state.settings.draftsToOutlook && state.hooks.sendToOutlook && stamped.length) await actions.sendDraftsToOutlook(stamped.map(d => d.id));
    return { ...res, drafts: stamped };
  },
  /** Outlook-engine scan over all eligible loads (Active + Carrier Outreach = Yes), ranked by lane fit within the carrier radius. */
  async runOutlookScan() {
    const scan = planRankedScan(state.postings, state.carriers, state.outreach, { zip: state.zip, settings: state.settings, coverLog: state.coverLog, inquiries: state.inquiries });
    const stamped = scan.drafts.map(d => ({ id: uid(), createdAt: new Date().toISOString(), kind: 'Carrier outreach (scan)', ...d }));
    state.drafts.unshift(...stamped); state.outreach.push(...scan.logEntries);
    for (const [pid] of scan.countUpdates) {
      const p = state.postings.find(x => x.id === pid);
      if (p) p.outreachCount = state.outreach.filter(o => o.postingId === pid).length;
    }
    await guard(async () => { await db.putMany('drafts', stamped); await db.putMany('outreach', scan.logEntries); });
    await savePostings(); emit();
    if (state.settings.draftsToOutlook && state.hooks.sendToOutlook && stamped.length) await actions.sendDraftsToOutlook(stamped.map(d => d.id));
    return { ...scan, drafts: stamped };
  },
  /**
   * "Do you have any trucks available?" - one draft per carrier. Returns the saved draft records.
   * With `load` (a posting) the question is about THAT lane ("in Joliet, IL heading toward Atlanta, GA") instead of the carrier's own lane.
   */
  async truckCheck(carrierIds, load = null) {
    const made = [];
    for (const cid of carrierIds) {
      const c = state.carriers.find(x => x.id === cid); if (!c || !String(c.email || '').trim()) continue;
      const asked = load ? { ...c, originCity: load.originCity, originState: load.originState, destCity: load.destCity, destState: load.destState } : c;
      made.push({ id: uid(), createdAt: new Date().toISOString(), ...(load ? { postingId: load.id } : {}), ...buildTruckCheck(asked, state.settings) });
    }
    if (!made.length) return [];
    state.drafts.unshift(...made); await guard(() => db.putMany('drafts', made));
    const now = new Date().toISOString(); const touched = [];
    for (const d of made) { const c = state.carriers.find(x => x.id === d.carrierId); if (c) { c.lastContacted = now; touched.push(c); } }
    await guard(() => db.putMany('carriers', touched)); state.carrierRev++;
    emit();
    if (state.settings.draftsToOutlook && state.hooks.sendToOutlook) await actions.sendDraftsToOutlook(made.map(d => d.id));
    return made;
  },
  /**
   * Truck check for one load: the best-matched carriers (lane fit, cover history, response rate) are asked whether they have a truck near the
   * pickup. Skips anyone already contacted about this load and anyone contacted in the last 24 hours. Drafts only; nothing is sent.
   */
  async truckCheckForLoad(id, count) {
    const p = state.postings.find(x => x.id === id);
    if (!p) return { drafts: [], created: 0, detail: 'That load is no longer on the board.' };
    const n = Math.max(1, Math.trunc(Number(count) || Number(state.settings.truckCheckCount) || 15));
    const asked = new Set(state.outreach.filter(o => o.postingId === p.id).map(o => String(o.email || '').toLowerCase()).filter(Boolean));
    const cutoff = Date.now() - 86400000;
    for (const c of state.carriers) { const t = Date.parse(c.lastContacted); if (Number.isFinite(t) && t > cutoff) asked.add(String(c.email || '').toLowerCase()); }
    const ranked = rankCarriers(p, state.carriers, { zip: state.zip, settings: state.settings, coverLog: state.coverLog, inquiries: state.inquiries, exclude: asked });
    const seen = new Set(); const ids = [];
    for (const r of ranked) { const em = String(r.carrier.email || '').toLowerCase(); if (!em || seen.has(em)) continue; seen.add(em); ids.push(r.carrier.id); if (ids.length >= n) break; }
    if (!ids.length) return { drafts: [], created: 0, detail: 'No carrier in the database fits this lane (or all of them were asked in the last 24 hours). Add carriers, or widen the carrier radius in System.' };
    const drafts = await actions.truckCheck(ids, p);
    await actions.logOp(p.id, 'truckcheck', `${drafts.length} truck-check draft(s)`);
    return { drafts, created: drafts.length, detail: `${drafts.length} truck-availability draft(s) for the carriers best matched to ${p.originCity}, ${p.originState} to ${p.destCity}, ${p.destState}. Best matches first. Nothing has been sent.` };
  },
  /** Queue drafts for the Outlook macro to save in the Drafts folder (nothing is ever sent). Returns how many were queued. */
  async sendDraftsToOutlook(ids) {
    if (!state.hooks.sendToOutlook) return 0;
    const set = new Set(ids); const list = state.drafts.filter(d => set.has(d.id) && d.to);
    if (!list.length) return 0;
    // DANGER ZONE switches (default off): the macro SENDS instead of saving a draft. Inbound replies additionally need autoSendSafe.
    const inboundKinds = ['Inquiry reply', 'Rate response', 'Carrier reply'];
    for (const d of list) d.send = inboundKinds.includes(d.kind) ? (typeof d.send === 'boolean' && d.sendDecided ? d.send : !!(state.settings.autoSendInbound && d.autoSendSafe)) : !!state.settings.autoSendOutbound;
    const n = await state.hooks.sendToOutlook(list);
    for (const d of list) d.outlook = 'queued';
    await guard(() => db.putMany('drafts', list)); emit(); return n;
  },
  /** Called by the bridge when the macro reports back which outbox drafts it created or failed. */
  async markDraftsDone(results) {
    const touched = [];
    for (const r of results) { const d = state.drafts.find(x => x.id === r.id); if (d && d.outlook !== (r.ok ? (r.sent ? 'sent' : 'saved') : 'error')) { d.outlook = r.ok ? (r.sent ? 'sent' : 'saved') : 'error'; d.outlookDetail = r.detail || ''; touched.push(d); } }
    if (touched.length) { await guard(() => db.putMany('drafts', touched)); emit(); }
    return touched.length;
  },
  async removeDraft(id) { state.drafts = state.drafts.filter(d => d.id !== id); await guard(() => db.del('drafts', id)); emit(); },
  async clearDrafts() { state.drafts = []; await guard(() => db.clear('drafts')); emit(); },
  async addDraft(d) { const s = { id: uid(), createdAt: new Date().toISOString(), ...d }; state.drafts.unshift(s); await guard(() => db.put('drafts', s)); emit(); return s; },

  // ---------- inbound e-mail ----------
  async processEmail(mail, { force = false } = {}) {
    const now = Date.now();
    // 1. idempotency: the same message is never judged (and never answered) twice, even after a restart or a re-paste
    const key = ledgerKey(mail);
    if (!force && state.ledger.some(e => e.id === key)) return { action: 'duplicate', reason: 'This message was already handled (it is in the processing ledger).', ledgerKey: key };
    const res = processIncomingEmail({ mail, postings: state.postings, inquiries: state.inquiries, settings: state.settings });
    if (res.newInquiry) {
      const q = { id: uid(), ...res.newInquiry }; state.inquiries.push(q); await guard(() => db.put('inquiries', q));
      if (res.inquiryPatch === undefined) res.convId = q.conversationId;
    }
    if (res.inquiryPatch) {
      const q = state.inquiries.find(x => x.id === res.inquiryPatch.id);
      if (q) { Object.assign(q, res.inquiryPatch.patch); await guard(() => db.put('inquiries', q)); }
    }
    if (res.postingPatch) {
      const p = state.postings.find(x => x.id === res.postingPatch.id);
      if (p) { Object.assign(p, res.postingPatch.patch); await savePostings(); }
    }
    // 2. the safe-send decision for the drafted reply (the macro applies the same gates)
    let decision = null;
    const posting = state.postings.find(x => x.id === (res.postingPatch && res.postingPatch.id)) ||
      state.postings.find(x => x.id === (res.inquiryPatch && (state.inquiries.find(q => q.id === res.inquiryPatch.id) || {}).postingId));
    if (res.draft) {
      const conv = (res.newInquiry && res.newInquiry.conversationId) || (state.inquiries.find(q => res.inquiryPatch && q.id === res.inquiryPatch.id) || {}).conversationId || '';
      const counts = sendCounts(state.ledger, conv, now);
      const q = state.inquiries.find(x => res.inquiryPatch && x.id === res.inquiryPatch.id);
      decision = decideSend({
        plan: { kind: res.planKind || (res.plan && res.plan.kind), text: res.replyText || (res.plan && res.plan.text) || '', autoSendSafe: res.autoSendSafe, ladderNext: res.plan && res.plan.ladderNext, ignore: res.plan && res.plan.ignore },
        analysis: res.analysis || {}, settings: state.settings, now, laneScore: res.laneScore, targetRate: posting && posting.targetRate,
        targetConfirmed: !posting || posting.targetSource !== 'suggested', events: q ? Number(q.eventCount) || 0 : 1, ...counts,
        fromSelf: /@freightsignal\.local$/i.test(String(mail.from || '')), noReply: /(?:^|[^a-z])(?:no-?reply|do-?not-?reply|mailer-daemon|postmaster)@/i.test(String(mail.from || '')),
        attachments: Number(mail.attachments) || 0,
      });
      res.decision = decision;
      res.draft.autoSendSafe = !!(res.autoSendSafe && decision.would);
      res.draft.send = decision.send; res.draft.sendDecided = true; res.draft.sendDelayMinutes = decision.delayMinutes;
    }
    // 3. what the carrier's words taught us: a truck, an MC number, a "do not contact"
    const learned = await learnFromEmail(res, mail, now);
    if (learned.length) res.learned = learned;
    // 4. the ledger and the exception queue
    const entry = buildLedgerEntry({ ...res, convId: res.convId }, mail, decision, now);
    if (res.suggest) {
      const sd = await actions.addDraft({ postingId: posting && posting.id, ...res.suggest }); res.suggest = sd;
    }
    state.ledger.unshift(entry); if (state.ledger.length > 3000) state.ledger.length = 3000;
    await guard(() => db.put('ledger', entry));
    if (res.draft) {
      res.draft = await actions.addDraft({ postingId: res.postingPatch?.id || (posting && posting.id), ...res.draft });
      if (decision && decision.send && state.hooks.sendToOutlook) await actions.sendDraftsToOutlook([res.draft.id]);   // routine/full mode: the macro sends it (after the delay)
    }
    res.ledgerEntry = entry;
    emit();
    return res;
  },

  // ---------- processing ledger / exception queue ----------
  /** Mark a held message as dealt with (and, optionally, whether the engine's reply was right: feeds the readiness meter). */
  async resolveLedger(id, verdict = '') {
    const e = state.ledger.find(x => x.id === id); if (!e) return;
    e.resolved = true; if (verdict === 'ok' || verdict === 'bad') e.verdict = verdict;
    await guard(() => db.put('ledger', e)); emit();
  },
  async markVerdict(id, verdict) {
    const e = state.ledger.find(x => x.id === id); if (!e) return;
    const was = e.verdict;
    e.verdict = verdict === 'ok' || verdict === 'bad' ? verdict : ''; await guard(() => db.put('ledger', e));
    if (e.learned && verdict === 'ok' && was !== 'ok') { await actions.saveSettings({ replyLessons: confirmLesson(state.settings.replyLessons, e.learned.sig) }); return; }   // your OK on a taught reply counts toward letting it send itself
    emit();
  },
  /** Teach Freight Signal what a message it did not understand means. Uses your standard reply for that meaning; never invents wording. */
  async teachReply(id, intent) {
    const e = state.ledger.find(x => x.id === id); if (!e) return { ok: false, reason: 'That message is no longer in the list.' };
    const r = teachLesson(state.settings.replyLessons, e.fresh, intent);
    if (!r.ok) return r;
    await actions.saveSettings({ replyLessons: r.lessons });
    const lesson = r.lessons.find(l => l.sig === r.sig);
    e.verdict = 'ok'; e.taught = intent; await guard(() => db.put('ledger', e)); emit();
    return { ok: true, count: lesson ? lesson.count : 1, label: teachableLabel(intent) };
  },
  async forgetLesson(sig) { await actions.saveSettings({ replyLessons: forgetLesson(state.settings.replyLessons, sig) }); },
  /** Entries that Outlook wrote while the app was closed (never overwrites one already known: your verdicts and Done marks stay). */
  async addLedgerEntries(list) {
    const have = new Set(state.ledger.map(e => e.id)); const fresh = list.filter(e => !have.has(e.id));
    if (!fresh.length) return 0;
    state.ledger.unshift(...fresh); state.ledger.sort((a, b) => b.at - a.at); if (state.ledger.length > 3000) state.ledger.length = 3000;
    await guard(() => db.putMany('ledger', fresh)); emit(); return fresh.length;
  },
  async clearLedger() { state.ledger = []; await guard(() => db.clear('ledger')); emit(); },


  // ---------- Two-way matching (v17) ----------
  /** Every open load against every available truck (yours and the team's). Cheap; runs when a load or a truck arrives and on every tick. */
  async runMatching({ newLoadIds = new Set(), newTruckKeys = new Set(), now = Date.now() } = {}) {
    const team = (() => { try { return state.hooks.teamTrucks ? state.hooks.teamTrucks() : []; } catch { return []; } })();
    const mine = activeTrucks(state.trucks, now); const trucks = [...mine, ...activeTrucks(team, now).filter(t => !mine.some(m => m.key && m.key === t.key))];
    const r = reconcileMatches({ existing: state.matches, loads: headsOf(state.postings), trucks, zipMap: state.zip, now, coverLog: state.coverLog, newLoadIds, newTruckKeys, radius: Number(state.settings.carrierRadiusMiles) > 0 ? Math.max(100, Number(state.settings.carrierRadiusMiles)) : 125 });
    const changed = r.added.length || r.dropped.length;
    if (!changed) return r;
    state.matches = r.matches;
    await guard(async () => { for (const d of r.dropped) await db.del('matches', d.id); await db.putMany('matches', r.added); });
    emit();
    if (r.added.length && state.hooks.onMatches) { try { state.hooks.onMatches(r); } catch (e) { console.error(e); } }
    return r;
  },
  async setMatchStatus(id, status) { const m = state.matches.find(x => x.id === id); if (!m) return; m.status = status; await guard(() => db.put('matches', m)); emit(); },

  // ---------- Auto Rescue (v17) ----------
  autoRescueFor(id) { return state.autoRescues.find(r => r.id === id) || null; },
  async startAutoRescue(headId, opts = {}) {
    const head = state.postings.find(p => p.id === headId); if (!head) return null;
    const ex = actions.autoRescueFor(headId); if (ex && ex.status === 'active') return ex;
    const r = newRescue(head, { now: Date.now(), maxRate: opts.maxRate, includeTeam: opts.includeTeam, auto: !!opts.auto });
    state.autoRescues = state.autoRescues.filter(x => x.id !== headId); state.autoRescues.push(r);
    await guard(() => db.put('autorescues', r)); emit();
    await actions.tickAutoRescue({ reason: 'start' });
    return r;
  },
  async updateAutoRescue(id, patch) {
    const r = actions.autoRescueFor(id); if (!r) return null; Object.assign(r, patch);
    await guard(() => db.put('autorescues', r)); emit(); return r;
  },
  async stopAutoRescue(id, status = 'stopped', text = '') {
    const r = actions.autoRescueFor(id); if (!r || r.status === status) return;
    r.status = status; r.endedAt = Date.now(); r.log.push({ at: Date.now(), stage: 'end', text: text || (status === 'covered' ? 'The load was covered.' : status === 'paused' ? 'Paused.' : 'Stopped.') });
    await guard(() => db.put('autorescues', r)); emit();
  },
  async resumeAutoRescue(id) { const r = actions.autoRescueFor(id); if (!r) return; r.status = 'active'; delete r.endedAt; r.log.push({ at: Date.now(), stage: 'start', text: 'Resumed.' }); await guard(() => db.put('autorescues', r)); emit(); await actions.tickAutoRescue({ reason: 'resume' }); },
  async deleteAutoRescue(id) { state.autoRescues = state.autoRescues.filter(r => r.id !== id); await guard(() => db.del('autorescues', id)); emit(); },
  /** Do whatever is due: start hard lanes that have gone quiet, run each rescue's due stages, and re-run a cycle when something new appears. */
  async tickAutoRescue({ now = Date.now(), reason = 'tick', force = null } = {}) {
    if (actions._rescueBusy) return 0; actions._rescueBusy = true; let did = 0;
    try {
      const heads = headsOf(state.postings);
      // 1. hard lanes that nobody has answered start by themselves
      for (const head of heads) {
        const ex = actions.autoRescueFor(head.id); if (ex && ex.status !== 'stopped' && ex.status !== 'covered') continue; if (ex && ex.autoDeclined) continue;
        const a = shouldAutoStart(head, { zipMap: state.zip, settings: state.settings, now });
        if (a.start) { const r = newRescue(head, { now, includeTeam: false, auto: true }); r.log[0].text = 'Started automatically: ' + (a.why || 'hard lane') + ', posted and no replies yet.'; state.autoRescues = state.autoRescues.filter(x => x.id !== head.id); state.autoRescues.push(r); await guard(() => db.put('autorescues', r)); did++; }
      }
      // 2. run the active rescues
      for (const r of state.autoRescues.filter(x => x.status === 'active')) {
        const head = heads.find(p => p.id === r.headId);
        if (!head || head.status === 'Covered') { await actions.stopAutoRescue(r.id, head ? 'covered' : 'stopped', head ? 'The load was covered.' : 'The load left the board.'); continue; }
        if (minutesIn(r, now) > (Number(state.settings.rescueMaxHours) > 0 ? Number(state.settings.rescueMaxHours) : 72) * 60) { await actions.stopAutoRescue(r.id, 'stopped', 'Stopped after 72 hours. Restart it if the load is still open.'); continue; }
        const team = (() => { try { return state.hooks.teamTrucks ? state.hooks.teamTrucks() : []; } catch { return []; } })();
        const mine = activeTrucks(state.trucks, now); const trucks = [...mine, ...activeTrucks(team, now).filter(t => !mine.some(m => m.key && m.key === t.key))];
        const ctx = { carriers: state.carriers, trucks, coverLog: state.coverLog, inquiries: state.inquiries, outreach: state.outreach, rescues: state.autoRescues, drafts: state.drafts, settings: state.settings, zipMap: state.zip, now };
        let due = force ? [force] : dueStages(r, now);
        // catching up after the app was closed: run the first stage and the latest one, not every wave in between
        if (due.length > 2) due = [due[0], due[due.length - 1]];
        for (const stage of due) { did += await runRescueStage(r, head, stage, ctx, reason); r.fired[stage] = now; }
        // 3. something new (a truck, a quote, a reply) triggers another matching cycle straight away
        const sig = signatureOf(head, ctx);
        if (r.sig && sig !== r.sig && !due.length) did += await runRescueStage(r, head, 'rematch', ctx, reason);
        r.sig = sig; r.lastEvalAt = now;
        await guard(() => db.put('autorescues', r));
      }
      if (did) emit();
    } finally { actions._rescueBusy = false; }
    return did;
  },

  // ---------- Truck Book ----------
  /** Add trucks (already parsed). Newer reports replace older ones from the same carrier at the same place. Returns { added, updated }. */
  async addTrucks(list) {
    const m = mergeTrucks(state.trucks, list); state.trucks = m.trucks;
    await guard(() => db.putMany('trucks', state.trucks)); emit();
    actions.runMatching({ newTruckKeys: new Set((list || []).map(t => t.key).filter(Boolean)) }).then(() => actions.tickAutoRescue({ reason: 'new truck' })).catch(() => {});
    return { added: m.added, updated: m.updated };
  },
  /** Paste a list, a CSV or an e-mail: Freight Signal finds the trucks in it. */
  async importTruckText(text, source = 'paste') {
    const r = parseTruckList(text, { now: Date.now(), zipMap: state.zip, source, by: state.settings.brokerName || '' });
    const res = await actions.addTrucks(r.trucks); return { ...res, found: r.trucks.length, skipped: r.skipped };
  },
  async setTruckStatus(id, status) {
    const t = state.trucks.find(x => x.id === id); if (!t) return; t.status = status; await guard(() => db.put('trucks', t)); emit();
  },
  async removeTruck(id) { state.trucks = state.trucks.filter(t => t.id !== id); await guard(() => db.del('trucks', id)); emit(); },
  /** Drop trucks that expired more than a week ago. */
  async pruneTrucks(now = Date.now()) {
    const gone = state.trucks.filter(t => !isActive(t, now) && now - Math.max(Number(t.exp) || 0, Number(t.at) || 0) > 7 * 86400000);
    if (!gone.length) return 0; const ids = new Set(gone.map(t => t.id)); state.trucks = state.trucks.filter(t => !ids.has(t.id));
    for (const t of gone) await guard(() => db.del('trucks', t.id)); emit(); return gone.length;
  },

  // ---------- carrier clean-up ----------
  /** Remove exact duplicate carrier rows (same carrier AND same lane), keeping the fullest one and filling its blanks from the others. */
  async cleanupCarrierDuplicates() {
    const dup = duplicateRows(state.carriers); const patches = mergePatches(state.carriers);
    for (const pt of patches) { const c = state.carriers.find(x => x.id === pt.id); if (c) Object.assign(c, pt.patch); }
    const drop = new Set(dup.drop); if (!drop.size && !patches.length) return { removed: 0, merged: 0 };
    state.carriers = state.carriers.filter(c => !drop.has(c.id)); state.carrierRev++;
    await guard(() => db.replaceAll('carriers', state.carriers)); emit();
    return { removed: drop.size, merged: patches.length };
  },

  // ---------- primary carriers (assignments), load plan, e-mail history ----------
  async saveAssignment(f) {
    const a = cleanAssignment(f, uid); if (!a) return null;
    const i = state.assignments.findIndex(x => x.id === a.id);
    if (i >= 0) state.assignments[i] = { ...state.assignments[i], ...a }; else state.assignments.unshift(a);
    await guard(() => db.put('assignments', i >= 0 ? state.assignments[i] : a)); emit(); return a;
  },
  async deleteAssignment(id) { state.assignments = state.assignments.filter(a => a.id !== id); await guard(() => db.del('assignments', id)); emit(); },
  /** Remember what the plan looked like when the load was first shown (difficulty, the carriers it suggested), so the result can be judged against it later. Silent: no redraw. */
  async snapPlan(id) {
    const p = state.postings.find(x => x.id === id); if (!p) return null;
    const head = (p.groupId ? groupMembers(state.postings, p.groupId) : [p]).find(m => m.variant === 'Original') || p;
    if (head.planSnap) return head.planSnap;
    const bp = loadPlan(head);
    head.planSnap = { at: new Date().toISOString(), score: bp.diff.score, level: bp.diff.level, tags: bp.diff.tags, confidence: bp.diff.confidence, keys: [...suggestedKeys(bp.matches, 6)], assigned: bp.assignMatches.map(a => netCarrierKey({ mc: a.mc, email: a.email })).filter(Boolean), priorAvg: bp.intel.covers.avg || null };
    await savePostings(); return head.planSnap;
  },
  /** Read a historical e-mail import plan into the carrier database, Cover Log and history. Re-checks for duplicates against what is stored RIGHT NOW. */
  async applyHistoryImport(plan) {
    const stats = { added: 0, updated: 0, duplicates: 0, covers: 0, threads: 0, conflicts: 0 };
    const stamp = new Date().toISOString();
    const fresh = [];
    for (const raw of plan.adds || []) {
      const { _cand, ...r } = raw;
      const cand = { mc: String(r.mc || '').replace(/\D/g, ''), dot: '', email: r.email, emails: [r.email, ...(r.altEmails || [])].filter(Boolean), phone: r.phone, dispatchPhone: r.dispatchPhone, name: r.carrierName };
      if (findExisting(cand, [...state.carriers, ...fresh]).length) { stats.duplicates++; continue; }
      fresh.push({ id: uid(), ...Object.fromEntries(CARRIER_KEYS.map(k => [k, ''])), ...r });
    }
    const touched = [];
    for (const pt of plan.patches || []) {
      const row = state.carriers.find(c => c.id === pt.id); if (!row) continue;
      const before = JSON.stringify(row); Object.assign(row, pt.patch);
      if (JSON.stringify(row) !== before) { touched.push(row); stats.updated++; }
      stats.conflicts += (pt.conflicts || []).length;
    }
    const entries = [];
    const have = new Set(state.coverLog.map(e => e.threadId).filter(Boolean));
    for (const c of plan.covers || []) { if (have.has(c.threadId)) continue; have.add(c.threadId); entries.push(coverEntryFor(c, { uid, zipMap: state.zip, settings: state.settings })); }
    if (fresh.length) { state.carriers.push(...fresh); stats.added = fresh.length; }
    if (fresh.length || touched.length) state.carrierRev++;
    if (entries.length) { state.coverLog.unshift(...entries); state.coverLog.sort((a, b) => String(b.closedAt).localeCompare(String(a.closedAt))); stats.covers = entries.length; }
    const th = (plan.threads || []).map(t => ({ ...t, scanned: stamp }));
    if (th.length) { const ids = new Set(th.map(t => t.id)); state.history = [...state.history.filter(t => !ids.has(t.id)), ...th]; stats.threads = th.length; }
    await guard(async () => {
      if (fresh.length) await db.putMany('carriers', fresh);
      if (touched.length) await db.putMany('carriers', touched);
      if (entries.length) await db.putMany('coverLog', entries);
      if (th.length) await db.putMany('history', th);
    });
    emit(); return stats;
  },
  async clearHistory() { state.history = []; await guard(() => db.clear('history')); emit(); },

  // ---------- carriers ----------
  async saveCarrier(c) {
    if (!c.id) c.id = uid();
    const i = state.carriers.findIndex(x => x.id === c.id);
    if (i >= 0) state.carriers[i] = c; else state.carriers.push(c);
    state.carrierRev++;
    await guard(() => db.put('carriers', c)); emit(); return c;
  },
  async deleteCarrier(id) { state.carrierRev++; state.carriers = state.carriers.filter(c => c.id !== id); await guard(() => db.del('carriers', id)); emit(); },
  async importCarriers(rows, mode = 'append') {
    state.carrierRev++;
    const recs = rows.map(r => ({ id: uid(), ...r }));
    if (mode === 'replace') state.carriers = recs; else state.carriers.push(...recs);
    await guard(() => (mode === 'replace' ? db.replaceAll('carriers', state.carriers) : db.putMany('carriers', recs))); emit(); return recs.length;
  },

  // ---------- customers ----------
  async saveCustomer(c) {
    if (!c.id) c.id = uid();
    const i = state.customers.findIndex(x => x.id === c.id);
    if (i >= 0) state.customers[i] = c; else state.customers.push(c);
    await guard(() => db.put('customers', c)); emit(); return c;
  },
  async deleteCustomer(id) { state.customers = state.customers.filter(c => c.id !== id); await guard(() => db.del('customers', id)); emit(); },
  async importCustomers(rows, mode = 'append') {
    const recs = rows.map(r => ({ id: uid(), ...Object.fromEntries(CUSTOMER_KEYS.map(k => [k, ''])), ...r }));
    if (mode === 'replace') state.customers = recs; else state.customers.push(...recs);
    await guard(() => (mode === 'replace' ? db.replaceAll('customers', state.customers) : db.putMany('customers', recs))); emit(); return recs.length;
  },

  // ---------- inquiry log ----------
  async saveInquiry(q) {
    if (!q.id) q.id = uid();
    const i = state.inquiries.findIndex(x => x.id === q.id);
    if (i >= 0) state.inquiries[i] = q; else state.inquiries.push(q);
    await guard(() => db.put('inquiries', q)); emit(); return q;
  },
  async deleteInquiry(id) { state.inquiries = state.inquiries.filter(q => q.id !== id); await guard(() => db.del('inquiries', id)); emit(); },
  async importInquiries(rows, mode = 'append') {
    const recs = rows.map(r => ({ id: uid(), ...r }));
    if (mode === 'replace') state.inquiries = recs; else state.inquiries.push(...recs);
    await guard(() => (mode === 'replace' ? db.replaceAll('inquiries', state.inquiries) : db.putMany('inquiries', recs))); emit(); return recs.length;
  },
  /** HandleInquiryLogApproval + AddOrUpdateApprovedCarrier: Approved = Yes stamps Date Added and upserts the carrier. */
  async setApproved(id, value) {
    const q = state.inquiries.find(x => x.id === id); if (!q) return null;
    q.approved = value;
    let carrier = null;
    if (String(value).toLowerCase() === 'yes') {
      q.dateAdded = new Date().toISOString();
      const email = String(q.senderEmail ?? '').trim();
      carrier = state.carriers.find(c => email && normalizeText(c.email) === normalizeText(email));
      const isNew = !carrier;
      if (!carrier) carrier = { id: uid(), ...Object.fromEntries(CARRIER_KEYS.map(k => [k, ''])) };
      const copy = (k, v) => { if (String(v ?? '').trim() !== '') carrier[k] = v; };
      copy('email', email); copy('originCity', q.originCity); copy('originState', q.originState);
      copy('destCity', q.destCity); copy('destState', q.destState);
      if (!String(carrier.status ?? '').trim()) carrier.status = 'Active';
      if (isNew) state.carriers.push(carrier);
      await guard(() => db.put('carriers', carrier));
    }
    await guard(() => db.put('inquiries', q)); emit();
    return carrier;
  },

  // ---------- spare load details ----------
  async saveSpareFromGroup(id, label) {
    const p = state.postings.find(x => x.id === id); if (!p) return null;
    const rows = p.groupId ? groupMembers(state.postings, p.groupId) : [p];
    const first = rows[0];
    const spare = {
      id: uid(), createdAt: new Date().toISOString(),
      label: label || `${first.originCity} ${first.originState} - ${first.destCity} ${first.destState}`,
      rows: JSON.parse(JSON.stringify(rows)),
    };
    state.spares.push(spare); await guard(() => db.put('spares', spare)); emit(); return spare;
  },
  async restoreSpare(spareId) {
    const s = state.spares.find(x => x.id === spareId); if (!s) return 0;
    const gid = 'FS-RESTORED-' + Date.now().toString(36).toUpperCase();
    const rows = s.rows.map(r => ({ ...JSON.parse(JSON.stringify(r)), id: uid(), groupId: r.groupId ? gid : '', status: 'Active', outreach: 'No' }));
    state.postings.push(...rows); await savePostings(); emit(); return rows.length;
  },
  async deleteSpare(id) { state.spares = state.spares.filter(s => s.id !== id); await guard(() => db.del('spares', id)); emit(); },
  async saveSpare(s) { const i = state.spares.findIndex(x => x.id === s.id); if (i >= 0) state.spares[i] = s; await guard(() => db.put('spares', s)); emit(); },

  // ---------- weather (set by store/weather.js; not persisted) ----------
  setWeather(map) { state.weather = map; emit(); },

  // ---------- counters ----------
  async setCounters(patch) { state.counters = { ...state.counters, ...patch }; await saveCounters(); emit(); },

  // ---------- backup / restore ----------
  async exportBackup() { return db.exportAll(); },
  async restoreBackup(snapshot, mode = 'replace') {
    const keepAcct = { account: state.settings.account || null, accountPrompt: state.settings.accountPrompt || '' };
    await db.importAll(snapshot, mode);
    const keepZip = state.zip;
    await loadAll();
    if (!state.zip && keepZip) state.zip = keepZip;
    // A backup made before sign-in existed must not remove the sign-in you have now.
    if (!state.settings.account && keepAcct.account) await actions.savePrefs(keepAcct);
    emit();
  },
  async wipe() { await db.wipeAll(false); await loadAll(); },
};

export { parseTqlLoad, countAlternates, safeNumeric, INQUIRY_KEYS, CUSTOMER_KEYS };
