// Cloud accounts and sync. Everything here talks to Firebase over plain HTTPS (REST), so the app stays a no-build, no-dependency
// static site.
//
//   * Accounts: Firebase Authentication (e-mail + password). Anyone with the link can create their own account.
//   * Storage: Firebase Realtime Database, one private branch per person: users/<uid>/. The database rules (database.rules.json)
//     let a signed-in person read and write ONLY their own branch.
//   * IndexedDB stays the working copy on each device (fast, works offline). Every write marks its store "dirty"; a debounced push
//     uploads the whole store; a pull on sign-in, on focus and every minute fetches changes made on another device.
//
// Sync model, in one paragraph: each store (postings, carriers, ...) is saved as one node plus a small random "revision" token under
// users/<uid>/rev/<store>. This device remembers the revision it last synced. If the cloud's token differs and nothing here is unsaved,
// the cloud copy replaces the local one. If both changed, this device's copy wins and the person is told (last writer wins).

import { CLOUD_CONFIG } from '../config.js';
import * as db from './db.js';
import { isEmail, passwordProblem, normEmail, MIN_PASSWORD } from './auth.js';

export { isEmail, passwordProblem, normEmail, MIN_PASSWORD };

export const SYNC_STORES = db.BACKUP_STORES;
const SESSION_KEY = 'fs-cloud-session';
const META_PREFIX = 'fs-sync-';
const LEGACY_FLAG = 'fs-legacy-handled';
const CHUNK = 900000;                       // characters per database string (a single string may not exceed 10 MB; stay far below)
const PUSH_DELAY = 1500;
const POLL_MS = 45000;

/* ------------------------------------------------------------------------------------------------ config */
const cfg = () => ({ ...CLOUD_CONFIG, ...(globalThis.__FS_CLOUD || {}) });
export const enabled = () => { const c = cfg(); return !!(c.apiKey && /^https:\/\/[^/\s]+/.test(String(c.databaseURL || ''))); };
const dbBase = () => String(cfg().databaseURL).replace(/\/+$/, '');
/** Wording for "where is my data" labels. */
export const storedWhere = () => (enabled() ? 'Saved to your account and cached on this device.' : 'Stored only in this browser.');
export const shareUrl = () => cfg().shareUrl || (globalThis.location ? location.origin + location.pathname : '');

export class CloudError extends Error { constructor(message, code = 'error') { super(message); this.code = code; } }

