// Team Network: small pure helpers shared by the truck board, load rescue, lane intelligence and channels.
// No DOM, no storage, no network: everything here runs (and is unit-tested) in Node.

import { normalizeText, normalizeZip, safeNumeric } from './util.js';
import { parseMcDot } from './resources.js';
import { equipFamilies } from './equipment.js';

export const MIN = 60000;
export const HOUR = 3600000;
export const DAY = 86400000;

/* ------------------------------------------------------------------------------------------------ ids and text */
/** Time-ordered, collision-safe id for a shared record: base36 time + random tail. `rand` is injectable for tests. */
export function newId(now = Date.now(), rand = Math.random) {
  return now.toString(36).padStart(9, '0') + Math.floor(rand() * 36 ** 5).toString(36).padStart(5, '0');
}

/** Single-line text: control characters become spaces, trimmed and cut to `max` characters. */
export const oneLine = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
/** Multi-line text: keeps line breaks, drops other control characters, cut to `max` characters. */
export const multiLine = (v, max = 1000) => String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
export const stateCode = (v) => oneLine(v, 2).toUpperCase();
export const emailOf = (v) => { const t = oneLine(v, 120).toLowerCase(); return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(t) ? t : ''; };
export const phoneOf = (v) => { const t = oneLine(v, 30); const d = t.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15 ? t : ''; };

/** Stable identity for a carrier: "mc:123456", "dot:3456789" or "em:<hash of e-mail>". '' when nothing identifies it. */
export function carrierKey({ mc, email } = {}) {
  const p = parseMcDot(mc);
  if (p) return (p.type === 'DOT' ? 'dot:' : 'mc:') + p.num;
  const e = emailOf(email);
  return e ? 'em:' + hash(e) : '';
}
/** Short non-cryptographic hash (FNV-1a, 32 bit, base36). Used only to avoid shipping e-mail addresses inside lane statistics. */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

/* ------------------------------------------------------------------------------------------------ team invite codes */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L: nobody mistypes a code read over the phone
const TEAM_LEN = 8, SECRET_LEN = 12;

