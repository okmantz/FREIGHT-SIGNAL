// IndexedDB wrapper: the on-device copy of the workspace (fast, works offline). With cloud accounts switched on, every write
// is also announced through onWrite() so store/cloud.js can save it to the person's account; the database is then named per
// user (setDbName) so two people on one computer never see each other's data.
// Stores: postings, carriers, inquiries, outreach, spares, drafts, kv (settings/counters), zipmap (raw CSV text), handles (bridge folder).

export const DB_NAME = 'freight-signal';
export const DB_VERSION = 3;
export const STORES = {
  postings: { keyPath: 'id' },
  carriers: { keyPath: 'id' },
  inquiries: { keyPath: 'id' },
  outreach: { keyPath: 'key' },
  spares: { keyPath: 'id' },
  drafts: { keyPath: 'id' },
  kv: { keyPath: 'key' },
  zipmap: { keyPath: 'key' },
  customers: { keyPath: 'id' },  // v3: customer contact database
  coverLog: { keyPath: 'id' },   // v3: attribution log of covered / expired / manually closed loads
  handles: { keyPath: 'key' },   // v2: Outlook-bridge folder handle (never exported in backups)
};

export const BACKUP_STORES = ['postings', 'carriers', 'inquiries', 'outreach', 'spares', 'drafts', 'kv', 'customers', 'coverLog'];

let dbPromise = null;
let activeName = DB_NAME;

/** Which database the rest of this module reads and writes. Switching closes the previous connection. */
export function setDbName(name) {
  if (name === activeName) return;
  if (dbPromise) dbPromise.then((d) => d.close()).catch(() => {});
  dbPromise = null; activeName = name;
}
export const currentDbName = () => activeName;

/** Observers told after every committed write: fn(storeName). Used by the cloud sync; never throws into the writer. */
const writeListeners = new Set();
export const onWrite = (fn) => { writeListeners.add(fn); return () => writeListeners.delete(fn); };
const notify = (store) => { for (const fn of writeListeners) { try { fn(store); } catch (e) { console.error(e); } } };

export function openDb(factory = globalThis.indexedDB, name = activeName) {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('IndexedDB is not available in this browser context.')); return; }
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [s, opts] of Object.entries(STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, opts);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked by another open tab. Close other Freight Signal tabs and reload.'));
  });
  return dbPromise;
}

const tx = async (store, mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    try { result = fn(s); } catch (e) { reject(e); return; }
    // fn may return an IDBRequest (read ops) or nothing (write ops). A missing key must resolve to undefined, not the request.
    t.oncomplete = () => resolve(result && typeof result === 'object' && 'readyState' in result ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  });
};

export const getAll = (store) => tx(store, 'readonly', (s) => s.getAll());
export const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const put = (store, obj) => tx(store, 'readwrite', (s) => { s.put(obj); }).then((r) => { notify(store); return r; });
export const putMany = (store, objs) => tx(store, 'readwrite', (s) => { for (const o of objs) s.put(o); }).then((r) => { notify(store); return r; });
export const del = (store, key) => tx(store, 'readwrite', (s) => { s.delete(key); }).then((r) => { notify(store); return r; });
export const clear = (store) => tx(store, 'readwrite', (s) => { s.clear(); }).then((r) => { notify(store); return r; });

/** Replace the whole contents of a store in ONE transaction (all-or-nothing). */
export const replaceAll = (store, objs) => tx(store, 'readwrite', (s) => { s.clear(); for (const o of objs) s.put(o); }).then((r) => { notify(store); return r; });
/** Same, but NOT announced to onWrite(): used when the rows came FROM the cloud, so they are not sent straight back. */
export const replaceAllQuiet = (store, objs) => tx(store, 'readwrite', (s) => { s.clear(); for (const o of objs) s.put(o); });

export async function kvGet(key, fallback) {
  const r = await get('kv', key);
  return r ? r.value : fallback;
}
export const kvSet = (key, value) => put('kv', { key, value });

/** Snapshot of everything except the (large, re-importable) ZIP map. */
export async function exportAll() {
  const out = { app: 'freight-signal', schema: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const s of BACKUP_STORES) out.data[s] = await getAll(s);
  return out;
}

/** Restore from exportAll() output. mode: 'replace' wipes first; 'merge' upserts by key. Validates before touching anything. */
export async function importAll(snapshot, mode = 'replace') {
  if (!snapshot || snapshot.app !== 'freight-signal' || !snapshot.data) throw new Error('This file is not a Freight Signal backup.');
  if (snapshot.schema !== 1) throw new Error('Unsupported backup schema version: ' + snapshot.schema);
  for (const s of BACKUP_STORES) {
    if (snapshot.data[s] !== undefined && !Array.isArray(snapshot.data[s])) throw new Error(`Backup is damaged: "${s}" is not a list.`);
  }
  for (const s of Object.keys(snapshot.data)) {
    if (!STORES[s]) continue;
    const rows = snapshot.data[s];
    const kp = STORES[s].keyPath;
    if (rows.some(r => r === null || typeof r !== 'object' || r[kp] === undefined)) throw new Error(`Backup is damaged: a "${s}" record has no "${kp}".`);
  }
  for (const s of Object.keys(snapshot.data)) {
    if (!STORES[s]) continue;
    if (mode === 'replace') await replaceAll(s, snapshot.data[s]); else await putMany(s, snapshot.data[s]);
  }
}

/** Rows of the pre-accounts database ('freight-signal') if this browser has one, else null. Read-only; never creates it. */
export async function readLegacyLocal(factory = globalThis.indexedDB) {
  if (!factory || typeof factory.databases !== 'function') return null;
  try { if (!(await factory.databases()).some((d) => d.name === DB_NAME)) return null; } catch { return null; }
  let legacy;
  try {
    legacy = await new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME);
      req.onupgradeneeded = () => { try { req.transaction.abort(); } catch { /* ignore */ } };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
  } catch { return null; }
  try {
    const out = {};
    for (const s of BACKUP_STORES) {
      if (!legacy.objectStoreNames.contains(s)) { out[s] = []; continue; }
      out[s] = await new Promise((resolve, reject) => { const r = legacy.transaction(s, 'readonly').objectStore(s).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    }
    return out;
  } catch { return null; } finally { legacy.close(); }
}

/** Delete a whole database (used by "sign out and remove this device's copy"). */
export async function deleteDatabase(name, factory = globalThis.indexedDB) {
  if (name === activeName && dbPromise) { try { (await dbPromise).close(); } catch { /* ignore */ } dbPromise = null; }
  await new Promise((resolve) => { const r = factory.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
}

export async function wipeAll(includeZip = false) {
  for (const s of Object.keys(STORES)) if (s === 'handles') continue; else if (s !== 'zipmap' || includeZip) await clear(s);
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* ignore */ }
  return null;
}
