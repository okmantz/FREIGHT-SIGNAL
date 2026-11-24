// Relevance search for the Carrier and Customer databases (v21). Pure: no DOM, no storage.
//
// What it does that a plain "does the row contain this text" filter does not:
//   * every word you type must match somewhere (name, MC, phone, e-mail, city, state, equipment, notes...), in any order and any field
//   * results are ranked: a name that starts with your word beats an e-mail that merely contains it, an exact word beats a prefix,
//     a prefix beats a fragment, and a fragment beats a typo match
//   * phone numbers and MC / DOT numbers match on digits only, so "717 555", "(717) 555-0100" and "5550100" all find the same carrier
//   * a small typo is forgiven ("keystne" finds Keystone) once a word is long enough for that to be safe
//   * filler words ("inc", "llc", "trucking", "logistics", "transport"...) count for little when you typed something more specific
//   * "field:value" narrows to one field: mc:123456  st:pa  city:harrisburg  equip:reefer  email:keystone  phone:717  name:smith
//   * "quoted words" must appear together, in that order, in one field
//   * when nothing matches every word, you get the closest partial matches (flagged) instead of an empty table
// Ties fall back to a small "who is more useful" boost (primary carrier, covers on record), then A to Z.

const FILLER = new Set(['inc', 'llc', 'ltd', 'co', 'corp', 'corporation', 'company', 'the', 'and', 'of', 'transport', 'transportation', 'transports', 'trucking', 'truck', 'trucks', 'logistics', 'freight', 'express', 'lines', 'line', 'carrier', 'carriers', 'services', 'service', 'group', 'enterprises', 'solutions', 'systems', 'intl', 'international', 'brokerage', 'shipping', 'hauling', 'haul', 'llp', 'lp', 'dba']);

/** Lower case, accents removed, everything that is not a letter or digit becomes one space. */
export function norm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
export const digitsOf = (s) => String(s ?? '').replace(/\D+/g, '');
const wordsOf = (s) => { const n = norm(s); return n ? n.split(' ') : []; };

/** Edit distance with an early exit once it is certain to exceed `max`. Counts a swap of two neighbours as one edit. */
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  let prev2 = null, prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v; if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[lb];
}

/** Turn what the person typed into a query: { raw, terms:[{text, digits, filler, field, phrase}] }. */
export function parseQuery(raw, fieldAliases = {}) {
  const src = String(raw ?? '').trim(); const terms = [];
  if (!src) return { raw: src, terms };
  const re = /(?:([a-z]+):)?(?:"([^"]+)"|(\S+))/gi; let m;
  while ((m = re.exec(src))) {
    let field = ''; let body = m[2] !== undefined ? m[2] : m[3]; const phrase = m[2] !== undefined;
    if (m[1] && fieldAliases[m[1].toLowerCase()]) field = fieldAliases[m[1].toLowerCase()];
    else if (m[1]) body = m[1] + ':' + body;                                    // an unknown "word:" is just text
    const text = norm(body); if (!text) continue;
    const parts = phrase ? [text] : text.split(' ');
    for (const p of parts) terms.push({ text: p, digits: digitsOf(body), filler: !phrase && !field && FILLER.has(p), field, phrase });
  }
  // a query made only of filler words is taken at face value
  if (terms.length && terms.every(t => t.filler)) terms.forEach(t => { t.filler = false; });
  return { raw: src, terms };
}

/** How one query word scores against one field's words. 0 = no match. */
function scoreWord(term, field, words) {
  const t = term.text; if (!t) return 0;
  const long = t.length;
  let best = 0;
  if (field.kind === 'code') return words.includes(t) ? 1 : 0;                       // state codes: exact only
  if (field.kind === 'digits') {                                                     // phone, MC / DOT: digits only
    const d = term.digits; if (d.length < (field.minDigits || 3)) return 0;
    const all = field.digits || ''; if (!all) return 0;
    if (all === d || (all.endsWith(d) && d.length >= 7)) return 1;
    if (all.startsWith(d)) return 0.85;
    if (all.includes(d)) return 0.6;
    return 0;
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === t) { best = Math.max(best, i === 0 ? 1 : 0.95); continue; }
    if (long >= 1 && w.startsWith(t)) { if (long >= 2 || field.kind === 'name') best = Math.max(best, (i === 0 ? 0.88 : 0.8) * Math.min(1, 0.7 + long * 0.1)); continue; }
    if (long >= 3 && w.includes(t)) { best = Math.max(best, 0.5); continue; }
    if (long >= 4 && w.length >= 4) {
      const max = long >= 8 ? 2 : 1;
      const d = Math.min(editDistance(t, w, max), editDistance(t, w.slice(0, Math.min(w.length, long + 1)), max));
      if (d <= max) best = Math.max(best, d === 1 ? 0.42 : 0.34);
    }
  }
  return best;
}

