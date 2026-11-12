import { h, toast, modal, confirmDialog, copyText, openExternal, field, inputEl, selectEl, download } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { rateViewUrl, ventuskyUrl } from '../../core/links.js';
import { DAT_COLUMNS, EQUIPMENT } from '../../core/defaults.js';
import { PRIORITIES, laneBoxes, gridLabel, targetForPriority } from '../../core/model.js';
import { datTsv, datCsv, datProblems, datPostings, datFileName } from '../../core/dat.js';
import { originalLoadDetails, copyDetailsMessage } from '../../core/loaddetails.js';
import { analyseBoard, matchesQuick } from '../../core/worklist.js';
import { laneMemory, laneMemoryText, rateVsMemory, paceStats } from '../../core/coverlog.js';
import { safeNumeric } from '../../core/util.js';
import { icon } from '../icons.js';
import { pageHead, emptyState, flash } from '../chrome.js';
import { boardCtx } from '../board/ctx.js';
import { pastePanel, matrixFlow } from '../board/flow.js';
import { coverModal } from '../board/cover.js';
import { overviewStrip, worklistPanel, scoreboard, guidanceBlock, agingModal } from '../board/insights.js';
import { summaryOutreach } from '../board/outreachview.js';
import { money } from '../board/util.js';

let filter = '';
let quick = '';               // overview-tile filter ('' = none)
let brokerTab = '__all';      // '__all' | broker name | '' (unassigned)
const selected = new Set();   // ticked posting ids (for Download selected / Delete selected)
const rerender = () => import('../../main.js').then(m => m.render());

const ui = () => state.settings.ui || {};
const collapsedSet = () => new Set(ui().collapsed || []);
const saveUi = (patch) => actions.savePrefs({ ui: { ...ui(), ...patch } });
const setCollapsed = (keys) => { saveUi({ collapsed: [...keys] }); rerender(); };

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

/** DAT-rate cell: while you type, shows how the rate compares with the last cover on THIS posting's lane (from your own Cover Log). */
function rateCell(p) {
  const hint = h('small', { class: 'ratehint muted' }, '');
  const inp = inputEl(p.datRate, (v) => actions.updatePosting(p.id, { datRate: v }), { size: 6, placeholder: '$', title: 'Select rate posted on DAT (goes in the CSV)', 'data-fk': `${p.id}:datRate`, class: 'cell datrate' });
  let mem; let looked = false;
  const show = () => {
    if (!looked) { mem = laneMemory(state.coverLog, p, state.zip, Number(state.settings.carrierRadiusMiles) || 75); looked = true; }
    if (!mem) { hint.textContent = ''; return; }
    const vs = rateVsMemory(inp.value, mem);
    hint.textContent = vs ? `${laneMemoryText(mem)} - ${vs}` : laneMemoryText(mem);
  };
  inp.addEventListener('focus', show); inp.addEventListener('input', show);
  return h('td', { class: 'ratecell' }, inp, hint);
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
    rateCell(p),
    h('td', { class: 'ratecell' }, inputEl(p.targetRate, upd('targetRate'), { size: 6, placeholder: '$', title: 'Target rate: used ONLY to judge carrier replies in e-mail. Never uploaded to DAT.', 'data-fk': `${p.id}:targetRate` })),
    h('td', { class: 'num' }, `${p.inquiryCount || 0} / ${p.outreachCount || 0}`),
    h('td', null, selectEl(['No', 'Yes'], p.outreach || 'No', (v) => actions.updatePosting(p.id, { outreach: v }), { title: 'Yes = include in the next lane scan', 'data-fk': `${p.id}:outreach` })),
    h('td', null, h('div', { class: 'rowact' },
      h('button', { class: 'btn small iconcopy', type: 'button', title: 'Copy the original load details', 'aria-label': 'Copy original load details', 'data-act': 'copy-details', onclick: (e) => copyLoadDetails(members, e.currentTarget) }, icon('copy', 14), 'Copy'),
      h('button', { class: 'btn small', type: 'button', title: 'Draft carrier outreach for this posting (best-matched carriers first)', onclick: async () => { const r = await actions.runOutreach(p.id); if (r) summaryOutreach(r); } }, 'Outreach'),
      h('button', { class: 'btn small', type: 'button', title: 'Open DAT RateView for this lane', onclick: () => rateLink(p) }, 'Rate'),
      h('button', { class: 'btn small', type: 'button', title: 'Open weather for the origin', onclick: () => weather(p) }, 'Wx'),
      h('button', { class: 'btn small', type: 'button', title: 'Edit every field', onclick: () => detailModal(p) }, 'Edit'),
      h('button', { class: 'btn small', type: 'button', title: 'Download just this posting as a DAT CSV', 'data-act': 'csv-one', onclick: () => downloadDat('one', [p], 'Posting') }, 'CSV'),
      h('button', { class: 'btn small danger', type: 'button', title: 'Delete only this posting', 'data-act': 'del-one', onclick: () => deleteMany([p.id], 'this posting') }, '✕'))));
}

