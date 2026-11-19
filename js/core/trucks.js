// Shared truck availability board: building, validating, expiring and searching posted trucks.
//
// A truck is published by one person (the owner) and never edited in place by anyone else. Its LIFE CYCLE lives in a tiny separate
// record (the "status" record, one per truck): open / booked / withdrawn, plus an optional renewed expiry. Anyone on the team can mark a
// truck booked or withdrawn (the person who just booked it is the one who knows); only the publisher can renew it. Because the truck
// and its status are different files, two people acting at the same moment never overwrite each other.
//
// A truck stops showing as available by itself when its expiry passes, so the board cannot fill up with stale trucks.

import { normalizeText, normalizeZip } from './util.js';
import { parseMcDot } from './resources.js';
import { equipLabel } from './equipment.js';
import { HOUR, DAY, oneLine, multiLine, stateCode, emailOf, phoneOf, isoDay, dayEnd, todayIso, addDays, usDate, resolveSpot, zipMiles, equipFits, placeText, carrierKey } from './netcommon.js';

export const MAX_TTL_HOURS = 7 * 24;
export const DEFAULT_TTL_HOURS = 24;
export const KEEP_EXPIRED_MS = 7 * DAY;                 // expired trucks are deleted by whoever opens the board a week later
export const TTL_OPTIONS = [[4, '4 hours'], [8, '8 hours'], [24, '24 hours (default)'], [48, '2 days'], [72, '3 days'], ['date', 'Until the end of the available date']];

/* ------------------------------------------------------------------------------------------------ build and clean */
/**
 * Validate a form into a truck record. input: { carrierName, mc, email, phone, equip, oCity, oState, oZip, dCity, dState, destOpen,
 * date, dateTo, note, ttl }.  me: { uid, name, email }.  Returns { ok, truck } or { ok:false, error }.
 */
export function buildTruck(input, me, { now = Date.now(), zipMap = null, ttlHours = DEFAULT_TTL_HOURS, id = '' } = {}) {
  const email = emailOf(input.email), phone = phoneOf(input.phone);
  const mcRaw = oneLine(input.mc, 30), mc = parseMcDot(mcRaw);
  const carrierName = oneLine(input.carrierName, 80);
  if (!carrierName && !mc && !email && !phone) return { ok: false, error: 'Enter the carrier: a name, an MC number, an e-mail or a phone number.' };
  if (!email && !phone) return { ok: false, error: 'Add an e-mail or a phone number so a teammate can reach the carrier.' };
  const oCity = oneLine(input.oCity, 60), oState = stateCode(input.oState);
  let oZip = normalizeZip(input.oZip);
  if (!oZip && zipMap && zipMap.size && oCity && oState) oZip = zipMap.bestZipForCityState(oCity, oState);
  if (!oCity || !oState) {
    // A ZIP alone is enough: fill the city from the ZIP Map.
    const r = oZip && zipMap && zipMap.size ? zipMap.findZip(oZip) : null;
    if (!r) return { ok: false, error: 'Where is the truck? Enter the origin city and state (or a ZIP code).' };
    return buildTruck({ ...input, oCity: r.city, oState: r.state, oZip }, me, { now, zipMap, ttlHours, id });
  }
  const destOpen = !!input.destOpen || (!oneLine(input.dCity, 60) && !stateCode(input.dState));
  const dCity = destOpen ? '' : oneLine(input.dCity, 60), dState = destOpen ? '' : stateCode(input.dState);
  const today = todayIso(now);
  let d = isoDay(input.date) || today;
  const d2 = isoDay(input.dateTo);
  if (d2 && d2 < d) return { ok: false, error: '"Available until" is before "Available from".' };
  if (dayEnd(d2 || d) < now) return { ok: false, error: 'That available date has already passed.' };
  const exp = expiryFor(input.ttl ?? ttlHours, { now, date: d, dateTo: d2 });
  return {
    ok: true,
    truck: {
      id: id || '', uid: me.uid, by: oneLine(me.name, 60), byEmail: emailOf(me.email), at: now, exp,
      carrierName, mc: mc ? (mc.type === 'DOT' ? 'DOT ' : 'MC ') + mc.num : mcRaw, email, phone,
      equip: oneLine(input.equip || 'V', 4).toUpperCase(),
      oCity, oState, oZip, dCity, dState, destOpen,
      date: d, dateTo: d2, note: multiLine(input.note, 300),
    },
  };
}

