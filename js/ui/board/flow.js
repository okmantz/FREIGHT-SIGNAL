// Adding loads: the paste panel that parses as you paste, and the 3x3 auto-build (with a preview only when needed).
import { h, toast, modal, field } from '../dom.js';
import { state, actions } from '../../store/state.js';
import { parseTqlLoad, splitLoads } from '../../core/parser.js';
import { buildPreviewMessage, rankCandidates, pinKey } from '../../core/matrix.js';
import { classifyLane } from '../../core/lanes.js';
import { attributionFromLog } from '../../core/coverlog.js';
import { pageSelectEq } from './util.js';

// ------------------------------------------------------------------ paste panel state (module level so a re-render never loses it)
const paste = { text: '', items: [], broker: '', timer: 0, busy: false };
const rerender = () => import('../../main.js').then(m => m.render());

const EDIT_FIELDS = [['originCity', 'Origin city', 14], ['originState', 'St', 3], ['originZip', 'ZIP', 6], ['pickupEarliest', 'Pickup', 9], ['destCity', 'Dest city', 14], ['destState', 'St', 3], ['weight', 'Weight', 6]];

function reparse(previewHost, summaryEl, addBtn) {
  const blocks = splitLoads(paste.text, state.settings.loadSeparatorRegex);
  const old = paste.items;
  paste.items = blocks.map((raw, i) => {
    const prev = old.find(o => o.raw === raw);
    if (prev) return prev;       // keep the user's edits for blocks that did not change
    const parsed = parseTqlLoad(raw);
    return { raw, parsed, take: true, f: { equip: 'V', ...parsed.fields } };
  });
  drawPreview(previewHost, summaryEl, addBtn);
}

function drawPreview(host, summaryEl, addBtn) {
  host.replaceChildren();
  const n = paste.items.filter(i => i.take).length;
  summaryEl.textContent = paste.items.length ? `${paste.items.length} load${paste.items.length === 1 ? '' : 's'} found - fix anything highlighted, then press Enter (or the button).` : (paste.text.trim() ? 'No load found yet - keep pasting, or add one by hand.' : '');
  addBtn.textContent = n ? `Add ${n} load${n === 1 ? '' : 's'}` : 'Add loads';
  addBtn.disabled = !n;
  if (!paste.items.length) return;
  const head = h('tr', null, h('th', null, ''), EDIT_FIELDS.map(([, l]) => h('th', null, l)), h('th', null, 'Equip'), h('th', null, ''));
  const rows = paste.items.map((it, idx) => {
    const miss = new Set(it.parsed.missing || []);
    const cells = EDIT_FIELDS.map(([k, , w]) => {
      const bad = !String(it.f[k] ?? '').trim() && ['originCity', 'originState', 'destCity', 'destState', 'pickupEarliest'].includes(k);
      const inp = h('input', { class: 'cell' + (bad ? ' bad' : ''), size: w, value: it.f[k] ?? '', 'aria-label': k, 'data-live': '' });
      inp.addEventListener('input', () => { it.f[k] = inp.value; inp.classList.toggle('bad', !inp.value.trim() && ['originCity', 'originState', 'destCity', 'destState', 'pickupEarliest'].includes(k)); });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addAll(); } });
      return h('td', null, inp);
    });
    const eq = pageSelectEq(it.f.equip, (v) => { it.f.equip = v; });
    const tick = h('input', { type: 'checkbox', checked: it.take, 'aria-label': 'Include this load', 'data-live': '' });
    tick.addEventListener('change', () => { it.take = tick.checked; drawPreview(host, summaryEl, addBtn); });
    return h('tr', { class: 'prow' + (miss.size ? ' warnrow' : '') }, h('td', { class: 'chk' }, tick), cells, h('td', null, eq),
      h('td', { class: 'muted small', title: (it.parsed.warnings || []).join(' ') }, miss.size ? 'missing: ' + [...miss].join(', ') : (it.parsed.warnings || []).length ? (it.parsed.warnings || [])[0] : ''));
  });
  host.append(h('div', { class: 'tablewrap' }, h('table', { class: 'lanetable pastetable' }, h('thead', null, head), h('tbody', null, rows))));
}

let addAll = async () => {};