function flagChips(r) {
  const chips = [];
  if (r.stats.alerts.length) chips.push(h('span', { class: 'flag ' + (r.stats.alerts.some(a => a.level === 'severe') ? 'urgent' : 'act'), title: r.stats.alerts.map(a => a.headline).join('\n') }, icon('storm', 13), ' ' + r.stats.weatherText));
  for (const f of r.flags) if (f.kind !== 'weather') chips.push(h('span', { class: 'flag ' + f.level }, f.text));
  return chips;
}

function groupBox(r, collapsed, toggle) {
  const b = r.box; const head = b.head; const ids = b.members.map(m => m.id);
  const pr = targetForPriority(head.priority, state.settings);
  const allSel = ids.every(id => selected.has(id));
  const single = b.members.length === 1 && !b.groupId;
  const lane = r.stats.cls || '';
  const bulk = h('input', { class: 'cell datrate', size: 6, placeholder: '$ rate', title: 'One DAT rate for every posting in this box', 'data-fk': `${b.key}:bulkrate` });
  const apply = async () => { const n = await actions.setDatRate(ids, bulk.value); toast(n ? `DAT rate ${bulk.value.trim() ? 'set' : 'cleared'} on ${n} posting(s).` : 'Nothing changed.', 'ok'); };
  bulk.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
  const priSel = h('select', { class: 'cell', title: 'Priority sets the outreach target for the whole box (Low 5, Medium 10, High 15)', 'data-fk': `${b.key}:priority` },
    PRIORITIES.map(x => h('option', { value: x, selected: x === (head.priority || 'Low') }, x)));
  priSel.addEventListener('change', () => actions.setPriority(head.id, priSel.value));
  const contact = h('select', { class: 'cell', title: 'How carriers should reach you from the DAT post. Email is the default; Phone shows your phone number on DAT instead.', 'data-fk': `${b.key}:contact` },
    ['Email', 'Phone'].map(x => h('option', { value: x, selected: x === (String(head.contact || '').toLowerCase() === 'phone' ? 'Phone' : 'Email') }, x === 'Email' ? 'E-mail (default)' : 'Phone')));
  contact.addEventListener('change', () => actions.setContact(head.id, contact.value));
  const brokers = state.settings.brokers || [];
  const brokerSel = brokers.length ? h('select', { class: 'cell', title: 'Which broker owns this load', 'data-fk': `${b.key}:broker` },
    h('option', { value: '' }, 'Unassigned'), brokers.map(x => h('option', { value: x, selected: x === (head.broker || '') }, x))) : null;
  if (brokerSel) brokerSel.addEventListener('change', () => actions.setBroker(head.id, brokerSel.value));
  const memLine = r.stats.mem ? h('p', { class: 'memline' }, icon('trendup', 14), ' ' + laneMemoryText(r.stats.mem)) : null;
  const rates = b.members.map(m => safeNumeric(m.datRate)).filter(x => x > 0);
  const rateTxt = rates.length ? (Math.min(...rates) === Math.max(...rates) ? money(rates[0]) : `${money(Math.min(...rates))}-${money(Math.max(...rates))}`) : 'no rate';
  const toggleBtn = h('button', { class: 'collbtn', type: 'button', 'aria-expanded': String(!collapsed), title: collapsed ? 'Expand this load' : 'Collapse this load', 'data-act': 'toggle-box', onclick: toggle }, icon(collapsed ? 'chevright' : 'chevdown', 16));
  const header = h('header', { class: 'lanehead' },
    h('div', { class: 'lanetitle' }, toggleBtn,
      h('input', { type: 'checkbox', checked: allSel, 'aria-label': 'Select every posting in this lane', 'data-fk': `${b.key}:chk`, onchange: (e) => { ids.forEach(id => (e.target.checked ? selected.add(id) : selected.delete(id))); rerender(); } }),
      h('h3', { class: 'lane', onclick: toggle }, b.title),
      h('span', { class: 'score ' + r.label.toLowerCase(), title: `Cover-probability score ${r.score}/100 (${r.label}): ${r.reasons.join('; ')}` }, r.score),
      h('span', { class: 'pill' }, `${b.members.length} posting${b.members.length === 1 ? '' : 's'}`),
      lane ? h('span', { class: 'pill lanecls ' + lane, title: 'Posting strategy for this lane length (System > Posting strategy)' }, ({ local: 'Local', regional: 'Regional', long: 'Long-distance' })[lane] || lane) : null,
      h('span', { class: 'pill' }, rateTxt), head.broker ? h('span', { class: 'pill alt' }, head.broker) : null,
      String(head.contact || '').toLowerCase() === 'phone' ? h('span', { class: 'pill', title: 'Posted on DAT with your phone number' }, icon('phone', 12), ' phone') : null,
      `${r.stats.inquiries.total}` !== '0' ? h('span', { class: 'pill ok', title: 'Inquiries received' }, `${r.stats.inquiries.total} inq`) : null,
      ...flagChips(r)),
    collapsed ? null : h('div', { class: 'lanectl' },
      h('label', { class: 'inl' }, 'Priority ', priSel),
      h('span', { class: 'pill tgt', title: 'Target outreach number for this box' }, `Target outreach: ${pr.target}`),
      h('label', { class: 'inl' }, 'DAT contact ', contact),
      brokerSel ? h('label', { class: 'inl' }, 'Broker ', brokerSel) : null,
      h('button', { class: 'btn small primary', type: 'button', 'data-act': 'mark-covered', title: 'Log which posting and carrier covered it, then remove the load', onclick: () => coverModal(b) }, icon('check', 14), 'Mark covered')));
  if (collapsed) return h('section', { class: 'lanebox collapsed p-' + (head.priority || 'Low'), dataset: { group: b.groupId || '', lane: b.title, key: b.key } }, header);
  return h('section', { class: 'lanebox p-' + (head.priority || 'Low'), dataset: { group: b.groupId || '', lane: b.title, key: b.key } },
    header, memLine,
    guidanceBlock(r, boardCtx()),
    h('div', { class: 'laneact' },
      h('button', { class: 'btn small', type: 'button', 'data-act': 'copy-lane-details', title: 'Copy the original load details (the pasted TQL text)', onclick: (e) => copyLoadDetails(b.members, e.currentTarget) }, icon('copy', 15), 'Copy load details'),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'view-lane-details', title: 'View the original load details', onclick: () => viewDetails(b) }, icon('eye', 15), 'View details'),
      single ? h('button', { class: 'btn small primary', type: 'button', title: 'Build the 9-posting matrix', onclick: () => matrixFlow(head) }, 'Build 3×3 matrix') : null,
      h('span', { class: 'inl' }, h('b', null, 'DAT rate for all:'), bulk, h('button', { class: 'btn small', type: 'button', 'data-act': 'rate-all', onclick: apply }, 'Apply')),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'csv-group', title: 'Download every posting in this box as a DAT CSV', onclick: () => downloadDat(single ? 'one' : 'group', b.members, 'Lane') }, 'Download CSV'),
      h('button', { class: 'btn small', type: 'button', title: 'Save this load group to Spare Load Details', onclick: async () => { await actions.saveSpareFromGroup(head.id); toast('Saved to Spare Load Details.', 'ok'); } }, 'Spare'),
      h('button', { class: 'btn small danger', type: 'button', 'data-act': 'del-group', title: 'Delete the whole box (not logged; use Mark covered to keep a record)', onclick: () => deleteMany(ids, single ? 'this posting' : `all ${ids.length} postings in ${b.title}`) }, single ? 'Delete' : 'Delete group')),
    h('div', { class: 'tablewrap' }, h('table', { class: 'lanetable' },
      h('thead', null, h('tr', null, [['', ''], ['Posting', ''], ['Pickup', ''], ['Weight', ''], ['Eq', EQ_TITLE], ['Origin city', ''], ['St', ''], ['ZIP', 'Auto-filled from the city'], ['Dest city', ''], ['St', ''], ['ZIP', 'Auto-filled from the city'], ['DAT rate $', 'Rate posted on DAT (goes in the CSV)'], ['Target $ (email)', 'Used only to judge carrier e-mail replies; never uploaded'], ['Inq / Sent', 'Carrier inquiries received / outreach drafts sent'], ['Outreach', 'Yes = include in the next lane scan'], ['Actions', '']].map(([x, t]) => h('th', { title: t || null }, x)))),
      h('tbody', null, b.members.map(m => row(m, b.members))))));
}

