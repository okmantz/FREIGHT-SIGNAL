// Primary / preferred carriers for typical loads ("Taylord Logistics always takes our SC to GA loads").
// An assignment lives beside the carrier (by id / MC) and says which lane it is for. When a load is posted, the best matching assignment is
// offered first, with a ready e-mail draft and a call script. Pure logic; the app stores the records and shows the offer.
import { normalizeText, safeNumeric } from './util.js';
import { stateCode, oneLine, money, placeText } from './netcommon.js';
import { placeKey } from './lanematch.js';

export const KINDS = { lane: 'Exact lanes (city to city)', area: 'Areas (city or state to city or state)' };

/** Normalise a form into an assignment. An empty city means "anywhere in that state". Needs a carrier and at least one state at each end. */
export function cleanAssignment(f = {}, uid = () => 'a' + Math.random().toString(36).slice(2, 9)) {
  const a = {
    id: f.id || uid(), carrierId: oneLine(f.carrierId, 60), carrierName: oneLine(f.carrierName, 80), mc: oneLine(f.mc, 20), email: oneLine(f.email, 120).toLowerCase(), phone: oneLine(f.phone, 30),
    originCity: oneLine(f.originCity, 60), originState: stateCode(f.originState), destCity: oneLine(f.destCity, 60), destState: stateCode(f.destState),
    priority: f.priority === 'backup' ? 'backup' : 'primary', rate: f.rate === '' || f.rate === undefined ? '' : safeNumeric(f.rate) || '', note: oneLine(f.note, 300),
    active: f.active === false ? false : true, createdAt: f.createdAt || new Date().toISOString(), hits: Number(f.hits) || 0, wins: Number(f.wins) || 0, lastOfferedAt: f.lastOfferedAt || '', lastWonAt: f.lastWonAt || '',
  };
  if (!a.carrierName && !a.carrierId && !a.email) return null;
  if (!a.originState && !a.originCity) return null;
  if (!a.destState && !a.destCity) return null;
  return a;
}

export const describeAssignment = (a) => {
  const side = (c, s) => (c ? placeText(c, s) : s ? 'anywhere in ' + s : 'anywhere');
  return side(a.originCity, a.originState) + ' to ' + side(a.destCity, a.destState);
};

/** How well one assignment fits a load: 0 = not at all. City-to-city 100, city / state mixes 85-70, state to state 60. Nearby cities (within `radius` mi) count as 90. */
export function fit(load, a, { zipMap = null, radius = 40 } = {}) {
  if (!a || a.active === false) return 0;
  const end = (lc, ls, ac, as) => {
    const lS = stateCode(ls), aS = stateCode(as);
    if (aS && lS !== aS) return 0;
    if (!ac) return 0.6;                                              // "anywhere in the state"
    if (placeKey(lc, ls) === placeKey(ac, as || ls)) return 1;
    if (zipMap && zipMap.size) { try { const x = zipMap.market(lc, ls), y = zipMap.market(ac, as || ls); if (x && y && zipMap.distanceBetweenZips(x.zip, y.zip) <= radius) return 0.9; } catch { /* no ZIP data */ } }
    return 0;
  };
  const o = end(load.originCity, load.originState, a.originCity, a.originState), d = end(load.destCity, load.destState, a.destCity, a.destState);
  if (!o || !d) return 0;
  return Math.round((o + d) / 2 * 100) * (a.priority === 'backup' ? 0.9 : 1);
}

/** Assignments that fit this load, best first (primary before backup at equal fit). Each carries the carrier row when it is still in the database. */
export function matchAssignments(load, assignments = [], carriers = [], opts = {}) {
  const out = [];
  for (const a of assignments) {
    const f = fit(load, a, opts); if (f <= 0) continue;
    const row = carriers.find(c => (a.carrierId && c.id === a.carrierId)) || carriers.find(c => a.mc && normalizeText(c.mc).replace(/\D/g, '') === a.mc.replace(/\D/g, '') && a.mc.replace(/\D/g, '')) || null;
    const gone = !row && !a.email;
    out.push({ ...a, fit: f, carrier: row, name: a.carrierName || (row && row.carrierName) || '', email: a.email || (row && row.email) || '', phone: a.phone || (row && row.phone) || '', unreachable: gone });
  }
  return out.sort((x, y) => y.fit - x.fit || (y.priority === 'primary') - (x.priority === 'primary') || (y.wins - x.wins));
}

const day = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${Number(m[2])}/${Number(m[3])}` : ''; };

/** E-mail draft + call script for reaching an assigned carrier first. */
export function assignmentDraft(load, a, { signature = '', rate = '' } = {}) {
  const hello = a.name ? 'Hi ' + String(a.name).split(/\s+/)[0] + ' team,' : 'Hello,';
  const pu = load.pickupEarliest || load.pickupDate || '';
  const lane = placeText(load.originCity, load.originState) + ' to ' + placeText(load.destCity, load.destState);
  const r = safeNumeric(rate) || safeNumeric(a.rate) || 0;
  const subject = 'First call: ' + lane + (pu ? ' (' + day(pu) + ')' : '');
  const lines = [
    hello, '',
    'You usually run this lane for us, so you get the first look: ' + lane + (pu ? ', pickup ' + (day(pu) || pu) : '') + '.',
    load.equip ? 'Equipment: ' + load.equip + '.' : '',
    r ? 'I can do ' + money(r) + ' all-in. If you have a truck, reply "yes" and I will send the rate confirmation right away.' : 'If you have a truck for it, reply with your all-in rate and I will confirm right away.',
    'Please send driver and dispatch info as soon as you have it.', '',
    signature || 'Thank you,',
  ].filter((l, i, arr) => l !== '' || (arr[i - 1] !== '' && i > 0));
  const script = ['Call ' + (a.name || 'the carrier') + (a.phone ? ' at ' + a.phone : '') + ':', '"' + lane + (pu ? ', picking up ' + (day(pu) || pu) : '') + '. You usually run this one. ' + (r ? 'I can do ' + money(r) + '. ' : 'What do you need on it? ') + 'Can you cover it?"', 'If yes: send the rate confirmation and ask for driver and dispatch info.'];
  return { to: a.email, subject, body: lines.join('\n'), script: script.join('\n') };
}

/** A carrier that was assigned and then covered the load: counts as a win, otherwise just an offer. Returns the updated record. */
export function recordOutcome(a, { won = false, at = new Date().toISOString() } = {}) {
  return { ...a, hits: (a.hits || 0) + 1, wins: (a.wins || 0) + (won ? 1 : 0), lastOfferedAt: at, lastWonAt: won ? at : a.lastWonAt || '' };
}
