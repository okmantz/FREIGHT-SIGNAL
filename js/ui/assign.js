// Primary / preferred carriers: "Taylord Logistics always takes our SC to GA loads". Set it once on the carrier; when you post a matching load the
// app puts them first with an e-mail draft and a call script.
import { h, toast, modal, field, copyText, confirmDialog } from './dom.js';
import { state, actions } from '../store/state.js';
import { describeAssignment, assignmentDraft } from '../core/assignments.js';
import { mailHref, telHref } from '../core/resources.js';

const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

/** Add or edit one assignment. carrier = a carrier row (optional when editing); preset = lane fields to start from (e.g. the load being posted). */
export function assignDialog({ carrier = null, assignment = null, preset = {}, onSaved } = {}) {
  const a = assignment || {};
  const inp = (v, p = {}) => h('input', { value: v ?? '', ...p });
  const carrierSel = h('select', null, h('option', { value: '' }, 'Choose a carrier…'), ...state.carriers.slice().sort((x, y) => String(x.carrierName).localeCompare(String(y.carrierName))).map(c => h('option', { value: c.id, selected: (carrier && carrier.id === c.id) || (a.carrierId === c.id) }, (c.carrierName || c.email) + (c.mc ? ' (' + c.mc + ')' : ''))));
  const oc = inp(a.originCity ?? preset.originCity), os = h('select', null, h('option', { value: '' }, 'Any state'), ...STATES.map(s => h('option', { value: s, selected: (a.originState || preset.originState) === s }, s)));
  const dc = inp(a.destCity ?? preset.destCity), ds = h('select', null, h('option', { value: '' }, 'Any state'), ...STATES.map(s => h('option', { value: s, selected: (a.destState || preset.destState) === s }, s)));
  const pr = h('select', null, h('option', { value: 'primary', selected: a.priority !== 'backup' }, 'Primary: reach out to them first'), h('option', { value: 'backup', selected: a.priority === 'backup' }, 'Backup: after the primary'));
  const rate = inp(a.rate, { placeholder: 'Optional: the rate they usually take', inputmode: 'numeric' }), note = inp(a.note, { placeholder: 'e.g. always takes SC to GA, call before 10am' });
  const body = h('div', { class: 'grid3' },
    field('Carrier', carrierSel), field('Priority', pr), field('Usual rate', rate),
    field('From city (blank = anywhere in the state)', oc), field('From state', os), h('span'),
    field('To city (blank = anywhere in the state)', dc), field('To state', ds), h('span'),
    field('Note', note));
  modal({ title: assignment ? 'Edit primary carrier' : 'Set as primary carrier', body, wide: true, actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
    const row = state.carriers.find(c => c.id === carrierSel.value);
    if (!row) { toast('Choose a carrier.', 'err'); return false; }
    const saved = await actions.saveAssignment({ ...a, carrierId: row.id, carrierName: row.carrierName, mc: row.mc, email: row.email, phone: row.phone, originCity: oc.value, originState: os.value, destCity: dc.value, destState: ds.value, priority: pr.value, rate: rate.value, note: note.value });
    if (!saved) { toast('Enter at least a state for the pickup and for the delivery.', 'err'); return false; }
    toast('Saved: ' + (row.carrierName || row.email) + ' is first for ' + describeAssignment(saved) + '.', 'ok'); if (onSaved) onSaved(saved);
  } }] });
}

/** Every assignment, editable. */
export function assignmentsDialog() {
  const root = h('div');
  const draw = () => {
    root.replaceChildren(...[
      h('p', { class: 'muted' }, 'When you post a load that matches, these carriers are suggested first with an e-mail draft and a call script. Add one from a carrier\'s row (Set as primary) or here.'),
      state.assignments.length ? h('table', { class: 'carrier dirtable' }, h('thead', null, h('tr', null, ['Carrier', 'Lane', 'Priority', 'Offered', 'Won', ''].map(t => h('th', null, t)))),
        h('tbody', null, state.assignments.map(x => h('tr', null, h('td', null, h('b', null, x.carrierName || x.email), h('div', { class: 'muted small' }, x.note || '')), h('td', null, describeAssignment(x)), h('td', null, x.priority), h('td', null, String(x.hits || 0)), h('td', null, String(x.wins || 0)),
          h('td', null, h('button', { class: 'btn small', type: 'button', onclick: () => assignDialog({ assignment: x, onSaved: draw }) }, 'Edit'), ' ', h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Remove', 'Stop suggesting ' + (x.carrierName || x.email) + ' first for ' + describeAssignment(x) + '?', 'Remove')) { await actions.deleteAssignment(x.id); draw(); } } }, 'Remove')))))) : h('p', null, 'No primary carriers yet.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => assignDialog({ onSaved: draw }) }, 'Add a primary carrier'),
    ]);
  };
  draw();
  modal({ title: 'Primary carriers', body: root, wide: true, actions: [{ label: 'Close' }] });
}

/** E-mail draft + call script for reaching an assigned carrier about a load. */
export function reachOutDialog(load, a) {
  const d = assignmentDraft(load, a, { rate: load.targetRate });
  actions.logOp(load.id, 'assign-offer', a.name || a.email);
  const body = h('div', null,
    h('p', null, h('b', null, a.name || a.email), a.phone ? '  ·  ' + a.phone : '', '  ·  ', a.priority === 'primary' ? 'your primary' : 'your backup'),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Subject'), h('input', { value: d.subject, readonly: true })),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'E-mail'), h('textarea', { rows: 9, readonly: true }, d.body)),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'If you call'), h('textarea', { rows: 4, readonly: true }, d.script)));
  modal({ title: 'First call: ' + (a.name || a.email), body, wide: true, actions: [
    { label: 'Copy e-mail', keepOpen: true, onClick: () => copyText(d.subject + '\n\n' + d.body, 'E-mail copied.') },
    a.email ? { label: 'Open e-mail', keepOpen: true, onClick: () => { globalThis.location.href = mailHref(a.email) + '?subject=' + encodeURIComponent(d.subject) + '&body=' + encodeURIComponent(d.body); } } : null,
    a.phone ? { label: 'Call', keepOpen: true, onClick: () => { actions.logOp(load.id, 'assign-call', a.name || a.phone); globalThis.location.href = telHref(a.phone); } } : null,
    { label: 'Close', kind: 'primary' }].filter(Boolean) });
}