const FRIENDLY = {
  EMAIL_EXISTS: 'An account with that e-mail already exists. Use Sign in instead.',
  INVALID_LOGIN_CREDENTIALS: 'That e-mail and password do not match.',
  INVALID_PASSWORD: 'That e-mail and password do not match.',
  EMAIL_NOT_FOUND: 'That e-mail and password do not match.',
  USER_DISABLED: 'This account has been disabled.',
  INVALID_EMAIL: 'Enter a valid e-mail address.',
  MISSING_PASSWORD: 'Enter your password.',
  WEAK_PASSWORD: `Use at least ${MIN_PASSWORD} characters.`,
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Too many attempts. Wait a few minutes and try again.',
  OPERATION_NOT_ALLOWED: 'E-mail/password sign-in is switched off in the Firebase project (Authentication > Sign-in method > Email/Password > Enable).',
  API_KEY_INVALID: 'The Firebase Web API key in js/config.js is not valid.',
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: 'For security, sign in again and retry.',
};
const AUTH_LOST = new Set(['TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN', 'INVALID_ID_TOKEN', 'CREDENTIAL_MISMATCH', 'MISSING_REFRESH_TOKEN']);
function friendly(msg) {
  const code = String(msg || '').split(/\s*[:(]/)[0].trim();
  if (/API key not valid/i.test(String(msg))) return new CloudError(FRIENDLY.API_KEY_INVALID, 'API_KEY_INVALID');
  return new CloudError(FRIENDLY[code] || 'Something went wrong' + (code ? ' (' + code + ')' : '') + '.', code || 'error');
}
const offlineError = () => new CloudError('Could not reach the server. Check your internet connection.', 'offline');

/* ------------------------------------------------------------------------------------------------ sessions */
let session = null;      // { uid, email, refreshToken, idToken, expiresAt, keep }

const store = (keep) => (keep ? globalThis.localStorage : globalThis.sessionStorage);
function persistSession() {
  if (!session) return;
  const v = JSON.stringify({ uid: session.uid, email: session.email, refreshToken: session.refreshToken });
  try { globalThis.localStorage.removeItem(SESSION_KEY); globalThis.sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
  try { store(session.keep).setItem(SESSION_KEY, v); } catch { /* the person signs in again next time */ }
}
function forgetSession() { session = null; try { globalThis.localStorage.removeItem(SESSION_KEY); globalThis.sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

/** The saved sign-in of this browser, or null. No network: the app opens from the on-device copy even offline. */
export function restoreSession() {
  for (const [st, keep] of [[globalThis.localStorage, true], [globalThis.sessionStorage, false]]) {
    try {
      const v = st && JSON.parse(st.getItem(SESSION_KEY) || 'null');
      if (v && v.uid && v.refreshToken) { session = { uid: v.uid, email: v.email || '', refreshToken: v.refreshToken, idToken: '', expiresAt: 0, keep }; return user(); }
    } catch { /* ignore */ }
  }
  return null;
}
export const user = () => (session ? { uid: session.uid, email: session.email } : null);

async function post(url, body, form = false) {
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' }, body: form ? new URLSearchParams(body).toString() : JSON.stringify(body) });
  } catch { throw offlineError(); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw friendly(j && j.error && (j.error.message || j.error));
  return j;
}
const idt = (method, body) => post(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${encodeURIComponent(cfg().apiKey)}`, body);

function adopt(j, email, keep) {
  session = { uid: j.localId || j.user_id, email: normEmail(email || j.email || (session && session.email) || ''), refreshToken: j.refreshToken || j.refresh_token, idToken: j.idToken || j.id_token, expiresAt: Date.now() + (Number(j.expiresIn || j.expires_in) || 3600) * 1000, keep: keep ?? (session ? session.keep : true) };
  persistSession();
  return user();
}

/** A valid ID token, refreshing it when it is about to expire. Throws CloudError('offline') or ('auth') if it cannot. */
export async function getToken() {
  if (!session) throw new CloudError('Not signed in.', 'auth');
  if (session.idToken && session.expiresAt - Date.now() > 120000) return session.idToken;
  let j;
  try { j = await post(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(cfg().apiKey)}`, { grant_type: 'refresh_token', refresh_token: session.refreshToken }, true); }
  catch (e) { if (e.code === 'offline') throw e; if (AUTH_LOST.has(e.code) || /refresh|token|credential/i.test(e.message)) throw new CloudError('Your sign-in has expired. Please sign in again.', 'auth'); throw e; }
  adopt(j, session.email, session.keep);
  return session.idToken;
}

export async function signUp(email, password, keep = true) {
  if (!enabled()) throw new CloudError('Cloud accounts are not set up for this site yet.', 'config');
  if (!isEmail(email)) throw new CloudError('Enter a valid e-mail address.', 'INVALID_EMAIL');
  const bad = passwordProblem(password); if (bad) throw new CloudError(bad, 'WEAK_PASSWORD');
  const j = await idt('signUp', { email: normEmail(email), password, returnSecureToken: true });
  return adopt(j, email, keep);
}

export async function signIn(email, password, keep = true) {
  if (!enabled()) throw new CloudError('Cloud accounts are not set up for this site yet.', 'config');
  if (!isEmail(email)) throw new CloudError('Enter a valid e-mail address.', 'INVALID_EMAIL');
  const j = await idt('signInWithPassword', { email: normEmail(email), password, returnSecureToken: true });
  return adopt(j, email, keep);
}

export async function sendReset(email) {
  if (!isEmail(email)) throw new CloudError('Enter a valid e-mail address.', 'INVALID_EMAIL');
  await idt('sendOobCode', { requestType: 'PASSWORD_RESET', email: normEmail(email) });
}

/** Sensitive actions re-check the password first (this also gives a fresh token). */
async function reauth(password) {
  if (!session) throw new CloudError('Not signed in.', 'auth');
  const j = await idt('signInWithPassword', { email: session.email, password, returnSecureToken: true });
  adopt(j, session.email, session.keep);
}

export async function changePassword(current, next) {
  const bad = passwordProblem(next); if (bad) throw new CloudError(bad, 'WEAK_PASSWORD');
  await reauth(current);
  const j = await idt('update', { idToken: session.idToken, password: next, returnSecureToken: true });
  adopt(j, session.email, session.keep);
}

/* ------------------------------------------------------------------------------------------------ database (REST) */
async function rtdb(method, path, body, retried = false) {
  const token = await getToken();
  let r;
  try { r = await fetch(`${dbBase()}/${path}.json?auth=${encodeURIComponent(token)}`, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch { throw offlineError(); }
  if ((r.status === 401 || r.status === 403) && !retried) {
    // An expired token reports the same status as a missing rule. Force one refresh before blaming the rules.
    if (session) session.expiresAt = 0;
    return rtdb(method, path, body, true);
  }
  if (r.status === 401 || r.status === 403) throw new CloudError('The database refused access. In the Firebase console, publish the rules from database.rules.json (see docs/CLOUD-SETUP.md).', 'rules');
  if (r.status === 404) throw new CloudError('The database URL in js/config.js was not found. Copy it exactly from Firebase > Realtime Database.', 'config');
  if (!r.ok) throw new CloudError('The database answered with an error (' + r.status + ').', 'server');
  return r.json().catch(() => null);
}

/** Rows -> { n, p0, p1, ... } (a JSON text split into pieces the database accepts). Splitting never cuts an emoji in half. */
export function packRows(rows) {
  const text = JSON.stringify(rows);
  const node = { n: 0, count: rows.length };
  for (let i = 0; i < text.length || i === 0;) {
    let end = Math.min(i + CHUNK, text.length);
    if (end < text.length) { const c = text.charCodeAt(end - 1); if (c >= 0xd800 && c <= 0xdbff) end--; }
    node['p' + node.n++] = text.slice(i, end); i = end;
    if (i >= text.length) break;
  }
  return node;
}
export function unpackRows(node, keyPath) {
  if (!node || typeof node !== 'object' || !(node.n >= 1)) throw new CloudError('A saved list in the cloud is damaged.', 'damaged');
  let text = '';
  for (let i = 0; i < node.n; i++) { if (typeof node['p' + i] !== 'string') throw new CloudError('A saved list in the cloud is incomplete.', 'damaged'); text += node['p' + i]; }
  const rows = JSON.parse(text);
  if (!Array.isArray(rows) || rows.some((r) => r === null || typeof r !== 'object' || (keyPath && r[keyPath] === undefined))) throw new CloudError('A saved list in the cloud is damaged.', 'damaged');
  return rows;
}

/** The sign-in record of the legacy local account and the first-run prompt never leave this device. */
const scrubKv = (rows) => rows.map((r) => (r && r.key === 'settings' && r.value && typeof r.value === 'object' ? { ...r, value: Object.fromEntries(Object.entries(r.value).filter(([k]) => k !== 'account' && k !== 'accountPrompt')) } : r));

/* ------------------------------------------------------------------------------------------------ sync state */
const S = { started: false, dirty: new Set(), version: {}, flushing: false, pulling: false, timer: null, retry: null, poll: null, status: 'off', detail: '', lastSync: 0, listeners: new Set(), hooks: {} };

function emitStatus(status, detail = '') { S.status = status; S.detail = detail; for (const fn of S.listeners) { try { fn(getStatus()); } catch (e) { console.error(e); } } }
export const getStatus = () => ({ status: S.status, detail: S.detail, lastSync: S.lastSync, pending: S.dirty.size });
export const onStatus = (fn) => { S.listeners.add(fn); return () => S.listeners.delete(fn); };
/** hooks: { onRemoteChange(stores), onConflict(stores), onAuthLost() } */
export const setHooks = (h) => { S.hooks = { ...S.hooks, ...h }; };

const metaKey = () => META_PREFIX + session.uid;
function metaRead() {
  let m = null; try { m = JSON.parse(globalThis.localStorage.getItem(metaKey()) || 'null'); } catch { /* ignore */ }
  return { token: '', base: {}, dirty: [], ...(m || {}) };
}
function metaWrite(m) { try { globalThis.localStorage.setItem(metaKey(), JSON.stringify(m)); } catch { /* storage blocked: sync still works for this session */ } }
function metaUpdate(fn) { const m = metaRead(); fn(m); metaWrite(m); return m; }

/** Point the on-device database at this person's own copy. Call once after sign-in, before loadAll(). */
export async function activate() {
  if (!session) throw new CloudError('Not signed in.', 'auth');
  db.setDbName('freight-signal-u-' + session.uid);
  await db.openDb();
  // The localStorage record and the IndexedDB copy must belong together. If the database was wiped (site data cleared in part), the
  // old revisions no longer describe it, so forget them and download everything again instead of uploading an empty copy.
  const m = metaRead();
  const mark = await db.get('handles', 'sync-token');
  if (!m.token || !mark || mark.value !== m.token) {
    const token = (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    metaWrite({ token, base: {}, dirty: [] });
    await db.put('handles', { key: 'sync-token', value: token });
  }
  S.dirty = new Set(metaRead().dirty);
  return user();
}

const newRev = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());

/**
 * First sync after sign-in. On a device that has never synced this account, download the cloud copy BEFORE the app draws, so the
 * person sees their data straight away. Returns { fresh } = true for a brand-new account with nothing anywhere.
 */
export async function initialSync() {
  const m = metaRead();
  if (Object.keys(m.base).length) return { fresh: false };
  const rev = (await rtdb('GET', `users/${session.uid}/rev`)) || {};
  const remoteEmpty = Object.keys(rev).length === 0;
  const localRows = {};
  for (const s of SYNC_STORES) localRows[s] = (await db.getAll(s)).length;
  const localEmpty = Object.values(localRows).every((n) => n === 0);
  if (!remoteEmpty) await pull(rev, true);
  // Anything on this device that the cloud has never seen (written before the first sync) is queued for upload.
  for (const s of SYNC_STORES) if (rev[s] === undefined && localRows[s] > 0) markDirty(s);
  return { fresh: remoteEmpty && localEmpty };
}

/* ---- old data: the database that existed before accounts ('freight-signal') */
export const legacyHandled = () => { try { return !!globalThis.localStorage.getItem(LEGACY_FLAG); } catch { return true; } };
export const markLegacyHandled = () => { try { globalThis.localStorage.setItem(LEGACY_FLAG, session ? session.uid : '1'); } catch { /* ignore */ } };
/** { postings, carriers, ... } counts when this browser holds data from before accounts existed, else null. */
export async function legacySummary() {
  const rows = await db.readLegacyLocal(); if (!rows) return null;
  const counts = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v.length]));
  const any = ['postings', 'carriers', 'inquiries', 'spares', 'customers', 'coverLog'].some((k) => counts[k] > 0);
  return any ? counts : null;
}
export async function importLegacy() {
  const rows = await db.readLegacyLocal(); if (!rows) return 0;
  rows.kv = scrubKv(rows.kv || []);
  let n = 0;
  for (const s of SYNC_STORES) { await db.replaceAllQuiet(s, rows[s] || []); n += (rows[s] || []).length; markDirty(s); }
  return n;
}

/* ---- dirty tracking and push */
function markDirty(store) {
  if (!SYNC_STORES.includes(store)) return;
  S.dirty.add(store); S.version[store] = (S.version[store] || 0) + 1;
  metaUpdate((m) => { m.dirty = [...new Set([...m.dirty, store])]; });
}

export async function flush() {
  if (!session || S.flushing || !S.dirty.size) return;
  clearTimeout(S.timer); clearTimeout(S.retry);
  S.flushing = true; emitStatus('saving');
  try {
    const stores = [...S.dirty]; const snap = Object.fromEntries(stores.map((s) => [s, S.version[s] || 0]));
    const base = metaRead().base;
    const rev = (await rtdb('GET', `users/${session.uid}/rev`)) || {};
    const conflicts = stores.filter((s) => rev[s] !== undefined && rev[s] !== base[s]);
    const body = {}; const tokens = {};
    for (const s of stores) {
      let rows = await db.getAll(s); if (s === 'kv') rows = scrubKv(rows);
      body['stores/' + s] = packRows(rows); tokens[s] = newRev(); body['rev/' + s] = tokens[s];
    }
    await rtdb('PATCH', `users/${session.uid}`, body);
    metaUpdate((m) => { for (const s of stores) { m.base[s] = tokens[s]; if ((S.version[s] || 0) === snap[s]) m.dirty = m.dirty.filter((x) => x !== s); } });
    for (const s of stores) if ((S.version[s] || 0) === snap[s]) S.dirty.delete(s);
    S.lastSync = Date.now();
    if (conflicts.length && S.hooks.onConflict) S.hooks.onConflict(conflicts);
    emitStatus(S.dirty.size ? 'saving' : 'synced');
    if (S.dirty.size) schedulePush();
  } catch (e) { fail(e, () => flushLater(e.code === 'offline' ? 15000 : 60000)); }
  finally { S.flushing = false; }
}
const schedulePush = () => { clearTimeout(S.timer); S.timer = setTimeout(() => { flush(); }, PUSH_DELAY); };
const flushLater = (ms) => { clearTimeout(S.retry); S.retry = setTimeout(() => { flush(); }, ms); };

function fail(e, again) {
  if (e && e.code === 'auth') { emitStatus('error', e.message); if (S.hooks.onAuthLost) S.hooks.onAuthLost(e); return; }
  if (e && e.code === 'offline') emitStatus('offline', S.dirty.size ? 'Changes are saved on this device and will upload when you are back online.' : 'Offline.');
  else emitStatus('error', (e && e.message) || String(e));
  if (!(e && e.code === 'offline') || S.dirty.size) { try { again && again(); } catch { /* ignore */ } }
}

/* ---- pull */
export async function pull(knownRev, initial = false) {
  if (!session || S.pulling) return [];
  S.pulling = true; const changed = [];
  try {
    const rev = knownRev || (await rtdb('GET', `users/${session.uid}/rev`)) || {};
    const base = metaRead().base;
    for (const s of SYNC_STORES) {
      if (rev[s] === undefined || rev[s] === base[s]) continue;
      if (S.dirty.has(s)) continue;                                  // both sides changed: this device wins when it uploads
      const node = await rtdb('GET', `users/${session.uid}/stores/${s}`);
      let rows = unpackRows(node, db.STORES[s].keyPath);
      if (s === 'kv') rows = scrubKv(rows);
      await db.replaceAllQuiet(s, rows);
      metaUpdate((m) => { m.base[s] = rev[s]; });
      changed.push(s);
    }
    S.lastSync = Date.now();
    if (!S.dirty.size) emitStatus('synced');
    if (changed.length && !initial && S.hooks.onRemoteChange) await S.hooks.onRemoteChange(changed);
  } catch (e) { fail(e); }
  finally { S.pulling = false; }
  return changed;
}

/** Begin background syncing (call after the app has drawn). */
export function start() {
  if (S.started || !session) return;
  S.started = true;
  db.onWrite((store) => { if (session && SYNC_STORES.includes(store)) { markDirty(store); schedulePush(); emitStatus('saving'); } });
  const tick = async () => { if (!session || document.hidden) return; await pull(); if (S.dirty.size) await flush(); };
  S.poll = setInterval(tick, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { flush(); } else { tick(); } });
  globalThis.addEventListener('online', () => { tick(); });
  globalThis.addEventListener('pagehide', () => { flush(); });
  emitStatus(S.dirty.size ? 'saving' : 'synced');
  (async () => { await pull(); if (S.dirty.size) await flush(); })();
}

