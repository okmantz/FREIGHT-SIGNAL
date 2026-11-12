import { h, toast, modal, confirmDialog, copyText, openExternal, field, inputEl, selectEl, download } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { parseTqlLoad, splitLoads } from '../../core/parser.js';
import { buildPreviewMessage } from '../../core/matrix.js';
import { rateViewUrl, ventuskyUrl } from '../../core/links.js';
import { DAT_COLUMNS } from '../../core/defaults.js';
import { PRIORITIES, STATUSES, groupMembers } from '../../core/model.js';
import { datTsv } from '../../core/dat.js';
import { draftCard } from '../draftcard.js';

let pasteText = '';
let filter = '';
let statusFilter = 'All';

const shortGroup = (g) => (g ? g.replace(/^FS-/, '').slice(-9) : '');

function summaryOutreach(res) {
  const body = [h('p', null, res.detail || '')];
  if (res.error) body.push(h('div', { class: 'banner err' }, res.error));
  body.push(h('div', { class: 'banner ok' }, 'These are DRAFTS only. Nothing has been sent. Download the .eml files (they open in Outlook as unsent drafts) or open each in your mail app and press Send yourself.'));
  (res.drafts || []).forEach(d => body.push(draftCard(d)));
  modal({ title: `Carrier outreach: ${res.created ?? (res.drafts || []).length} draft(s)`, body, wide: true, actions: [{ label: 'Close', kind: 'primary' }] });
}

async function reviewParsed(text) {
  const blocks = splitLoads(text, state.settings.loadSeparatorRegex);
  if (!blocks.length) return toast('Paste at least one TQL load first.', 'warn');
  const items = blocks.map(b => ({ raw: b, parsed: parseTqlLoad(b), take: true }));
  const body = h('div', null, h('p', { class: 'muted' }, `${items.length} load block(s) found. Check each parse, correct anything wrong, and add. The pasted source text is stored with each load.`));
  const editors = items.map((it, i) => {
    const f = it.parsed.fields;
    const inputs = {};
    const cell = (k, label) => { inputs[k] = h('input', { value: f[k] ?? '' }); return field(label, inputs[k]); };
    const box = h('div', { class: 'panel' },
      h('label', null, h('input', { type: 'checkbox', checked: true, onchange: (e) => { it.take = e.target.checked; } }), ` Load ${i + 1}`),
      it.parsed.missing.length ? h('div', { class: 'banner err' }, 'Could not find: ' + it.parsed.missing.join(', ') + '. Fill in by hand below.') : null,
      ...it.parsed.warnings.map(w => h('div', { class: 'banner' }, w)),
      h('div', { class: 'grid4' }, cell('originCity', 'Origin city'), cell('originState', 'Origin state'), cell('originZip', 'Origin ZIP'), cell('pickupEarliest', 'Pickup date'),
        cell('destCity', 'Dest city'), cell('destState', 'Dest state'), cell('weight', 'Weight'), cell('equip', 'Equip (V/R/F)')),
      h('details', null, h('summary', null, 'Source text'), h('pre', { class: 'plain mono' }, it.raw)));
    it.inputs = inputs;
    return box;
  });
  body.appendChild(h('div', null, editors));
  modal({
    title: 'Review parsed loads', body, wide: true,
    actions: [{ label: 'Cancel' }, {
      label: 'Add to board', kind: 'primary',
      onClick: async () => {
        let n = 0;
        for (const it of items) {
          if (!it.take) continue;
          const f = { ...it.parsed.fields };
          for (const [k, el] of Object.entries(it.inputs)) f[k] = el.value.trim();
          f.originState = f.originState.toUpperCase(); f.destState = f.destState.toUpperCase();
          f.pickupLatest = f.pickupEarliest;
          await actions.addParsedLoad(f); n++;
        }
        pasteText = ''; toast(`${n} load(s) added.`, 'ok');
      },
    }],
  });
}

