// DAT bulk-upload export. Output is byte-for-byte shaped like DAT's own "bulk upload template" CSV:
//   * the exact 24-column header row (see DAT_COLUMNS), no BOM, LF line endings, ASCII only
//   * header + postings only (DAT's three instruction rows are NOT included - you must delete them before upload anyway)
//   * value styles copied from the template's sample rows: dates m/d/yyyy, Full/Partial capitalised, yes/no lower-case,
//     contact method lower-case, equipment code (V, R, F ...), rates as whole dollars.
// The "DAT Loadboard Rate" column is the SELECT rate you type on the board. It is deliberately separate from the
// target rate, which is only used when judging carrier replies in e-mail.

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
export function datRow(p) {
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
    datRate: useDat === 'yes' ? rate(p.datRate) : '',
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

export function datRows(postings) { return datPostings(postings).map(datRow); }

/** The upload file: header + one line per posting, LF endings, no BOM. */
export function datCsv(postings) {
  return toDelimited([datHeader(), ...datRows(postings)], ',', '\n');
}

/** Tab-separated, for pasting straight into the DAT template workbook. Header optional. */
export function datTsv(postings, withHeader = false) {
  const rows = datRows(postings);
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
