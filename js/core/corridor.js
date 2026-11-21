// Backhaul & corridor intelligence + load bundling and swaps (v16).
// A hard load is hard because the truck that delivers it cannot find freight out of there (AZ-FL: Florida is thin outbound), or the lane is short and cheap.
// So instead of only searching "carriers near the pickup", this finds the trucks that WANT this lane: they deliver near your pickup, live near your
// delivery, or have a load of yours (or a teammate's) that makes the round trip pay.
// Pure logic (no DOM, no storage). Everything takes the ZIP Map and works from data you already have.

import { equipFits, zipMiles, carrierKey, placeText, isoDay, todayIso, addDays, stateCode, emailOf, DAY } from './netcommon.js';
import { normalizeZip, normalizeText, safeNumeric, safeString } from './util.js';
import { laneMiles } from './lanes.js';

/** States where a truck that delivers has trouble finding freight back out (thin outbound / reload). Editable in System (settings.thinOutboundStates). */
export const THIN_OUTBOUND = ['FL', 'NJ', 'NY', 'CT', 'MA', 'RI', 'VT', 'NH', 'ME', 'WA', 'OR', 'ID', 'MT', 'WY', 'NV', 'AZ', 'NM', 'ND', 'SD'];
export const thinSet = (settings = {}) => new Set((Array.isArray(settings.thinOutboundStates) && settings.thinOutboundStates.length ? settings.thinOutboundStates : THIN_OUTBOUND).map(s => String(s).toUpperCase()));

const spotZip = (city, st, zip, zipMap) => normalizeZip(zip) || (zipMap && zipMap.size && city && st ? zipMap.bestZipForCityState(city, st) : '');
const near = (zipMap, a, b, miles) => { const d = zipMiles(zipMap, a, b); return d !== null && d !== undefined && d <= miles ? d : null; };

/** Why a load is hard, in words, plus how much of a premium that usually deserves. */
export function laneDifficulty(load, { zipMap = null, settings = {} } = {}) {
  const thin = thinSet(settings);
  const notes = []; let premium = 0;
  const dState = stateCode(load.destState), oState = stateCode(load.originState);
  if (thin.has(dState)) { notes.push('Trucks that deliver in ' + dState + ' have a hard time finding a load out'); premium += 0.06; }
  if (thin.has(oState)) { notes.push(oState + ' is a thin origin: fewer trucks sit there'); premium += 0.03; }
  const mi = laneMiles(load, zipMap);
  if (mi !== null && mi < 250) { notes.push('Short haul (' + Math.round(mi) + ' mi): carriers want more per mile'); premium += 0.05; }
  if (mi !== null && mi > 1800) { notes.push('Very long haul (' + Math.round(mi) + ' mi)'); premium += 0.02; }
  return { tough: notes.length > 0, notes, premium: Math.round(premium * 100) / 100, miles: mi === null ? null : Math.round(mi) };
}

/**
 * Carriers that WANT this lane, from every source you have. ctx: { carriers, coverLog, trucks, zipMap, now, radius, exclude:Set(carrierKey) }
 * Each result: { key, name, email, phone, mc, score, why:[...], source:[...] }, best first.
 */