async function matrixFlow(p) {
  const plan = actions.previewMatrix(p.id);
  if (!plan.ok) return toast(plan.error, 'err', 7000);
  const ok = await confirmDialog('Create 3 x 3 posting matrix', (plan.warnings.length ? plan.warnings.join('\n') + '\n\n' : '') + buildPreviewMessage(plan.origins, plan.dests), 'Create 9 postings');
  if (!ok) return;
  const rows = await actions.createMatrix(p.id, plan);
  toast(`Matrix created: ${rows.length} postings (original + ${rows.length - 1} alternates).`, 'ok');
}

function detailModal(p) {
  const inputs = {};
  const mk = (k, label, big) => { inputs[k] = big ? h('textarea', { value: p[k] ?? '' }) : h('input', { value: p[k] ?? '' }); return field(label, inputs[k]); };
  const body = h('div', null,
    h('div', { class: 'grid4' }, DAT_COLUMNS.map(c => mk(c.key, `${c.letter} ${c.header}`)),
      mk('destZip', 'Dest ZIP (derived)'), mk('targetRate', 'Target Rate')),
    mk('details', 'Auto-reply details (source TQL text)', true), mk('notes', 'Auto-reply notes'));
  modal({
    title: `Edit ${p.originCity}, ${p.originState} → ${p.destCity}, ${p.destState}`, body, wide: true,
    actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', onClick: async () => {
      const patch = {}; for (const [k, el] of Object.entries(inputs)) patch[k] = el.value;
      await actions.updatePosting(p.id, patch);
    } }],
  });
}

function weather(p) {
  const z = state.zip && state.zip.findZip(p.originZip);
  openExternal(z ? ventuskyUrl(z.lat, z.lng) : ventuskyUrl(NaN, NaN));
}

function rateLink(p) {
  const r = rateViewUrl(p);
  if (!r.ok) return toast(r.error, 'warn');
  openExternal(r.url);
}

function row(p) {
  const cls = [p.variant === 'Original' ? 'orig' : p.groupId ? 'alt' : '', 'p-' + (p.priority || 'Low')].join(' ');
  const upd = (k) => (v) => actions.updatePosting(p.id, { [k]: v });
  const td = (k, w) => h('td', null, inputEl(p[k], upd(k), w ? { size: w } : {}));
  const canMatrix = p.variant !== 'Alternate' && !(p.groupId && p.variant !== 'Original') && !(p.groupId && groupMembers(state.postings, p.groupId).length > 1);
  return h('tr', { class: cls },
    h('td', null, h('div', { class: 'rowact' },
      canMatrix ? h('button', { class: 'btn small primary', type: 'button', title: 'Build the 9-posting matrix', onclick: () => matrixFlow(p) }, 'Matrix') : null,
      h('button', { class: 'btn small', type: 'button', title: 'Draft carrier outreach for this row', onclick: async () => { const r = await actions.runOutreach(p.id); if (r) summaryOutreach(r); } }, 'Outreach'),
      h('button', { class: 'btn small', type: 'button', title: 'Open DAT RateView for this lane', onclick: () => rateLink(p) }, 'Rate'),
      h('button', { class: 'btn small', type: 'button', title: 'Open weather for the origin', onclick: () => weather(p) }, 'Wx'),
      h('button', { class: 'btn small', type: 'button', onclick: () => detailModal(p) }, 'Edit'),
      h('button', { class: 'btn small', type: 'button', title: 'Save this load group to Spare Load Details', onclick: async () => { await actions.saveSpareFromGroup(p.id); toast('Saved to Spare Load Details.', 'ok'); } }, 'Spare'),
      h('button', { class: 'btn small danger', type: 'button', title: 'Delete (whole group)', onclick: async () => { if (await confirmDialog('Delete load', 'Delete this load' + (p.groupId ? ' and its whole group' : '') + '?', 'Delete')) { const n = await actions.deleteGroup(p.id); toast(`${n} row(s) removed.`, 'ok'); } } }, '✕'))),
    h('td', null, p.variant ? h('span', { class: 'pill ' + (p.variant === 'Original' ? 'orig' : 'alt') }, p.variant) : ''),
    h('td', { class: 'mono' }, shortGroup(p.groupId)),
    td('pickupEarliest', 9), td('weight', 6), td('equip', 3),
    td('originCity', 14), td('originState', 3), td('originZip', 6), td('destCity', 14), td('destState', 3),
    h('td', { class: 'num' }, p.variant ? `${p.originAltMiles ?? ''} / ${p.destAltMiles ?? ''}` : ''),
    td('targetRate', 6),
    h('td', { class: 'num' }, p.inquiryCount ?? ''),
    h('td', null, selectEl(['No', 'Yes'], p.outreach || 'No', (v) => actions.updatePosting(p.id, { outreach: v }), { title: 'Yes = include in the next Outlook-style scan' })),
    h('td', { class: 'num' }, p.outreachCount ?? ''),
    h('td', null, selectEl(STATUSES, p.status || 'Active', async (v) => { const r = await actions.setStatus(p.id, v); if (r.removed) toast(`Covered: ${r.removed} row(s) removed from the board.`, 'ok'); })),
    h('td', null, selectEl(PRIORITIES, p.priority || 'Low', (v) => actions.setPriority(p.id, v))),
    h('td', { class: 'num' }, p.outreachTarget ?? ''));
}

