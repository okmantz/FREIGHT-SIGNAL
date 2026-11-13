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
import { loadStatus, equipLabel, shortDate, lbs, FLAG_ICON, QUICK_FILTERS } from '../board/status.js';
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
      mk('targetRate', 'Target rate (whole load)')),
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

const datOpts = () => ({ targetAsRate: state.settings.postTargetOnDat !== false });

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
  const o = datOpts();
  download(datFileName(kind, rows), datCsv(rows, o), 'text/csv;charset=utf-8');
  const priced = rows.filter(p => String(p.datRate ?? '').trim() || (o.targetAsRate && String(p.targetRate ?? '').trim())).length;
  toast(`${what}: ${rows.length} posting(s) downloaded (${priced} with a rate). Upload the file in DAT's bulk posting tool.`, 'ok', 7000);
}

async function deleteMany(ids, what) {
  if (!ids.length) return;
  if (!(await confirmDialog('Delete postings', `Delete ${what}? This cannot be undone (download a backup first if unsure).`, 'Delete'))) return;
  const n = await actions.deletePostings(ids);
  ids.forEach(id => selected.delete(id));
  toast(`${n} posting(s) deleted.`, 'ok');
}

const EQ_TITLE = EQUIPMENT.map(e => `${e.code} = ${e.label}`).join(', ');

/** Equipment select that applies to every posting of the load. */
function equipSelect(b) {
  const head = b.head;
  const cur = String(head.equip ?? '').toUpperCase();
  const opts = EQUIPMENT.some(e => e.code === cur) || !cur ? EQUIPMENT : [...EQUIPMENT, { code: cur, label: 'custom' }];
  const sel = h('select', { class: 'cell', title: EQ_TITLE, 'data-fk': `${b.key}:equip` },
    opts.map(e => h('option', { value: e.code, selected: e.code === cur }, `${e.code} · ${e.label}`)));
  sel.addEventListener('change', () => actions.updateGroup(head.id, { equip: sel.value }));
  return sel;
}

