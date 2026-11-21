// Truck Book (v16): YOUR persistent list of available trucks, learned from carrier e-mails, pasted lists and imports,
// ranked against every load you have, with freshness so a truck that said "empty Friday" on Tuesday does not rank like one that said it an hour ago.
// Pure logic (no DOM, no storage). Team trucks (js/core/trucks.js) use the same record shape and can be mixed in.
//
// Record: { id, key, carrierName, mc, email, phone, equip, oCity, oState, oZip, dCity, dState, destOpen, date, dateTo, note,
//           at (when the carrier said it), exp (expires), status 'open'|'booked'|'withdrawn', source 'email'|'paste'|'import'|'team'|'manual', by }

import { equipFits, resolveSpot, zipMiles, emailOf, phoneOf, oneLine, stateCode, isoDay, todayIso, addDays, dayStart, dayEnd, carrierKey, placeText, ago, HOUR, DAY } from './netcommon.js';
import { equipFromText, equipLabel } from './equipment.js';
import { normalizeZip, normalizeText } from './util.js';
import { parseMcDot } from './resources.js';

export const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));
export const FRESH_FULL_HOURS = 4;          // a truck reported in the last 4 hours is as fresh as it gets
export const FRESH_ZERO_HOURS = 36;         // ...and is worth nothing after a day and a half (unless it is re-confirmed)
export const DEFAULT_TRUCK_HOURS = 24;

const rid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** 1 = reported just now, 0 = stale. Linear between FRESH_FULL_HOURS and FRESH_ZERO_HOURS. */
export function freshness(t, now = Date.now()) {
  const at = Number(t && t.at); if (!Number.isFinite(at) || at <= 0) return 0.25;
  const h = (now - at) / HOUR;
  if (h <= FRESH_FULL_HOURS) return 1;
  if (h >= FRESH_ZERO_HOURS) return 0;
  return Math.round((1 - (h - FRESH_FULL_HOURS) / (FRESH_ZERO_HOURS - FRESH_FULL_HOURS)) * 100) / 100;
}
export const freshLabel = (t, now = Date.now()) => ago(Number(t.at) || NaN, now);

/** Still worth showing: open, not past its expiry, not past its last available day. */
export function isActive(t, now = Date.now()) {
  if (!t || (t.status && t.status !== 'open')) return false;
  if (Number(t.exp) > 0 && t.exp < now) return false;
  const end = t.dateTo || t.date; if (end && dayEnd(end) < now) return false;
  return true;
}
export const activeTrucks = (trucks, now = Date.now()) => (trucks || []).filter(t => isActive(t, now));

/** Identity of one truck report: the same carrier at the same place on the same day is ONE record (a newer report replaces the older). */
export function truckKeyOf(t) {
  const who = carrierKey({ mc: t.mc, email: t.email }) || (t.phone ? 'ph:' + String(t.phone).replace(/\D/g, '').slice(-10) : '') || 'nm:' + normalizeText(t.carrierName);
  return [who, normalizeText(t.oCity) + normalizeText(t.oState), t.date || ''].join('|');
}

/** Build a complete record from loose input (a parsed e-mail, a pasted line, a CSV row). Returns null when there is no usable location. */
export function makeTruck(input = {}, { now = Date.now(), zipMap = null, source = 'manual', hours = DEFAULT_TRUCK_HOURS, by = '' } = {}) {
  const email = emailOf(input.email), phone = phoneOf(input.phone);
  const mcP = parseMcDot(oneLine(input.mc, 30));
  let oCity = oneLine(input.oCity, 60), oState = stateCode(input.oState), oZip = normalizeZip(input.oZip);
  if (zipMap && zipMap.size) {
    if (oZip && (!oCity || !oState)) { const r = zipMap.findZip(oZip); if (r) { oCity = oCity || r.city; oState = oState || r.state; } }
    if (!oZip && oCity && oState) oZip = zipMap.bestZipForCityState(oCity, oState) || '';
  }
  if (!oCity || !oState) return null;
  const dCity = oneLine(input.dCity, 60), dState = stateCode(input.dState);
  const destOpen = !!input.destOpen || (!dCity && !dState);
  const date = isoDay(input.date) || todayIso(now), dateTo = isoDay(input.dateTo);
  const at = Number(input.at) > 0 ? Number(input.at) : now;
  const t = {
    id: input.id || '', carrierName: oneLine(input.carrierName, 80), mc: mcP ? (mcP.type === 'DOT' ? 'DOT ' : 'MC ') + mcP.num : '', email, phone,
    equip: oneLine(input.equip || 'V', 4).toUpperCase(), oCity, oState, oZip, dCity: destOpen ? '' : dCity, dState: destOpen ? '' : dState, destOpen,
    date, dateTo, note: oneLine(input.note, 300), at, exp: Number(input.exp) > 0 ? Number(input.exp) : Math.max(at + hours * HOUR, dayStart(date) + 12 * HOUR),
    status: input.status || 'open', source, by,
  };
  t.key = truckKeyOf(t); if (!t.id) t.id = 'tb_' + t.key.replace(/[^a-z0-9]+/gi, '_').slice(0, 60);
  return t;
}

