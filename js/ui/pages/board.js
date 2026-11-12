import { h, toast, modal, confirmDialog, copyText, openExternal, field, inputEl, selectEl, download } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { parseTqlLoad, splitLoads } from '../../core/parser.js';
import { buildPreviewMessage } from '../../core/matrix.js';
import { rateViewUrl, ventuskyUrl } from '../../core/links.js';
import { DAT_COLUMNS, EQUIPMENT } from '../../core/defaults.js';
import { PRIORITIES, STATUSES, groupMembers, laneBoxes, gridLabel, targetForPriority } from '../../core/model.js';
import { datTsv, datCsv, datProblems, datPostings, datFileName } from '../../core/dat.js';
import { draftCard } from '../draftcard.js';
import { originalLoadDetails, copyDetailsMessage } from '../../core/loaddetails.js';
import { icon } from '../icons.js';
import { pageHead, emptyState, flash } from '../chrome.js';

let pasteText = '';
let filter = '';
let statusFilter = 'All';
const selected = new Set();   // ticked posting ids (for Download selected / Delete selected)
const rerender = () => import('../../main.js').then(m => m.render());

/** Copy the ORIGINAL load details (the pasted TQL text) for a lane, falling back to a lane summary when none was pasted. */
async function copyLoadDetails(members, btn) {
  const d = originalLoadDetails(members);
  if (d.source === 'none') return toast('This load has no details to copy yet. Fill in the origin and destination first.', 'warn');
  await copyText(d.text, copyDetailsMessage(d.source));
  flash(btn);
}

function viewDetails(b) {
  const d = originalLoadDetails(b.members);
  const ta = h('textarea', { class: 'copybox', readOnly: true, rows: 14, 'aria-label': 'Original load details' }, d.text);
  ta.value = d.text;
  const note = d.source === 'original' ? 'This is the text pasted for the original posting, exactly as it was stored.'
    : d.source === 'summary' ? 'No source text was pasted for this load, so this is a summary built from its lane fields.' : 'There are no details for this load yet.';
  modal({
    title: `Load details: ${b.title}`, wide: true,
    body: h('div', null, h('p', { class: 'muted' }, note), ta),
    actions: [{ label: 'Close' }, { label: 'Copy details', kind: 'primary', keepOpen: true, onClick: async () => { if (d.text) await copyText(d.text, copyDetailsMessage(d.source)); return false; } }],
  });
  setTimeout(() => ta.select(), 30);
}

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
        cell('destCity', 'Dest city'), cell('destState', 'Dest state'), cell('weight', 'Weight'), cell('equip', 'Equip (V R F SD VM RM)')),
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
      mk('targetRate', 'Target Rate (emails only)')),
    mk('details', 'Auto-reply details (source TQL text)', true),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', onclick: (e) => { const v = inputs.details.value.trim(); if (!v) return toast('There are no details to copy.', 'warn'); copyText(v, 'Load details copied.'); flash(e.currentTarget); } }, icon('copy', 15), 'Copy details')),
    mk('notes', 'Auto-reply notes'));
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

/** Download a DAT-template CSV for a list of postings (whole board, one lane group, a selection, or a single posting). */
async function downloadDat(kind, list, what) {
  const rows = datPostings(list);
  if (!rows.length) return toast('Nothing to download.', 'warn');
  const problems = datProblems(rows);
  if (problems.length) {
    const msg = problems.slice(0, 12).map(x => `• ${x.label}: missing ${x.missing.join(', ')}`).join('\n') + (problems.length > 12 ? `\n…and ${problems.length - 12} more` : '');
    const ok = await confirmDialog('Some postings are incomplete', `DAT will reject these rows until the required fields are filled in:\n\n${msg}\n\nDownload anyway?`, 'Download anyway');
    if (!ok) return;
  }
  download(datFileName(kind, rows), datCsv(rows), 'text/csv;charset=utf-8');
  const priced = rows.filter(p => String(p.datRate ?? '').trim()).length;
  toast(`${what}: ${rows.length} posting(s) downloaded (${priced} with a DAT rate). Upload the file in DAT's bulk posting tool.`, 'ok', 7000);
}

async function deleteMany(ids, what) {
  if (!ids.length) return;
  if (!(await confirmDialog('Delete postings', `Delete ${what}? This cannot be undone (download a backup first if unsure).`, 'Delete'))) return;
  const n = await actions.deletePostings(ids);
  ids.forEach(id => selected.delete(id));
  toast(`${n} posting(s) deleted.`, 'ok');
}

