// Quick load entry: "aiken sc-fletcher ok", "Aiken, SC to Fletcher, OK", "Aiken south carolina to fletcher oklahoma".
//
// parseQuickLoads(text, zipMap) reads one load per line, works out the origin and destination city/state (checking them against the
// ZIP Map when it is loaded), and fills in the defaults: 53 ft dry van, 40,000 lbs, pickup today.
// buildStandardLoadDetails(fields, zipMap) writes the load details in the standard "1 pick - 1 drop" layout; those details are what is
// saved on the load and what the first reply to a carrier uses. Pure functions (no DOM), unit-tested.

import { normalizeText, normalizeZip } from './util.js';
import { equipFromText, equipLabel } from './equipment.js';
import { laneMiles } from './lanes.js';

export const QUICK_DEFAULTS = { weight: 40000, equip: 'V', length: 53 };
const WINDOW = 'FCFS 08:00 to 16:00';
const MILES_PER_DAY = 500;          // one driver: used only to suggest a delivery date
export const SAME_DAY_MILES = 300;  // a lane shorter than this picks up and delivers the same day

export const US_STATES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware',
  DC: 'district of columbia', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
  KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
  MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico',
  NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island',
  SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington',
  WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming', PR: 'puerto rico',
};
const NAME_TO_ABBR = new Map(Object.entries(US_STATES).map(([a, n]) => [n, a]));
const ABBRS = new Set(Object.keys(US_STATES));
const SHORT = { st: 'saint', ft: 'fort', mt: 'mount', ste: 'sainte' };
const LONG = { saint: 'st', fort: 'ft', mount: 'mt', sainte: 'ste' };

