// In-memory application state with write-through persistence. UI reads `state`, mutations go through `actions`.

import * as db from './db.js';
import { DEFAULT_SETTINGS, CARRIER_KEYS, INQUIRY_KEYS } from '../core/defaults.js';
import { ZipMap } from '../core/zipmap.js';
import { targetForPriority, blankPosting, reindex, initializeLoadControls, reconcileManualLane, coverPosting, setGroupPriority, setGroupStatus, groupMembers, countAlternates } from '../core/model.js';
import { planMatrix, applyMatrix, hasAlternates } from '../core/matrix.js';
import { planExcelOutreach, planOutlookScan } from '../core/outreach.js';
import { processIncomingEmail } from '../core/inbound.js';
import { todayKey, uid, safeNumeric, normalizeText } from '../core/util.js';
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
  postings: [], carriers: [], inquiries: [], outreach: [], spares: [], drafts: [],
  counters: { lifetimeCovers: 0, coversToday: 0, coversTodayDate: todayKey() },
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
    const p = blankPosting({ ...fields, variant: 'Original', targetRate: extras.targetRate ?? '' });
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
  /** Set (or clear, with '') the DAT-posted rate on specific postings. This is NOT the target rate (emails only). */
  async setDatRate(ids, rate) {
    const r = cleanRate(rate); const set = new Set(ids);
    let n = 0;
    for (const p of state.postings) if (set.has(p.id)) { p.datRate = r; n++; }
    await savePostings(); emit(); return n;
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
  /** Status change. Covered removes the whole group (Workbook_SheetChange -> DeleteEntireLoadGroup). */
  async setStatus(id, status) {
    const p = state.postings.find(x => x.id === id); if (!p) return { removed: 0 };
    if (String(status).toLowerCase() === 'covered') {
      const { remaining, removed } = coverPosting(state.postings, id);
      state.postings = remaining;
      const today = todayKey();
      if (state.counters.coversTodayDate !== today) { state.counters.coversTodayDate = today; state.counters.coversToday = 0; }
      state.counters.coversToday += 1; state.counters.lifetimeCovers += 1; // inferred: see docs/OPEN-QUESTIONS.md
      await savePostings(); await saveCounters(); emit();
      return { removed: removed.length };
    }
    if (p.groupId) setGroupStatus(state.postings, p.groupId, 'Active'); else p.status = 'Active';
    await savePostings(); emit();
    return { removed: 0 };
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
    const plan = planMatrix({ source: copy, zipMap: state.zip, inquiries: state.inquiries, settings: state.settings });
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
  async runOutreach(id) {
    const p = state.postings.find(x => x.id === id); if (!p) return null;
    let res;
    if (state.settings.outreachButtonMode === 'outlook') {
      const clone = [{ ...p, status: 'Active', outreach: 'Yes' }];
      const scan = planOutlookScan(clone, state.carriers, state.outreach, state.settings);
      res = { drafts: scan.drafts, created: scan.drafts.length, attempted: scan.drafts.length, detail: 'Outlook-engine lane scan: ' + scan.drafts.length + ' new draft(s) (max ' + state.settings.maxCarriersPerLoad + ' per load; already-drafted carriers skipped).' };
      if (scan.logEntries.length) { state.outreach.push(...scan.logEntries); await guard(() => db.putMany('outreach', scan.logEntries)); p.outreachCount = state.outreach.filter(o => o.postingId === p.id).length; }
    } else {
      res = planExcelOutreach(p, state.carriers, state.settings);
    }
    const stamped = res.drafts.map(d => ({ id: uid(), createdAt: new Date().toISOString(), postingId: p.id, kind: 'Carrier outreach', ...d }));
    state.drafts.unshift(...stamped);
    await guard(() => db.putMany('drafts', stamped));
    p.draftsCreated = res.created; p.lastRun = new Date().toISOString(); p.result = res.detail; p.outreach = 'No'; // macro resets to "No"
    await savePostings(); emit();
    return { ...res, drafts: stamped };
  },
  /** Outlook-engine scan over all eligible loads (Active + Carrier Outreach = Yes). */
  async runOutlookScan() {
    const scan = planOutlookScan(state.postings, state.carriers, state.outreach, state.settings);
    const stamped = scan.drafts.map(d => ({ id: uid(), createdAt: new Date().toISOString(), kind: 'Carrier outreach (scan)', ...d }));
    state.drafts.unshift(...stamped); state.outreach.push(...scan.logEntries);
    for (const [pid, n] of scan.countUpdates) {
      const p = state.postings.find(x => x.id === pid);
      if (p) p.outreachCount = state.outreach.filter(o => o.postingId === pid).length;
    }
    await guard(async () => { await db.putMany('drafts', stamped); await db.putMany('outreach', scan.logEntries); });
    await savePostings(); emit();
    return { ...scan, drafts: stamped };
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
    await guard(() => db.put('carriers', c)); emit(); return c;
  },
  async deleteCarrier(id) { state.carriers = state.carriers.filter(c => c.id !== id); await guard(() => db.del('carriers', id)); emit(); },
  async importCarriers(rows, mode = 'append') {
    const recs = rows.map(r => ({ id: uid(), ...r }));
    if (mode === 'replace') state.carriers = recs; else state.carriers.push(...recs);
    await guard(() => (mode === 'replace' ? db.replaceAll('carriers', state.carriers) : db.putMany('carriers', recs))); emit(); return recs.length;
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

  // ---------- counters ----------
  async setCounters(patch) { state.counters = { ...state.counters, ...patch }; await saveCounters(); emit(); },

  // ---------- backup / restore ----------
  async exportBackup() { return db.exportAll(); },
  async restoreBackup(snapshot, mode = 'replace') {
    await db.importAll(snapshot, mode);
    const keepZip = state.zip;
    await loadAll();
    if (!state.zip && keepZip) state.zip = keepZip;
    emit();
  },
  async wipe() { await db.wipeAll(false); await loadAll(); },
};

export { parseTqlLoad, countAlternates, safeNumeric, INQUIRY_KEYS };