/** Newer report from the same carrier at the same place replaces the older one; booked/withdrawn rows are kept. Returns { trucks, added, updated }. */
export function mergeTrucks(existing = [], incoming = []) {
  const byKey = new Map(existing.map(t => [t.key || truckKeyOf(t), t]));
  let added = 0, updated = 0;
  for (const n of incoming) {
    if (!n) continue; const k = n.key || truckKeyOf(n); const o = byKey.get(k);
    if (!o) { byKey.set(k, { ...n, key: k }); added++; continue; }
    if ((n.at || 0) >= (o.at || 0)) { byKey.set(k, { ...o, ...n, id: o.id, key: k, status: o.status === 'booked' ? 'booked' : n.status }); updated++; }
  }
  return { trucks: [...byKey.values()], added, updated };
}

// ------------------------------------------------------------------------------------------------ reading text
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const MC_RE = /\b(?:mc|dot|usdot)\s*(?:#|number|no\.?)?\s*:?\s*(\d{5,8})\b/i;
const PLACE_RE = /([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,2}?)\s*,?\s+([A-Z]{2})\b(?!\w)/g;
const OPEN_RE = /\b(?:anywhere|any ?where|open|any (?:direction|destination|lane|load)|going anywhere|no preference|flexible|wherever|all states)\b/i;
const DEST_SPLIT = /\s*(?:->|=>|→|\bto\b|\bgoing\b|\bheaded\b|\bheading\b|\bdest(?:ination)?\b|\bnorth ?bound\b|\bback to\b|\btoward(?:s)?\b|\bhome to\b)\s*/i;

/** First two "City, ST" places in order. The first is where the truck is; the second (after to / -> / heading) is where it wants to go. */
function placesIn(text) {
  const out = [];
  for (const m of String(text).matchAll(PLACE_RE)) {
    const st = m[2].toUpperCase(); if (!STATES.has(st)) continue;
    let city = m[1].trim();
    const LEAD_WORDS = /^(?:in|at|near|from|to|out of|empty|located|truck|trucks|i'?m|im|we'?re|my|our|have|got|a|an|the|van|reefer|flatbed|dry|53'?|and|going|goin|heading|headed|head|then|back|toward|towards|today|tomorrow|tmrw|tonight|now|available|avail|dest|destination|is|are)\s+/i;
    for (let g = 0; g < 8 && LEAD_WORDS.test(city); g++) city = city.replace(LEAD_WORDS, '').trim();
    if (city.length < 2) continue;
    out.push({ city: city.replace(/\b([a-z])/g, (x) => x.toUpperCase()), state: st, index: m.index });
  }
  return out;
}

function dateIn(text, now) {
  const t = String(text).toLowerCase();
  if (/\btomorrow\b|\btmrw\b/.test(t)) return addDays(todayIso(now), 1);
  if (/\btoday\b|\bnow\b|\basap\b|\bempty\b/.test(t)) return todayIso(now);
  const dow = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/.exec(t);
  if (dow) { const idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(dow[1]); const cur = new Date(now).getDay(); return addDays(todayIso(now), (idx - cur + 7) % 7); }
  const m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t);
  if (m) { const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date(now).getFullYear()); return isoDay(`${m[1]}/${m[2]}/${y}`); }
  return '';
}