/**
 * Prepare one record: for each field the normalised words and digits are worked out once (cached per record while its text is unchanged).
 * spec.fields = [{ id, get(record), weight, kind?: 'name'|'text'|'code'|'digits'|'email', aliases?: [..] }]
 */
const CACHE = new WeakMap();
function indexOf(rec, spec) {
  const vals = spec.fields.map(f => { const v = f.get(rec); return Array.isArray(v) ? v.join(' ; ') : String(v ?? ''); });
  const sig = vals.join('\u0001'); const hit = CACHE.get(rec);
  const id = spec.cacheId || spec;
  if (hit && hit.id === id && hit.sig === sig) return hit.idx;
  const idx = spec.fields.map((f, i) => {
    const raw = vals[i]; const n = norm(raw);
    return { text: n, words: n ? n.split(' ') : [], digits: f.kind === 'digits' ? digitsOf(raw) : '' };
  });
  CACHE.set(rec, { id, sig, idx });
  return idx;
}

/**
 * Rank `records` against `query`.
 * Returns { results: [{ record, score, matched:[fieldId], all: boolean }], partial: boolean, terms }.
 * No query -> every record, in the order given. partial = nothing matched every word, so these are the closest matches.
 */
export function searchRecords(records, query, spec) {
  const q = typeof query === 'string' ? parseQuery(query, spec.aliases || {}) : query;
  if (!q.terms.length) return { results: records.map(record => ({ record, score: 0, matched: [], all: true })), partial: false, terms: [] };
  const scored = [];
  const nonFiller = q.terms.filter(t => !t.filler).length;
  for (const record of records) {
    const idx = indexOf(record, spec);
    let total = 0, hits = 0, reqHits = 0; const matched = new Set();
    for (const term of q.terms) {
      let best = 0, bestField = '', extra = 0;
      for (let i = 0; i < spec.fields.length; i++) {
        const f = spec.fields[i];
        if (term.field && f.aliases && !f.aliases.includes(term.field) && f.id !== term.field) continue;
        if (term.field && !f.aliases && f.id !== term.field) continue;
        let s;
        if (term.phrase) s = idx[i].text.includes(term.text) ? (idx[i].text.startsWith(term.text) ? 1 : 0.8) : 0;
        else s = scoreWord(term, { ...f, digits: idx[i].digits }, idx[i].words);
        const w = s * f.weight;
        if (w > best) { if (best) extra += best * 0.08; best = w; bestField = f.id; } else if (w > 0) extra += w * 0.08;
      }
      if (best > 0) { hits++; if (!(term.filler && nonFiller)) reqHits++; matched.add(bestField); total += (term.filler && nonFiller ? 0.3 : 1) * (best + Math.min(extra, best * 0.25)); }
    }
    if (!hits) continue;
    // the whole phrase typed in order inside the name is the best possible sign that this is the one they meant
    const whole = norm(q.raw);
    if (whole && q.terms.length > 1 && !q.terms.some(t => t.field)) { const nm = spec.fields.find(f => f.kind === 'name'); if (nm) { const t = idx[spec.fields.indexOf(nm)].text; if (t.includes(whole)) total += nm.weight * (t.startsWith(whole) ? 1.2 : 0.8); } }
    const bonus = spec.boost ? Math.max(0, Math.min(spec.boostMax || 6, Number(spec.boost(record)) || 0)) : 0;
    scored.push({ record, score: total + bonus * 0.1, matched: [...matched], all: nonFiller ? reqHits === nonFiller : hits === q.terms.length, hits });
  }
  const full = scored.filter(r => r.all);
  const use = full.length ? full : scored.sort((a, b) => b.hits - a.hits || b.score - a.score);
  const name = spec.fields.find(f => f.kind === 'name');
  const nameOf = (r) => (name ? String(name.get(r.record) || '') : '');
  use.sort((a, b) => b.score - a.score || nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }));
  return { results: use, partial: !full.length && use.length > 0, terms: q.terms };
}

/**
 * Split text into [{ text, hit }] so the pieces that matched can be highlighted. Only whole-word starts and fragments are marked
 * (a typo match is not highlighted because there is nothing honest to point at).
 */
export function highlightParts(text, terms) {
  const s = String(text ?? ''); if (!s || !terms || !terms.length) return [{ text: s, hit: false }];
  const low = s.toLowerCase(); if (low.length !== s.length || s.normalize('NFD').length !== s.length) return [{ text: s, hit: false }];   // accents change the length: skip rather than misplace
  const marks = new Array(s.length).fill(false);
  for (const t of terms) {
    const w = t.text; if (!w) continue;
    let from = 0; let at;
    while ((at = low.indexOf(w, from)) !== -1) {
      const wordStart = at === 0 || !/[a-z0-9]/.test(low[at - 1]);
      if (wordStart || w.length >= 3) for (let i = at; i < at + w.length; i++) marks[i] = true;
      from = at + Math.max(1, w.length);
    }
  }
  const out = []; let cur = ''; let curHit = false;
  for (let i = 0; i < s.length; i++) { if (i && marks[i] !== curHit) { out.push({ text: cur, hit: curHit }); cur = ''; } curHit = marks[i]; cur += s[i]; }
  if (cur) out.push({ text: cur, hit: curHit });
  return out;
}

