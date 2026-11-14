// Click-to-sort for the Carrier and Customer database tables. Pure functions (no DOM), so they are unit-tested.
//
// Click a column header: A-Z (low to high), click again: Z-A (high to low), click again: random order, click again: back to A-Z.
// Another column always starts at A-Z. Empty cells always sink to the bottom, so a half-filled column still reads well.
// "Random" is a seeded shuffle: the order holds while you type in the search box or edit a row, and only changes on the next click.

export const CYCLE = ['asc', 'desc', 'random'];

const newSeed = (rand = Math.random) => 1 + Math.floor(rand() * 2147483646);

/** The sort state after a click on column `key`. cur = { key, mode, seed } or null. */
export function nextSort(cur, key, rand = Math.random) {
  if (!cur || cur.key !== key) return { key, mode: 'asc', seed: 0 };
  const mode = CYCLE[(CYCLE.indexOf(cur.mode) + 1) % CYCLE.length];
  return { key, mode, seed: mode === 'random' ? newSeed(rand) : 0 };
}

const isBlank = (v) => String(v ?? '').trim() === '';

/** "$1,850" / "80%" / "12" -> number, anything else -> null. */
const asNumber = (v) => {
  const s = String(v ?? '').trim().replace(/[$,%\s]/g, '');
  return /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null;
};
const DATE_LIKE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}\/\d{2,4})/;
const asTime = (v) => { const s = String(v ?? '').trim(); if (!DATE_LIKE.test(s)) return null; const t = Date.parse(s); return Number.isFinite(t) ? t : null; };

/** 'number' | 'date' | 'text', judged from every filled cell of the column (one stray word makes the whole column text). */
export function columnKind(values) {
  const filled = values.filter(v => !isBlank(v));
  if (!filled.length) return 'text';
  if (filled.every(v => asNumber(v) !== null)) return 'number';
  if (filled.every(v => asTime(v) !== null)) return 'date';
  return 'text';
}

/** Small string hash (FNV-1a plus a finaliser), so the shuffle is repeatable for a given seed. */
function hash(str, seed) {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Returns a NEW array in the requested order (the input is never changed).
 *   get(row, key) -> the cell value; id(row) -> a stable id used only to keep the random order steady (defaults to row.id).
 * With no sort active the rows come back in their original order.
 */
export function sortRows(rows, sort, get = (r, k) => r[k], id = (r) => r.id) {
  const list = rows.map((row, i) => ({ row, i }));
  if (!sort || !sort.key) return list.map(x => x.row);
  if (sort.mode === 'random') {
    const seed = sort.seed || 1;
    list.forEach(x => { x.h = hash(String(id(x.row) ?? x.i), seed); });
    return list.sort((a, b) => a.h - b.h || a.i - b.i).map(x => x.row);
  }
  const kind = columnKind(rows.map(r => get(r, sort.key)));
  const dir = sort.mode === 'desc' ? -1 : 1;
  const key = (r) => { const v = get(r, sort.key); return kind === 'number' ? asNumber(v) : kind === 'date' ? asTime(v) : String(v).trim(); };
  list.forEach(x => { x.blank = isBlank(get(x.row, sort.key)); if (!x.blank) x.k = key(x.row); });
  return list.sort((a, b) => {
    if (a.blank !== b.blank) return a.blank ? 1 : -1;            // blanks last, whichever direction
    if (a.blank && b.blank) return a.i - b.i;
    const c = kind === 'text' ? a.k.localeCompare(b.k, undefined, { numeric: true, sensitivity: 'base' }) : a.k - b.k;
    return c * dir || a.i - b.i;
  }).map(x => x.row);
}
