// Local accounts: several people can each have an account (e-mail + password) on the SAME computer, with no server and no
// Firebase. Each account owns its own on-device database, so loads, carriers, customers and settings are never mixed.
// Used when cloud accounts (js/config.js) are not set up. Honest limits, also stated in the UI: the data lives only in this browser
// on this computer (use System > Download backup to keep or move a copy), and the password is a door lock, not encryption.
//
// The password is never stored, only a salted PBKDF2-SHA256 hash (store/auth.js). The account list lives in localStorage; the
// signed-in marker lives in localStorage ("keep me signed in") or sessionStorage.
//
// Upgrade path: a browser that used the single-account version keeps its data. Its old sign-in (stored inside the old database)
// still works, and that database simply becomes that account's database.

import * as db from './db.js';
import { makeAccount, checkPassword, isEmail, normEmail, passwordProblem, cryptoReady, MIN_PASSWORD } from './auth.js';

export { isEmail, passwordProblem, normEmail, MIN_PASSWORD };

const REG = 'fs-local-accounts';
const SESSION = 'fs-local-session';
let current = null;   // { id, email, db }

const mismatch = () => new Error('That e-mail and password do not match.');
function readReg() { try { const r = JSON.parse(globalThis.localStorage.getItem(REG) || 'null'); return r && Array.isArray(r.accounts) ? r : { v: 1, accounts: [] }; } catch { return { v: 1, accounts: [] }; } }
function writeReg(r) { try { globalThis.localStorage.setItem(REG, JSON.stringify(r)); } catch { throw new Error('This browser is blocking storage, so an account cannot be saved here. Use a normal Chrome or Edge window.'); } }
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');

/** The single account of the previous version (its record lives in the old database), and whether that database holds data. */
async function legacy() {
  const rows = await db.readLegacyLocal();
  if (!rows) return { account: null, hasData: false };
  const settings = (rows.kv || []).find((r) => r.key === 'settings');
  const account = settings && settings.value && settings.value.account && settings.value.account.hash ? settings.value.account : null;
  const hasData = ['postings', 'carriers', 'inquiries', 'spares', 'customers', 'coverLog', 'drafts'].some((k) => (rows[k] || []).length > 0);
  return { account, hasData };
}
const legacyClaimed = (reg) => reg.accounts.some((a) => a.db === db.DB_NAME);

/** Which tab the sign-in screen should open on: sign in when this computer already has accounts, otherwise create. */
export async function startMode() {
  if (readReg().accounts.length) return 'signin';
  const l = await legacy();
  return l.account ? 'signin' : 'create';
}

function setCurrent(entry, keep) {
  current = { id: entry.id, email: entry.email, db: entry.db };
  try { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); } catch { /* storage blocked */ }
  try { (keep ? localStorage : sessionStorage).setItem(SESSION, JSON.stringify({ id: entry.id })); } catch { /* the person signs in again next time */ }
  return user();
}

/** The saved sign-in of this browser, or null. */
export function restoreSession() {
  const reg = readReg();
  for (const st of [globalThis.localStorage, globalThis.sessionStorage]) {
    try { const s = st && JSON.parse(st.getItem(SESSION) || 'null'); const e = s && reg.accounts.find((a) => a.id === s.id); if (e) { current = { id: e.id, email: e.email, db: e.db }; return user(); } } catch { /* ignore */ }
  }
  return null;
}
export const user = () => (current ? { id: current.id, email: current.email } : null);