const titleCase = (s) => s.split(' ').filter(Boolean).map(w => w.replace(/^([a-z])/, (c) => c.toUpperCase())).join(' ');
const pad2 = (n) => String(n).padStart(2, '0');
/** MM/DD/YYYY, as TQL writes it. */
export const fmtDate = (d) => `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
/** m/d/yyyy with no padding, the way the board stores pickup dates. */
export const fmtDateShort = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };

// ------------------------------------------------------------------ one end of the lane: "aiken sc", "aiken, south carolina 29801"
function cityVariants(words) {
  const out = new Set([words.join(' ')]);
  out.add(words.map(w => SHORT[w] || w).join(' '));
  out.add(words.map(w => LONG[w] || w).join(' '));
  return [...out];
}

function levenshtein(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const strip = (s) => s.replace(/[^a-z0-9]/g, '');
/** state -> Map(lower-case city with no spaces or punctuation -> its market), so "ofallon" finds "O'Fallon" and "winston-salem" finds "Winston Salem". Built once per ZIP Map. */
function marketsByState(zipMap) {
  if (zipMap._quickByState) return zipMap._quickByState;
  const by = new Map();
  for (const m of zipMap.markets().values()) {
    let l = by.get(m.state); if (!l) by.set(m.state, l = new Map());
    const key = strip(normalizeText(m.city)); const cur = l.get(key);
    if (!cur || m.pop > cur.pop) l.set(key, m);
  }
  zipMap._quickByState = by;
  return by;
}

/** Look a city up in the ZIP Map: exact (also St/Saint, Ft/Fort, Mt/Mount), then a one- or two-letter typo within the same state. */
function lookupCity(zipMap, words, st) {
  const list = marketsByState(zipMap).get(st);
  if (!list) return null;
  for (const v of cityVariants(words)) {
    const m = list.get(strip(v));
    if (m) return { city: m.city, zip: m.zip, exact: true };
  }
  const want = strip(words.join(' '));
  const max = want.length <= 3 ? 0 : want.length <= 7 ? 1 : 2;
  if (!max) return null;
  let best = null;
  for (const [key, m] of list) {
    const d = levenshtein(want, key, max);
    if (d <= max && (!best || d < best.d || (d === best.d && m.pop > best.m.pop))) best = { d, m };
  }
  return best ? { city: best.m.city, zip: best.m.zip, exact: false } : null;
}

/** Read "city state [zip]". score: 3 found in the ZIP Map, 2 found after fixing a typo, 1 state found but city not in the ZIP Map, 0 not a place. */
export function parseEnd(text, zipMap) {
  const raw = String(text ?? '').toLowerCase().replace(/[,;()]/g, ' ').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  const bad = { score: 0, city: '', state: '', zip: '' };
  if (!raw) return bad;
  let words = raw.split(' ');
  let zip = '';
  if (/^\d{5}(-\d{4})?$/.test(words[words.length - 1])) zip = normalizeZip(words.pop());
  let st = '';
  for (const n of [3, 2, 1]) {
    if (words.length <= n) continue;
    const a = NAME_TO_ABBR.get(words.slice(-n).join(' '));
    if (a) { st = a; words = words.slice(0, -n); break; }
  }
  if (!st && words.length > 1) {
    const last = words[words.length - 1].toUpperCase();
    if (ABBRS.has(last)) { st = last; words = words.slice(0, -1); }
  }
  if (!st || !words.length || words.length > 5 || !/[a-z]/.test(words.join(''))) return bad;
  const out = { score: 1, city: titleCase(words.join(' ')), state: st, zip, fixed: false };
  if (zipMap && zipMap.size) {
    const hit = lookupCity(zipMap, words, st);
    if (hit) {
      out.city = hit.city; out.fixed = !hit.exact; out.score = hit.exact ? 3 : 2;
      out.zip = zip && zipMap.zipMatchesCityState(zip, hit.city, st) ? zip : hit.zip;
    } else if (zip) {
      const z = zipMap.findZip(zip);
      if (z && z.state === st) { out.city = z.city; out.score = 3; }
    }
  }
  return out;
}

// ------------------------------------------------------------------ one line -> one load
const SEPARATORS = /\s*(?:->|=>|→|➔|»|>|–|—|-|\/|\||\bto\b|\bthru\b)\s*/gi;

function splitCandidates(line) {
  const cands = [];
  for (const m of line.matchAll(SEPARATORS)) {
    cands.push({ left: line.slice(0, m.index), right: line.slice(m.index + m[0].length), bonus: 0.2 });
  }
  const words = line.split(/\s+/);
  for (let k = 1; k < words.length; k++) cands.push({ left: words.slice(0, k).join(' '), right: words.slice(k).join(' '), bonus: 0 });
  return cands;
}

function pullExtras(line, now) {
  let s = ' ' + line + ' ';
  const x = {};
  const take = (re, fn) => { const m = re.exec(s); if (m) { s = s.replace(m[0], ' '); fn(m); } };
  take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
    let y = m[3] ? Number(m[3]) : now.getFullYear(); if (y < 100) y += 2000;
    const d = new Date(y, Number(m[1]) - 1, Number(m[2]));
    if (!m[3] && startOfDay(d) < startOfDay(now) && now - d > 7 * 86400000) d.setFullYear(y + 1);   // "1/5" typed in late December means next January
    if (d.getMonth() === Number(m[1]) - 1) x.pickup = d;
  });
  take(/\b(today|tomorrow|tmrw)\b/i, (m) => { x.pickup = addDays(now, m[1].toLowerCase() === 'today' ? 0 : 1); });
  take(/(\d{1,3}(?:,\d{3})+|\d{4,6})\s*(?:lbs?|pounds?)\b/i, (m) => { x.weight = Number(m[1].replace(/,/g, '')); });
  take(/\b(\d{2})\s?k\s*(?:lbs?)?(?=\s)/i, (m) => { x.weight = Number(m[1]) * 1000; });
  take(/\b(53|48|45|40|26|24)\s?(?:ft|foot|feet|')(?=\s|$)/i, (m) => { x.length = Number(m[1]); });
  take(/\b(reefer|refrigerated|flat\s?bed|step\s?deck|power\s?only|hot\s?shot|box\s?truck|straight\s?truck|sprinter|conestoga|rgn)\b/i, (m) => { x.equip = equipFromText(m[1]); });
  take(/\bdry\s+van\b/i, () => {});
  return { text: s.replace(/\s+/g, ' ').trim(), ...x };
}

/** Read one line. Returns null when it does not hold an origin and a destination. */
export function parseQuickLine(line, zipMap, now = new Date()) {
  const cleaned = String(line ?? '').replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/^\s*from\s+/i, '').trim();
  if (!cleaned) return null;
  const ex = pullExtras(cleaned, now);
  let best = null;
  for (const c of splitCandidates(ex.text)) {
    const o = parseEnd(c.left, zipMap), d = parseEnd(c.right, zipMap);
    if (!o.score || !d.score) continue;
    const score = o.score + d.score + c.bonus;
    if (!best || score > best.score) best = { score, o, d };
  }
  if (!best) return null;
  const { o, d } = best;
  const warnings = [];
  for (const [side, e] of [['Origin', o], ['Destination', d]]) {
    if (e.fixed) warnings.push(`${side} read as ${e.city}, ${e.state}: check the spelling.`);
    else if (e.score === 1 && zipMap && zipMap.size) warnings.push(`${side} "${e.city}, ${e.state}" is not in the ZIP Map.`);
  }
  const pickup = ex.pickup || startOfDay(now);
  const weight = ex.weight || QUICK_DEFAULTS.weight;
  const equip = ex.equip || QUICK_DEFAULTS.equip;
  const length = ex.length || QUICK_DEFAULTS.length;
  const f = {
    originCity: o.city, originState: o.state, originZip: o.zip, destCity: d.city, destState: d.state, destZip: d.zip,
    pickupEarliest: fmtDateShort(pickup), pickupLatest: fmtDateShort(pickup), weight: String(weight), equip, length,
  };
  return { fields: f, warnings, confident: o.score + d.score >= 5 };
}

/** Does this paste look like a typed lane (no TQL labels) rather than a TQL load? */
export const looksLikeLabelledLoad = (text) => /^\s*(pickup|delivery)\s*(date\/time)?\s*:/im.test(String(text ?? ''));

/** One load per non-empty line. { loads: [{ raw, fields, warnings }], skipped: [lines that were not a lane] } */
export function parseQuickLoads(text, zipMap, now = new Date()) {
  const loads = [], skipped = [];
  for (const raw of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim()) continue;
    const r = parseQuickLine(raw, zipMap, now);
    if (r) loads.push({ raw, ...r }); else skipped.push(raw.trim());
  }
  return { loads, skipped };
}

// ------------------------------------------------------------------ the standard load details
const commas = (n) => Number(n).toLocaleString('en-US');

/**
 * The load details, in the layout carriers see. `f` needs the lane (city/state, ZIPs optional: filled from the ZIP Map), pickupEarliest (m/d/yyyy),
 * weight, equip and length. The delivery date is the pickup day itself under 300 miles, otherwise the pickup plus one day per 500 miles (at least one).
 */
export function buildStandardLoadDetails(f, zipMap, now = new Date()) {
  const zipOf = (city, st, zip) => normalizeZip(zip) || (zipMap && zipMap.size && city && st ? zipMap.bestZipForCityState(city, st) : '');
  const oz = zipOf(f.originCity, f.originState, f.originZip), dz = zipOf(f.destCity, f.destState, f.destZip);
  const miles = Math.round(laneMiles({ originZip: oz, destZip: dz, originCity: f.originCity, originState: f.originState, destCity: f.destCity, destState: f.destState }, zipMap) || 0);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(f.pickupEarliest ?? '').trim());
  const pick = m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : startOfDay(now);
  // Under 300 miles it is a same-day pickup and delivery; otherwise one day per 500 miles (at least one). Unknown miles keep the old next-day default.
  const drop = addDays(pick, miles > 0 && miles < SAME_DAY_MILES ? 0 : Math.max(1, Math.ceil(miles / MILES_PER_DAY)));
  const w = Number(String(f.weight ?? '').replace(/[^0-9.]/g, '')) || QUICK_DEFAULTS.weight;
  const place = (c, s, z) => `${String(c ?? '').trim()}, ${String(s ?? '').trim().toUpperCase()}${z ? ' ' + z : ''}`;
  return [
    '1 pick - 1 drop',
    '',
    ' Pick 1',
    ` Pickup: ${place(f.originCity, f.originState, oz)}`,
    ` Pickup Date/Time: ${fmtDate(pick)} ${WINDOW}`,
    '',
    ' Drop 1',
    ` Delivery: ${place(f.destCity, f.destState, dz)}`,
    ` Delivery Date/Time: ${fmtDate(drop)} ${WINDOW}`,
    '',
    ` Weight: ${commas(w)} lbs`,
    ' Commodity:',
    ' Temp:',
    ` Miles: ${miles || ''}`.trimEnd(),
    ` Trailer Type: ${equipLabel(f.equip || QUICK_DEFAULTS.equip)}`,
    ` Trailer Size: ${f.length || QUICK_DEFAULTS.length} ft`,
  ].join('\n');
}
