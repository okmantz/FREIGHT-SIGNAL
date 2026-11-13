import { h, toast, modal, confirmDialog, download, pickFile, readFileText, field, copyText, fmtDate } from '../dom.js';
import { pageHead } from '../chrome.js';
import { icon } from '../icons.js';
import { state, actions, importZipCsv } from '../../store/state.js';
import * as db from '../../store/db.js';
import { bridge, connect, reconnect, disconnect, writeNow, pollNow, outlookConnected } from '../../store/bridge.js';
import { refreshWeather, weatherStatus } from '../../store/weather.js';
import { DEFAULT_TEMPLATES, TEMPLATE_VARS, templatesOf, ladderStage, fillTemplate } from '../../core/ladder.js';
import { strategyFor, LANE_LABEL } from '../../core/lanes.js';
import { formatCurrency0 } from '../../core/util.js';
import { makeSortable } from '../sortable.js';
import { weekRangeText } from '../../core/coverlog.js';

let est = null;
const rerender = () => import('../../main.js').then(m => m.render());
const MACRO_FILE = 'outlook/Outlook_v6_ThisOutlookSession.txt';

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


// ------------------------------------------------------------------ collapsible sections (open/closed state is remembered)
function section(id, title, summary, body, { open = false, tone = '' } = {}) {
  const saved = (state.settings.ui || {}).sys || {};
  const isOpen = id in saved ? !!saved[id] : open;
  const det = h('details', { class: 'sect ' + tone, open: isOpen, dataset: { sect: id } },
    h('summary', null, h('span', { class: 'sect-t' }, h('b', null, title), summary ? h('small', { class: 'muted' }, summary) : null), icon('chevdown', 16, 'sect-ch')),
    h('div', { class: 'sect-body' }, body));
  det.addEventListener('toggle', () => { const ui = state.settings.ui || {}; actions.savePrefs({ ui: { ...ui, sys: { ...(ui.sys || {}), [id]: det.open } } }); });
  return det;
}

async function macroText() {
  if (typeof globalThis.__FS_MACRO === 'string') return globalThis.__FS_MACRO;
  const r = await fetch(MACRO_FILE); if (!r.ok) throw new Error('The macro file could not be loaded (HTTP ' + r.status + ').');
  return r.text();
}

const step = (n, done, title, ...body) => h('li', { class: 'gstep2' + (done ? ' done' : '') },
  h('span', { class: 'gnum' }, done ? icon('check', 15) : String(n)), h('div', { class: 'gbody' }, h('b', null, title), ...body));
const kbd = (t) => h('kbd', null, t);

