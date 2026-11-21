import { h, toast, confirmDialog, inputEl, fmtDate, copyText } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { pageHead, emptyState, flash } from '../chrome.js';
import { icon } from '../icons.js';
import { chip } from '../directory.js';
import { originalLoadDetails, copyDetailsMessage } from '../../core/loaddetails.js';

export function render() {
  return h('div', null,
    pageHead({ icon: 'spare', title: 'Spare Load Details', sub: 'Park a load (or a whole matrix group) here and restore it to the board later. Use the Spare button on a board row to save one.' }),
    state.spares.length ? h('div', { class: 'sparegrid' }, state.spares.map(s => spareCard(s))) :
      emptyState({ icon: 'spare', title: 'Nothing saved yet', text: 'Press Spare on a lane box on the board to park it here.' }));
}

function spareCard(s) {
  const rows = s.rows || []; const head = rows.find(r => r.variant === 'Original') || rows[0] || {};
  const o = [head.originCity, head.originState].filter(Boolean).join(', '), d = [head.destCity, head.destState].filter(Boolean).join(', ');
  return h('div', { class: 'sparecard panel' },
    inputEl(s.label, (v) => actions.saveSpare({ ...s, label: v }), { class: 'cell label', 'aria-label': 'Label' }),
    o || d ? h('div', { class: 'lane' }, o || '?', icon('chevright', 14), d || '?') : null,
    h('div', { class: 'facts' }, chip(rows.length + ' posting' + (rows.length === 1 ? '' : 's')), chip(head.equipment || head.equip), chip(head.loadNumber ? '#' + head.loadNumber : ''), chip(head.pickupDate || head.pickup || ''), chip('Saved ' + fmtDate(s.createdAt))),
    h('div', { class: 'foot' },
      h('button', { class: 'btn small primary', type: 'button', onclick: async () => { const n = await actions.restoreSpare(s.id); toast(`${n} row(s) restored to the board.`, 'ok'); } }, icon('refresh', 14), 'Restore to board'),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'copy-spare-details', title: 'Copy the original load details', onclick: async (e) => {
        const dd = originalLoadDetails(s.rows);
        if (dd.source === 'none') return toast('This saved load has no details to copy.', 'warn');
        await copyText(dd.text, copyDetailsMessage(dd.source)); flash(e.currentTarget);
      } }, icon('copy', 14), 'Copy details'),
      h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete spare', 'Delete this saved load?', 'Delete')) actions.deleteSpare(s.id); } }, icon('trash', 14), 'Delete')));
}
