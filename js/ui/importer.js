// Paste / file import for table-shaped data (carriers, inquiries, postings). Header row is matched by canonical name,
// falling back to column position when no header matches.
import { parseDelimited, detectDelimiter } from '../core/csv.js';
import { canonHeader } from '../core/util.js';

export function tableToRecords(text, headers, keys) {
  const t = String(text ?? '').replace(/^﻿/, '');
  if (!t.trim()) return { rows: [], note: 'Nothing to import.' };
  const table = parseDelimited(t, detectDelimiter(t)).filter(r => r.some(c => String(c).trim() !== ''));
  if (!table.length) return { rows: [], note: 'Nothing to import.' };
  const canon = headers.map(canonHeader);
  const first = table[0].map(canonHeader);
  const hits = first.filter(c => canon.includes(c)).length;
  const hasHeader = hits >= Math.max(2, Math.floor(headers.length / 3));
  const body = hasHeader ? table.slice(1) : table;
  const map = hasHeader ? first.map(c => canon.indexOf(c)) : headers.map((_, i) => i);
  const rows = body.map(r => {
    const o = Object.fromEntries(keys.map(k => [k, '']));
    map.forEach((ki, ci) => { if (ki >= 0 && ki < keys.length && ci < r.length) o[keys[ki]] = String(r[ci]).trim(); });
    return o;
  });
  return { rows, note: hasHeader ? `Header row recognised (${hits}/${headers.length} columns).` : 'No header row recognised; columns were read by position.' };
}