export function corridorCarriers(load, ctx = {}) {
  const { zipMap, now = Date.now() } = ctx; const radius = Number(ctx.radius) > 0 ? Number(ctx.radius) : 100;
  if (!zipMap || !zipMap.size) return [];
  const oz = spotZip(load.originCity, load.originState, load.originZip, zipMap), dz = spotZip(load.destCity, load.destState, load.destZip, zipMap);
  if (!oz && !dz) return [];
  const out = new Map();
  const put = (who, add, why, src) => {
    const k = carrierKey({ mc: who.mc, email: who.email }) || (who.email ? 'e:' + String(who.email).toLowerCase() : '') || 'n:' + normalizeText(who.name);
    if (!k || k === 'n:') return; if (ctx.exclude && ctx.exclude.has(k)) return;
    const o = out.get(k) || { key: k, name: who.name || '', email: emailOf(who.email), phone: who.phone || '', mc: who.mc || '', score: 0, why: [], source: [] };
    o.name = o.name || who.name || ''; o.phone = o.phone || who.phone || ''; o.score += add;
    if (!o.why.includes(why)) o.why.push(why); if (!o.source.includes(src)) o.source.push(src);
    out.set(k, o);
  };
  const equipOk = (e) => !e || equipFits(load.equip || 'V', e, true);
  // 1. the carrier database: lanes they told you they run
  for (const c of ctx.carriers || []) {
    if (safeString(c.status).toLowerCase() === 'inactive' || !equipOk(c.equipment && /^[A-Z]{1,3}$/.test(c.equipment) ? c.equipment : '')) continue;
    const who = { name: c.carrierName, email: c.email, phone: c.phone, mc: c.mc };
    if (c.destCity && oz) { const cz = spotZip(c.destCity, c.destState, '', zipMap); const d = cz && near(zipMap, cz, oz, radius); if (d !== null && d !== '' && d !== false && cz) put(who, 50 - d / 4, 'delivers near your pickup (' + placeText(c.destCity, c.destState) + ', ' + Math.round(d) + ' mi)', 'carriers'); }
    if (c.originCity && dz) { const cz = spotZip(c.originCity, c.originState, '', zipMap); const d = cz && near(zipMap, cz, dz, radius); if (d !== null && d !== '' && d !== false && cz) put(who, 40 - d / 4, 'based near your delivery (' + placeText(c.originCity, c.originState) + '): this takes them home', 'carriers'); }
  }
  // 2. covers in the last 90 days: where did they end up, where do they live
  for (const e of ctx.coverLog || []) {
    if (e.outcome !== 'Covered' || !e.carrier || !(e.carrier.email || e.carrier.mc)) continue;
    const t = Date.parse(e.closedAt); const days = Number.isFinite(t) ? (now - t) / DAY : 999; if (days > 90) continue;
    const l = e.lane || {}; const who = { name: e.carrier.name, email: e.carrier.email, phone: e.carrier.phone, mc: e.carrier.mc };
    const dzE = spotZip(l.destCity, l.destState, '', zipMap), ozE = spotZip(l.originCity, l.originState, '', zipMap);
    const rec = Math.max(0, 1 - days / 90);
    if (dzE && oz) { const d = near(zipMap, dzE, oz, radius); if (d !== null) put(who, 35 * (0.4 + rec * 0.6), 'delivered ' + Math.round(days) + ' d ago in ' + placeText(l.destCity, l.destState) + ', near your pickup', 'covers'); }
    if (ozE && dz) { const d = near(zipMap, ozE, dz, radius); if (d !== null) put(who, 25 * (0.4 + rec * 0.6), 'picked up in ' + placeText(l.originCity, l.originState) + ', near your delivery', 'covers'); }
  }
  // 3. trucks in the Truck Book that want to go where this load goes
  for (const t of ctx.trucks || []) {
    if (!equipOk(t.equip) || t.destOpen || !t.dCity) continue;
    const tz = spotZip(t.dCity, t.dState, '', zipMap); const d = tz && dz ? near(zipMap, tz, dz, 150) : null;
    if (d !== null) put({ name: t.carrierName, email: t.email, phone: t.phone, mc: t.mc }, 55, 'a truck in ' + placeText(t.oCity, t.oState) + ' wants to go to ' + placeText(t.dCity, t.dState), 'trucks');
  }
  return [...out.values()].map(o => ({ ...o, score: Math.round(o.score * 10) / 10 })).sort((a, b) => b.score - a.score);
}

// ------------------------------------------------------------------------------------------------ backhaul loads, bundling, swaps
/** Estimated delivery day for a load: pickup + 1 day per ~500 miles (at least 1). */
export function deliveryDay(load, zipMap) {
  const start = isoDay(load.pickupEarliest) || todayIso();
  const mi = laneMiles(load, zipMap);
  return addDays(start, Math.max(1, Math.ceil((mi || 500) / 500)));
}

/** The "heads" of the board: one entry per load (not per posting). */
export const headsOf = (postings) => (postings || []).filter(p => !p.variant || p.variant === 'Original');

/**
 * Other loads of YOURS that start where this one ends: a carrier that covers this load has a paying load home. Returns [{ load, gapMiles, daysAfter }].
 */