const EQ_TITLE = EQUIPMENT.map(e => `${e.code} = ${e.label}`).join(', ');
function equipSelect(p) {
  const codes = EQUIPMENT.map(e => e.code);
  const cur = String(p.equip ?? '').toUpperCase();
  const opts = codes.includes(cur) || !cur ? EQUIPMENT : [...EQUIPMENT, { code: cur, label: 'custom' }];
  const sel = h('select', { class: 'cell eq', title: EQ_TITLE, 'data-fk': `${p.id}:equip` },
    opts.map(e => h('option', { value: e.code, selected: e.code === cur }, e.code)));
  sel.addEventListener('change', () => actions.updatePosting(p.id, { equip: sel.value }));
  return sel;
}

function row(p, members) {
  const upd = (k) => (v) => actions.updatePosting(p.id, { [k]: v });
  const td = (k, w, extra = {}) => h('td', null, inputEl(p[k], upd(k), { size: w, 'data-fk': `${p.id}:${k}`, ...extra }));
  const lbl = gridLabel(p.variant);
  const cls = ['lrow', p.variant === 'Original' ? 'orig' : ''].join(' ');
  return h('tr', { class: cls, dataset: { posting: p.id } },
    h('td', { class: 'chk' }, h('input', { type: 'checkbox', checked: selected.has(p.id), 'aria-label': 'Select posting', 'data-fk': `${p.id}:chk`, onchange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); rerender(); } })),
    h('td', null, p.variant ? h('span', { class: 'pill ' + (p.variant === 'Original' ? 'orig' : 'alt'), title: p.variant === 'Original' ? 'Original posting' : `${p.variant}: origin ${p.originAltMiles ?? 0} mi and destination ${p.destAltMiles ?? 0} mi from the original` }, (lbl ? lbl + ' · ' : '') + p.variant) : h('span', { class: 'muted' }, 'single')),
    td('pickupEarliest', 9), td('weight', 6), h('td', null, equipSelect(p)),
    td('originCity', 14), td('originState', 3), td('originZip', 6, { class: 'cell zip' }),
    td('destCity', 14), td('destState', 3), td('destZip', 6, { class: 'cell zip' }),
    h('td', { class: 'ratecell' }, inputEl(p.datRate, upd('datRate'), { size: 6, placeholder: '$', title: 'Select rate posted on DAT (goes in the CSV)', 'data-fk': `${p.id}:datRate`, class: 'cell datrate' })),
    h('td', { class: 'ratecell' }, inputEl(p.targetRate, upd('targetRate'), { size: 6, placeholder: '$', title: 'Target rate: used ONLY to judge carrier replies in e-mail. Never uploaded to DAT.', 'data-fk': `${p.id}:targetRate` })),
    h('td', { class: 'num' }, `${p.inquiryCount || 0} / ${p.outreachCount || 0}`),
    h('td', null, selectEl(['No', 'Yes'], p.outreach || 'No', (v) => actions.updatePosting(p.id, { outreach: v }), { title: 'Yes = include in the next lane scan', 'data-fk': `${p.id}:outreach` })),
    h('td', null, h('div', { class: 'rowact' },
      h('button', { class: 'btn small iconcopy', type: 'button', title: 'Copy the original load details', 'aria-label': 'Copy original load details', 'data-act': 'copy-details', onclick: (e) => copyLoadDetails(members, e.currentTarget) }, icon('copy', 14), 'Copy'),
      h('button', { class: 'btn small', type: 'button', title: 'Draft carrier outreach for this posting', onclick: async () => { const r = await actions.runOutreach(p.id); if (r) summaryOutreach(r); } }, 'Outreach'),
      h('button', { class: 'btn small', type: 'button', title: 'Open DAT RateView for this lane', onclick: () => rateLink(p) }, 'Rate'),
      h('button', { class: 'btn small', type: 'button', title: 'Open weather for the origin', onclick: () => weather(p) }, 'Wx'),
      h('button', { class: 'btn small', type: 'button', title: 'Edit every field', onclick: () => detailModal(p) }, 'Edit'),
      h('button', { class: 'btn small', type: 'button', title: 'Download just this posting as a DAT CSV', 'data-act': 'csv-one', onclick: () => downloadDat('one', [p], 'Posting') }, 'CSV'),
      h('button', { class: 'btn small danger', type: 'button', title: 'Delete only this posting', 'data-act': 'del-one', onclick: () => deleteMany([p.id], 'this posting') }, '✕'))));
}