export async function signUp(email, password, keep = true) {
  if (!cryptoReady()) throw new Error('This browser cannot create a secure password here (it needs https or localhost). Open the app from its https address.');
  if (!isEmail(email)) throw new Error('Enter a valid e-mail address.');
  const bad = passwordProblem(password); if (bad) throw new Error(bad);
  const reg = readReg(); const em = normEmail(email);
  if (reg.accounts.some((a) => a.email === em)) throw new Error('An account with that e-mail already exists on this computer. Use Sign in.');
  let dbName = 'freight-signal-l-' + rid();
  if (!reg.accounts.length) {
    const l = await legacy();
    if (l.account && l.account.email === em) throw new Error('This computer already has an account for that e-mail. Use Sign in with your existing password.');
    // Data saved before accounts existed (and no one's sign-in on it) becomes the first account's data.
    if (!l.account && l.hasData && !legacyClaimed(reg)) dbName = db.DB_NAME;
  }
  const entry = { id: rid(), ...(await makeAccount(em, password)), db: dbName };
  reg.accounts.push(entry); writeReg(reg);
  return setCurrent(entry, keep);
}

/** Registers the previous version's account (and its database) the first time its owner signs in. */
async function adoptLegacy(em, password) {
  const reg = readReg(); if (legacyClaimed(reg)) return null;
  const l = await legacy();
  if (!l.account || l.account.email !== em || !(await checkPassword(l.account, password))) return null;
  const entry = { id: rid(), email: em, salt: l.account.salt, iter: l.account.iter, hash: l.account.hash, createdAt: l.account.createdAt || new Date().toISOString(), db: db.DB_NAME };
  reg.accounts.push(entry); writeReg(reg);
  return entry;
}

export async function signIn(email, password, keep = true) {
  if (!isEmail(email)) throw new Error('Enter a valid e-mail address.');
  const em = normEmail(email); const reg = readReg();
  const entry = reg.accounts.find((a) => a.email === em);
  if (entry) { if (!(await checkPassword(entry, password))) throw mismatch(); return setCurrent(entry, keep); }
  const adopted = await adoptLegacy(em, password);
  if (!adopted) throw mismatch();
  return setCurrent(adopted, keep);
}

/** Point the on-device database at this person's own copy. Call once after sign-in, before loadAll(). */
export async function activate() {
  if (!current) throw new Error('Not signed in.');
  db.setDbName(current.db);
  await db.openDb();
  return user();
}

export function signOut() { current = null; try { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); } catch { /* ignore */ } }

function mine() { const reg = readReg(); const e = current && reg.accounts.find((a) => a.id === current.id); if (!e) throw new Error('Not signed in.'); return { reg, e }; }

export async function changePassword(currentPw, next) {
  const { reg, e } = mine();
  if (!(await checkPassword(e, currentPw))) throw new Error('The current password is not right.');
  const bad = passwordProblem(next); if (bad) throw new Error(bad);
  const fresh = await makeAccount(e.email, next);
  Object.assign(e, { salt: fresh.salt, iter: fresh.iter, hash: fresh.hash }); writeReg(reg);
}

/** Removes the account AND its data from this computer. */
export async function deleteAccount(password) {
  const { reg, e } = mine();
  if (!(await checkPassword(e, password))) throw new Error('The password is not right.');
  reg.accounts = reg.accounts.filter((a) => a.id !== e.id); writeReg(reg);
  signOut();
  await db.deleteDatabase(e.db);
}

/**
 * Forgot password: possible only on this computer, by typing the account's e-mail and choosing a new password. The data is kept.
 * (Anyone at this computer could do this, which is why the sign-in is described as a door lock, not a vault.)
 */
export async function resetPassword(email, next) {
  const em = normEmail(email); const bad = passwordProblem(next); if (bad) throw new Error(bad);
  const reg = readReg(); let e = reg.accounts.find((a) => a.email === em);
  if (!e) {
    const l = await legacy();
    if (!l.account || l.account.email !== em || legacyClaimed(reg)) throw new Error('That e-mail is not an account on this computer.');
    e = { id: rid(), email: em, createdAt: l.account.createdAt || new Date().toISOString(), db: db.DB_NAME };
    reg.accounts.push(e);
  }
  const fresh = await makeAccount(em, next);
  Object.assign(e, { salt: fresh.salt, iter: fresh.iter, hash: fresh.hash }); writeReg(reg);
}