/** The paste panel: textarea on top, editable parsed rows underneath, one button / Enter to add them all. */
export function pastePanel() {
  const ta = h('textarea', { class: 'pastebox', placeholder: 'Paste TQL loads here. They are read as you paste - no Parse button.', value: paste.text, 'data-rerender': '', 'data-fk': 'paste', rows: 4 });
  const summary = h('p', { class: 'muted pastesum', 'aria-live': 'polite' });
  const previewHost = h('div', { class: 'pastepreview' });
  const addBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, 'Add loads');
  const brokers = state.settings.brokers || [];
  const brokerSel = brokers.length ? h('select', { class: 'cell', 'aria-label': 'Broker for these loads', 'data-live': '' },
    h('option', { value: '' }, 'Broker: unassigned'), brokers.map(b => h('option', { value: b, selected: b === paste.broker }, b))) : null;
  if (brokerSel) brokerSel.addEventListener('change', () => { paste.broker = brokerSel.value; });
  addAll = async () => {
    if (paste.busy) return;
    const take = paste.items.filter(i => i.take); if (!take.length) return;
    paste.busy = true; addBtn.disabled = true;
    try {
      const added = [];
      for (const it of take) {
        const f = { ...it.parsed.fields, ...it.f };
        for (const k of Object.keys(f)) if (typeof f[k] === 'string') f[k] = f[k].trim();
        f.originState = String(f.originState || '').toUpperCase(); f.destState = String(f.destState || '').toUpperCase();
        f.pickupLatest = f.pickupLatest || f.pickupEarliest;
        added.push(await actions.addParsedLoad(f, { broker: paste.broker }));
      }
      paste.text = ''; paste.items = []; ta.value = '';
      drawPreview(previewHost, summary, addBtn);
      toast(`${added.length} load${added.length === 1 ? '' : 's'} added.`, 'ok');
      await autoBuild(added.map(p => p.id));
    } finally { paste.busy = false; }
  };
  addBtn.addEventListener('click', addAll);
  ta.addEventListener('input', () => {
    paste.text = ta.value; clearTimeout(paste.timer);
    paste.timer = setTimeout(() => reparse(previewHost, summary, addBtn), 120);
  });
  ta.addEventListener('paste', () => { setTimeout(() => { paste.text = ta.value; reparse(previewHost, summary, addBtn); }, 0); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addAll(); } });
  drawPreview(previewHost, summary, addBtn);
  return h('div', { class: 'panel pastepanel' },
    ta, summary, previewHost,
    h('div', { class: 'toolbar' }, addBtn, brokerSel,
      h('button', { class: 'btn', type: 'button', onclick: async () => { const p = await actions.addParsedLoad({ originCity: '', originState: '', destCity: '', destState: '', pickupEarliest: '', pickupLatest: '', weight: '', equip: 'V', details: '' }, { broker: paste.broker }); toast('Blank row added.', 'ok'); return p; } }, 'Add blank row'),
      h('span', { class: 'muted small' }, state.settings.matrixMode === 'ask' ? '3 × 3 matrix: you will be asked before it is built (System > Matrix).' : '3 × 3 matrix is built automatically; you are only asked when the cities look odd.')));
}

// ------------------------------------------------------------------ matrix
/** After adding loads: build the matrix automatically, or show the preview when the plan looks odd / the setting says ask. */
export async function autoBuild(ids) {
  let made = 0, asked = 0;
  for (const id of ids) {
    const p = state.postings.find(x => x.id === id); if (!p) continue;
    const plan = actions.previewMatrix(id);
    if (!plan.ok) { toast(`${p.originCity || 'Load'}: ${plan.error}`, 'warn', 7000); continue; }
    const ask = state.settings.matrixMode === 'ask' || plan.quality.weird;
    if (ask) { asked++; const done = await matrixPreview(id, plan); if (done) made++; }
    else { await actions.createMatrix(id, plan); made++; }
  }
  if (made) toast(`3 × 3 matrix built for ${made} load${made === 1 ? '' : 's'}${asked ? ` (${asked} confirmed by you)` : ''}.`, 'ok');
}