/**
 * Read ONE truck report out of free text (an e-mail, a text message, a pasted line).
 * Returns a partial record (no timestamps) or null when no location is found.
 * "Have 53' van empty in Gary IN tomorrow going to Atlanta GA" -> { equip:'V', oCity:'Gary', oState:'IN', dCity:'Atlanta', dState:'GA', date:<tomorrow> }
 */
export function parseTruckText(text, { now = Date.now(), zipMap = null } = {}) {
  const t = String(text ?? '').replace(/\r/g, '');
  const places = placesIn(t);
  let o = places[0] || null, d = null;
  // the destination is the place that comes after a "to / heading / ->" word, otherwise the second place
  const split = DEST_SPLIT.exec(t);
  if (o && places.length > 1) d = places.find(p => p.index > o.index && (!split || p.index >= split.index)) || places[1];
  if (!o && zipMap && zipMap.size) { const z = /\b(\d{5})\b/.exec(t.replace(PHONE_RE, ' ')); const r = z && zipMap.findZip(z[1]); if (r) o = { city: r.city, state: r.state }; }
  if (!o) return null;
  const mc = MC_RE.exec(t);
  const phone = PHONE_RE.exec(t);
  const email = EMAIL_RE.exec(t);
  const rest = t.replace(EMAIL_RE, ' ');
  const equip = equipFromText(/\b(van|reefer|flatbed|flat bed|step ?deck|power only|hot ?shot|sprinter|box truck|container|conestoga|lowboy|dry)\b/i.test(rest) ? rest : '');
  const openDest = !d || OPEN_RE.test(t);
  return {
    oCity: o.city, oState: o.state, dCity: d && !OPEN_RE.test(t) ? d.city : '', dState: d && !OPEN_RE.test(t) ? d.state : '', destOpen: openDest && !(d && !OPEN_RE.test(t)),
    equip: /\b(van|reefer|flatbed|flat bed|step ?deck|power only|hot ?shot|sprinter|box truck|container|conestoga|lowboy|dry)\b/i.test(rest) ? equip : 'V',
    date: dateIn(t, now), mc: mc ? 'MC ' + mc[1] : '', phone: phone ? phone[0] : '', email: email ? email[0] : '',
  };
}

const HEADER_ALIASES = {
  carrierName: ['carrier', 'carriername', 'name', 'company', 'carrier name'], mc: ['mc', 'mcnumber', 'mc#', 'dot', 'usdot', 'mc number'], email: ['email', 'e-mail', 'emailaddress'],
  phone: ['phone', 'cell', 'mobile', 'telephone', 'phone number'], equip: ['equip', 'equipment', 'trailer', 'type', 'truck type'],
  oCity: ['origin city', 'city', 'origin', 'from city', 'current city', 'location city', 'ocity'], oState: ['origin state', 'state', 'from state', 'current state', 'ostate'],
  oZip: ['origin zip', 'zip', 'from zip', 'ozip'], dCity: ['dest city', 'destination city', 'dest', 'destination', 'to city', 'dcity'], dState: ['dest state', 'destination state', 'to state', 'dstate'],
  date: ['date', 'available', 'avail date', 'available date', 'avail', 'pickup date'], dateTo: ['date to', 'available until', 'until'], note: ['note', 'notes', 'comment', 'comments'],
};
const canon = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9# ]/g, '').trim();

function splitCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',' || c === '\t') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map(x => x.trim());
}

/**
 * A pasted block or file -> trucks. Handles a CSV/TSV with a header row (carrier, mc, phone, city, state, equipment ...) and free text (one truck per line,
 * or one per blank-line-separated block). Returns { trucks, skipped:[lines that had no location] }.
 */
