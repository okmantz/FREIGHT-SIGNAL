import { h, toast, confirmDialog, inputEl, fmtDate } from '../dom.js';
import { state, actions } from '../../store/state.js';

export function render() {
  return h('div', null,
    h('div', { class: 'pagehead' }, h('h2', null, 'Spare Load Details'), h('p', null, 'Park a load (or a whole matrix group) here and restore it to the board later. Use the Spare button on a board row to save one.')),
    h('div', { class: 'banner' }, 'Behavior inferred from the screenshot: the workbook\'s exact Spare Load Details macro was not provided.'),
    state.spares.length ? h('div', { class: 'cards' }, state.spares.map(s => h('div', { class: 'panel' },
      inputEl(s.label, (v) => actions.saveSpare({ ...s, label: v }), { class: 'cell', 'aria-label': 'Label' }),
      h('p', { class: 'muted' }, `${s.rows.length} row(s), saved ${fmtDate(s.createdAt)}`),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn small primary', type: 'button', onclick: async () => { const n = await actions.restoreSpare(s.id); toast(`${n} row(s) restored to the board.`, 'ok'); } }, 'Restore to board'),
        h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete spare', 'Delete this saved load?', 'Delete')) actions.deleteSpare(s.id); } }, 'Delete'))))) :
      h('p', { class: 'muted' }, 'Nothing saved yet.'));
}
