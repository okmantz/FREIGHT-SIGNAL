// In-memory application state with write-through persistence. UI reads `state`, mutations go through `actions`.

import * as db from './db.js';
import { DEFAULT_SETTINGS, CARRIER_KEYS, INQUIRY_KEYS, CUSTOMER_KEYS } from '../core/defaults.js';
import { ZipMap } from '../core/zipmap.js';
import { targetForPriority, blankPosting, reindex, initializeLoadControls, reconcileManualLane, coverPosting, setGroupPriority, setGroupStatus, groupMembers, countAlternates } from '../core/model.js';
import { planMatrix, applyMatrix, hasAlternates } from '../core/matrix.js';
import { planExcelOutreach, planOutlookScan } from '../core/outreach.js';
import { planRankedOutreach, planRankedScan, buildTruckCheck } from '../core/ranking.js';
import { buildCoverEntry, weeklyGoalHit } from '../core/coverlog.js';
import { expiredGroups } from '../core/expiry.js';
import { classifyLane } from '../core/lanes.js';
import { processIncomingEmail } from '../core/inbound.js';
import { todayKey, uid, safeNumeric, normalizeText, applyOrder } from '../core/util.js';
import { parseTqlLoad } from '../core/parser.js';
import { toast } from '../ui/dom.js';

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
  postings: [], carriers: [], inquiries: [], outreach: [], spares: [], drafts: [], customers: [], coverLog: [],
  weather: new Map(),          // "city|st" -> alerts[] (filled by store/weather.js)
  carrierRev: 0,               // bumped whenever the carrier list changes (invalidates cached lane depth)
  hooks: { sendToOutlook: null, onWeeklyGoal: null }, // sendToOutlook: set by store/bridge.js when an Outlook folder is connected. onWeeklyGoal: set by main.js (confetti)
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

export async function loadAll(zipFetcher) {
  await db.openDb();
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
  state.carrierRev++;
  await loadZip(zipFetcher);
  state.ready = true;
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
    await savePostings(); emit();
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
    for (const p of state.postings) if (set.has(p.id)) { p.targetRate = r; n++; }
    await savePostings(); emit(); return n;
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
    // 1) log first (if this fails nothing is deleted)
    const goal = weeklyGoalHit({ logBefore: state.coverLog, entry, settings: state.settings, goalWeek: state.counters.goalWeek });
    await guard(() => db.put('coverLog', entry));
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
  /** "Do you have any trucks available?" - one draft per carrier. Returns the saved draft records. */
  async truckCheck(carrierIds) {
    const made = [];
    for (const cid of carrierIds) {
      const c = state.carriers.find(x => x.id === cid); if (!c || !String(c.email || '').trim()) continue;
      made.push({ id: uid(), createdAt: new Date().toISOString(), ...buildTruckCheck(c, state.settings) });
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
  /** Queue drafts for the Outlook macro to save in the Drafts folder (nothing is ever sent). Returns how many were queued. */
  async sendDraftsToOutlook(ids) {
    if (!state.hooks.sendToOutlook) return 0;
    const set = new Set(ids); const list = state.drafts.filter(d => set.has(d.id) && d.to);
    if (!list.length) return 0;
    // DANGER ZONE switches (default off): the macro SENDS instead of saving a draft. Inbound replies additionally need autoSendSafe.
    const inboundKinds = ['Inquiry reply', 'Rate response', 'Carrier reply'];
    for (const d of list) d.send = inboundKinds.includes(d.kind) ? !!(state.settings.autoSendInbound && d.autoSendSafe) : !!state.settings.autoSendOutbound;
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
  async processEmail(mail) {
    const res = processIncomingEmail({ mail, postings: state.postings, inquiries: state.inquiries, settings: state.settings });
    if (res.newInquiry) {
      const q = { id: uid(), ...res.newInquiry }; state.inquiries.push(q); await guard(() => db.put('inquiries', q));
    }
    if (res.inquiryPatch) {
      const q = state.inquiries.find(x => x.id === res.inquiryPatch.id);
      if (q) { Object.assign(q, res.inquiryPatch.patch); await guard(() => db.put('inquiries', q)); }
    }
    if (res.postingPatch) {
      const p = state.postings.find(x => x.id === res.postingPatch.id);
      if (p) { Object.assign(p, res.postingPatch.patch); await savePostings(); }
    }
    if (res.draft) res.draft = await actions.addDraft({ postingId: res.postingPatch?.id, ...res.draft });
    emit();
    return res;
  },

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