function brokerTabs(boxesAll) {
  const brokers = state.settings.brokers || [];
  const unassigned = boxesAll.filter(x => !(x.box.head.broker || '')).length;
  const count = (name) => boxesAll.filter(x => (x.box.head.broker || '') === name).length;
  const tab = (id, label, n) => h('button', { class: 'tab' + (brokerTab === id ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(brokerTab === id), 'data-fk': 'tab:' + id, onclick: () => { brokerTab = id; rerender(); } }, label, h('em', null, n));
  const addBroker = h('button', { class: 'btn small', type: 'button', onclick: () => {
    const inp = h('input', { placeholder: 'Broker name', 'data-live': '' });
    modal({ title: 'Add a broker', body: h('div', null, h('p', { class: 'muted' }, 'Each broker gets their own tab, scoreboard and CSV. You can also assign a load to a broker from its header.'), field('Name', inp)),
      actions: [{ label: 'Cancel' }, { label: 'Add', kind: 'primary', onClick: async () => { const ok = await actions.addBroker(inp.value); if (!ok) { toast('Enter a new name (it must not already exist).', 'warn'); return false; } brokerTab = inp.value.trim(); } }] });
    setTimeout(() => inp.focus(), 40);
  } }, icon('plus', 14), 'Broker');
  return h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Broker boards' },
    tab('__all', 'All', boxesAll.length), brokers.map(b => tab(b, b, count(b))), brokers.length && unassigned ? tab('', 'Unassigned', unassigned) : null, addBroker);
}