/* ------------------------------------------------------------------------------------------------ the two databases */
const lanesText = (c) => (Array.isArray(c.ranLanes) ? c.ranLanes.map(l => [l.originCity, l.originState, l.destCity, l.destState].filter(Boolean).join(' ')).join(' ; ') : '');

/** Field weights for the Carrier Database. `extra(c)` may return { primaryText } (e.g. "primary SC to GA") so "primary" finds starred carriers. */
export function carrierSpec(extra = () => ({}), boostFn = null) {
  return {
    cacheId: 'carrier',
    aliases: { name: 'name', carrier: 'name', mc: 'mc', dot: 'mc', phone: 'phone', tel: 'phone', email: 'email', mail: 'email', city: 'city', st: 'state', state: 'state', equip: 'equip', equipment: 'equip', notes: 'notes', note: 'notes', lane: 'lane', primary: 'primary' },
    fields: [
      { id: 'name', kind: 'name', weight: 10, aliases: ['name'], get: (c) => c.carrierName },
      { id: 'mc', kind: 'digits', weight: 9, minDigits: 3, aliases: ['mc'], get: (c) => c.mc },
      { id: 'phone', kind: 'digits', weight: 7, minDigits: 3, aliases: ['phone'], get: (c) => [c.phone, c.dispatchPhone, c.driverPhone].filter(Boolean).join(' ') },
      { id: 'email', kind: 'email', weight: 6, aliases: ['email'], get: (c) => [c.email, ...(Array.isArray(c.altEmails) ? c.altEmails : [])].filter(Boolean).join(' ') },
      { id: 'city', kind: 'text', weight: 4, aliases: ['city', 'lane'], get: (c) => [c.originCity, c.destCity].filter(Boolean).join(' ') },
      { id: 'state', kind: 'code', weight: 3.5, aliases: ['state', 'lane'], get: (c) => [c.originState, c.destState].filter(Boolean).join(' ') },
      { id: 'equip', kind: 'text', weight: 4, aliases: ['equip'], get: (c) => c.equipment },
      { id: 'primary', kind: 'text', weight: 5, aliases: ['primary', 'lane'], get: (c) => extra(c).primaryText || '' },
      { id: 'contact', kind: 'text', weight: 3, get: (c) => c.driverName },
      { id: 'lanes', kind: 'text', weight: 2.5, aliases: ['lane'], get: lanesText },
      { id: 'notes', kind: 'text', weight: 2, aliases: ['notes'], get: (c) => [c.notes, c.preferredPickupDates, c.status].filter(Boolean).join(' ') },
    ],
    boost: boostFn || ((c) => (Number(c.coverCount) > 0 ? Math.min(3, Number(c.coverCount) / 2) : 0) + (extra(c).primaryText ? 3 : 0)),
  };
}

export function customerSpec() {
  return {
    cacheId: 'customer',
    aliases: { name: 'name', company: 'name', contact: 'contact', phone: 'phone', tel: 'phone', email: 'email', mail: 'email', city: 'city', st: 'state', state: 'state', equip: 'equip', equipment: 'equip', notes: 'notes', note: 'notes', lane: 'lane', industry: 'industry' },
    fields: [
      { id: 'name', kind: 'name', weight: 10, aliases: ['name'], get: (c) => c.company },
      { id: 'contact', kind: 'text', weight: 8, aliases: ['contact'], get: (c) => c.contactName },
      { id: 'phone', kind: 'digits', weight: 7, minDigits: 3, aliases: ['phone'], get: (c) => c.phone },
      { id: 'email', kind: 'email', weight: 6, aliases: ['email'], get: (c) => c.email },
      { id: 'city', kind: 'text', weight: 4, aliases: ['city', 'lane'], get: (c) => c.city },
      { id: 'state', kind: 'code', weight: 3.5, aliases: ['state', 'lane'], get: (c) => c.state },
      { id: 'title', kind: 'text', weight: 3, get: (c) => c.title },
      { id: 'industry', kind: 'text', weight: 3.5, aliases: ['industry'], get: (c) => [c.industry, c.equipment].filter(Boolean).join(' ') },
      { id: 'lanes', kind: 'text', weight: 2.5, aliases: ['lane'], get: (c) => c.lanes },
      { id: 'notes', kind: 'text', weight: 2, aliases: ['notes'], get: (c) => [c.notes, c.status].filter(Boolean).join(' ') },
    ],
    boost: () => 0,
  };
}
