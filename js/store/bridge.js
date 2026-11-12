// Outlook bridge (browser side). Keeps the shared folder in sync using the File System Access API (Chrome / Edge).
// The folder handle is remembered in IndexedDB; after a browser restart Chrome may ask the user to re-grant access
// (one click on "Reconnect"). Nothing is uploaded anywhere: the files only ever land in the folder you picked.

import * as db from './db.js';
import { state, subscribe, actions } from './state.js';
import { FILES, postingsFile, postingsFingerprint, configFile, inquiriesHeader, foldInquiryEvents, parseStatus, planInquirySync, outboxFile, parseDraftsDone } from '../core/bridge.js';

export const bridge = {
  supported: typeof globalThis.showDirectoryPicker === 'function',
  connected: false,          // we hold a handle AND have read/write permission
  needsPermission: false,    // handle remembered, permission must be re-granted by a click
  folderName: '',
  lastWrite: '',             // ISO time the postings feed was last written
  postingsWritten: 0,
  lastSync: '',              // ISO time the inquiry log was last read
  eventsSeen: 0,
  outlook: null,             // parsed status file, or null if Outlook has never reported
  draftsPending: 0,          // drafts waiting in the outbox for the macro to save into Outlook Drafts
  draftsSaved: 0,            // drafts the macro has confirmed this session
  error: '',
};

let handle = null, timer = null, writeTimer = null, lastFingerprint = '', lastConfig = '', lastInqSig = '', lastSig = '', lastOutboxSig = '', lastDoneSig = '', started = false, busy = false;
const listeners = new Set();
export const onBridge = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

async function fileHandle(name, create) { return handle.getFileHandle(name, { create }); }
async function writeText(name, text) {
  const fh = await fileHandle(name, true);
  const w = await fh.createWritable(); await w.write(text); await w.close();
}
async function readText(name) {
  try { const fh = await fileHandle(name, false); const f = await fh.getFile(); return { text: await f.text(), modified: f.lastModified, size: f.size }; }
  catch (e) { if (e && e.name === 'NotFoundError') return null; throw e; }
}

const pendingDrafts = () => state.drafts.filter(d => d.outlook === 'queued' && d.to).map(d => ({ ...d, outboxId: d.id }));

/** Rewrite freight-signal-outbox.tsv with the drafts that are still waiting (only when that list changed). */
async function writeOutbox(force = false) {
  if (!handle || !bridge.connected) return;
  const pend = pendingDrafts();
  bridge.draftsPending = pend.length;
  const sig = pend.map(d => d.id).join(',');
  if (!force && sig === lastOutboxSig) return;
  if (!sig && !lastOutboxSig && !force) return;
  await writeText(FILES.outbox, outboxFile(pend));
  lastOutboxSig = sig;
}

/** Hook used by actions.sendDraftsToOutlook: queue these drafts for the macro. Returns how many were queued. */
async function sendToOutlook(list) {
  if (!handle || !bridge.connected) return 0;
  for (const d of list) d.outlook = 'queued';
  await writeOutbox(true);
  notify();
  return list.length;
}

/** Write feeds if (and only if) something changed. Safe to call often. */
export async function writeNow(force = false) {
  if (!handle || !bridge.connected) return false;
  if (busy) { setTimeout(() => writeNow(force), 300); return false; }
  busy = true;
  try {
    const fp = postingsFingerprint(state.postings);
    const cfg = configFile(state.settings);
    if (force || fp !== lastFingerprint) {
      await writeText(FILES.postings, postingsFile(state.postings));
      lastFingerprint = fp; bridge.lastWrite = new Date().toISOString(); bridge.postingsWritten = state.postings.filter(p => String(p.status ?? 'Active').toLowerCase() !== 'covered').length;
    }
    if (force || cfg !== lastConfig) { await writeText(FILES.config, cfg); lastConfig = cfg; }
    // Make sure the Outlook->app log exists with its header so the macro can simply append.
    if (!(await readText(FILES.inquiries))) await writeText(FILES.inquiries, inquiriesHeader());
    await writeOutbox(force);
    bridge.error = '';
    return true;
  } catch (e) { bridge.error = 'Could not write to the bridge folder: ' + (e.message || e); return false; }
  finally { busy = false; notify(); }
}

