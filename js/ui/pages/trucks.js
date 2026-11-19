// Team Truck Board: trucks your teammates have talked to, searchable by origin ZIP + radius, destination, equipment, date, carrier / MC and e-mail.
import { h, toast, modal, field, copyText } from '../dom.js';
import { state } from '../../store/state.js';
import * as net from '../../store/net.js';
import { pageHead, emptyState, iconBtn, flash } from '../chrome.js';
import { icon } from '../icons.js';
import { equipLabel } from '../../core/equipment.js';
import { TTL_OPTIONS } from '../../core/trucks.js';
import { placeText, usDate, until, ago, todayIso } from '../../core/netcommon.js';
import { notJoined } from './team.js';

const EQUIP = ['V', 'R', 'F', 'SD', 'VR', 'FSD', 'PO', 'HS'];
const view = { q: { origin: '', radius: 100, dest: '', equip: '', date: '', carrier: '', email: '', status: 'open', looseReefer: false }, loaded: false };

const equipSelect = (value, any = 'Any equipment') => h('select', { class: 'cell', 'aria-label': 'Equipment', 'data-fk': 'tb-equip' },
  h('option', { value: '' }, any), EQUIP.map(c => h('option', { value: c, selected: c === value }, `${equipLabel(c)} (${c})`)));

/** The one-click publish dialog. `pre` can carry carrier details (from the Carrier Database) or a pickup spot. */
export function openPublish(pre = {}) {
  if (!net.joined()) { toast('Join or create a team first (Team page).', 'warn'); location.hash = '#/team'; return; }
  const f = { carrierName: pre.carrierName || '', mc: pre.mc || '', email: pre.email || '', phone: pre.phone || '', equip: pre.equip || 'V', oCity: pre.oCity || '', oState: pre.oState || '', oZip: pre.oZip || '',
    dCity: pre.dCity || '', dState: pre.dState || '', destOpen: pre.destOpen !== false && !pre.dCity && !pre.dState, date: pre.date || todayIso(), note: pre.note || '', ttl: String(net.net.cfg.ttlHours || 24) };
  const inp = (key, props = {}) => { const i = h('input', { class: 'cell', value: f[key], 'data-live': '1', ...props }); i.addEventListener('input', () => { f[key] = i.value; }); return i; };
  const err = h('div', { class: 'banner err', hidden: true });
  const destRow = h('div', { class: 'grid3' });
  const drawDest = () => { destRow.replaceChildren(...(f.destOpen ? [] : [field('Dest city', inp('dCity')), field('State', inp('dState', { maxlength: 2 }))])); };
  const open = h('input', { type: 'checkbox', checked: f.destOpen }); open.addEventListener('change', () => { f.destOpen = open.checked; drawDest(); });
  drawDest();
  const eq = equipSelect(f.equip, 'Van'); eq.addEventListener('change', () => { f.equip = eq.value || 'V'; });
  const ttl = h('select', { class: 'cell', 'aria-label': 'Keep this truck listed for' }, TTL_OPTIONS.map(([v, l]) => h('option', { value: String(v), selected: String(v) === f.ttl }, l)));
  ttl.addEventListener('change', () => { f.ttl = ttl.value; });
  const body = h('div', null,
    h('p', { class: 'muted' }, 'Fill in what the carrier told you. Only the carrier\'s business details are shared, never your notes about rates or customers.'),
    err,
    h('div', { class: 'grid2' }, field('Carrier name', inp('carrierName', { autofocus: true })), field('MC / DOT', inp('mc', { placeholder: 'MC 123456' }))),
    h('div', { class: 'grid2' }, field('E-mail', inp('email', { type: 'email' })), field('Phone', inp('phone'))),
    h('div', { class: 'grid4' }, field('Truck is in (city)', inp('oCity')), field('State', inp('oState', { maxlength: 2 })), field('or ZIP', inp('oZip', { maxlength: 5 })), field('Equipment', eq)),
    h('label', { class: 'check' }, open, ' Goes anywhere'), destRow,
    h('div', { class: 'grid3' }, field('Available', inp('date', { type: 'date' })), field('Keep listed for', ttl)),
    field('Note (optional)', inp('note', { placeholder: 'e.g. 2 trucks, driver is at the yard' })));
  modal({ title: 'Share a truck with the team', body, actions: [{ label: 'Cancel' }, { label: 'Share truck', kind: 'primary', onClick: async () => {
    const r = await net.publishTruck({ ...f, ttl: f.ttl });
    if (!r.ok) { err.hidden = false; err.textContent = r.error; return false; }
    toast('Truck shared. It will expire by itself.', 'ok');
  } }] });
}