/** A "⋯" dropdown: <details> so it works without any script, closed again after a choice. */
function menu(label, items) {
  const d = h('details', { class: 'menu' },
    h('summary', { class: 'btn small iconbtn', 'aria-label': label, title: label }, icon('more', 16)),
    h('div', { class: 'menu-pop' }, items.filter(Boolean).map(it => h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button', 'data-act': it.act || null, onclick: (e) => { d.removeAttribute('open'); it.run(e); } }, it.label))));
  return d;
}
document.addEventListener('click', (e) => { document.querySelectorAll('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); }); });

/** The plain-language problem chips under a load's title. */
function issuesStrip(r) {
  const chips = [];
  if (r.stats.alerts.length) chips.push(h('span', { class: 'issue ' + (r.stats.alerts.some(a => a.level === 'severe') ? 'urgent' : 'act'), title: r.stats.alerts.map(a => a.headline).join('\n') }, icon('storm', 14), r.stats.weatherText));
  for (const f of r.flags) if (f.kind !== 'weather') chips.push(h('span', { class: 'issue ' + (f.kind === 'hot' ? 'hot' : f.level) }, icon(FLAG_ICON[f.kind] || 'alert', 14), f.text));
  return chips.length ? h('div', { class: 'issues' }, chips) : null;
}

/** One row of the compact matrix: position, lane, replies, and a ⋯ menu for the rarely used actions. */
function row(p) {
  const upd = (k) => (v) => actions.updatePosting(p.id, { [k]: v });
  const ci = (k, size, extra = {}) => inputEl(p[k], upd(k), { size, 'data-fk': `${p.id}:${k}`, ...extra });
  const lbl = gridLabel(p.variant);
  const orig = p.variant === 'Original';
  return h('tr', { class: 'lrow' + (orig ? ' orig' : ''), dataset: { posting: p.id } },
    h('td', { class: 'chk' }, h('input', { type: 'checkbox', checked: selected.has(p.id), 'aria-label': 'Select posting', 'data-fk': `${p.id}:chk`, onchange: (e) => { if (e.target.checked) selected.add(p.id); else selected.delete(p.id); rerender(); } })),
    h('td', null, p.variant ? h('span', { class: 'pos ' + (orig ? 'orig' : ''), title: orig ? 'Original posting (A-A)' : `${p.variant}: origin ${p.originAltMiles ?? 0} mi and destination ${p.destAltMiles ?? 0} mi from the original` }, lbl || p.variant) : h('span', { class: 'pos' }, 'Single')),
    h('td', null, h('div', { class: 'endpoint' }, ci('originCity', 14, { 'aria-label': 'Origin city' }), ci('originState', 2, { class: 'cell st', 'aria-label': 'Origin state' }), ci('originZip', 5, { class: 'cell zip', 'aria-label': 'Origin ZIP' }))),
    h('td', { class: 'arrow' }, icon('chevright', 14)),
    h('td', null, h('div', { class: 'endpoint' }, ci('destCity', 14, { 'aria-label': 'Destination city' }), ci('destState', 2, { class: 'cell st', 'aria-label': 'Destination state' }), ci('destZip', 5, { class: 'cell zip', 'aria-label': 'Destination ZIP' }))),
    h('td', { class: 'num', title: 'Carrier replies received / outreach drafts sent' }, `${p.inquiryCount || 0} / ${p.outreachCount || 0}`),
    h('td', { class: 'rowmenu' }, menu('More actions for this posting', [
      { label: 'Edit every field', run: () => detailModal(p) },
      { label: 'Open DAT RateView', run: () => rateLink(p) },
      { label: 'Weather at origin', run: () => weather(p) },
      { label: 'Download this posting (CSV)', act: 'csv-one', run: () => downloadDat('one', [p], 'Posting') },
      { label: 'Delete this posting', act: 'del-one', danger: true, run: () => deleteMany([p.id], 'this posting') }])));
}

function groupBox(r, collapsed, toggle) {
  const b = r.box; const head = b.head; const ids = b.members.map(m => m.id);
  const pr = targetForPriority(head.priority, state.settings);
  const allSel = ids.every(id => selected.has(id));
  const single = b.members.length === 1 && !b.groupId;
  const st = loadStatus(r);
  const lane = r.stats.cls || '';
  const attrs = { dataset: { group: b.groupId || '', lane: b.title, key: b.key } };
  const memberRate = b.members.map(m => String(m.targetRate ?? '').trim() || String(m.datRate ?? '').trim()).find(Boolean) || '';
  const rate = String(head.targetRate ?? '').trim() || memberRate;

  const toggleBtn = h('button', { class: 'collbtn', type: 'button', 'aria-expanded': String(!collapsed), title: collapsed ? 'Expand this load' : 'Collapse this load', 'data-act': 'toggle-box', onclick: toggle }, icon(collapsed ? 'chevright' : 'chevdown', 16));
  const meta = [
    [lbs(head.weight), 'weight'], [equipLabel(head.equip), 'truck'], [head.pickupEarliest ? shortDate(head.pickupEarliest) : '', 'calendar'],
  ].filter(x => x[0]).map(([t, ic]) => h('span', { class: 'meta' }, icon(ic, 14), t));
  const header = h('header', { class: 'lanehead' },
    h('div', { class: 'lanetitle' }, toggleBtn,
      h('input', { type: 'checkbox', checked: allSel, 'aria-label': 'Select every posting in this lane', 'data-fk': `${b.key}:chk`, onchange: (e) => { ids.forEach(id => (e.target.checked ? selected.add(id) : selected.delete(id))); rerender(); } }),
      h('div', { class: 'truck' }, icon('truck', 20)),
      h('div', { class: 'lanemain' },
        h('h3', { class: 'lane', onclick: toggle }, b.title),
        h('div', { class: 'metarow' }, meta,
          h('span', { class: 'meta' }, `${b.members.length} posting${b.members.length === 1 ? '' : 's'}`),
          lane ? h('span', { class: 'meta' }, ({ local: 'Local', regional: 'Regional', long: 'Long-distance' })[lane] || lane) : null,
          head.broker ? h('span', { class: 'meta' }, head.broker) : null,
          r.stats.inquiries.total ? h('span', { class: 'meta ok' }, `${r.stats.inquiries.total} replies`) : null)),
      h('div', { class: 'lanestatus' },
        h('span', { class: 'badge st-' + st.tone }, icon(st.icon, 14), st.label),
        h('span', { class: 'score ' + r.label.toLowerCase(), title: `Cover-probability score ${r.score}/100 (${r.label}): ${r.reasons.join('; ')}` }, r.score))),
    collapsed ? null : issuesStrip(r));
  if (collapsed) return h('section', { class: 'lanebox collapsed p-' + (head.priority || 'Low'), ...attrs }, header);

  // ---- load details: one place for the basics, one target rate for the whole matrix
  const rateIn = h('input', { class: 'cell', size: 7, value: rate, placeholder: '$ rate', inputmode: 'decimal', title: 'One target rate for every posting in this load. It judges carrier replies and is posted on DAT.', 'data-fk': `${b.key}:target` });
  const rateHint = h('small', { class: 'ratehint muted' }, r.stats.mem ? laneMemoryText(r.stats.mem) : '');
  const hintNow = () => { if (!r.stats.mem) return; const vs = rateVsMemory(rateIn.value, r.stats.mem); rateHint.textContent = vs ? `${laneMemoryText(r.stats.mem)} - ${vs}` : laneMemoryText(r.stats.mem); };
  rateIn.addEventListener('input', hintNow);
  const applyRate = async () => { const n = await actions.setTargetRate(ids, rateIn.value); toast(n ? `Target rate ${rateIn.value.trim() ? 'set' : 'cleared'} for ${b.title}.` : 'Nothing changed.', 'ok'); };
  rateIn.addEventListener('change', applyRate);
  rateIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rateIn.blur(); } });
  const pickup = h('input', { class: 'cell', size: 10, value: head.pickupEarliest ?? '', placeholder: 'm/d/yyyy', 'data-fk': `${b.key}:pickup` });
  pickup.addEventListener('change', () => actions.updateGroup(head.id, { pickupEarliest: pickup.value }));
  const weight = h('input', { class: 'cell', size: 7, value: head.weight ?? '', placeholder: 'lbs', 'data-fk': `${b.key}:weight` });
  weight.addEventListener('change', () => actions.updateGroup(head.id, { weight: weight.value }));
  const fld = (label, el) => h('label', { class: 'dfield' }, h('span', null, label), el);
  const details = h('div', { class: 'loaddetails' },
    fld('Pickup', pickup), fld('Weight', weight), fld('Equipment', equipSelect(b)),
    h('div', { class: 'dfield rate' }, h('span', null, 'Target rate'), rateIn, rateHint));

  // ---- options
  const priSel = h('select', { class: 'cell', title: 'Priority sets the outreach target for the whole load (Low 5, Medium 10, High 15)', 'data-fk': `${b.key}:priority` },
    PRIORITIES.map(x => h('option', { value: x, selected: x === (head.priority || 'Low') }, `${x} · ${targetForPriority(x, state.settings).target}`)));
  priSel.addEventListener('change', () => actions.setPriority(head.id, priSel.value));
  const contact = h('select', { class: 'cell', title: 'How carriers reach you from the DAT post.', 'data-fk': `${b.key}:contact` },
    ['Email', 'Phone'].map(x => h('option', { value: x, selected: x === (String(head.contact || '').toLowerCase() === 'phone' ? 'Phone' : 'Email') }, x)));
  contact.addEventListener('change', () => actions.setContact(head.id, contact.value));
  const brokers = state.settings.brokers || [];
  const brokerSel = brokers.length ? h('select', { class: 'cell', title: 'Which broker owns this load', 'data-fk': `${b.key}:broker` },
    h('option', { value: '' }, 'Unassigned'), brokers.map(x => h('option', { value: x, selected: x === (head.broker || '') }, x))) : null;
  if (brokerSel) brokerSel.addEventListener('change', () => actions.setBroker(head.id, brokerSel.value));
  const scan = h('input', { type: 'checkbox', role: 'switch', checked: head.outreach === 'Yes', 'data-fk': `${b.key}:scan`, 'data-act': 'lane-scan' });
  scan.addEventListener('change', () => actions.setLaneScan(head.id, scan.checked));
  const opts = h('div', { class: 'laneopts' },
    fld('Priority', priSel), fld('Contact on DAT', contact), brokerSel ? fld('Broker', brokerSel) : null,
    h('label', { class: 'tgl', title: 'Include this load in the next lane scan (one set of drafts for the whole load)' }, scan, h('span', null, 'Include in lane scan')));

  // ---- actions: one outreach button per load
  const acts = h('div', { class: 'laneact' },
    h('button', { class: 'btn primary', type: 'button', 'data-act': 'outreach', title: 'Draft carrier outreach for this load, best-matched carriers first (nothing is sent)', onclick: async () => { const x = await actions.runOutreach(head.id); if (x) summaryOutreach(x); } }, icon('send', 15), 'Carrier outreach'),
    h('button', { class: 'btn', type: 'button', 'data-act': 'copy-lane-details', title: 'Copy the original load details (the pasted TQL text)', onclick: (e) => copyLoadDetails(b.members, e.currentTarget) }, icon('copy', 15), 'Copy load details'),
    h('button', { class: 'btn', type: 'button', 'data-act': 'csv-group', title: 'Download every posting of this load as a DAT CSV', onclick: () => downloadDat(single ? 'one' : 'group', b.members, 'Load') }, icon('download', 15), 'Download CSV'),
    h('button', { class: 'btn', type: 'button', 'data-act': 'mark-covered', title: 'Log which posting and carrier covered it, then remove the load', onclick: () => coverModal(b) }, icon('check', 15), 'Mark covered'),
    single ? h('button', { class: 'btn', type: 'button', title: 'Build the 9-posting matrix', onclick: () => matrixFlow(head) }, 'Build 3×3 matrix') : null,
    menu('More actions for this load', [
      { label: 'View original details', act: 'view-lane-details', run: () => viewDetails(b) },
      { label: 'Save to Spare Load Details', run: async () => { await actions.saveSpareFromGroup(head.id); toast('Saved to Spare Load Details.', 'ok'); } },
      { label: 'Open DAT RateView', run: () => rateLink(head) },
      { label: 'Weather at origin', run: () => weather(head) },
      { label: single ? 'Delete this load' : 'Delete all postings', act: 'del-group', danger: true, run: () => deleteMany(ids, single ? 'this posting' : `all ${ids.length} postings in ${b.title}`) }]));

  return h('section', { class: 'lanebox p-' + (head.priority || 'Low'), ...attrs },
    header, loadDetailsBar(details, opts), acts,
    guidanceBlock(r, boardCtx()),
    h('div', { class: 'tablewrap' }, h('table', { class: 'lanetable' },
      h('thead', null, h('tr', null, [['', ''], ['Post', 'A-A is the original. Other cells are nearby origin/destination pairings.'], ['Origin', ''], ['', ''], ['Destination', ''], ['Replies / sent', 'Carrier replies received / outreach drafts created'], ['', '']].map(([x, t]) => h('th', { title: t || null }, x)))),
      h('tbody', null, b.members.map(m => row(m))))));
}

const loadDetailsBar = (details, opts) => h('div', { class: 'lanesetup' }, details, opts);

function brokerTabs(boxesAll) {
  const brokers = state.settings.brokers || [];
  const unassigned = boxesAll.filter(x => !(x.box.head.broker || '')).length;
  const count = (name) => boxesAll.filter(x => (x.box.head.broker || '') === name).length;
  const tab = (id, label, n) => h('button', { class: 'tab' + (brokerTab === id ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(brokerTab === id), 'data-fk': 'tab:' + id, onclick: () => { brokerTab = id; rerender(); } }, label, h('em', null, n));
  const addBroker = h('button', { class: 'btn small', type: 'button', onclick: () => {
    const inp = h('input', { placeholder: 'Broker name', 'data-live': '' });
    modal({ title: 'Add a broker', body: h('div', null, h('p', { class: 'muted' }, 'Each broker gets their own tab, scoreboard and CSV. You can also assign a load to a broker from its card.'), field('Name', inp)),
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
  const search = h('input', { type: 'search', placeholder: 'Search lanes…', value: filter, 'data-live': '', 'data-fk': 'filter' });
  search.addEventListener('input', () => { filter = search.value; rerender(); });
  const quickSel = h('select', { class: 'cell', 'aria-label': 'Show', title: 'Show only loads that match', 'data-fk': 'quick' }, QUICK_FILTERS.map(([k, l]) => h('option', { value: k, selected: k === quick }, l)));
  quickSel.addEventListener('change', () => { quick = quickSel.value; rerender(); });
  const selIds = () => [...selected];
  const openBox = async (box) => { if (collapsed.has(box.key)) { collapsed.delete(box.key); saveUi({ collapsed: [...collapsed] }); } await rerender(); setTimeout(() => { const el = document.querySelector(`[data-key="${CSS.escape(box.key)}"]`); if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); el.classList.add('pulse'); setTimeout(() => el.classList.remove('pulse'), 1600); } }, 120); };
  const wlOpen = ui().worklist !== false;
  const onDat = h('input', { type: 'checkbox', role: 'switch', checked: state.settings.postTargetOnDat !== false, 'data-fk': 'postTargetOnDat' });
  onDat.addEventListener('change', () => { actions.savePrefs({ postTargetOnDat: onDat.checked }); toast(onDat.checked ? 'The target rate will be the rate in your DAT CSV.' : 'The DAT CSV will leave the rate blank (unless a posting has its own DAT rate).', 'info'); });
  const aging = rowsTab.filter(r => r.flags.some(x => x.kind === 'aging')).length;
  const scanBtn = h('button', { class: 'btn', type: 'button', 'data-act': 'lane-scan-all', title: 'Draft outreach for every load that has "Include in lane scan" switched on', onclick: async () => { const r = await actions.runOutlookScan(); toast(`Lane scan: ${r.drafts.length} draft(s) for eligible loads.`, r.drafts.length ? 'ok' : 'info'); if (r.drafts.length) summaryOutreach({ detail: 'Ranked lane scan over all Active loads with "Include in lane scan" on.', drafts: r.drafts, created: r.drafts.length }); } }, 'Run lane scan');
  const csvAll = h('button', { class: 'btn primary', type: 'button', 'data-act': 'csv-all', title: `${tabName === 'All' ? 'Every posting on the board' : tabName + "'s postings"}, in DAT’s bulk-upload template format`, onclick: () => downloadDat(brokerTab === '__all' ? 'all' : 'group', tabPostings, tabName === 'All' ? 'Whole board' : tabName + ' board') }, icon('download', 15), brokerTab === '__all' ? 'Download all' : `Download ${tabName}`);
  return h('div', null,
    pageHead({ icon: 'board', title: 'Load board', sub: 'Paste TQL loads, set one target rate per load, then download the DAT CSV. Drafts are never sent automatically.' }),
    overviewStrip(rowsAll, ctx, quick, (k) => { quick = k; rerender(); }),
    worklistPanel(rowsAll, wlOpen, openBox, wlOpen, (v) => { saveUi({ worklist: v }); rerender(); }),
    pastePanel(),
    brokerTabs(rowsAll),
    scoreboard(brokerTab),
    h('div', { class: 'toolbar sticky boardbar' }, search, quickSel, csvAll,
      h('button', { class: 'btn', type: 'button', onclick: () => copyText(datTsv(tabPostings, false, datOpts()), 'DAT rows copied (tab-separated).') }, 'Copy for DAT'),
      h('button', { class: 'btn', type: 'button', 'data-act': 'aging', onclick: () => agingModal(rowsTab, ctx), title: 'Loads with no inquiries past their lane limit: one-click reprice and a fresh round of outreach' }, 'Aging loads' + (aging ? ` (${aging})` : '')),
      scanBtn,
      menu('Board options', [
        { label: 'Collapse all loads', act: 'collapse-all', run: () => setCollapsed(new Set(rowsAll.map(r => r.box.key))) },
        { label: 'Expand all loads', act: 'expand-all', run: () => setCollapsed(new Set()) }]),
      h('label', { class: 'tgl', title: 'On: the target rate is the rate in the DAT CSV. Off: the CSV rate is blank.' }, onDat, h('span', null, 'Post target rate on DAT')),
      h('span', { class: 'muted count' }, `${rows.length} load${rows.length === 1 ? '' : 's'} · ${shown} postings`)),
    nSel ? h('div', { class: 'toolbar selbar' }, h('b', null, `${nSel} selected`),
      h('button', { class: 'btn small', type: 'button', 'data-act': 'csv-sel', onclick: () => downloadDat('selected', state.postings.filter(p => selected.has(p.id)), 'Selection') }, 'Download selected'),
      h('button', { class: 'btn small danger', type: 'button', 'data-act': 'del-sel', onclick: () => deleteMany(selIds(), `${nSel} selected posting${nSel === 1 ? '' : 's'}`) }, 'Delete selected'),
      h('button', { class: 'btn small', type: 'button', onclick: () => { selected.clear(); rerender(); } }, 'Clear')) : null,
    rows.length ? rows.map(r => groupBox(r, collapsed.has(r.box.key), () => { if (collapsed.has(r.box.key)) collapsed.delete(r.box.key); else collapsed.add(r.box.key); setCollapsed(collapsed); })) :
      emptyState({ icon: 'board', title: state.postings.length ? 'No loads match' : 'No loads yet', text: state.postings.length ? 'Clear the search or pick another broker tab.' : 'Paste TQL load text above. The loads appear here right away.' }));
}