/** Read Outlook's inquiry log + heartbeat and apply anything new. */
export async function pollNow() {
  if (!handle || !bridge.connected) return 0;
  let applied = 0;
  try {
    const st = await readText(FILES.status);
    bridge.outlook = st ? parseStatus(st.text) : null;
    const inq = await readText(FILES.inquiries);
    if (inq) {
      const sig = inq.size + ':' + inq.modified;
      if (sig !== lastInqSig) {
        const records = foldInquiryEvents(inq.text);
        bridge.eventsSeen = records.length;
        applied = await actions.applyBridgeInquiries(planInquirySync(records, state.inquiries, state.postings));
        lastInqSig = sig;
      }
    }
    // Which queued drafts has Outlook saved (or failed)? Mark them and shrink the outbox.
    const dn = await readText(FILES.draftsDone);
    if (dn) {
      const dsig = dn.size + ':' + dn.modified;
      if (dsig !== lastDoneSig) {
        lastDoneSig = dsig;
        const done = parseDraftsDone(dn.text);
        const results = [];
        for (const d of state.drafts) { const r = d.outlook === 'queued' ? done.get(d.id) : null; if (r) results.push({ id: d.id, ok: r.ok, detail: r.detail }); }
        if (results.length) { await actions.markDraftsDone(results); bridge.draftsSaved += results.filter(r => r.ok).length; applied += results.length; await writeOutbox(true); }
      }
    }
    bridge.draftsPending = pendingDrafts().length;
    bridge.lastSync = new Date().toISOString(); bridge.error = '';
  } catch (e) { bridge.error = 'Could not read the bridge folder: ' + (e.message || e); }
  // Only repaint the System page when something visible changed (a poll every 3 s must not rebuild the page).
  const sig = [bridge.outlook && bridge.outlook.lastSeen, bridge.outlook && bridge.outlook.lastEvent, bridge.eventsSeen, bridge.error, bridge.connected, bridge.draftsPending, bridge.draftsSaved, applied].join('|');
  if (sig !== lastSig) { lastSig = sig; notify(); }
  return applied;
}

function startLoops() {
  if (timer) return;
  timer = setInterval(() => { if (!document.hidden) pollNow(); }, 3000);
  subscribe(() => { clearTimeout(writeTimer); writeTimer = setTimeout(() => writeNow(false), 400); });
}

async function adopt(h, { persist }) {
  handle = h; bridge.folderName = h.name || '(folder)';
  bridge.connected = true; bridge.needsPermission = false;
  if (persist) await db.put('handles', { key: 'bridge', handle: h });
  lastFingerprint = ''; lastConfig = ''; lastInqSig = ''; lastOutboxSig = ''; lastDoneSig = '';
  state.hooks.sendToOutlook = sendToOutlook;
  await writeNow(true); await pollNow(); startLoops();
}

/** Test / advanced hook: use any FileSystemDirectoryHandle (e.g. OPFS in the e2e tests). */
export async function useHandle(h) { await adopt(h, { persist: false }); }

/** User picks the folder (must be called from a click). */
export async function connect() {
  if (!bridge.supported) throw new Error('This browser cannot share a folder with Outlook. Use Chrome or Edge.');
  const h = await globalThis.showDirectoryPicker({ id: 'freight-signal-bridge', mode: 'readwrite', startIn: 'documents' });
  await adopt(h, { persist: true });
}

/** Re-grant access to the remembered folder (must be called from a click). */
export async function reconnect() {
  if (!handle) return connect();
  const p = await handle.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') { bridge.error = 'Permission was not granted.'; notify(); return; }
  await adopt(handle, { persist: false });
}

export async function disconnect() {
  state.hooks.sendToOutlook = null;
  handle = null; bridge.connected = false; bridge.needsPermission = false; bridge.folderName = ''; bridge.outlook = null;
  await db.del('handles', 'bridge'); notify();
}

/** Called once at boot: restore the remembered folder if the browser still lets us use it. */
export async function initBridge() {
  if (started) return; started = true;
  if (!bridge.supported) return;
  try {
    const rec = await db.get('handles', 'bridge');
    if (!rec || !rec.handle) return;
    handle = rec.handle; bridge.folderName = handle.name || '(folder)';
    const perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') await adopt(handle, { persist: false });
    else { bridge.needsPermission = true; notify(); }
  } catch (e) { bridge.error = String(e.message || e); notify(); }
}

export const outlookConnected = () => !!(bridge.outlook && bridge.outlook.lastSeen && Date.now() - new Date(bridge.outlook.lastSeen).getTime() < 36 * 3600 * 1000);