export async function syncNow() { await pull(); await flush(); return getStatus(); }

/* ------------------------------------------------------------------------------------------------ sign out / delete */
async function leave({ clearDevice }) {
  const uid = session && session.uid;
  S.dirty.clear(); clearTimeout(S.timer); clearTimeout(S.retry); clearInterval(S.poll);
  forgetSession();
  if (clearDevice && uid) {
    try { globalThis.localStorage.removeItem(META_PREFIX + uid); } catch { /* ignore */ }
    await db.deleteDatabase('freight-signal-u-' + uid);
  }
}

/** Upload anything still unsaved (up to ~6 s), then sign out. clearDevice also removes this device's copy of the data. */
export async function signOut({ clearDevice = false } = {}) {
  if (session && S.dirty.size) { await Promise.race([flush(), new Promise((r) => setTimeout(r, 6000))]); }
  if (clearDevice && S.dirty.size) throw new CloudError('Some changes have not been uploaded yet, so this device\'s copy was kept. Connect to the internet and try again.', 'pending');
  await leave({ clearDevice });
}

/** Permanently delete the account and everything saved in the cloud. */
export async function deleteAccount(password) {
  await reauth(password);
  await rtdb('DELETE', `users/${session.uid}`);
  await idt('delete', { idToken: session.idToken });
  await leave({ clearDevice: true });
}

/** Forget the session without trying to sync (used when the sign-in was revoked elsewhere). */
export async function dropSession() { await leave({ clearDevice: false }); }