export function parseTruckList(text, { now = Date.now(), zipMap = null, source = 'paste', by = '', defaults = {} } = {}) {
  const raw = String(text ?? '').replace(/\r/g, '').trim();
  if (!raw) return { trucks: [], skipped: [] };
  const lines = raw.split('\n').filter(l => l.trim());
  const first = splitCsvLine(lines[0]).map(canon);
  const idx = {};
  for (const [k, names] of Object.entries(HEADER_ALIASES)) { const i = first.findIndex(h => names.includes(h)); if (i >= 0) idx[k] = i; }
  const trucks = [], skipped = [];
  if (Object.keys(idx).length >= 2 && (idx.oCity !== undefined || idx.oZip !== undefined || idx.oState !== undefined)) {
    for (const l of lines.slice(1)) {
      const c = splitCsvLine(l); const row = {}; for (const [k, i] of Object.entries(idx)) row[k] = c[i] || '';
      if (row.equip) row.equip = equipFromText(row.equip);
      let city = row.oCity, st = row.oState;
      if (city && !st) { const m = /^(.*?)[,\s]+([A-Za-z]{2})$/.exec(city); if (m) { city = m[1]; st = m[2]; } }
      const tr = makeTruck({ ...defaults, ...row, oCity: city, oState: st }, { now, zipMap, source, by });
      if (tr) trucks.push(tr); else skipped.push(l);
    }
    return { trucks, skipped };
  }
  // free text: blank-line blocks if there are any, otherwise one truck per line
  const blocks = /\n\s*\n/.test(raw) ? raw.split(/\n\s*\n/) : lines;
  for (const b of blocks) {
    const p = parseTruckText(b, { now, zipMap });
    const tr = p && makeTruck({ ...defaults, ...p, carrierName: p.carrierName || guessName(b) }, { now, zipMap, source, by });
    if (tr) trucks.push(tr); else if (b.trim()) skipped.push(b.trim().slice(0, 100));
  }
  return { trucks, skipped };
}
function guessName(block) {
  const m = /^\s*([A-Z][A-Za-z0-9&.' -]{2,40}(?:LLC|INC|TRUCKING|TRANSPORT|LOGISTICS|FREIGHT|EXPRESS|CARRIERS?|LINES?))\b/m.exec(block);
  return m ? m[1].trim() : '';
}

// ------------------------------------------------------------------------------------------------ matching
const MAX_DEADHEAD = 150;

function pickupWindow(load) {
  const a = isoDay(load.pickupEarliest) || todayIso(), b = isoDay(load.pickupLatest) || a;
  return [a, b < a ? a : b];
}

/** How a truck's available dates fit a load's pickup window: 'ok' | 'early' (truck is free before the load) | 'late' (truck is free after) */
export function dateFit(truck, load) {
  const [pa, pb] = pickupWindow(load);
  const ta = truck.date || todayIso(), tb = truck.dateTo || ta;
  if (tb < pa) return 'early';
  if (ta > pb) return 'late';
  return 'ok';
}

/**
 * Score ONE truck for ONE load. Returns null when it cannot haul it (wrong equipment, too far, not available in time).
 * ctx: { zipMap, now, radius, carrierHistory:Map(carrierKey -> {covers, lastCovered}), contactedKeys:Set }
 */
export function scoreTruck(load, truck, ctx = {}) {
  const now = ctx.now || Date.now(), zipMap = ctx.zipMap;
  const radius = Number(ctx.radius) > 0 ? Number(ctx.radius) : MAX_DEADHEAD;
  if (!isActive(truck, now)) return null;
  if (!equipFits(load.equip || 'V', truck.equip || 'V', true)) return null;
  const oz = normalizeZip(load.originZip) || (zipMap && zipMap.size ? zipMap.bestZipForCityState(load.originCity, load.originState) : '');
  const miles = zipMiles(zipMap, oz, truck.oZip);
  const sameCity = normalizeText(load.originCity) === normalizeText(truck.oCity) && normalizeText(load.originState) === normalizeText(truck.oState);
  const dead = sameCity ? 0 : miles;
  if (dead === null || dead === undefined) { if (!(truck.oState && truck.oState === stateCode(load.originState))) return null; }
  else if (dead > radius) return null;
  const df = dateFit(truck, load);
  if (df === 'late') return null;
  const reasons = []; let score = 0;
  // 1. deadhead: the closer the truck, the better
  const dh = dead === null || dead === undefined ? 60 : dead;
  score += Math.max(0, 40 - (dh / radius) * 40);
  reasons.push(dead === 0 ? 'in ' + placeText(truck.oCity, truck.oState) : dead === null || dead === undefined ? 'same origin state' : Math.round(dh) + ' mi from pickup');
  // 2. freshness
  const fr = freshness(truck, now); score += fr * 25;
  reasons.push('reported ' + (freshLabel(truck, now) || 'earlier'));
  // 3. availability window
  if (df === 'ok') { score += 10; reasons.push('available for your pickup date'); } else { score += 3; reasons.push('empty earlier than the pickup'); }
  // 4. where it wants to go: open or heading your way is worth a lot; heading the opposite way is a reason it will want a premium
  const dz = normalizeZip(load.destZip) || (zipMap && zipMap.size ? zipMap.bestZipForCityState(load.destCity, load.destState) : '');
  if (truck.destOpen) { score += 12; reasons.push('open to any destination'); }
  else if (stateCode(load.destState) === truck.dState && truck.dState) { score += 18; reasons.push('wants to go to ' + truck.dState); }
  else if (dz && truck.dCity && zipMap && zipMap.size) {
    const tz = zipMap.bestZipForCityState(truck.dCity, truck.dState); const dm = tz ? zipMiles(zipMap, tz, dz) : null;
    if (dm !== null && dm <= 150) { score += 15; reasons.push('wants to go near ' + load.destCity); } else if (dm !== null && dm > 400) { score -= 6; reasons.push('wants to go elsewhere'); }
  }
  // 5. history with you
  const h = ctx.carrierHistory && ctx.carrierHistory.get(carrierKey({ mc: truck.mc, email: truck.email }));
  if (h && h.covers > 0) { score += Math.min(10, 4 + h.covers * 2); reasons.push('covered ' + h.covers + ' load' + (h.covers === 1 ? '' : 's') + ' for you'); }
  // 6. you can actually reach them
  if (truck.phone) score += 3; if (truck.email) score += 2;
  if (!truck.phone && !truck.email) { score -= 10; reasons.push('no phone or e-mail'); }
  const key = carrierKey({ mc: truck.mc, email: truck.email });
  const contacted = !!(key && ctx.contactedKeys && ctx.contactedKeys.has(key));
  if (contacted) reasons.push('already contacted on this load');
  return { truck, score: Math.round(score * 10) / 10, deadhead: dead === null || dead === undefined ? null : Math.round(dead), fresh: fr, dateFit: df, destOpen: truck.destOpen, contacted, reasons, tier: score >= 70 ? 'hot' : score >= 45 ? 'good' : 'maybe' };
}

/** Every truck that can take this load, best first. */
export function matchTrucksToLoad(load, trucks, ctx = {}) {
  return (trucks || []).map(t => scoreTruck(load, t, ctx)).filter(Boolean).sort((a, b) => b.score - a.score);
}

/** The loads one truck could take, best first (the inverse of matchTrucksToLoad). */
export function matchLoadsToTruck(truck, loads, ctx = {}) {
  return (loads || []).map(l => { const r = scoreTruck(l, truck, ctx); return r ? { load: l, ...r } : null; }).filter(Boolean).sort((a, b) => b.score - a.score);
}

/** { carrierKey -> { covers, lastCovered } } from the cover log, so history can lift a truck's rank. */
export function carrierHistoryFromLog(coverLog = []) {
  const m = new Map();
  for (const e of coverLog) {
    const c = e.carrier || {}; const k = carrierKey({ mc: c.mc, email: c.email }); if (!k || e.outcome !== 'Covered') continue;
    const o = m.get(k) || { covers: 0, lastCovered: '' }; o.covers++; o.lastCovered = e.coveredAt || e.at || o.lastCovered; m.set(k, o);
  }
  return m;
}

/** One readable line for a list. */
export function truckBookLine(t) {
  const to = t.destOpen ? 'anywhere' : placeText(t.dCity, t.dState);
  return [equipLabel(t.equip), placeText(t.oCity, t.oState) + ' to ' + to, t.carrierName, t.mc, t.phone || t.email].filter(Boolean).join(' · ');
}
