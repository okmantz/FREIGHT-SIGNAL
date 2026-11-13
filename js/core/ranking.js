// Ranked carrier outreach. Replaces "first N carriers in sheet order whose lane text matches exactly" with:
//   * radius matching  - a carrier's lane counts when BOTH ends are within carrierRadiusMiles (default 75) of the load's ends
//   * history          - covers on this lane (from the Cover Log), prior inquiries/replies, response rate, recent covers
//   * courtesy         - carriers already contacted in the last day or two sink; inactive / blocked carriers never appear
// Every candidate comes back with a score and plain-English reasons so the ranking is never a black box.
// Pure functions; the geometry uses the ZIP Map when one is passed and falls back to exact city / state text without it.

import { normalizeText, safeString, safeNumeric, isSameCity, calculateDistanceMiles, CRLF } from './util.js';
import { isBlockedExcel, cleanLoadDetailsText, buildFallbackLoadDetails, buildExcelSubject, buildExcelBody, buildOutlookLoadDetails, buildOutlookOutreach } from './outreach.js';
import { laneKey } from './coverlog.js';
import { templatesOf, fillTemplate } from './ladder.js';
import { classifyLane } from './lanes.js';
import { DEFAULT_SETTINGS } from './defaults.js';

const DAY = 86400000;

function dist(zip, aCity, aState, bCity, bState) {
  if (!zip || !zip.size) return null;
  const a = zip.market(aCity, aState), b = zip.market(bCity, bState);
  if (!a || !b) return null;
  return calculateDistanceMiles(a.lat, a.lng, b.lat, b.lng);
}

const equipWords = (code) => {
  switch (String(code || '').toUpperCase()) { case 'R': case 'RM': return ['reefer', 'r', 'rm']; case 'F': return ['flat', 'f']; case 'SD': return ['step', 'sd', 'flat']; case 'SB': return ['straight', 'box', 'sb']; default: return ['van', 'v', 'vm', 'dry']; }
};

/** How well a carrier's lane fits a load. Returns { tier, tierLabel, geo, why } or null when it does not fit at all. */
export function laneFit(post, c, zip, radius = 75) {
  const oc = safeString(post.originCity), os = safeString(post.originState).toUpperCase(), dc = safeString(post.destCity), ds = safeString(post.destState).toUpperCase();
  const co = safeString(c.originCity), cs = safeString(c.originState).toUpperCase(), cd = safeString(c.destCity), cds = safeString(c.destState).toUpperCase();
  const exactO = !!(co && oc && isSameCity(co, cs, oc, os)), exactD = !!(cd && dc && isSameCity(cd, cds, dc, ds));
  if (exactO && exactD) return { tier: 'A', tierLabel: 'Exact lane', geo: 100, why: 'runs this exact lane' };
  const dO = exactO ? 0 : co ? dist(zip, co, cs, oc, os) : null;
  const dD = exactD ? 0 : cd ? dist(zip, cd, cds, dc, ds) : null;
  const oIn = dO !== null && dO <= radius, dIn = dD !== null && dD <= radius;
  if (oIn && dIn) return { tier: 'B', tierLabel: `Within ${radius} mi`, geo: Math.round(80 - ((dO + dD) / 2) / radius * 20), why: `both ends within ${radius} mi (${Math.round(dO)} / ${Math.round(dD)} mi)` };
  if ((oIn || exactO) && cds && cds === ds) return { tier: 'C', tierLabel: 'Origin area, same dest state', geo: 55, why: `origin ${Math.round(dO || 0)} mi away, same destination state` };
  if (oIn || exactO) return { tier: 'D', tierLabel: 'Origin area', geo: cd ? 38 : 45, why: cd ? `origin ${Math.round(dO || 0)} mi away` : 'open-destination carrier near the origin' };
  if (cs === os && cds === ds && os && ds) return { tier: 'E', tierLabel: 'State-to-state', geo: 32, why: 'same origin and destination state' };
  if (cs === os && os) return { tier: 'F', tierLabel: 'Origin state only', geo: 18, why: 'same origin state' };
  return null;
}

/**
 * Rank every usable carrier for a load.
 * ctx: { zip, inquiries, coverLog, settings, now, exclude:Set(lower-case emails), blocklist }
 * Returns [{ carrier, score, tier, tierLabel, reasons[] }] best first.
 */
