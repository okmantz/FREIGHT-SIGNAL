import { h, toast, modal, confirmDialog, download, pickFile, readFileText, field } from '../dom.js';
import { state, actions, importZipCsv } from '../../store/state.js';
import * as db from '../../store/db.js';

let est = null;
const rerender = () => import('../../main.js').then(m => m.render());

async function importZip() {
  const f = await pickFile('.csv');
  if (!f) return;
  try { const n = await importZipCsv(await readFileText(f), f.name); toast(`ZIP Map imported: ${n.toLocaleString()} rows.`, 'ok'); }
  catch (e) { toast('ZIP Map not imported: ' + e.message, 'err', 9000); }
}

async function loadSample() {
  try {
    const snap = typeof globalThis.__FS_SAMPLE === 'string' ? JSON.parse(globalThis.__FS_SAMPLE) : await fetch('data/sample/sample-backup.json').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
    if (!(await confirmDialog('Load sample data', 'Adds clearly fictional sample carriers, inquiries and one load to your existing data (merge). Continue?', 'Add sample data'))) return;
    await actions.restoreBackup(snap, 'merge'); toast('Sample data added.', 'ok');
  } catch (e) { toast('Sample data unavailable: ' + e.message, 'err'); }
}

async function restore() {
  const f = await pickFile('.json'); if (!f) return;
  let snap; try { snap = JSON.parse(await readFileText(f)); } catch { return toast('That file is not valid JSON.', 'err'); }
  const mode = await new Promise((resolve) => {
    modal({ title: 'Restore backup', body: h('p', null, 'Replace everything with the backup, or merge it into current data?'), onClose: () => resolve(null),
      actions: [{ label: 'Cancel', onClick: () => resolve(null) }, { label: 'Merge', onClick: () => resolve('merge') }, { label: 'Replace all', kind: 'danger', onClick: () => resolve('replace') }] });
  });
  if (!mode) return;
  try { await actions.restoreBackup(snap, mode); toast('Backup restored.', 'ok'); } catch (e) { toast('Restore failed (nothing was changed if validation failed): ' + e.message, 'err', 9000); }
}

function lines(v) { return String(v || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean); }

