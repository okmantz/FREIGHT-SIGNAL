// DAT bulk-upload export. Output is byte-for-byte shaped like DAT's own "bulk upload template" CSV:
//   * the exact 24-column header row (see DAT_COLUMNS), no BOM, LF line endings, ASCII only
//   * header + postings only (DAT's three instruction rows are NOT included - you must delete them before upload anyway)
//   * value styles copied from the template's sample rows: dates m/d/yyyy, Full/Partial capitalised, yes/no lower-case,
//     contact method lower-case, equipment code (V, R, F ...), rates as whole dollars.
// The "DAT Loadboard Rate" column is a posting's own DAT rate when it has one (the "DAT rate" box on each posting row). Otherwise, when
// `targetAsRate` is on (the board's "Post target rate on DAT" switch, on by default), it is the load's Target rate: the one
// rate typed per load. With the switch off the column stays blank and the target rate is only used to judge carrier replies.
// Posting only SOME of a load's postings with a rate: the moment any posting of a load has its own DAT rate, ONLY the postings that
// have one carry a rate; the rest of that load post without a rate (the target-rate fallback is switched off for that load).

import { DAT_COLUMNS } from './defaults.js';
import { toDelimited } from './csv.js';

const REQUIRED = DAT_COLUMNS.filter(c => c.header.endsWith('*'));

export const datHeader = () => DAT_COLUMNS.map(c => c.header);