export function rankCarriers(post, carriers, ctx = {}) {
  const settings = ctx.settings || DEFAULT_SETTINGS;
  const radius = Number(settings.carrierRadiusMiles) > 0 ? Number(settings.carrierRadiusMiles) : 75;
  const now = (ctx.now || new Date()).getTime();
  const log = ctx.coverLog || [];
  const lane = laneKey(post);
  const coversBy = new Map(); const nearBy = new Map();
  for (const e of log) {
    if (e.outcome !== 'Covered' || !e.carrier || !e.carrier.email) continue;
    const em = e.carrier.email;
    const lk = laneKey(e.covered || e.lane || {}), ok = laneKey(e.lane || {});
    if (lk === lane || ok === lane) coversBy.set(em, (coversBy.get(em) || 0) + 1);
    else {
      const l = e.covered || e.lane || {};
      const dO = dist(ctx.zip, l.originCity, l.originState, post.originCity, post.originState), dD = dist(ctx.zip, l.destCity, l.destState, post.destCity, post.destState);
      if (dO !== null && dD !== null && dO <= radius && dD <= radius) nearBy.set(em, (nearBy.get(em) || 0) + 1);
    }
  }
  const inqBy = new Map();
  for (const q of ctx.inquiries || []) {
    const em = String(q.senderEmail || '').trim().toLowerCase(); if (!em) continue;
    const same = normalizeText(q.originState) === normalizeText(post.originState);
    if (same) inqBy.set(em, (inqBy.get(em) || 0) + (String(q.stage || '').toUpperCase() === 'RATE_RESPONSE_SENT' || safeNumeric(q.lastCarrierRate) > 0 ? 2 : 1));
  }
  const out = [];
  for (const c of carriers) {
    const email = safeString(c.email).toLowerCase();
    if (!email && ctx.requireEmail !== false) continue;
    if (safeString(c.status).toLowerCase() === 'inactive') continue;
    if (email && isBlockedExcel(email, settings.outreachBlocklist)) continue;
    if (ctx.exclude && email && ctx.exclude.has(email)) continue;
    const fit = laneFit(post, c, ctx.zip, radius);
    if (!fit) continue;
    let score = fit.geo; const reasons = [fit.why];
    const cov = coversBy.get(email) || 0, near = nearBy.get(email) || 0;
    if (cov) { score += Math.min(60, cov * 30); reasons.push(`covered this lane ${cov}x`); }
    if (near) { score += Math.min(30, near * 15); reasons.push(`covered a nearby lane ${near}x`); }
    const inq = inqBy.get(email) || 0;
    if (inq) { score += Math.min(24, inq * 8); reasons.push('has replied to loads from this state'); }
    const cc = safeNumeric(c.coverCount); if (cc > 0) { score += Math.min(15, cc * 3); reasons.push(`${cc} cover(s) on record`); }
    const rr = parseFloat(String(c.responseRate ?? '').replace('%', ''));
    if (Number.isFinite(rr) && rr > 0) { score += (Math.min(rr, 100) / 100) * 20; reasons.push(`${Math.round(rr)}% response rate`); }
    const lc = Date.parse(c.lastCovered); if (Number.isFinite(lc) && now - lc < 30 * DAY) { score += 5; reasons.push('covered in the last 30 days'); }
    const ct = Date.parse(c.lastContacted);
    if (Number.isFinite(ct)) { const age = now - ct; if (age < DAY) { score -= 25; reasons.push('contacted in the last 24 h'); } else if (age < 3 * DAY) { score -= 10; reasons.push('contacted in the last 3 days'); } }
    const eq = safeString(c.equipment).toLowerCase();
    if (eq) { const words = equipWords(post.equip); if (words.some(w => new RegExp('\\b' + w + '\\b').test(eq))) { score += 6; } else { score -= 20; reasons.push('equipment may not match'); } }
    out.push({ carrier: c, score: Math.round(score * 10) / 10, tier: fit.tier, tierLabel: fit.tierLabel, reasons });
  }
  return out.sort((a, b) => b.score - a.score || String(a.carrier.carrierName).localeCompare(String(b.carrier.carrierName)));
}

/** How many carriers to contact for a load: Low 5 / Medium 10 / High 15, scaled by the lane class strategy. */
export function outreachCount(post, settings, zip) {
  let base = Math.trunc(Number(post.outreachTarget) || 0);
  if (base < 1) base = settings.lowTarget || 5;
  if (!zip) return base;
  const { strategy } = classifyLane(post, zip, settings);
  return Math.max(1, Math.round(base * (strategy.outreachMultiplier || 1)));
}

