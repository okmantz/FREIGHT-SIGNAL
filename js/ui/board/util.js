import { h } from '../dom.js';
import { EQUIPMENT } from '../../core/defaults.js';

/** Small equipment <select> that reports its value (no persistence of its own). */
export function pageSelectEq(value, onChange) {
  const cur = String(value || 'V').toUpperCase();
  const s = h('select', { class: 'cell eq', title: EQUIPMENT.map(e => `${e.code} = ${e.label}`).join(', '), 'data-live': '' }, EQUIPMENT.map(e => h('option', { value: e.code, selected: e.code === cur }, e.code)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export const money = (n) => (n === '' || n === null || n === undefined || !Number.isFinite(Number(n)) ? '' : '$' + Math.round(Number(n)).toLocaleString('en-US'));
export const ago = (iso, now = new Date()) => {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now.getTime() - t) / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 48 * 60 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago';
};