export function render() {
  const rows = state.postings.filter(p => {
    if (statusFilter !== 'All' && (p.status || 'Active') !== statusFilter) return false;
    if (!filter) return true;
    return [p.originCity, p.originState, p.destCity, p.destState, p.groupId, p.variant].join(' ').toLowerCase().includes(filter.toLowerCase());
  });
  const ta = h('textarea', { placeholder: 'Paste one or more TQL load blocks here (Pickup:, Delivery:, Pickup Date/Time:, Weight:, Trailer Type: …)', value: pasteText, 'data-rerender': '' });
  ta.addEventListener('input', () => { pasteText = ta.value; });
  const search = h('input', { type: 'search', placeholder: 'Filter lanes / groups…', value: filter, 'data-rerender': '' });
  search.addEventListener('input', () => { filter = search.value; });
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') { filter = search.value; import('../../main.js').then(m => m.render()); } });
  return h('div', null,
    h('div', { class: 'pagehead' }, h('h2', null, 'FREIGHT SIGNAL'), h('p', null, 'Paste TQL loads → review → build the 3 x 3 matrix → draft outreach. Drafts are never sent automatically.')),
    h('div', { class: 'panel' }, ta,
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => reviewParsed(ta.value) }, 'Parse pasted loads'),
        h('button', { class: 'btn', type: 'button', onclick: () => actions.addParsedLoad({ originCity: '', originState: '', destCity: '', destState: '', pickupEarliest: '', pickupLatest: '', weight: '', equip: 'V', details: '' }) }, 'Add blank row'))),
    h('div', { class: 'toolbar' }, search,
      selectEl(['All', 'Active'], statusFilter, (v) => { statusFilter = v; import('../../main.js').then(m => m.render()); }, { 'data-rerender': '' }),
      h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await actions.runOutlookScan(); toast(`Lane scan: ${r.drafts.length} draft(s) for eligible loads (Outreach = Yes).`, r.drafts.length ? 'ok' : 'info'); if (r.drafts.length) summaryOutreach({ detail: 'Lane scan over all Active loads with Outreach = Yes.', drafts: r.drafts, created: r.drafts.length }); }, title: 'Outlook-macro style scan over loads where Outreach = Yes' }, 'Run lane scan'),
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(datTsv(state.postings, state.settings), 'DAT rows copied (tab-separated).') }, 'Copy all for DAT'),
      h('span', { class: 'muted' }, `${rows.length} of ${state.postings.length} rows`)),
    h('div', { class: 'tablewrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Actions', 'Variant', 'Group', 'Pickup', 'Weight', 'Eq', 'Origin city', 'St', 'ZIP', 'Dest city', 'St', 'Alt mi (O/D)', 'Target $', 'Inq', 'Outreach', 'Sent', 'Status', 'Priority', 'Tgt'].map(x => h('th', null, x)))),
      h('tbody', null, rows.length ? rows.map(row) : h('tr', null, h('td', { colspan: 19, class: 'muted' }, 'No loads yet. Paste TQL text above.'))))));
}