/** Drafts for the top-ranked carriers. wave 2 = pass ctx.exclude with everyone already contacted. */
export function planRankedOutreach(post, carriers, ctx = {}) {
  const settings = ctx.settings || DEFAULT_SETTINGS;
  const target = ctx.count || outreachCount(post, settings, ctx.zip);
  const ranked = rankCarriers(post, carriers, ctx);
  const used = new Set(); const drafts = [];
  for (const r of ranked) {
    if (drafts.length >= target) break;
    const email = safeString(r.carrier.email).toLowerCase();
    if (used.has(email)) continue; used.add(email);
    drafts.push({ to: email, subject: buildExcelSubject(post), body: buildExcelBody(post, r.carrier), carrierId: r.carrier.id, tier: r.tierLabel, score: r.score, why: r.reasons.join('; ') });
  }
  const by = {}; drafts.forEach(d => { by[d.tier] = (by[d.tier] || 0) + 1; });
  const detail = `Requested ${target}; created ${drafts.length}, best-ranked first.` + CRLF +
    (Object.keys(by).length ? Object.entries(by).map(([k, v]) => `${k}: ${v}`).join(CRLF) + CRLF : '') +
    'Ranked by lane fit (within the carrier radius), cover history on this lane, replies, response rate and how recently you contacted them.' +
    (drafts.length < target ? CRLF + 'The target was not filled because no more qualified carriers were available.' : '');
  return { drafts, attempted: drafts.length, created: drafts.length, ranked, detail, error: '' };
}

/** "Do you have any trucks available?" draft for one carrier (Carrier Database one-click button). */
export function buildTruckCheck(carrier, settings = DEFAULT_SETTINGS) {
  const t = templatesOf(settings);
  const co = safeString(carrier.originCity), cs = safeString(carrier.originState).toUpperCase(), cd = safeString(carrier.destCity), cds = safeString(carrier.destState).toUpperCase();
  const o = co ? `${co}${cs ? ', ' + cs : ''}` : '', d = cd ? `${cd}${cds ? ', ' + cds : ''}` : '';
  const lane = o && d ? `${o} to ${d}` : o || d || 'your lanes';
  const where = o && d ? `in ${o} heading toward ${d}` : o ? `in ${o}` : d ? `heading toward ${d}` : 'this week';
  const name = safeString(carrier.carrierName);
  const vars = { name, where, lane };
  const body = fillTemplate(t.truckBody, vars).replace(/Hello ,/g, 'Hello,').replace(/Hello  /g, 'Hello ').replace(/\r?\n/g, CRLF);
  return { to: safeString(carrier.email).toLowerCase(), subject: fillTemplate(t.truckSubject, vars).replace(/\s+$/, ''), body, carrierId: carrier.id, kind: 'Truck availability', tier: '' };
}

/** Phone call list for "start calling out": best-ranked carriers that have a phone number. */
export function callList(post, carriers, ctx = {}, n = 10) {
  return rankCarriers(post, carriers.filter(c => safeString(c.phone)), { ...ctx, requireEmail: false, settings: { ...(ctx.settings || DEFAULT_SETTINGS), outreachBlocklist: [] } }).slice(0, n);
}

const isYes = (t) => ['YES', 'Y', 'TRUE', '1'].includes(String(t ?? '').trim().toUpperCase());

/**
 * Lane scan over every Active load with Outreach = Yes (the Outlook v3 "RunCarrierDatabaseScan"), ranked instead of exact-city-pair only.
 * (load, e-mail) pairs already in the outreach log are skipped. At most maxCarriersPerLoad drafts per load.
 */
export function planRankedScan(postings, carriers, outreachLog, ctx = {}) {
  const settings = ctx.settings || DEFAULT_SETTINGS;
  const seen = new Set((outreachLog || []).map(o => String(o.key).toLowerCase()));
  const drafts = [], logEntries = [], countUpdates = new Map();
  for (let i = postings.length - 1; i >= 0; i--) {
    const p = postings[i];
    if (!(String(p.status ?? '').trim().toUpperCase() === 'ACTIVE' && isYes(p.outreach))) continue;
    const loadKey = String(p.loadNumber || p.id).toLowerCase();
    const details = safeString(p.details) ? safeString(p.details) : buildOutlookLoadDetails(p);
    let created = 0;
    for (const r of rankCarriers(p, carriers, ctx)) {
      const email = safeString(r.carrier.email).toLowerCase();
      const key = (loadKey + '|' + email).toLowerCase();
      if (seen.has(key)) continue;
      drafts.push({ ...buildOutlookOutreach(p, email, details), postingId: p.id, carrierId: r.carrier.id, tier: r.tierLabel + ' (score ' + r.score + ')', score: r.score, why: r.reasons.join('; ') });
      logEntries.push({ key, dateTime: new Date().toISOString(), loadNumber: p.loadNumber || '', postingId: p.id, postingRow: i + 2, carrierName: r.carrier.carrierName, email: r.carrier.email, phone: r.carrier.phone, mc: r.carrier.mc,
        originCity: p.originCity, originState: p.originState, destCity: p.destCity, destState: p.destState, score: r.score, status: 'DRAFT CREATED' });
      seen.add(key); countUpdates.set(p.id, (countUpdates.get(p.id) || 0) + 1);
      if (++created >= settings.maxCarriersPerLoad) break;
    }
  }
  return { drafts, logEntries, countUpdates };
}

export { cleanLoadDetailsText, buildFallbackLoadDetails };