export function render() {
  const s = state.settings;
  if (!est) db.storageEstimate().then(e => { est = e || { none: true }; rerender(); });
  const num = (k, label, hint) => { const el = h('input', { type: 'number', value: s[k], 'data-rerender': '' }); el.addEventListener('change', () => actions.saveSettings({ [k]: Number(el.value) })); return field(label, el, hint); };
  const area = (k, label, hint, conv = (v) => v, show = (v) => v) => { const el = h('textarea', { 'data-rerender': '' }); el.value = show(s[k]); el.addEventListener('change', () => actions.saveSettings({ [k]: conv(el.value) })); return field(label, el, hint); };
  const tiers = h('textarea', { 'data-rerender': '' }); tiers.value = s.distanceTiers.map(t => t.join('-')).join('\n');
  tiers.addEventListener('change', () => {
    const parsed = lines(tiers.value).map(l => l.split(/\s*-\s*/).map(Number));
    if (!parsed.length || parsed.some(t => t.length !== 2 || t.some(n => !Number.isFinite(n)) || t[0] > t[1])) return toast('Distance tiers: one "min-max" pair per line, min ≤ max.', 'err');
    actions.saveSettings({ distanceTiers: parsed }); toast('Distance tiers saved.', 'ok');
  });
  const mode = h('select', { 'data-rerender': '' }, h('option', { value: 'excel', selected: s.outreachButtonMode === 'excel' }, 'Excel-style tiered (exact lane → state-to-state → origin state)'), h('option', { value: 'outlook', selected: s.outreachButtonMode === 'outlook' }, 'Outlook-style lane scan'));
  mode.addEventListener('change', () => actions.saveSettings({ outreachButtonMode: mode.value }));
  const both = h('input', { type: 'checkbox', checked: s.requireBothStates }); both.addEventListener('change', () => actions.saveSettings({ requireBothStates: both.checked }));
  const comma = h('input', { type: 'checkbox', checked: s.recogniseCommaRates }); comma.addEventListener('change', () => actions.saveSettings({ recogniseCommaRates: comma.checked }));
  return h('div', null,
    h('div', { class: 'pagehead' }, h('h2', null, 'System'), h('p', null, 'Settings, backup and data. All stored in this browser only.')),
    state.persistError ? h('div', { class: 'banner err' }, 'Storage problem: ' + state.persistError) : null,
    h('div', { class: 'panel' }, h('h3', null, 'Outreach targets and rules'),
      h('div', { class: 'grid4' }, num('lowTarget', 'Low target'), num('mediumTarget', 'Medium target'), num('highTarget', 'High target'), num('maxCarriersPerLoad', 'Max carriers / load (scan)'),
        num('rateProximity', 'Rate proximity ($)', 'Within this of target = confirm ETA'), num('minReasonableRate', 'Min plausible rate'), num('maxReasonableRate', 'Max plausible rate')),
      h('label', null, comma, ' Recognise comma-formatted carrier rates such as $1,650 (the original Outlook macro does not; leave off for exact macro behaviour)'),
      field('Row Outreach button uses', mode), h('label', null, both, ' Require both origin and destination state to match (scan)'),
      field('Matrix distance tiers (miles)', tiers, 'One min-max per line, tried in order until two distinct alternates are found. Default 20-60, 0-100, 0-200, 0-99999.')),
    h('div', { class: 'panel' }, h('h3', null, 'Blocklists'),
      h('div', { class: 'grid2' },
        area('outreachBlocklist', 'Outreach blocklist', 'One per line: "@domain.com" blocks a domain, a full address blocks one sender. Never shipped in the repo.', lines, (v) => (v || []).join('\n')),
        area('inboundBlocklist', 'Inbound e-mail blocklist', 'Substring match against the sender address.', lines, (v) => (v || []).join('\n')))),
    h('div', { class: 'panel' }, h('h3', null, 'DAT and parsing'),
      area('datHeaderOverride', 'DAT header override', 'Paste the exact header row of your DAT bulk-posting template (tab or comma separated).'),
      area('loadSeparatorRegex', 'Multi-load separator (regex)', 'Pasted text is split into loads at lines matching this.', (v) => v.trim() || '^\\s*\\d+\\s*pick\\s*[-–]\\s*\\d+\\s*drop')),
    h('div', { class: 'panel' }, h('h3', null, 'ZIP Map'),
      h('p', null, state.zip ? `${state.zip.size.toLocaleString()} rows from ${state.zipInfo.source}.` : 'Not loaded.'),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: importZip }, 'Import a different ZIP Map CSV…'),
        h('span', { class: 'muted' }, 'Required headers: zip, lat, lng, city, state_id, population.'))),
    h('div', { class: 'panel' }, h('h3', null, 'Backup and restore'),
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => { const snap = await actions.exportBackup(); download(`freight-signal-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snap, null, 1), 'application/json'); toast('Backup downloaded. It contains your carriers and loads: store it securely.', 'ok', 7000); } }, 'Download backup (.json)'),
        h('button', { class: 'btn', type: 'button', onclick: restore }, 'Restore from backup…'),
        h('button', { class: 'btn', type: 'button', onclick: loadSample }, 'Add sample data')),
      est && !est.none ? h('p', { class: 'muted' }, `Browser storage used: ${((est.usage || 0) / 1048576).toFixed(1)} MB of ${((est.quota || 0) / 1048576).toFixed(0)} MB available.`) : null),
    h('div', { class: 'panel' }, h('h3', null, 'Counters'),
      h('p', { class: 'muted' }, 'Covers counters are kept by the app (the workbook formula was not provided). Adjust if you want to carry over your Excel numbers.'),
      h('div', { class: 'grid4' }, num2('Covers today', 'coversToday'), num2('Lifetime covers', 'lifetimeCovers'))),
    h('div', { class: 'panel' }, h('h3', null, 'Danger zone'),
      h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDialog('Erase all data', 'Delete ALL loads, carriers, inquiries, drafts and spares from this browser? Download a backup first. The ZIP Map is kept.', 'Erase everything')) { await actions.wipe(); toast('All data erased.', 'ok'); } } }, 'Erase all data')));
}

function num2(label, key) {
  const el = h('input', { type: 'number', value: state.counters[key] || 0, 'data-rerender': '' });
  el.addEventListener('change', () => actions.setCounters({ [key]: Number(el.value) || 0 }));
  return field(label, el);
}