/** m/d/yyyy from m/d/yyyy, m/d/yy, yyyy-mm-dd or an ISO timestamp. Unknown text is passed through untouched. */
export function datDate(v) {
  const t = String(v ?? '').trim();
  if (!t) return '';
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return `${+m[1]}/${+m[2]}/${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(t);
  if (m) return `${+m[1]}/${+m[2]}/20${m[3]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${+m[2]}/${+m[3]}/${m[1]}`;
  return t;
}

const yn = (v, dflt) => { const t = String(v ?? '').trim().toLowerCase(); return t === 'yes' || t === 'y' || t === 'true' ? 'yes' : t === 'no' || t === 'n' || t === 'false' ? 'no' : dflt; };
const rate = (v) => { const t = String(v ?? '').replace(/[$,\s]/g, ''); const n = Number(t); return t && Number.isFinite(n) && n > 0 ? String(Math.round(n)) : ''; };
const digits = (v) => String(v ?? '').replace(/[^0-9]/g, '');
// Spreadsheet-safe, ASCII-only free text (comments / commodity / reference id). Newlines would break the one-row-per-posting rule.
const text = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').trim();

/** One posting -> the 24 DAT cell values (strings) in template order. */
export function datRow(p, opts = {}) {
  const equip = String(p.equip ?? '').trim().toUpperCase();
  const usePrivate = yn(p.usePrivate, 'no');
  const useDat = yn(p.useDat, 'yes');
  const v = {
    pickupEarliest: datDate(p.pickupEarliest),
    pickupLatest: datDate(p.pickupLatest),
    length: digits(p.length),
    weight: digits(p.weight),
    fullPartial: /^p/i.test(String(p.fullPartial ?? '')) ? 'Partial' : 'Full',
    equip,
    usePrivate,
    privateRate: usePrivate === 'yes' ? rate(p.privateRate) : '',
    allowPrivBooking: yn(p.allowPrivBooking, 'no'),
    allowPrivBidding: yn(p.allowPrivBidding, 'no'),
    useDat,
    datRate: useDat === 'yes' ? (rate(p.datRate) || (opts.targetAsRate && !opts.ownRates ? rate(p.targetRate) : '')) : '',
    allowDatBooking: yn(p.allowDatBooking, 'no'),
    useExtended: yn(p.useExtended, 'no'),
    contact: String(p.contact ?? 'email').trim().toLowerCase() || 'email',
    originCity: text(p.originCity),
    originState: text(p.originState).toUpperCase(),
    originZip: digits(p.originZip).slice(0, 5),
    destCity: text(p.destCity),
    destState: text(p.destState).toUpperCase(),
    destZip: digits(p.destZip).slice(0, 5),
    comment: text(p.comment),
    commodity: text(p.commodity),
    referenceId: text(p.referenceId),
  };
  return DAT_COLUMNS.map(c => v[c.key] ?? '');
}

const labelOf = (p) => `${p.originCity || '?'}, ${p.originState || '?'} -> ${p.destCity || '?'}, ${p.destState || '?'}${p.variant ? ' (' + p.variant + ')' : ''}`;

/** Required-field check. Returns [{ id, label, missing:[header...] }] for postings DAT would reject. */
export function datProblems(postings) {
  const out = [];
  for (const p of postings) {
    const row = datRow(p);
    const missing = REQUIRED.filter(c => !String(row[DAT_COLUMNS.indexOf(c)]).trim()).map(c => c.header.replace('*', ''));
    if (missing.length) out.push({ id: p.id, label: labelOf(p), missing });
  }
  return out;
}

/** Postings that go to DAT (covered rows never do). */
export const datPostings = (postings) => postings.filter(p => String(p.status ?? 'Active').toLowerCase() !== 'covered');

/** Key of the load a posting belongs to (its group id, or its own id when it has none). */
export const loadKey = (p) => { const g = String(p.groupId ?? '').trim().toLowerCase(); return g ? 'g:' + g : 'p:' + p.id; };

/**
 * Loads where at least one posting has its OWN DAT rate: Set of loadKey. `all` is every posting on the board, so a single posting
 * downloaded on its own still knows whether its siblings carry rates.
 */
export function loadsWithOwnRates(all) {
  const out = new Set();
  for (const p of all || []) if (String(p.status ?? 'Active').toLowerCase() !== 'covered' && rate(p.datRate)) out.add(loadKey(p));
  return out;
}

/** How a load's rate will go out: { own: true, count } when only some postings carry one, else the target rate on every posting (when on). */
export function loadRateInfo(members, opts = {}) {
  const live = datPostings(members);
  const own = live.filter(p => rate(p.datRate));
  if (own.length) return { mode: 'own', count: own.length, total: live.length };
  const t = live.some(p => rate(p.targetRate));
  return opts.targetAsRate && t ? { mode: 'target', count: live.length, total: live.length } : { mode: 'none', count: 0, total: live.length };
}

export function datRows(postings, opts = {}) {
  const own = loadsWithOwnRates(opts.all || postings);
  return datPostings(postings).map(p => datRow(p, { ...opts, ownRates: own.has(loadKey(p)) }));
}

/** The upload file: header + one line per posting, LF endings, no BOM. */
export function datCsv(postings, opts = {}) {
  return toDelimited([datHeader(), ...datRows(postings, opts)], ',', '\n');
}

/** Tab-separated, for pasting straight into the DAT template workbook. Header optional. */
export function datTsv(postings, withHeader = false, opts = {}) {
  const rows = datRows(postings, opts);
  if (withHeader) rows.unshift(datHeader());
  return rows.map(r => r.join('\t')).join('\n');
}

const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Download file name: whole list, a lane group, or one posting. */
export function datFileName(kind, postings = [], date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  if (kind === 'all') return `freight-signal-dat-all-${d}.csv`;
  const h = postings.find(p => p.variant === 'Original') || postings[0] || {};
  const lane = [slug(h.originCity), h.originState, 'to', slug(h.destCity), h.destState].filter(Boolean).join('-');
  if (kind === 'group') return `freight-signal-dat-${lane}-${d}.csv`;
  if (kind === 'selected') return `freight-signal-dat-selected-${postings.length}-${d}.csv`;
  return `freight-signal-dat-${lane}${h.variant ? '-' + slug(h.variant) : ''}-${d}.csv`;
}