/** Expiry time (ms) for a lifetime: hours, or 'date' = the end of the last available day (never less than an hour, never more than 7 days). */
export function expiryFor(ttl, { now = Date.now(), date = '', dateTo = '' } = {}) {
  let ms;
  if (ttl === 'date') { const e = dayEnd(dateTo || date); ms = Number.isFinite(e) ? e - now : 4 * HOUR; }
  else { const h = Number(ttl); ms = (Number.isFinite(h) && h > 0 ? h : DEFAULT_TTL_HOURS) * HOUR; }
  ms = Math.min(Math.max(ms, HOUR), MAX_TTL_HOURS * HOUR);
  return now + ms;
}

/** Read a truck from storage (another person's file: never trust its shape). null when it is not usable. */
export function cleanTruck(raw, id = '') {
  if (!raw || typeof raw !== 'object') return null;
  const t = {
    id: oneLine(raw.id || id, 40), uid: oneLine(raw.uid, 80), by: oneLine(raw.by, 60), byEmail: emailOf(raw.byEmail),
    at: Number(raw.at), exp: Number(raw.exp),
    carrierName: oneLine(raw.carrierName, 80), mc: oneLine(raw.mc, 30), email: emailOf(raw.email), phone: phoneOf(raw.phone),
    equip: oneLine(raw.equip || 'V', 4).toUpperCase(),
    oCity: oneLine(raw.oCity, 60), oState: stateCode(raw.oState), oZip: normalizeZip(raw.oZip),
    dCity: oneLine(raw.dCity, 60), dState: stateCode(raw.dState), destOpen: !!raw.destOpen || (!raw.dCity && !raw.dState),
    date: isoDay(raw.date), dateTo: isoDay(raw.dateTo), note: multiLine(raw.note, 300),
  };
  if (!t.id || !t.uid || !Number.isFinite(t.at) || !Number.isFinite(t.exp) || !t.oCity || !t.oState) return null;
  return t;
}

export function cleanStat(raw, id = '') {
  if (!raw || typeof raw !== 'object') return null;
  const s = String(raw.s || '');
  if (!['open', 'booked', 'withdrawn'].includes(s)) return null;
  const at = Number(raw.at); if (!Number.isFinite(at)) return null;
  return { id: oneLine(raw.id || id, 40), s, by: oneLine(raw.by, 80), byName: oneLine(raw.byName, 60), at, exp: Number.isFinite(Number(raw.exp)) ? Number(raw.exp) : 0, note: oneLine(raw.note, 120) };
}

/* ------------------------------------------------------------------------------------------------ life cycle */
/**
 * Combine each truck with its status record. Result rows carry: status ('open' | 'booked' | 'withdrawn' | 'expired'),
 * expiresAt (the renewed expiry when the publisher renewed it), statusBy / statusAt / statusNote.
 */
export function resolveTrucks(trucks, stats, now = Date.now()) {
  const by = stats instanceof Map ? stats : new Map((stats || []).map(s => [s.id, s]));
  return trucks.map((t) => {
    const st = by.get(t.id);
    let status = 'open', expiresAt = t.exp, statusBy = '', statusAt = t.at, statusNote = '';
    if (st) {
      if (st.s === 'booked' || st.s === 'withdrawn') { status = st.s; statusBy = st.byName; statusAt = st.at; statusNote = st.note; }
      else if (st.s === 'open' && st.by === t.uid && st.exp > 0) { expiresAt = Math.min(st.exp, st.at + MAX_TTL_HOURS * HOUR); statusAt = st.at; }
    }
    if (status === 'open' && now >= expiresAt) status = 'expired';
    return { ...t, status, expiresAt, statusBy, statusAt, statusNote };
  });
}

/** Trucks that are safe to delete from the shared store (expired, booked or withdrawn long ago). */
export const prunable = (row, now = Date.now()) => now - Math.max(row.expiresAt || 0, row.status === 'booked' || row.status === 'withdrawn' ? row.statusAt || 0 : 0) > KEEP_EXPIRED_MS;

/** The status record to write for an action. */
export function statRecord(truck, action, me, { now = Date.now(), ttl = DEFAULT_TTL_HOURS, note = '' } = {}) {
  const base = { id: truck.id, by: me.uid, byName: oneLine(me.name, 60), at: now, note: oneLine(note, 120) };
  if (action === 'booked') return { ...base, s: 'booked' };
  if (action === 'withdrawn') return { ...base, s: 'withdrawn' };
  if (action === 'renew') return { ...base, s: 'open', exp: expiryFor(ttl, { now, date: truck.date, dateTo: truck.dateTo }) };
  throw new Error('Unknown truck action: ' + action);
}