function groupBox(b) {
  const head = b.head; const ids = b.members.map(m => m.id);
  const pr = targetForPriority(head.priority, state.settings);
  const allSel = ids.every(id => selected.has(id));
  const bulk = h('input', { class: 'cell datrate', size: 6, placeholder: '$ rate', title: 'One DAT rate for every posting in this box', 'data-fk': `${b.key}:bulkrate` });
  const apply = async () => { const n = await actions.setDatRate(ids, bulk.value); toast(n ? `DAT rate ${bulk.value.trim() ? 'set' : 'cleared'} on ${n} posting(s).` : 'Nothing changed.', 'ok'); };
  bulk.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  const single = b.members.length === 1 && !b.groupId;
  const priSel = h('select', { class: 'cell', title: 'Priority sets the outreach target for the whole box (Low 5, Medium 10, High 15)', 'data-fk': `${b.key}:priority` },
    PRIORITIES.map(x => h('option', { value: x, selected: x === (head.priority || 'Low') }, x)));
  priSel.addEventListener('change', () => actions.setPriority(head.id, priSel.value));
  const stSel = selectEl(STATUSES, head.status || 'Active', async (v) => { const r = await actions.setStatus(head.id, v); if (r.removed) toast(`Covered: ${r.removed} row(s) removed from the board.`, 'ok'); }, { 'data-fk': `${b.key}:status` });
  return h('section', { class: 'lanebox p-' + (head.priority || 'Low'), dataset: { group: b.groupId || '', lane: b.title } },
    h('header', { class: 'lanehead' },
      h('div', { class: 'lanetitle' },
        h('input', { type: 'checkbox', checked: allSel, 'aria-label': 'Select every posting in this lane', 'data-fk': `${b.key}:chk`, onchange: (e) => { ids.forEach(id => (e.target.checked ? selected.add(id) : selected.delete(id))); rerender(); } }),
        h('h3', { class: 'lane' }, b.title),
        h('span', { class: 'pill' }, `${b.members.length} posting${b.members.length === 1 ? '' : 's'}`),
        b.groupId ? h('span', { class: 'pill mono', title: b.groupId }, shortGroup(b.groupId)) : null),
      h('div', { class: 'lanectl' },
        h('label', { class: 'inl' }, 'Priority ', priSel),
        h('span', { class: 'pill tgt', title: 'Target outreach number for this box' }, `Target outreach: ${pr.target}`),
        h('label', { class: 'inl' }, 'Status ', stSel))),
    h('div', { class: 'laneact' },
      h('button', { class: 'btn small', type: 'button', 'data-act': 'copy-lane-details', title: 'Copy the original load details (the pasted TQL text)', onclick: (e) => copyLoadDetails(b.members, e.currentTarget) }, icon('copy', 15), 'Copy load details'),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'view-lane-details', title: 'View the original load details', onclick: () => viewDetails(b) }, icon('eye', 15), 'View details'),
      single ? h('button', { class: 'btn small primary', type: 'button', title: 'Build the 9-posting matrix', onclick: () => matrixFlow(head) }, 'Build 3×3 matrix') : null,
      h('span', { class: 'inl' }, h('b', null, 'DAT rate for all:'), bulk, h('button', { class: 'btn small', type: 'button', 'data-act': 'rate-all', onclick: apply }, 'Apply')),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'csv-group', title: 'Download every posting in this box as a DAT CSV', onclick: () => downloadDat(single ? 'one' : 'group', b.members, 'Lane') }, 'Download CSV'),
      h('button', { class: 'btn small', type: 'button', title: 'Save this load group to Spare Load Details', onclick: async () => { await actions.saveSpareFromGroup(head.id); toast('Saved to Spare Load Details.', 'ok'); } }, 'Spare'),
      h('button', { class: 'btn small danger', type: 'button', 'data-act': 'del-group', title: 'Delete the whole box', onclick: () => deleteMany(ids, single ? 'this posting' : `all ${ids.length} postings in ${b.title}`) }, single ? 'Delete' : 'Delete group')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'lanetable' },
      h('thead', null, h('tr', null, [['', ''], ['Posting', ''], ['Pickup', ''], ['Weight', ''], ['Eq', EQ_TITLE], ['Origin city', ''], ['St', ''], ['ZIP', 'Auto-filled from the city'], ['Dest city', ''], ['St', ''], ['ZIP', 'Auto-filled from the city'], ['DAT rate $', 'Rate posted on DAT (goes in the CSV)'], ['Target $ (email)', 'Used only to judge carrier e-mail replies; never uploaded'], ['Inq / Sent', 'Carrier inquiries received / outreach drafts sent'], ['Outreach', 'Yes = include in the next lane scan'], ['Actions', '']].map(([x, t]) => h('th', { title: t || null }, x)))),
      h('tbody', null, b.members.map(m => row(m, b.members))))));
}