/** A fresh invite: the team id (public part) and the secret that proves you were invited. `rand` is injectable for tests. */
export function makeInvite(rand) {
  const pick = (n) => {
    const bytes = new Uint8Array(n);
    if (rand) for (let i = 0; i < n; i++) bytes[i] = Math.floor(rand() * 256);
    else globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join('');
  };
  const team = pick(TEAM_LEN), secret = pick(SECRET_LEN);
  return { teamId: team.toLowerCase(), secret: secret.toLowerCase(), code: formatInvite(team + secret) };
}
export function formatInvite(raw) { return (String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').match(/.{1,4}/g) || []).join('-'); }
/** Read a code the way people paste it (spaces, dashes, lower case, surrounding text). null when it is not a valid code. */
export function parseInvite(text) {
  const up = String(text ?? '').toUpperCase();
  let raw = up.replace(/[^A-Z0-9]/g, '');
  if (raw.length !== TEAM_LEN + SECRET_LEN) {
    const m = /(?:[A-Z2-9]{4}[\s-]*){4}[A-Z2-9]{4}/.exec(up);     // a code inside a longer message: "Join code: ABCD-..."
    raw = m ? m[0].replace(/[^A-Z0-9]/g, '') : '';
  }
  if (raw.length !== TEAM_LEN + SECRET_LEN) return null;
  if ([...raw].some(c => !ALPHABET.includes(c))) return null;
  return { teamId: raw.slice(0, TEAM_LEN).toLowerCase(), secret: raw.slice(TEAM_LEN).toLowerCase(), code: formatInvite(raw) };
}

/* ------------------------------------------------------------------------------------------------ places */
export const marketKey = (city, st) => normalizeText(city) + '|' + normalizeText(st);
export const placeText = (city, st) => [oneLine(city, 60), stateCode(st)].filter(Boolean).join(', ');

/** "60601", "Chicago, IL", "Chicago IL" -> { zip, city, state, lat, lng } using the ZIP Map. null when it cannot be located. */
export function resolveSpot(text, zipMap) {
  const t = oneLine(text, 80); if (!t || !zipMap || !zipMap.size) return null;
  let zip = '';
  if (/^\d{5}(-\d{4})?$/.test(t)) zip = normalizeZip(t);
  else {
    const m = /^(.*?)[,\s]+([A-Za-z]{2})$/.exec(t);
    if (m) zip = zipMap.bestZipForCityState(m[1].trim(), m[2].toUpperCase());
  }
  if (!zip) return null;
  const r = zipMap.findZip(zip); if (!r) return null;
  return { zip, city: r.city, state: r.state, lat: r.lat, lng: r.lng };
}

/** Straight-line miles between two ZIPs, or null when either is unknown. */
export const zipMiles = (zipMap, a, b) => (zipMap && zipMap.size && a && b ? zipMap.distanceBetweenZips(a, b) : null);

/* ------------------------------------------------------------------------------------------------ equipment */
/** The family a lane is grouped under ("van", "reefer", "flatbed" ...). */
export const equipFamily = (code) => (equipFamilies(code) || ['van'])[0] || 'van';
/**
 * Does a truck of type `truck` suit a search for `want`? Same family, or any family in common (Van or Reefer fits both).
 * looseReefer: a reefer can also haul dry freight, so a van search can include reefers.
 */
export function equipFits(want, truck, looseReefer = false) {
  if (!want) return true;
  const a = equipFamilies(want) || ['van'], b = equipFamilies(truck) || ['van'];
  if (a.some(f => b.includes(f))) return true;
  return !!looseReefer && a.includes('van') && b.includes('reefer');
}

/* ------------------------------------------------------------------------------------------------ dates */
/** "2026-11-20", "11/20/2026" or "11/20/26" -> "2026-11-20". '' when it is not a date. */
export function isoDay(v) {
  const t = String(v ?? '').trim(); if (!t) return '';
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (!m) { const x = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t); if (x) m = [0, x[3].length === 2 ? '20' + x[3] : x[3], x[1].padStart(2, '0'), x[2].padStart(2, '0')]; }
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getFullYear() !== Number(m[1]) || d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) return '';
  return `${m[1]}-${m[2]}-${m[3]}`;
}
/** Local midnight (start) of an ISO day, as ms. NaN for a bad day. */
export const dayStart = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : NaN; };
/** Last millisecond of an ISO day (local time). */
export const dayEnd = (iso) => { const s = dayStart(iso); return Number.isFinite(s) ? s + DAY - 1 : NaN; };
export const todayIso = (now = Date.now()) => { const d = new Date(now); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
export const addDays = (iso, n) => { const s = dayStart(iso); if (!Number.isFinite(s)) return ''; return todayIso(s + n * DAY + 12 * HOUR); };
export const usDate = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : ''; };

/** "12 min ago", "3 h ago", "2 d ago". */
export function ago(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const m = Math.max(0, Math.round((now - ms) / MIN));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
}
/** "in 3 h", "in 25 min", "expired". */
export function until(ms, now = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const m = Math.round((ms - now) / MIN);
  return m <= 0 ? 'expired' : m < 60 ? `in ${m} min` : m < 48 * 60 ? `in ${Math.round(m / 60)} h` : `in ${Math.round(m / 1440)} d`;
}

/** Sum of the "reprice" steps logged on a load (+$100, -$50 ...). Positive = the rate was raised that much since the first post. */
export function repriceTotal(ops) {
  let total = 0;
  for (const o of Array.isArray(ops) ? ops : []) {
    if (!o || o.type !== 'reprice') continue;
    const m = /([+-])\s*\$?\s*([\d,]+)/.exec(String(o.detail || ''));
    if (m) total += (m[1] === '-' ? -1 : 1) * Number(m[2].replace(/,/g, ''));
  }
  return total;
}

/* ------------------------------------------------------------------------------------------------ statistics */
export const median = (list) => { const a = list.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const n = a.length; return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; };
export const mean = (list) => { const a = list.filter(Number.isFinite); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };
export const percentile = (list, p) => { const a = list.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const i = Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1)); return a[i]; };
export const roundTo = (n, step = 25) => (Number.isFinite(n) ? Math.round(n / step) * step : null);
export const money = (n) => (Number.isFinite(Number(n)) && n !== '' && n !== null ? '$' + Math.round(Number(n)).toLocaleString('en-US') : '');
export const num = safeNumeric;