export function findBackhaulLoads(load, loads, { zipMap = null, radius = 100 } = {}) {
  if (!zipMap || !zipMap.size) return [];
  const dz = spotZip(load.destCity, load.destState, load.destZip, zipMap); if (!dz) return [];
  const arrive = deliveryDay(load, zipMap); const out = [];
  for (const o of loads || []) {
    if (o.id === load.id || o.groupId && o.groupId === load.groupId) continue;
    if (!equipFits(load.equip || 'V', o.equip || 'V', true)) continue;
    const oz = spotZip(o.originCity, o.originState, o.originZip, zipMap); const d = oz && near(zipMap, dz, oz, radius); if (d === null || d === '' || !oz) continue;
    const pick = isoDay(o.pickupEarliest) || arrive, last = isoDay(o.pickupLatest) || pick;
    if (last < arrive) continue;                                                    // the truck would arrive after that load is gone
    out.push({ load: o, gapMiles: Math.round(d), daysAfter: Math.max(0, Math.round((Date.parse(pick) - Date.parse(arrive)) / DAY)) });
  }
  return out.sort((a, b) => a.gapMiles - b.gapMiles || a.daysAfter - b.daysAfter);
}

/** A sentence to put in a carrier e-mail when you have a round trip to offer. */
export function backhaulPitch(load, backhaul) {
  if (!backhaul || !backhaul.load) return '';
  const b = backhaul.load;
  return 'I also have a load out of ' + placeText(b.originCity, b.originState) + ' to ' + placeText(b.destCity, b.destState) + (b.pickupEarliest ? ' ready ' + b.pickupEarliest : '') + ', so this could be a round trip for you.';
}

/** Pairs of your loads that one truck could run back to back ("chain") or two trucks could load from the same place ("same origin"). */
export function bundleOpportunities(heads, { zipMap = null, radius = 75, limit = 12 } = {}) {
  if (!zipMap || !zipMap.size) return [];
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const a = heads[i];
    for (let j = 0; j < heads.length; j++) {
      if (i === j) continue; const b = heads[j];
      if (a.groupId && a.groupId === b.groupId) continue; if (!equipFits(a.equip || 'V', b.equip || 'V', true)) continue;
      const adz = spotZip(a.destCity, a.destState, a.destZip, zipMap), boz = spotZip(b.originCity, b.originState, b.originZip, zipMap);
      if (!adz || !boz) continue;
      const d = near(zipMap, adz, boz, radius); if (d === null) continue;
      const arrive = deliveryDay(a, zipMap), last = isoDay(b.pickupLatest) || isoDay(b.pickupEarliest) || arrive;
      if (last < arrive) continue;
      out.push({ kind: 'chain', first: a, second: b, gapMiles: Math.round(d), text: placeText(a.originCity, a.originState) + ' to ' + placeText(a.destCity, a.destState) + ' then ' + placeText(b.originCity, b.originState) + ' to ' + placeText(b.destCity, b.destState) });
    }
  }
  return out.sort((x, y) => x.gapMiles - y.gapMiles).slice(0, limit);
}

/** Teammates' open rescue requests that fit with this load: whoever covers one can take the other. ctx: { zipMap, radius } */
export function swapOpportunities(load, rescues, { zipMap = null, radius = 100 } = {}) {
  if (!zipMap || !zipMap.size) return [];
  const oz = spotZip(load.originCity, load.originState, load.originZip, zipMap), dz = spotZip(load.destCity, load.destState, load.destZip, zipMap);
  const out = [];
  for (const r of rescues || []) {
    if (r.status && r.status !== 'open') continue; if (!equipFits(load.equip || 'V', r.equip || 'V', true)) continue;
    const rO = spotZip(r.oCity, r.oState, r.oZip, zipMap), rD = spotZip(r.dCity, r.dState, r.dZip, zipMap);
    const forward = dz && rO ? near(zipMap, dz, rO, radius) : null;            // their load starts where mine ends
    const reverse = oz && rD ? near(zipMap, oz, rD, radius) : null;            // their load ends where mine starts
    if (forward !== null) out.push({ rescue: r, kind: 'continue', gapMiles: Math.round(forward), text: 'A truck that delivers yours in ' + placeText(load.destCity, load.destState) + ' can load ' + (r.by || 'a teammate') + "'s " + placeText(r.oCity, r.oState) + ' to ' + placeText(r.dCity, r.dState) + '.' });
    if (reverse !== null) out.push({ rescue: r, kind: 'arrive', gapMiles: Math.round(reverse), text: 'A truck delivering ' + (r.by ? r.by + "'s " : '') + placeText(r.oCity, r.oState) + ' to ' + placeText(r.dCity, r.dState) + ' ends next to your pickup.' });
  }
  return out.sort((a, b) => a.gapMiles - b.gapMiles);
}
