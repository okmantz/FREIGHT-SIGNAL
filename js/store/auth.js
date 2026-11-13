// Account sign-in for this browser. An account is an e-mail address plus a password. The password is never stored: only a
// salted PBKDF2-SHA256 hash is kept, in the settings record (so it is included in backups and survives a restore).
//
// IMPORTANT, and stated in the UI as well: Freight Signal is local-first (no server), so this account lives in THIS browser's
// storage. It keeps other people at the keyboard out of the workspace and ties the saved data to your e-mail, but it is not
// a cloud login: it does not sync between computers, and the data underneath is still readable by someone who can open
// the browser's developer tools. A forgotten password cannot be e-mailed to you; it can only be reset on this computer.

import { state, actions } from './state.js';

const ITER = 210000;
const SESSION_KEY = 'fs-session';
const enc = new TextEncoder();
const b64 = (buf) => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim());
export const MIN_PASSWORD = 8;
/** '' when the password is acceptable, otherwise the sentence to show. */
export const passwordProblem = (pw) => (String(pw || '').length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : /^\s+$/.test(String(pw)) ? 'A password cannot be only spaces.' : '');

export const cryptoReady = () => !!(globalThis.crypto && globalThis.crypto.subtle && globalThis.crypto.getRandomValues);

async function derive(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

/** Compare two base64 strings without stopping at the first difference. */
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }

export async function makeAccount(email, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { email: normEmail(email), salt: b64(salt), iter: ITER, hash: await derive(password, salt, ITER), createdAt: new Date().toISOString() };
}

export async function checkPassword(acct, password) {
  if (!acct || !acct.hash || !acct.salt) return false;
  try { return same(await derive(password, unb64(acct.salt), acct.iter || ITER), acct.hash); } catch { return false; }
}

export const account = () => state.settings.account || null;
export const hasAccount = () => !!(account() && account().email && account().hash);

/* ------------------------------------------------------------------------------------------------ session */
const fingerprint = (acct) => (acct ? String(acct.hash).slice(0, 24) : '');
function readStore(store) { try { return JSON.parse(store.getItem(SESSION_KEY) || 'null'); } catch { return null; } }

/** True when this browser already signed in to the CURRENT account (changing the password signs every other tab out). */
export function isSignedIn() {
  const a = account(); if (!a) return false;
  for (const store of [globalThis.localStorage, globalThis.sessionStorage]) {
    let s = null; try { s = store ? readStore(store) : null; } catch { s = null; }
    if (s && s.e === a.email && s.k === fingerprint(a)) return true;
  }
  return false;
}

function remember(acct, keep) {
  try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
  const v = JSON.stringify({ e: acct.email, k: fingerprint(acct) });
  try { (keep ? localStorage : sessionStorage).setItem(SESSION_KEY, v); } catch { /* storage blocked: the person signs in again next time */ }
}

export function signOut() { try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }

/* ------------------------------------------------------------------------------------------------ actions */
export async function createAccount(email, password, keep = true) {
  if (!cryptoReady()) throw new Error('This browser cannot create a secure password here (it needs https or localhost). Open the app from its https address.');
  if (!isEmail(email)) throw new Error('Enter a valid e-mail address.');
  const pw = passwordProblem(password); if (pw) throw new Error(pw);
  const acct = await makeAccount(email, password);
  await actions.savePrefs({ account: acct, accountPrompt: 'done' });
  remember(acct, keep);
  return acct;
}

/** Resolves true on success. Wrong e-mail and wrong password give the same answer on purpose. */
export async function signIn(email, password, keep = true) {
  const a = account(); if (!a) return false;
  if (normEmail(email) !== a.email) return false;
  if (!(await checkPassword(a, password))) return false;
  remember(a, keep);
  return true;
}

export async function changePassword(current, next) {
  const a = account();
  if (!(await checkPassword(a, current))) throw new Error('The current password is not right.');
  const pw = passwordProblem(next); if (pw) throw new Error(pw);
  const acct = { ...(await makeAccount(a.email, next)), createdAt: a.createdAt };
  await actions.savePrefs({ account: acct });
  remember(acct, !!(globalThis.localStorage && readStore(localStorage)));
}

export async function changeEmail(current, email) {
  const a = account();
  if (!(await checkPassword(a, current))) throw new Error('The password is not right.');
  if (!isEmail(email)) throw new Error('Enter a valid e-mail address.');
  const acct = { ...a, email: normEmail(email) };
  await actions.savePrefs({ account: acct });
  remember(acct, !!(globalThis.localStorage && readStore(localStorage)));
}

/** Remove the sign-in entirely (needs the password). The workspace data is untouched. */
export async function removeAccount(password) {
  if (!(await checkPassword(account(), password))) throw new Error('The password is not right.');
  await actions.savePrefs({ account: null, accountPrompt: 'skipped' });
  signOut();
}

/** Forgot password: only possible on this computer. Typing the account's e-mail confirms it; data is kept, the sign-in is removed. */
export async function resetAccount(email) {
  const a = account();
  if (!a || normEmail(email) !== a.email) throw new Error('That is not the e-mail address on this account.');
  await actions.savePrefs({ account: null, accountPrompt: '' });
  signOut();
}

export async function skipForNow() { await actions.savePrefs({ accountPrompt: 'skipped' }); }

/** Does the first-run / sign-in screen need to show before the app? */
export const needsGate = () => (hasAccount() ? !isSignedIn() : state.settings.accountPrompt !== 'skipped' && state.settings.accountPrompt !== 'done');
