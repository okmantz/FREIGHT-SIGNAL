// "Mark covered": log WHICH of the postings covered it, which carrier and at what rate - then the load leaves the board.
import { h, toast, modal, field } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { gridLabel } from '../../core/model.js';
import { laneMemory, laneMemoryText, rateVsMemory } from '../../core/coverlog.js';
import { safeNumeric } from '../../core/util.js';
import { money } from './util.js';

export function coverModal(box, preset = {}) {
  const members = box.members;
  const head = box.head;
  const ids = new Set(members.map(m => m.id));
  const mem = laneMemory(state.coverLog, head, state.zip, Number(state.settings.carrierRadiusMiles) || 75);

  // which posting
  const label = (m) => `${gridLabel(m.variant) || 'Single'} · ${m.originCity}, ${m.originState} → ${m.destCity}, ${m.destState}${m.datRate ? ' · ' + money(m.datRate) : ''}`;
  const postingSel = h('select', { 'aria-label': 'Which posting covered it', 'data-live': '' }, members.map(m => h('option', { value: m.id, selected: m.id === (preset.postingId || head.id) }, label(m))));

  // carrier
  const quotes = state.inquiries.filter(q => ids.has(q.postingId) && q.senderEmail);
  const byEmail = new Map();
  for (const q of quotes) { const e = String(q.senderEmail).toLowerCase(); const prev = byEmail.get(e); const rate = safeNumeric(q.lastCarrierRate); if (!prev || rate) byEmail.set(e, { email: e, rate: rate || (prev && prev.rate) || 0 }); }
  const inp = (ph, v = '') => h('input', { placeholder: ph, value: v, 'data-live': '' });
  const name = inp('Carrier name'), email = inp('Carrier e-mail'), mc = inp('MC / DOT'), phone = inp('Phone');
  const rate = inp('$ paid / agreed', preset.rate ? String(preset.rate) : '');
  const note = inp('Note (optional)');
  const hint = h('small', { class: 'hint' }, '');
  const fill = (c) => { name.value = c.carrierName || name.value; email.value = c.email || ''; mc.value = c.mc || ''; phone.value = c.phone || ''; };
  const addNew = h('input', { type: 'checkbox', checked: true, 'data-live': '' });
  const pickers = h('div', { class: 'quickpick' });
  const chips = [...byEmail.values()].slice(0, 8).map(q => {
    const c = state.carriers.find(x => String(x.email || '').toLowerCase() === q.email);
    return h('button', { class: 'btn small', type: 'button', title: 'Fill in the carrier from this inquiry', onclick: () => { if (c) fill(c); else { email.value = q.email; } if (q.rate && !rate.value) { rate.value = String(q.rate); upd(); } } }, (c ? c.carrierName || q.email : q.email) + (q.rate ? ' · ' + money(q.rate) : ''));
  });
  if (chips.length) pickers.append(h('span', { class: 'muted small' }, 'Replied to this load: '), chips);
  const dl = h('datalist', { id: 'cover-carriers' }, state.carriers.slice(0, 600).map(c => h('option', { value: c.carrierName || c.email }, c.email)));
  name.setAttribute('list', 'cover-carriers');
  name.addEventListener('change', () => { const q = name.value.trim().toLowerCase(); const c = state.carriers.find(x => String(x.carrierName || '').toLowerCase() === q || String(x.email || '').toLowerCase() === q); if (c) fill(c); });
  const upd = () => {
    const r = safeNumeric(rate.value); const parts = [];
    if (r > 0 && head.targetRate) { const t = safeNumeric(head.targetRate); if (t > 0) parts.push(`${r <= t ? 'at/under' : ((r - t) / t * 100).toFixed(1) + '% over'} your ${money(t)} target`); }
    const vm = rateVsMemory(r, mem); if (vm) parts.push(vm);
    hint.textContent = parts.join(' · ');
  };
  rate.addEventListener('input', upd); upd();

  const body = h('div', null,
    h('p', { class: 'muted' }, `${box.title} · ${members.length} posting${members.length === 1 ? '' : 's'}. This is recorded in the Cover Log first - then the load leaves the board.`),
    mem ? h('div', { class: 'banner' }, laneMemoryText(mem)) : null,
    field('Which posting covered it?', postingSel, members.length > 1 ? 'Pick the exact origin/destination pairing the carrier booked (A-A is the original).' : null),
    pickers, dl,
    h('div', { class: 'grid2' }, field('Carrier', name), field('E-mail', email), field('MC / DOT', mc), field('Phone', phone)),
    field('Rate', rate, null), hint, field('Note', note),
    h('label', { class: 'inl' }, addNew, ' Add this carrier to the Carrier Database if they are new'));

  modal({
    title: 'Mark covered', body, wide: true,
    actions: [
      { label: 'Cancel' },
      { label: 'Close without a cover', onClick: async () => {
        const e = await actions.coverGroup(head.id, { outcome: 'Manual', coveredId: null, note: note.value.trim() || 'Closed without a cover.' });
        if (e) toast('Removed from the board and kept in the Cover Log (not counted as a cover).', 'ok');
      } },
      { label: 'Log cover and remove', kind: 'primary', onClick: async () => {
        if (!email.value.trim() && !name.value.trim() && !(await askNoCarrier())) return false;
        const e = await actions.coverGroup(head.id, {
          coveredId: postingSel.value, rate: safeNumeric(rate.value) || '', note: note.value.trim(), addCarrier: addNew.checked,
          carrier: { name: name.value.trim(), email: email.value.trim(), mc: mc.value.trim(), phone: phone.value.trim() },
        });
        if (e) toast(`Covered and logged${e.rate ? ' at ' + money(e.rate) : ''}.`, 'ok');
      } },
    ],
  });
  setTimeout(() => (byEmail.size ? rate : name).focus(), 40);
}

function askNoCarrier() {
  return import('../dom.js').then(({ confirmDialog }) => confirmDialog('No carrier entered', 'Log this cover without a carrier? Lane memory and the pace tracker still count it, but the carrier will not be credited.', 'Log anyway'));
}