/** The Outlook connection: live status + a click-by-click guide with ticks that fill in as each step is detected. */
function outlookGuide() {
  const run = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'ok'); } catch (e) { if (e && e.name === 'AbortError') return; toast(String(e.message || e), 'err', 8000); } rerender(); };
  const on = bridge.connected, olOn = on && outlookConnected();
  const v5 = olOn && /v[56]/i.test(String(bridge.outlook && bridge.outlook.macroVersion || ''));
  const macroBtns = h('div', { class: 'toolbar' },
    h('button', { class: 'btn primary', type: 'button', 'data-act': 'macro-copy', onclick: async () => { try { await copyText(await macroText(), 'Macro copied. Now paste it into Outlook (step 5).'); } catch (e) { toast(e.message, 'err', 8000); } } }, icon('copy', 15), 'Copy the macro'),
    h('button', { class: 'btn', type: 'button', 'data-act': 'macro-download', onclick: async () => { try { download('Outlook_v6_ThisOutlookSession.txt', await macroText(), 'text/plain;charset=utf-8'); } catch (e) { toast(e.message, 'err', 8000); } } }, icon('download', 15), 'Download as a .txt file'));
  const steps = h('ol', { class: 'gsteps' },
    step(1, on, 'Make a folder for the two programs to share', h('p', null, 'In File Explorer open ', h('b', null, 'Documents'), ', right-click an empty spot, choose ', h('b', null, 'New → Folder'), ' and name it ', h('b', null, 'FreightSignal'), '. This one folder is the only thing the browser and Outlook share.'),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', onclick: () => copyText('FreightSignal', 'Folder name copied.') }, 'Copy the name'))),
    step(2, on, 'Tell Freight Signal about that folder', h('p', null, 'Use Chrome or Edge. Click the button, pick the ', h('b', null, 'FreightSignal'), ' folder, then press ', h('b', null, 'Edit files / View files'), ' (Allow) when the browser asks.'),
      !bridge.supported ? h('div', { class: 'banner err' }, 'This browser cannot share a folder. Open Freight Signal in Chrome or Edge.') : null,
      h('div', { class: 'toolbar' },
        !on && !bridge.needsPermission ? h('button', { class: 'btn primary', type: 'button', 'data-act': 'bridge-connect', disabled: !bridge.supported, onclick: () => run(connect, 'Folder connected. Postings are now shared with Outlook.') }, 'Choose the FreightSignal folder…') : null,
        bridge.needsPermission ? h('button', { class: 'btn primary', type: 'button', 'data-act': 'bridge-reconnect', onclick: () => run(reconnect, 'Reconnected.') }, 'Reconnect folder (one click)') : null,
        on ? h('span', { class: 'pill ok' }, `Connected: ${bridge.folderName}`) : null)),
    step(3, olOn, 'Use classic Outlook for Windows', h('p', null, 'Macros only work in ', h('b', null, 'classic Outlook'), ' (the one with a File menu and a ribbon). If you see a ', h('b', null, 'New Outlook'), ' toggle in the top-right corner, switch it ', h('b', null, 'off'), '. Outlook on the web, Mac and the Microsoft Store mail app cannot run it.')),
    step(4, olOn, 'Copy the macro', h('p', null, 'This is the whole program Outlook will run. Press the button, or download it as a text file and open that in Notepad.'), macroBtns),
    step(5, olOn, 'Paste it into Outlook', h('ol', { class: 'sub' },
      h('li', null, 'In Outlook press ', kbd('Alt'), ' + ', kbd('F11'), '. A window called ', h('b', null, 'Microsoft Visual Basic for Applications'), ' opens.'),
      h('li', null, 'On the left, click the little ', h('b', null, '+'), ' beside ', h('b', null, 'Project1'), ', then beside ', h('b', null, 'Microsoft Outlook Objects'), '.'),
      h('li', null, 'Double-click ', h('b', null, 'ThisOutlookSession'), '. A big white area opens on the right.'),
      h('li', null, 'Click inside that white area, press ', kbd('Ctrl'), ' + ', kbd('A'), ' (select everything that is there) and then ', kbd('Ctrl'), ' + ', kbd('V'), ' to paste the macro over it. If you had the older version, this replaces it.'),
      h('li', null, 'Press ', kbd('Ctrl'), ' + ', kbd('S'), ' to save, then close the Visual Basic window.'))),
    step(6, olOn, 'Allow the macro to run', h('ol', { class: 'sub' },
      h('li', null, 'In Outlook choose ', h('b', null, 'File → Options → Trust Center → Trust Center Settings… → Macro Settings'), '.'),
      h('li', null, 'Select ', h('b', null, 'Notifications for all macros'), ' (safe: Outlook asks you each time it starts) and press OK twice.'),
      h('li', null, 'Close Outlook completely and open it again. When the yellow bar or pop-up appears, click ', h('b', null, 'Enable Macros'), '.'),
      h('li', null, 'Tip: if your company blocks macros, ask IT to allow this one, or to sign it with your certificate.'))),
    step(7, olOn, 'Test it', h('ol', { class: 'sub' },
      h('li', null, 'In Outlook press ', kbd('Alt'), ' + ', kbd('F8'), ', choose ', h('b', null, 'FS_Ping'), ' and press Run.'),
      h('li', null, 'Come back here and press the button below. The line at the top of this section turns green and says "Outlook connected".')),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', 'data-act': 'bridge-poll', disabled: !on, onclick: () => run(async () => { const n = await pollNow(); toast(n ? `${n} Outlook update(s) applied.` : 'Checked.', n ? 'ok' : 'info'); }) }, icon('refresh', 15), 'Check Outlook now'))),
    step(8, v5 && bridge.draftsSaved > 0, 'Carrier outreach lands in your Outlook Drafts', h('p', null, 'With the folder connected, every outreach or truck-check draft made here is saved into the ', h('b', null, 'Drafts'), ' folder in Outlook. Nothing is ever sent for you: open the draft and press Send yourself.'),
      h('p', { class: 'muted' }, 'Outlook picks the drafts up when you click into Outlook, when a new e-mail arrives, or when it starts. To force it, press ', kbd('Alt'), ' + ', kbd('F8'), ', choose ', h('b', null, 'FS_DraftsNow'), ' and Run.'),
      olOn && !v5 ? h('div', { class: 'banner err' }, `Outlook is still running the older macro (${bridge.outlook.macroVersion || 'v4'}). Repeat steps 4 and 5 to update it - drafts to Outlook need v5 or newer, and auto-send needs v6.`) : null),
  );
  const fix = h('div', { class: 'trouble' },
    h('details', null, h('summary', null, 'Nothing happens after step 6 / the status never turns green'), h('ul', null,
      h('li', null, 'Make sure you saved in the VBA window (', kbd('Ctrl'), '+', kbd('S'), ') and restarted Outlook, then clicked Enable Macros.'),
      h('li', null, 'Press ', kbd('Alt'), '+', kbd('F11'), ' and check the code is in ', h('b', null, 'ThisOutlookSession'), ', not in a Module.'),
      h('li', null, 'Press ', kbd('Alt'), '+', kbd('F8'), ', run ', h('b', null, 'FS_Diagnostics'), ': it lists what it found in the folder and any error.'),
      h('li', null, 'Outlook looks for the folder you chose in step 2. If it asks you for a folder path, paste the full path of the FreightSignal folder.'))),
    h('details', null, h('summary', null, 'The browser asks for folder permission every day'), h('p', null, 'That is Chrome protecting your files. After a restart, click ', h('b', null, 'Reconnect folder'), ' once. Installing Freight Signal as an app (Chrome menu → Cast, save and share → Install) reduces the prompts.')),
    h('details', null, h('summary', null, 'I only want the e-mail drafts, not Outlook'), h('p', null, 'Skip this whole section. Drafts can be downloaded as .eml files (they open in Outlook as unsent drafts), opened in your mail app or copied. The Outlook connection adds automatic replies to carriers and the Drafts folder.')));
  const state_rows = [];
  state_rows.push(h('div', { class: 'state', 'data-bridge': on ? 'connected' : bridge.needsPermission ? 'permission' : 'off' }, h('span', { class: 'dot ' + (on ? 'on' : bridge.needsPermission ? 'warn' : 'off') }),
    on ? `Folder connected: ${bridge.folderName}` : bridge.needsPermission ? `Folder "${bridge.folderName}" needs your permission again` : 'Not connected'));
  const ol = bridge.outlook;
  state_rows.push(h('div', { class: 'state', 'data-outlook': olOn ? 'connected' : 'waiting' }, h('span', { class: 'dot ' + (olOn ? 'on' : 'warn') }),
    olOn ? `Outlook connected — last heard ${fmtDate(ol.lastSeen)}, read ${ol.postingsRead} posting(s)${ol.macroVersion ? ', macro ' + ol.macroVersion : ''}${ol.lastEvent ? ', last action: ' + ol.lastEvent : ''}` :
      on ? (ol && ol.lastSeen ? `Outlook last heard ${fmtDate(ol.lastSeen)} (more than a day ago - restart Outlook or run FS_Ping)` : 'Waiting for Outlook — follow steps 3 to 7 below') : 'Outlook status unknown until a folder is connected'));
  if (on) state_rows.push(h('dl', { class: 'kv' },
    h('dt', null, 'Postings shared with Outlook'), h('dd', null, `${bridge.postingsWritten}` + (bridge.lastWrite ? ` (written ${fmtDate(bridge.lastWrite)})` : '')),
    h('dt', null, 'Carrier conversations from Outlook'), h('dd', null, String(bridge.eventsSeen || 0)),
    h('dt', null, 'Drafts waiting for Outlook / saved this session'), h('dd', null, `${bridge.draftsPending || 0} / ${bridge.draftsSaved || 0}`),
    h('dt', null, 'Last checked'), h('dd', null, bridge.lastSync ? fmtDate(bridge.lastSync) : '—')));
  if (bridge.error) state_rows.push(h('div', { class: 'banner err' }, bridge.error));
  const tools = h('div', { class: 'toolbar' },
    on ? h('button', { class: 'btn', type: 'button', onclick: () => run(() => writeNow(true), 'Postings written for Outlook.') }, 'Write postings now') : null,
    on || bridge.needsPermission ? h('button', { class: 'btn danger', type: 'button', onclick: () => run(disconnect, 'Disconnected.') }, 'Disconnect') : null);
  return h('div', { class: 'bridge' },
    h('p', { class: 'muted' }, 'Outlook cannot see data stored in a browser, so Freight Signal shares your live postings with it through one folder. The Outlook macro reads that folder to match carrier e-mails to your postings, drafts the replies, saves your outreach drafts, and writes what it did back so the Inquiry Log updates here. Nothing is uploaded anywhere.'),
    ...state_rows, tools, h('h4', null, 'Step by step'), steps, fix);
}

// ------------------------------------------------------------------ settings widgets
const lines = (v) => String(v || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

function mk(s) {
  const save = (patch) => actions.saveSettings(patch);
  const num = (k, label, hint, props = {}) => { const el = h('input', { type: 'number', value: s[k], 'data-rerender': '', ...props }); el.addEventListener('change', () => save({ [k]: Number(el.value) })); return field(label, el, hint); };
  const check = (k, label, hint) => { const el = h('input', { type: 'checkbox', checked: !!s[k], 'data-live': '' }); el.addEventListener('change', () => save({ [k]: el.checked })); return h('label', { class: 'inl chk' }, el, ' ', label, hint ? h('small', { class: 'muted' }, ' - ' + hint) : null); };
  const area = (k, label, hint, conv = (v) => v, show = (v) => v) => { const el = h('textarea', { 'data-rerender': '' }); el.value = show(s[k]); el.addEventListener('change', () => save({ [k]: conv(el.value) })); return field(label, el, hint); };
  const select = (k, label, opts, hint) => { const el = h('select', { 'data-rerender': '' }, opts.map(([v, t]) => h('option', { value: v, selected: String(s[k]) === String(v) }, t))); el.addEventListener('change', () => save({ [k]: el.value })); return field(label, el, hint); };
  return { save, num, check, area, select };
}

function ladderSection(s) {
  const { num } = mk(s);
  const tpl = templatesOf(s);
  const tplField = (key, label, hint, rows = 3) => {
    const el = h('textarea', { rows, 'data-rerender': '' }); el.value = tpl[key];
    el.addEventListener('change', () => actions.saveSettings({ templates: { ...(s.templates || {}), [key]: el.value } }));
    return field(label, el, h('span', null, hint + ' Fill-ins: ' + TEMPLATE_VARS[key].join(' ')));
  };
  const ex = (target, rate) => { const st = ladderStage(rate, target, s); const label = st.stage === 'book' ? 'book it (ETA)' : st.stage === 'split' ? `split at ${formatCurrency0(st.split)}` : `counter at ${formatCurrency0(target)}`; return h('tr', null, h('td', null, formatCurrency0(target)), h('td', null, formatCurrency0(rate)), h('td', null, (st.pct >= 0 ? '+' : '') + st.pct.toFixed(1) + '%'), h('td', null, h('b', null, label))); };
  return h('div', null,
    h('p', { class: 'muted' }, 'When a carrier quotes a rate, the app (and the Outlook macro) compares it with your target as a ', h('b', null, 'percentage'), ', so $200 over is treated very differently on a $900 load than on a $6,000 load. A rate at or below target is always "book it".'),
    h('div', { class: 'grid4' }, num('ladderBookPct', 'Book it within (%)', 'Up to this % over target: confirm ETA / book.', { step: '0.5', min: 0 }), num('ladderSplitPct', 'Split the difference within (%)', 'Above that, up to this %: counter halfway.', { step: '0.5', min: 0 }), num('ladderRound', 'Round the split to ($)', 'Usually 5 or 10.', { min: 0 })),
    h('p', { class: 'muted' }, `Beyond ${s.ladderSplitPct}% over target the counter is simply your target.`),
    h('table', { class: 'lanetable exampletable' }, h('thead', null, h('tr', null, ['Target', 'Carrier says', 'Over target', 'Reply'].map(x => h('th', null, x)))),
      h('tbody', null, ex(900, 925), ex(900, 1100), ex(6000, 6150), ex(6000, 6400), ex(6000, 7000))),
    h('h4', null, 'What the e-mails say'),
    tplField('book', 'Inside the booking band', 'Sent when the rate is acceptable.'),
    tplField('split', 'Split-the-difference counter', 'Sent when the rate is a little high.'),
    tplField('target', 'Counter at target', 'Sent when the rate is too high.'),
    tplField('askRate', 'Carrier asks "rate?"', 'Sent when a carrier asks what you are paying.', 2),
    tplField('available', 'Carrier asks "still available?"', 'Sent when a carrier only asks about availability.', 2),
    tplField('needRate', 'No rate given', 'Sent when a carrier replies without a rate.', 2),
    tplField('needRateEta', 'No rate, no ETA', 'Sent when a carrier gives neither.', 2),
    tplField('agreed', 'Carrier agrees to your rate', 'Sent when a carrier accepts your number.', 2),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', onclick: async () => { const t = { ...(s.templates || {}) }; for (const k of ['book', 'split', 'target', 'askRate', 'available', 'availableLead', 'needRate', 'needRateEta', 'agreed']) delete t[k]; await actions.saveSettings({ templates: t }); toast('Reply wording reset to the defaults.', 'ok'); } }, 'Reset reply wording')));
}

/** DANGER ZONE: let the Outlook macro SEND instead of saving drafts. Inbound and outbound are separate switches; both default to off. */
function autoSendControls(s) {
  const sw = (key, title, onText, offText, confirmText) => {
    const cb = h('input', { type: 'checkbox', role: 'switch', checked: !!s[key], 'data-act': 'autosend-' + key });
    cb.addEventListener('change', async () => {
      if (cb.checked) {
        if (!(await confirmDialog(title, confirmText, 'Turn on sending'))) { cb.checked = false; return; }
        await actions.saveSettings({ [key]: true }); toast(title + ' is ON. The Outlook macro will send instead of saving drafts.', 'ok', 6000);
      } else { await actions.saveSettings({ [key]: false }); toast(title + ' is off. Back to drafts only.', 'ok'); }
    });
    return h('label', { class: 'tgl dangerrow' }, cb, h('span', null, h('b', null, title), h('small', { class: 'muted' }, ' ' + (s[key] ? onText : offText))));
  };
  return h('div', { class: 'autosend' },
    h('p', { class: 'muted' }, 'By default every e-mail is saved as a draft for you to review. These switches let the Outlook macro (v6) send instead. Only the macro can send; this app never does. Turn a switch off at any time and the next e-mail goes back to a draft.'),
    sw('autoSendInbound', 'Auto-send replies to carriers', 'ON: replies to carrier e-mails are SENT when the app is certain it understood them. Anything unclear stays a draft and is flagged.', 'Off: replies are saved as drafts.',
      'With this on, the Outlook macro SENDS replies to inbound carrier e-mails (rate counters, "how close can you come", ETA requests) without showing them to you first. Only e-mails the app fully understood are sent; anything unusual (a question, a pushback, several rates, a stop request) stays a draft. A cap of ' + (s.maxAutoSendsPerHour || 20) + ' sends per hour applies. Requires the v6 macro.'),
    sw('autoSendOutbound', 'Auto-send outreach to carriers', 'ON: outreach drafts made here are SENT by Outlook instead of saved.', 'Off: outreach is saved as drafts.',
      'With this on, outreach and truck-check e-mails you create here are SENT by Outlook as soon as they are queued, without a draft to review. Make sure your carrier list and wording are right first. Requires the v6 macro.'));
}

function truckSection(s) {
  const tpl = templatesOf(s);
  const f = (key, label, rows) => { const el = key === 'truckSubject' ? h('input', { 'data-rerender': '' }) : h('textarea', { rows, 'data-rerender': '' }); el.value = tpl[key]; el.addEventListener('change', () => actions.saveSettings({ templates: { ...(s.templates || {}), [key]: el.value } })); return field(label, el, 'Fill-ins: ' + TEMPLATE_VARS[key].join(' ')); };
  return h('div', null, h('p', { class: 'muted' }, 'The one-click "Truck?" button in the Carrier Database drafts this e-mail to a carrier. {where} becomes "in Fresno, CA heading toward Reno, NV" from the carrier\'s record.'),
    f('truckSubject', 'Subject'), f('truckBody', 'Message', 7),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', onclick: async () => { const t = { ...(s.templates || {}) }; delete t.truckSubject; delete t.truckBody; await actions.saveSettings({ templates: t }); toast('Truck-check wording reset.', 'ok'); } }, 'Reset')));
}

const STRAT_FIELDS = [['altMin', 'Closest alternate city (mi)'], ['altIdeal', 'Ideal alternate distance (mi)'], ['altMax', 'Farthest alternate (mi)'], ['minPop', 'Smallest market (people)'], ['outreachMultiplier', 'Outreach size x'], ['staleHours', 'Aging after (h, no inquiries)'], ['repricePct', 'Reprice step (% of rate)'], ['repriceMin', 'Reprice min ($)'], ['repriceMax', 'Reprice max ($)'], ['closingHours', 'Pickup "closing" within (h)']];
function strategySection(s) {
  const { num } = mk(s);
  const cols = ['local', 'regional', 'long'].map(cls => {
    const cur = strategyFor(s, cls);
    return h('div', { class: 'panel stratcol' }, h('h4', null, LANE_LABEL[cls]), STRAT_FIELDS.map(([k, label]) => {
      const el = h('input', { type: 'number', value: cur[k], step: k === 'outreachMultiplier' ? '0.25' : '1', 'data-rerender': '' });
      el.addEventListener('change', () => actions.saveSettings({ strategies: { ...(s.strategies || {}), [cls]: { ...((s.strategies || {})[cls] || {}), [k]: Number(el.value) } } }));
      return field(label, el);
    }));
  });
  return h('div', null,
    h('p', { class: 'muted' }, 'Each load is classed by its road miles. A local load needs many nearby trucks and a tight matrix; a long load needs fewer, better-matched carriers and wider alternates. Change the cut-offs and the numbers if your freight behaves differently.'),
    h('div', { class: 'grid4' }, num('laneLocalMax', 'Local is under (road mi)'), num('laneRegionalMax', 'Regional runs up to (road mi)', 'Longer than this = long-distance.')),
    h('div', { class: 'grid3' }, cols),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', onclick: async () => { await actions.saveSettings({ strategies: null, laneLocalMax: 150, laneRegionalMax: 600 }); toast('Strategies reset to the defaults.', 'ok'); } }, 'Reset to defaults')));
}

function matrixSection(s) {
  const { select } = mk(s);
  const pins = Object.entries(s.matrixPins || {});
  return h('div', null,
    h('p', { class: 'muted' }, 'The 3 × 3 matrix picks two alternate origins and two alternate destinations that sit where the most trucks are, using population, your own cover history and the lane length. It adapts: in a dense metro it picks the close, big markets; in thin country it reaches farther.'),
    select('matrixMode', 'When a load is added', [['auto', 'Build the 3 × 3 automatically (ask only when the cities look odd)'], ['ask', 'Always show me the cities before building']]),
    h('h4', null, 'Cities you told it to remember'),
    pins.length ? h('table', { class: 'lanetable' }, h('thead', null, h('tr', null, ['For', 'Always use', ''].map(x => h('th', null, x)))),
      h('tbody', null, pins.map(([k, v]) => h('tr', null, h('td', null, k.replace('|', ', ').toUpperCase()), h('td', null, (v || []).map(c => `${c.city}, ${c.state}`).join(' and ')),
        h('td', null, h('button', { class: 'btn small danger', type: 'button', onclick: async () => { const p = { ...(s.matrixPins || {}) }; delete p[k]; await actions.saveSettings({ matrixPins: p }); } }, 'Forget')))))) : h('p', { class: 'muted' }, 'None. In the matrix preview, tick "Remember these picks" to pin cities for an origin or destination.'));
}

function carriersSection(s) {
  const { num, select, check, area } = mk(s);
  return h('div', null,
    h('div', { class: 'grid4' }, num('lowTarget', 'Low target'), num('mediumTarget', 'Medium target'), num('highTarget', 'High target'), num('maxCarriersPerLoad', 'Max carriers / load (scan)'),
      num('carrierRadiusMiles', 'Carrier match radius (mi)', 'A carrier within this distance of the origin and destination counts as on the lane.'), num('minReasonableRate', 'Min plausible rate'), num('maxReasonableRate', 'Max plausible rate')),
    check('recogniseCommaRates', 'Recognise comma-formatted carrier rates such as $1,650', 'the original Outlook macro does not; leave off for exact macro behaviour'),
    select('outreachButtonMode', 'Row "Outreach" button', [['excel', 'Draft the best-ranked carriers for this posting'], ['outlook', 'Scan-style: skip carriers already drafted for this load']]),
    select('defaultContact', 'New loads are posted on DAT with', [['Email', 'E-mail (default)'], ['Phone', 'Phone number']], 'You can change any load from its header.'),
    check('draftsToOutlook', 'Save outreach drafts into my Outlook Drafts folder when Outlook is connected', 'never sends anything'),
    h('div', { class: 'grid2' },
      area('outreachBlocklist', 'Outreach blocklist', 'One per line: "@domain.com" blocks a domain, a full address blocks one sender.', lines, (v) => (v || []).join('\n')),
      area('inboundBlocklist', 'Inbound e-mail blocklist', 'Substring match against the sender address.', lines, (v) => (v || []).join('\n'))));
}

function expirySection(s) {
  const { num, check } = mk(s);
  return h('div', null, h('p', { class: 'muted' }, 'Postings whose pickup day has passed are moved to the Cover Log as "Expired" so the board only shows live loads. They can be restored from the Cover Log.'),
    check('autoExpire', 'Retire loads automatically after their pickup day', 'on by default'), num('expireGraceDays', 'Extra days to keep a load after pickup', '0 = retire at midnight after the pickup day.', { min: 0 }));
}

function brokerSection(s) {
  const { num } = mk(s);
  const brokers = s.brokers || [];
  const name = h('input', { placeholder: 'Broker name', 'data-live': '' });
  const add = async () => { const ok = await actions.addBroker(name.value); if (!ok) return toast('Enter a name that is not already in the list.', 'warn'); name.value = ''; };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const days = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  const wd = new Set((s.workDays || [1, 2, 3, 4, 5]).map(Number));
  return h('div', null,
    h('p', { class: 'muted' }, 'Add the brokers you post for. Each gets their own tab on the Freight Signal page, their own scoreboard and their own DAT CSV; "All" shows everything.'),
    brokers.length ? brokerList(brokers) : h('p', { class: 'muted' }, 'No brokers yet.'),
    h('div', { class: 'toolbar' }, name, h('button', { class: 'btn primary', type: 'button', onclick: add }, 'Add broker')),
    h('h4', null, 'Cover pace tracker (top right)'),
    h('p', { class: 'muted small' }, `The cover week runs Monday to Sunday (this week: ${weekRangeText()}). The weekly count resets at 12:00 AM Monday, the moment Sunday ends. Reach the weekly floor and the app celebrates with a short burst of confetti.`),
    h('div', { class: 'grid4' }, num('weeklyFloor', 'Weekly floor (covers)'), num('workStart', 'Workday starts (hour, 0-23)', null, { min: 0, max: 23 }), num('workEnd', 'Workday ends (hour, 0-23)', null, { min: 1, max: 23 })),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', onclick: () => import('../celebrate.js').then(m => m.celebrate({ week: state.settings.weeklyFloor || 50, floor: state.settings.weeklyFloor || 50 })) }, icon('sparkle', 14), 'Preview the celebration')),
    h('div', { class: 'daypick' }, h('span', { class: 'muted' }, 'Working days: '), days.map(([n, l]) => { const c = h('input', { type: 'checkbox', checked: wd.has(n), 'data-live': '' }); c.addEventListener('change', () => { if (c.checked) wd.add(n); else wd.delete(n); if (!wd.size) { wd.add(n); c.checked = true; return toast('Keep at least one working day.', 'warn'); } actions.saveSettings({ workDays: [...wd].sort() }); }); return h('label', { class: 'inl' }, c, ' ' + l); })));
}

/** The broker list in System: drag the grip (or hold Alt and use the arrow keys) to re-order. The order is the order of the tabs on the board. */
function brokerList(brokers) {
  const ul = h('ul', { class: 'brokerlist' }, brokers.map(b => h('li', { dataset: { broker: b }, tabindex: 0, title: brokers.length > 1 ? 'Drag to re-order (or hold Alt and press the arrow keys)' : null },
    brokers.length > 1 ? h('span', { class: 'grip', 'aria-hidden': 'true' }, icon('grip', 16)) : null, h('b', null, b),
      h('button', { class: 'btn small', type: 'button', onclick: () => { const inp = h('input', { value: b, 'data-live': '' }); modal({ title: 'Rename broker', body: field('Name', inp), actions: [{ label: 'Cancel' }, { label: 'Rename', kind: 'primary', onClick: async () => { await actions.renameBroker(b, inp.value); } }] }); } }, 'Rename'),
      h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Remove broker', `Remove ${b}? Their loads stay on the board as Unassigned.`, 'Remove')) actions.removeBroker(b); } }, 'Remove'))));
  if (brokers.length > 1) makeSortable(ul, { items: () => [...ul.querySelectorAll('li[data-broker]')], id: (el) => el.dataset.broker, axis: 'y', onReorder: (order) => actions.reorderBrokers(order) });
  return ul;
}

function weatherSection(s) {
  const { check } = mk(s);
  return h('div', null,
    h('p', { class: 'muted' }, 'Flags loads whose pickup or delivery city has a severe National Weather Service alert (winter storms, tornadoes, flooding, high wind...) during the pickup window.'),
    h('div', { class: 'banner' }, h('b', null, 'Privacy: '), 'this is the one feature that contacts another website. Only a latitude/longitude for each pickup and delivery city is sent to api.weather.gov (U.S. government, public). No load details, customers, carriers or rates are ever sent. Turn it off and nothing is.'),
    check('weatherFlags', 'Show weather flags (U.S. cities)'),
    h('p', { class: 'muted small' }, weatherStatus.lastRun ? `Last check ${fmtDate(weatherStatus.lastRun)}: ${weatherStatus.cities} cities, ${weatherStatus.failed} failed${weatherStatus.error ? ' (' + weatherStatus.error + ')' : ''}. Alerts now: ${state.weather.size} cities.` : 'Not checked yet this session.'),
    h('div', { class: 'toolbar' }, h('button', { class: 'btn small', type: 'button', disabled: !s.weatherFlags, onclick: async () => { await refreshWeather(true); toast('Weather refreshed.', 'ok'); rerender(); } }, icon('refresh', 14), 'Refresh now')));
}

export function render() {
  const s = state.settings;
  if (!est) db.storageEstimate().then(e => { est = e || { none: true }; rerender(); });
  const { area } = mk(s);
  const olOn = bridge.connected && outlookConnected();
  return h('div', null,
    pageHead({ icon: 'system', title: 'System', sub: 'Settings, backup and data. All stored in this browser only. Click a section to open it.', actions: [h('a', { class: 'btn', href: '#/account' }, icon('palette', 15), 'Themes & appearance')] }),
    state.persistError ? h('div', { class: 'banner err' }, 'Storage problem: ' + state.persistError) : null,
    section('outlook', 'Connect to Outlook', olOn ? 'Connected' : bridge.connected ? 'Folder connected, waiting for Outlook' : 'Not connected - step-by-step guide inside', outlookGuide(), { open: !olOn, tone: olOn ? 'good' : 'warn' }),
    section('ladder', 'Counter ladder and reply wording', `Book within ${s.ladderBookPct}%, split within ${s.ladderSplitPct}% of target`, ladderSection(s)),
    section('truck', 'Truck-availability e-mail', 'Wording for the one-click "Truck?" button', truckSection(s)),
    section('strategy', 'Posting strategy by lane length', `Local < ${s.laneLocalMax} mi · Regional to ${s.laneRegionalMax} mi · Long beyond`, strategySection(s)),
    section('matrix', '3 × 3 matrix', s.matrixMode === 'ask' ? 'Always asks before building' : 'Builds automatically', matrixSection(s)),
    section('carriers', 'Carriers, outreach and blocklists', `Radius ${s.carrierRadiusMiles} mi · DAT contact: ${s.defaultContact}`, carriersSection(s)),
    section('expiry', 'Auto-expiry', s.autoExpire ? 'On: loads retire after pickup' : 'Off', expirySection(s)),
    section('brokers', 'Brokers and cover pace', `${(s.brokers || []).length} broker(s) · floor ${s.weeklyFloor}/week`, brokerSection(s)),
    section('weather', 'Weather flags', s.weatherFlags ? 'On (contacts api.weather.gov)' : 'Off - nothing leaves the browser', weatherSection(s)),
    section('parsing', 'Parsing', 'How pasted loads are split', area('loadSeparatorRegex', 'Multi-load separator (regex)', 'Pasted text is split into loads at lines matching this.', (v) => v.trim() || '^\\s*\\d+\\s*pick\\s*[-–]\\s*\\d+\\s*drop')),
    section('zip', 'ZIP Map', state.zip ? `${state.zip.size.toLocaleString()} rows` : 'Not loaded', h('div', null, h('p', null, state.zip ? `${state.zip.size.toLocaleString()} rows from ${state.zipInfo.source}.` : 'Not loaded.'),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: importZip }, 'Import a different ZIP Map CSV…'), h('span', { class: 'muted' }, 'Required headers: zip, lat, lng, city, state_id, population.')))),
    section('backup', 'Backup and restore', 'Download everything as one file', h('div', null,
      h('div', { class: 'toolbar' },
        h('button', { class: 'btn primary', type: 'button', onclick: async () => { const snap = await actions.exportBackup(); download(`freight-signal-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(snap, null, 1), 'application/json'); toast('Backup downloaded. It contains your carriers, customers and loads: store it securely.', 'ok', 7000); } }, 'Download backup (.json)'),
        h('button', { class: 'btn', type: 'button', onclick: restore }, 'Restore from backup…'),
        h('button', { class: 'btn', type: 'button', onclick: loadSample }, 'Add sample data')),
      est && !est.none ? h('p', { class: 'muted' }, `Browser storage used: ${((est.usage || 0) / 1048576).toFixed(1)} MB of ${((est.quota || 0) / 1048576).toFixed(0)} MB available.`) : null)),
    section('counters', 'Counters', 'Carry over numbers from Excel', h('div', null, h('p', { class: 'muted' }, 'The pace tracker counts from the Cover Log. These two counters are for your own reference (and for carrying over Excel numbers).'),
      h('div', { class: 'grid4' }, num2('Covers today', 'coversToday'), num2('Lifetime covers', 'lifetimeCovers')))),
    section('danger', 'Danger zone', 'Auto-send e-mail, erase all data', h('div', null, autoSendControls(s), h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (await confirmDialog('Erase all data', 'Delete ALL loads, carriers, customers, cover log, inquiries, drafts and spares from this browser? Download a backup first. The ZIP Map is kept.', 'Erase everything')) { await actions.wipe(); toast('All data erased.', 'ok'); } } }, 'Erase all data')), { tone: 'danger' }));
}

function num2(label, key) {
  const el = h('input', { type: 'number', value: state.counters[key] || 0, 'data-rerender': '' });
  el.addEventListener('change', () => actions.setCounters({ [key]: Number(el.value) || 0 }));
  return field(label, el);
}