function card(t) {
  const mine = t.uid === net.myUid();
  const status = t.status;
  const btns = [];
  const act = (action, label, kind = '') => h('button', { class: 'btn small ' + kind, type: 'button', onclick: async (e) => { try { await net.truckAction(t.id, action); flash(e.currentTarget); } catch (x) { toast(x.message, 'err'); } } }, label);
  if (status === 'open') btns.push(act('booked', 'Booked', 'primary'), act('withdrawn', 'Withdraw'));
  else if (mine) btns.push(act('renew', status === 'expired' ? 'Re-list' : 'Put back'));
  if (t.phone) btns.push(h('button', { class: 'btn small', type: 'button', onclick: (e) => { copyText(t.phone, 'Phone copied.'); flash(e.currentTarget); } }, icon('phone', 13), 'Phone'));
  if (t.email) btns.push(h('button', { class: 'btn small', type: 'button', onclick: (e) => { copyText(t.email, 'E-mail copied.'); flash(e.currentTarget); } }, icon('mail', 13), 'E-mail'));
  const left = status === 'open' ? 'expires ' + until(t.exp) : status === 'booked' ? `booked by ${t.statusBy || 'a teammate'}` : status === 'withdrawn' ? `withdrawn by ${t.statusBy || 'a teammate'}` : 'expired';
  return h('div', { class: 'panel truck ' + status, 'data-truck': t.id },
    h('div', { class: 'truck-head' }, h('b', null, t.carrierName || 'Carrier'), h('span', { class: 'pill' }, `${equipLabel(t.equip)}`), t.miles != null ? h('span', { class: 'pill alt' }, `${Math.round(t.miles)} mi away`) : null,
      status !== 'open' ? h('span', { class: 'pill warn' }, status) : null),
    h('div', { class: 'truck-route' }, `${placeText(t.oCity, t.oState)} → ${t.destOpen ? 'anywhere' : placeText(t.dCity, t.dState)}`, t.date ? '  ·  available ' + usDate(t.date) + (t.dateTo ? '-' + usDate(t.dateTo) : '') : ''),
    h('div', { class: 'muted small' }, [t.mc, t.phone, t.email].filter(Boolean).join('  ·  ')),
    t.note ? h('div', { class: 'truck-note' }, t.note) : null,
    h('div', { class: 'muted small' }, `Shared by ${t.by || 'a teammate'} ${ago(t.at)}  ·  ${left}`),
    btns.length ? h('div', { class: 'toolbar' }, btns) : null);
}

export function render() {
  if (!net.joined()) return notJoined('trucks');
  net.markSeen('trucks');
  const q = view.q;
  const root = h('div', null,
    pageHead({ icon: 'truck', title: 'Team Truck Board', sub: 'Trucks your teammates have just talked to. Share one after every carrier call; it removes itself when it expires.', actions: [iconBtn('plus', 'Share a truck', { class: 'primary', 'data-act': 'share-truck', onclick: () => openPublish() })] }));
  const bind = (key, el, ev = 'change') => { el.addEventListener(ev, () => { q[key] = el.type === 'checkbox' ? el.checked : el.value; draw(); }); return el; };
  const txt = (key, ph, width) => bind(key, h('input', { class: 'cell', type: 'text', placeholder: ph, value: q[key], 'aria-label': ph, 'data-live': '1', 'data-fk': 'tb-' + key }), 'change');
  const eq = bind('equip', equipSelect(q.equip));
  const radius = bind('radius', h('select', { class: 'cell', 'aria-label': 'Radius' }, [25, 50, 100, 150, 250].map(n => h('option', { value: n, selected: n === Number(q.radius) }, `${n} mi`))));
  const status = bind('status', h('select', { class: 'cell', 'aria-label': 'Show' }, [['open', 'Available now'], ['mine', 'My trucks (any status)'], ['all', 'Everything']].map(([v, l]) => h('option', { value: v, selected: v === q.status }, l))));
  const date = bind('date', h('input', { class: 'cell', type: 'date', value: q.date, 'aria-label': 'Available date' }));
  root.append(h('div', { class: 'panel' }, h('div', { class: 'toolbar' }, txt('origin', 'Origin ZIP or City, ST'), radius, txt('dest', 'Destination (TX or Dallas, TX)'), eq, date),
    h('div', { class: 'toolbar' }, txt('carrier', 'Carrier name or MC'), txt('email', 'E-mail'), status)));
  const list = h('div', { class: 'cards' });
  const draw = () => {
    const rows = q.status === 'mine' ? net.resolvedTrucks().filter(t => t.uid === net.myUid()).sort((a, b) => b.at - a.at) : net.searchBoard(q);
    list.replaceChildren(...(rows.length ? rows.map(card) : [emptyState({ icon: 'truck', title: net.resolvedTrucks().length ? 'No trucks match those filters' : 'No trucks shared yet', text: net.resolvedTrucks().length ? 'Widen the radius or clear a filter.' : 'After your next carrier call, press Share a truck. Your teammates\' calls will show up here too.', actions: [iconBtn('plus', 'Share a truck', { class: 'primary', onclick: () => openPublish() })] })]));
  };
  draw(); root.append(list);
  return root;
}
export const _view = view;