export function render() {
  const now = new Date();
  const ctx = boardCtx(now);
  const rowsAll = analyseBoard(ctx);
  const brokers = state.settings.brokers || [];
  if (brokerTab !== '__all' && brokerTab !== '' && !brokers.includes(brokerTab)) brokerTab = '__all';
  if (brokerTab === '' && !brokers.length) brokerTab = '__all';
  const f = filter.trim().toLowerCase();
  const inTab = (r) => brokerTab === '__all' || (r.box.head.broker || '') === brokerTab;
  const rows = rowsAll.filter(inTab).filter(r => matchesQuick(r, quick)).filter(r => !f || r.box.members.some(p => [p.originCity, p.originState, p.destCity, p.destState, p.groupId, p.variant, p.broker].join(' ').toLowerCase().includes(f)));
  const rowsTab = rowsAll.filter(inTab);
  for (const id of [...selected]) if (!state.postings.some(p => p.id === id)) selected.delete(id);
  const nSel = selected.size;
  const shown = rows.reduce((n, r) => n + r.box.members.length, 0);
  const collapsed = collapsedSet();
  const tabPostings = state.postings.filter(p => brokerTab === '__all' || (p.broker || '') === brokerTab);
  const tabName = brokerTab === '__all' ? 'All' : (brokerTab || 'Unassigned');
  const search = h('input', { type: 'search', placeholder: 'Filter lanes / groups…', value: filter, 'data-live': '', 'data-fk': 'filter' });
  search.addEventListener('input', () => { filter = search.value; rerender(); });
  const selIds = () => [...selected];
  const openBox = async (box) => { if (collapsed.has(box.key)) { collapsed.delete(box.key); saveUi({ collapsed: [...collapsed] }); } await rerender(); setTimeout(() => { const el = document.querySelector(`[data-key="${CSS.escape(box.key)}"]`); if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 1600); } }, 120); };
  const wlOpen = ui().worklist !== false;
  const pace = paceStats(state.coverLog, state.settings, now, brokerTab === '__all' ? null : brokerTab);
  return h('div', null,
    pageHead({ icon: 'board', title: 'FREIGHT SIGNAL', sub: 'Paste TQL loads → they are read as you paste → the 3 × 3 matrix builds itself → set DAT rates → download the DAT CSV. Drafts are never sent automatically.' }),
    overviewStrip(rowsAll, ctx, quick, (k) => { quick = k; rerender(); }),
    worklistPanel(rowsAll, wlOpen, openBox, wlOpen, (v) => { saveUi({ worklist: v }); rerender(); }),
    pastePanel(),
    brokerTabs(rowsAll),
    scoreboard(brokerTab),
    h('div', { class: 'toolbar sticky' }, search,
      quick ? h('button', { class: 'btn small', type: 'button', onclick: () => { quick = ''; rerender(); } }, `Showing: ${quick} ✕`) : null,
      h('button', { class: 'btn primary', type: 'button', 'data-act': 'csv-all', title: `${tabName === 'All' ? 'Every posting on the board' : tabName + "'s postings"}, in DAT’s bulk-upload template format`, onclick: () => downloadDat(brokerTab === '__all' ? 'all' : 'group', tabPostings, tabName === 'All' ? 'Whole board' : tabName + ' board') }, icon('download', 15), brokerTab === '__all' ? 'Download all (DAT CSV)' : `Download ${tabName} CSV`),
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(datTsv(tabPostings), 'DAT rows copied (tab-separated).') }, 'Copy for DAT'),
      h('button', { class: 'btn', type: 'button', 'data-act': 'aging', onclick: () => agingModal(rowsTab, ctx), title: 'Loads with no inquiries past their lane limit: one-click reprice and a fresh round of outreach' }, 'Aging loads' + (rowsTab.filter(r => r.flags.some(x => x.kind === 'aging')).length ? ` (${rowsTab.filter(r => r.flags.some(x => x.kind === 'aging')).length})` : '')),
      h('button', { class: 'btn', type: 'button', onclick: async () => { const r = await actions.runOutlookScan(); toast(`Lane scan: ${r.drafts.length} draft(s) for eligible loads (Outreach = Yes).`, r.drafts.length ? 'ok' : 'info'); if (r.drafts.length) summaryOutreach({ detail: 'Ranked lane scan over all Active loads with Outreach = Yes.', drafts: r.drafts, created: r.drafts.length }); }, title: 'Scan loads where Outreach = Yes and draft the best-ranked carriers' }, 'Run lane scan'),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'collapse-all', onclick: () => setCollapsed(new Set(rowsAll.map(r => r.box.key))) }, 'Collapse all'),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'expand-all', onclick: () => setCollapsed(new Set()) }, 'Expand all'),
      h('span', { class: 'muted' }, `${rows.length} load${rows.length === 1 ? '' : 's'} · ${shown} postings`)),
    nSel ? h('div', { class: 'toolbar selbar' }, h('b', null, `${nSel} selected`),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'csv-sel', onclick: () => downloadDat('selected', state.postings.filter(p => selected.has(p.id)), 'Selection') }, 'Download selected'),
      h('button', { class: 'btn small danger', type: 'button', 'data-act': 'del-sel', onclick: () => deleteMany(selIds(), `${nSel} selected posting${nSel === 1 ? '' : 's'}`) }, 'Delete selected'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { selected.clear(); rerender(); } }, 'Clear')) : null,
    h('p', { class: 'legend muted' }, h('b', null, 'Equipment: '), EQUIPMENT.map(e => `${e.code} = ${e.label}`).join('  ·  '),
      '   |   ', h('b', null, 'DAT rate'), ' is posted on DAT.  ', h('b', null, 'Target $'), ' is only used to judge carrier e-mail replies.'),
    rows.length ? rows.map(r => groupBox(r, collapsed.has(r.box.key), () => { if (collapsed.has(r.box.key)) collapsed.delete(r.box.key); else collapsed.add(r.box.key); setCollapsed(collapsed); })) :
      emptyState({ icon: 'board', title: state.postings.length ? 'No loads match' : 'No loads yet', text: state.postings.length ? 'Clear the filter, or pick another broker tab.' : 'Paste TQL load text above. The loads appear as editable rows right away.' }));
}