/* ------------------------------------------------------------------------------------------------ search */
/** "TX", "Dallas, TX" or "Dallas" -> { city, state }. */
export function parseDest(text) {
  const t = oneLine(text, 80); if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) return { city: '', state: t.toUpperCase() };
  const m = /^(.*?)[,\s]+([A-Za-z]{2})$/.exec(t);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : { city: t, state: '' };
}

/** Which part of a search the truck's destination satisfied: 'open' (goes anywhere), 'city', 'state' or ''. */
export function destMatch(t, dest) {
  if (!dest) return 'any';
  if (t.destOpen) return 'open';
  if (dest.state && t.dState && dest.state !== t.dState) return '';
  if (dest.city) {
    if (t.dCity && normalizeText(t.dCity) === normalizeText(dest.city)) return 'city';
    if (dest.state && t.dState === dest.state && !t.dCity) return 'state';
    return dest.state ? (t.dState === dest.state ? 'state' : '') : '';
  }
  return dest.state && t.dState === dest.state ? 'state' : '';
}

/**
 * Search resolved trucks. q: { origin, radius, dest, equip, looseReefer, date, carrier, email, status ('open' default | 'all') }.
 * Returns rows with `miles` (straight-line from the searched origin) and `destHit`, nearest first when an origin was given.
 */
export function searchTrucks(rows, q = {}, { zipMap = null, now = Date.now() } = {}) {
  const status = q.status || 'open';
  const spot = q.origin ? resolveSpot(q.origin, zipMap) : null;
  const radius = Number(q.radius) > 0 ? Number(q.radius) : 75;
  const dest = parseDest(q.dest);
  const day = isoDay(q.date);
  const carrierTerms = normalizeText(q.carrier).split(/\s+/).filter(Boolean);
  const wantMc = (parseMcDot(q.carrier) || {}).num || '';
  const em = normalizeText(q.email);
  const originText = !spot && q.origin ? normalizeText(q.origin) : '';
  const out = [];
  for (const t of rows) {
    if (status !== 'all' && t.status !== status) continue;
    if (q.equip && !equipFits(q.equip, t.equip, q.looseReefer)) continue;
    if (carrierTerms.length) {
      const hay = normalizeText([t.carrierName, t.mc, t.email].join(' '));
      const mcHit = wantMc && String(t.mc).replace(/\D/g, '') === wantMc;
      if (!mcHit && !carrierTerms.every(w => hay.includes(w))) continue;
    }
    if (em && !normalizeText(t.email + ' ' + t.byEmail).includes(em)) continue;
    if (day) {
      const start = t.date || '', end = t.dateTo || addDays(start, 2);
      if (!start || day < start || day > end) continue;
    }
    let miles = null;
    if (spot) {
      const tz = t.oZip || (zipMap && zipMap.size ? zipMap.bestZipForCityState(t.oCity, t.oState) : '');
      miles = zipMiles(zipMap, tz, spot.zip);
      if (miles === null) { if (!(normalizeText(t.oCity) === normalizeText(spot.city) && t.oState === spot.state)) continue; miles = 0; }
      if (miles > radius) continue;
    } else if (originText && !normalizeText(placeText(t.oCity, t.oState) + ' ' + t.oZip).includes(originText)) continue;
    const hit = destMatch(t, dest);
    if (!hit) continue;
    out.push({ ...t, miles, destHit: hit });
  }
  return out.sort((a, b) => (a.miles ?? 1e9) - (b.miles ?? 1e9) || b.at - a.at);
}

/** The search that finds trucks for a posting on the board: near the pickup, matching equipment, available on the pickup day. */
export function queryForLoad(p, settings = {}) {
  return {
    origin: p.originZip ? normalizeZip(p.originZip) : placeText(p.originCity, p.originState),
    radius: Number(settings.carrierRadiusMiles) > 0 ? Number(settings.carrierRadiusMiles) : 75,
    equip: String(p.equip || 'V').toUpperCase(), looseReefer: false,
    date: isoDay(p.pickupEarliest), dest: '', status: 'open',
  };
}

/** One readable line for lists, toasts and copied text. */
export function truckLine(t) {
  const to = t.destOpen ? 'anywhere' : placeText(t.dCity, t.dState);
  const when = t.date ? usDate(t.date) + (t.dateTo ? '-' + usDate(t.dateTo) : '') : '';
  return [equipLabel(t.equip), `${placeText(t.oCity, t.oState)} to ${to}`, when && 'avail ' + when, t.carrierName, t.mc, t.phone || t.email].filter(Boolean).join(' · ');
}

/** The key that says two postings describe the same carrier (used to warn about duplicates when publishing). */
export const truckCarrierKey = (t) => carrierKey({ mc: t.mc, email: t.email });