/** One-load flow used by the "Build 3×3" button. */
export async function matrixFlow(p) {
  const plan = actions.previewMatrix(p.id);
  if (!plan.ok) return toast(plan.error, 'err', 7000);
  if (state.settings.matrixMode === 'ask' || plan.quality.weird) { if (await matrixPreview(p.id, plan)) toast('Matrix created.', 'ok'); return; }
  const rows = await actions.createMatrix(p.id, plan);
  toast(`Matrix created: ${rows.length} postings (original + ${rows.length - 1} alternates).`, 'ok');
}

function pickerFor(side, plan, caches, attr, source) {
  const center = side === 'origin' ? plan.origins[0] : plan.dests[0];
  const other = side === 'origin' ? plan.dests[0] : plan.origins[0];
  const lane = classifyLane({ ...source, originZip: plan.origins[0].zip, destZip: plan.dests[0].zip }, state.zip, state.settings);
  const cands = rankCandidates(state.zip, caches, center.zip, center.city, center.state, other.city, other.state, side === 'origin', lane.strategy, 15, attr);
  const list = side === 'origin' ? plan.origins : plan.dests;
  const sels = [1, 2].map((slot) => {
    const cur = list[slot];
    const opts = [...cands]; if (cur && !opts.some(c => c.city === cur.city && c.state === cur.state)) opts.unshift({ ...cur, pop: 0 });
    const s = h('select', { class: 'cell', 'aria-label': `${side} alternate ${slot}`, 'data-live': '' },
      opts.map(c => h('option', { value: c.city + '|' + c.state, selected: !!cur && c.city === cur.city && c.state === cur.state }, `${c.city}, ${c.state} - ${Math.round(c.miles)} mi${c.pop ? ` · pop ${Math.round(c.pop / 1000)}k` : ''}`)));
    s.addEventListener('change', () => { const c = opts.find(x => x.city + '|' + x.state === s.value); if (c) list[slot] = { city: c.city, state: c.state, zip: c.zip, miles: c.miles }; });
    return s;
  });
  return h('div', { class: 'pickrow' }, h('b', null, `${side === 'origin' ? 'Origin' : 'Destination'} alternates (${center.city}, ${center.state})`), sels);
}

/** Returns true when the matrix was created. The user can swap either alternate and ask us to remember the choice. */
export function matrixPreview(id, plan) {
  return new Promise((resolve) => {
    const source = state.postings.find(x => x.id === id); if (!source) return resolve(false);
    const caches = plan.caches, attr = attributionFromLog(state.coverLog);
    const remember = h('input', { type: 'checkbox', 'data-live': '' });
    const why = plan.quality.reasons.length ? h('div', { class: 'banner' }, h('b', null, 'Why you are being asked: '), plan.quality.reasons.join(' ')) : h('p', { class: 'muted' }, 'You chose "ask before building" in System > Matrix.');
    const msg = h('pre', { class: 'plain small' }, buildPreviewMessage(plan.origins, plan.dests));
    let done = false;
    const body = h('div', null, h('p', null, h('b', null, `${source.originCity}, ${source.originState} → ${source.destCity}, ${source.destState}`), ` · ${plan.lane.label} lane (${Math.round(plan.lane.miles)} mi)`), why,
      pickerFor('origin', plan, caches, attr, source), pickerFor('dest', plan, caches, attr, source),
      h('label', { class: 'inl' }, remember, ' Remember these picks for this origin / destination'), msg);
    modal({
      title: 'Check the 3 × 3 matrix', body, wide: true,
      actions: [{ label: 'Skip (keep as one posting)', onClick: () => { done = true; resolve(false); } },
        { label: 'Create 9 postings', kind: 'primary', onClick: async () => {
          if (remember.checked) {
            const pins = { ...(state.settings.matrixPins || {}) };
            pins[pinKey(plan.origins[0].city, plan.origins[0].state)] = plan.origins.slice(1).map(o => ({ city: o.city, state: o.state }));
            pins[pinKey(plan.dests[0].city, plan.dests[0].state)] = plan.dests.slice(1).map(o => ({ city: o.city, state: o.state }));
            await actions.saveSettings({ matrixPins: pins });
          }
          await actions.createMatrix(id, plan); done = true; resolve(true);
        } }],
      onClose: () => { if (!done) resolve(false); },
    });
  });
}
export { field, rerender };