export function render() {
  const f = filter.trim().toLowerCase();
  let boxes = laneBoxes(state.postings);
  boxes = boxes.filter(b => {
    if (statusFilter !== 'All' && (b.head.status || 'Active') !== statusFilter) return false;
    if (!f) return true;
    return b.members.some(p => [p.originCity, p.originState, p.destCity, p.destState, p.groupId, p.variant].join(' ').toLowerCase().includes(f));
  });
  // forget ticks for postings that no longer exist
  for (const id of [...selected]) if (!state.postings.some(p => p.id === id)) selected.delete(id);
  const nSel = selected.size;
  const shown = boxes.reduce((n, b) => n + b.members.length, 0);
  const ta = h('textarea', { placeholder: 'Paste one or more TQL load blocks here (Pickup:, Delivery:, Pickup Date/Time:, Weight:, Trailer Type: …)', value: pasteText, 'data-rerender': '', 'data-fk': 'paste' });
  ta.addEventListener('input', () => { pasteText = ta.value; });
  const search = h('input', { type: 'search', placeholder: 'Filter lanes / groups…', value: filter, 'data-live': '', 'data-fk': 'filter' });
  search.addEventListener('input', () => { filter = search.value; rerender(); });
  const selIds = () => [...selected];
  return h('div', null,
    pageHead({ icon: 'board', title: 'FREIGHT SIGNAL', sub: 'Paste TQL loads → review → build the 3 × 3 matrix → set DAT rates → download the DAT CSV. Drafts are never sent automatically.' }),
    h('div', { class: 'panel' }, ta,
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => reviewParsed(ta.value) }, 'Parse pasted loads'),
        h('button', { class: 'btn', type: 'button', onclick: () => actions.addParsedLoad({ originCity: '', originState: '', destCity: '', destState: '', pickupEarliest: '', pickupLatest: '', weight: '', equip: 'V', details: '' }) }, 'Add blank row'))),
    h('div', { class: 'toolbar sticky' }, search,
      selectEl(['All', 'Active'], statusFilter, (v) => { statusFilter = v; rerender(); }),
      h('button', { class: 'btn primary', type: 'button', 'data-act': 'csv-all', title: 'Every posting on the board, in DAT’s bulk-upload template format', onclick: () => downloadDat('all', state.postings, 'Whole board') }, 'Download all (DAT CSV)'),
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(datTsv(state.postings), 'DAT rows copied (tab-separated).') }, 'Copy all for DAT'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await actions.runOutlookScan(); toast(`Lane scan: ${r.drafts.length} draft(s) for eligible loads (Outreach = Yes).`, r.drafts.length ? 'ok' : 'info'); if (r.drafts.length) summaryOutreach({ detail: 'Lane scan over all Active loads with Outreach = Yes.', drafts: r.drafts, created: r.drafts.length }); }, title: 'Outlook-macro style scan over loads where Outreach = Yes' }, 'Run lane scan'),
      h('span', { class: 'muted' }, `${boxes.length} lane${boxes.length === 1 ? '' : 's'} · ${shown} of ${state.postings.length} postings`)),
    nSel ? h('div', { class: 'toolbar selbar' }, h('b', null, `${nSel} selected`),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'csv-sel', onclick: () => downloadDat('selected', state.postings.filter(p => selected.has(p.id)), 'Selection') }, 'Download selected'),
      h('button', { class: 'btn small danger', type: 'button', 'data-act': 'del-sel', onclick: () => deleteMany(selIds(), `${nSel} selected posting${nSel === 1 ? '' : 's'}`) }, 'Delete selected'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { selected.clear(); rerender(); } }, 'Clear')) : null,
    h('p', { class: 'legend muted' }, h('b', null, 'Equipment: '), EQUIPMENT.map(e => `${e.code} = ${e.label}`).join('  ·  '),
      '   |   ', h('b', null, 'DAT rate'), ' is posted on DAT.  ', h('b', null, 'Target $'), ' is only used to judge carrier e-mail replies.'),
    boxes.length ? boxes.map(groupBox) : emptyState({ icon: 'board', title: state.postings.length ? 'No lanes match the filter' : 'No loads yet', text: state.postings.length ? 'Clear the filter to see everything.' : 'Paste TQL load text above and choose Parse pasted loads.' }));
}
