import { h, toast, confirmDialog, inputEl, fmtDate, copyText } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { pageHead, emptyState, flash } from '../chrome.js';
import { icon } from '../icons.js';
import { originalLoadDetails, copyDetailsMessage } from '../../core/loaddetails.js';

export function render() {
  return h('div', null,
    pageHead({ icon: 'spare', title: 'Spare Load Details', sub: 'Park a load (or a whole matrix group) here and restore it to the board later. Use the Spare button on a board row to save one.' }),
    h('div', { class: 'banner' }, 'Behavior inferred from the screenshot: the workbook\'s exact Spare Load Details macro was not provided.'),
    state.spares.length ? h('div', { class: 'cards' }, state.spares.map(s => h('div', { class: 'panel' },
      inputEl(s.label, (v) => actions.saveSpare({ ...s, label: v }), { class: 'cell', 'aria-label': 'Label' }),
      h('p', { class: 'muted' }, `${s.rows.length} row(s), saved ${fmtDate(s.createdAt)}`),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn small primary', type: 'button', onclick: async () => { const n = await actions.restoreSpare(s.id); toast(`${n} row(s) restored to the board.`, 'ok'); } }, icon('refresh', 14), 'Restore to board'),
        h('button', { class: 'btn small', type: 'button', 'data-act': 'copy-spare-details', title: 'Copy the original load details', onclick: async (e) => {
          const d = originalLoadDetails(s.rows);
          if (d.source === 'none') return toast('This saved load has no details to copy.', 'warn');
          await copyText(d.text, copyDetailsMessage(d.source)); flash(e.currentTarget);
        } }, icon('copy', 14), 'Copy details'),
        h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete spare', 'Delete this saved load?', 'Delete')) actions.deleteSpare(s.id); } }, icon('trash', 14), 'Delete'))))) :
      emptyState({ icon: 'spare', title: 'Nothing saved yet', text: 'Press Spare on a lane box on the board to park it here.' }));
}
