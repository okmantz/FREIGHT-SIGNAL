// "Import historical emails": read the last 30 / 90 days of Outlook mail, find the carriers that really booked a load with you, and let you
// review every one (with the evidence) before anything is added. Nothing is written until you press Import.
import { h, toast, modal, pickFile, readFileText } from './dom.js';
import { state, actions } from '../store/state.js';
import { bridge, requestHistory, readHistory } from '../store/bridge.js';
import { analyzeHistory, planImport, parseExport, parseEml } from '../core/history.js';
import { usDate, isoDay, money } from '../core/netcommon.js';

const LEVEL = { high: ['Verified', 'good'], medium: ['Needs your review', 'warn'], low: ['Weak', 'muted'] };
const dayText = (t) => usDate(isoDay(new Date(t).toISOString())) || '';
const laneText = (l) => (l ? `${l.originCity}, ${l.originState} to ${l.destCity}, ${l.destState}` : 'lane not clear');

export function openHistoryImport() {
  const S = { days: Number(state.settings.historyDays) === 90 ? 90 : 30, step: 'setup', msg: '', analysis: null, plan: null, picked: new Set(), showExcluded: false, open: new Set(), addCovers: true, keepThreads: true, own: String(state.settings.historyOwnEmails || ''), busy: false, cancel: false };
  let m = null; const root = h('div', { class: 'hx' });
  const redraw = () => { root.replaceChildren(...view().filter(Boolean)); };
  const close = () => { S.cancel = true; if (m) m.close(); };

  /* ------------------------------------------------------------------ analysis */
  const analyze = async (messages, meta = {}) => {
    S.step = 'working'; S.msg = 'Reading ' + messages.length.toLocaleString('en-US') + ' messages…'; redraw();
    await new Promise(r => setTimeout(r, 30));
    const own = S.own.split(/[,;\s]+/).map(x => x.trim().toLowerCase()).filter(x => x.includes('@'));
    await actions.saveSettings({ historyDays: S.days, historyOwnEmails: S.own });
    const customers = state.customers.map(c => String(c.email || '').toLowerCase()).filter(Boolean);
    const since = Date.now() - S.days * 86400000;
    const analysis = analyzeHistory(messages, { zipMap: state.zip, settings: state.settings, own, customers, since });
    S.analysis = analysis; rebuildPlan(analysis);
    S.picked = new Set(S.plan.rows.filter(r => r.cand.level === 'high' && r.status !== 'present').map(r => r.cand.key));
    S.meta = meta; S.step = 'review'; redraw();
  };
  const rebuildPlan = (analysis) => {
    const ctx = { carriers: state.carriers, coverLog: state.coverLog, history: state.history };
    const all = planImport(analysis, ctx, { levels: ['high', 'medium'] });
    const rows = analysis.candidates.filter(c => c.level !== 'low').map(c => {
      const one = planImport(analysis, ctx, { levels: ['high', 'medium'], only: new Set([c.key]) });
      const add = one.adds[0], patch = one.patches[0];
      const status = add ? 'new' : patch && (Object.keys(patch.fill).length || patch.conflicts.length || patch.patch.verified) ? 'update' : 'present';
      return { cand: c, status, add, patch, covers: one.covers.length };
    });
    S.plan = { all, rows };
  };

  /* ------------------------------------------------------------------ sources */
  const fromOutlook = async () => {
    if (!bridge.connected) { toast('Connect the Outlook folder first (System > Outlook connection), or choose a file below.', 'err', 6000); return; }
    try {
      S.busy = true; S.step = 'waiting'; S.msg = ''; redraw();
      const id = await requestHistory(S.days);
      const t0 = Date.now();
      while (!S.cancel) {
        await new Promise(r => setTimeout(r, 2000));
        const r = await readHistory(id);
        if (r.state === 'ready') { S.busy = false; await analyze(r.parsed.messages, r.parsed.meta); return; }
        if (r.state === 'error') { S.busy = false; S.step = 'setup'; S.err = r.error || 'Outlook reported an error.'; redraw(); return; }
        S.msg = r.state === 'writing' ? 'Outlook is exporting' + (r.status && r.status.messages ? ' (' + r.status.messages + ' messages so far)' : '') + '…' : 'Waiting for you to run the macro in Outlook…';
        if (!S.cancel) redraw();
        if (Date.now() - t0 > 30 * 60000) { S.busy = false; S.step = 'setup'; S.err = 'Nothing arrived from Outlook in 30 minutes.'; redraw(); return; }
      }
    } catch (e) { S.busy = false; S.step = 'setup'; S.err = String(e.message || e); redraw(); }
  };
  const fromFile = async () => {
    const f = await pickFile('.tsv,.txt'); if (!f) return;
    const r = parseExport(await readFileText(f));
    if (!r.ok) { S.err = r.error; redraw(); return; }
    await analyze(r.messages, r.meta);
  };
  const fromEml = () => {
    const input = h('input', { type: 'file', accept: '.eml', multiple: true, class: 'offscreen' });
    input.addEventListener('change', async () => {
      const msgs = []; let bad = 0;
      for (const f of input.files) { try { const mm = parseEml(await readFileText(f), f.name + f.size + f.lastModified); if (mm) msgs.push(mm); else bad++; } catch { bad++; } }
      input.remove();
      if (!msgs.length) { S.err = 'None of those files could be read as e-mail (.eml).'; redraw(); return; }
      if (bad) toast(bad + ' file' + (bad === 1 ? '' : 's') + ' could not be read and were skipped.', 'info');
      await analyze(msgs, { days: S.days });
    });
    document.body.appendChild(input); input.click();
  };

  /* ------------------------------------------------------------------ views */
  const setupView = () => [
    h('p', null, 'Freight Signal reads your Outlook mail for the last ', h('b', null, S.days + ' days'), ' and finds only the carriers that ', h('b', null, 'really booked a load with you'), ': a rate confirmation you sent or they signed, driver details they sent after you booked, a delivery, a thank-you for the load. A "please send driver and dispatch info" on its own is never enough.'),
    h('div', { class: 'hx-days', role: 'group', 'aria-label': 'How far back' }, [30, 90].map(d => h('button', { type: 'button', class: 'btn' + (S.days === d ? ' primary' : ''), 'aria-pressed': String(S.days === d), onclick: () => { S.days = d; redraw(); } }, 'Last ' + d + ' days'))),
    h('label', { class: 'field' }, h('span', { class: 'lbl' }, 'Your own e-mail address(es) (optional)'), h('input', { value: S.own, placeholder: 'you@company.com, you@gmail.com', oninput: (e) => { S.own = e.target.value; } }), h('small', { class: 'hint' }, 'Found automatically from your Sent Items. Add other addresses so a message from a coworker is never mistaken for a carrier.')),
    S.err ? h('p', { class: 'hx-err', role: 'alert' }, S.err) : null,
    h('div', { class: 'hx-src' },
      h('div', { class: 'hx-card' }, h('b', null, '1. From Outlook (recommended)'), h('p', { class: 'muted' }, bridge.connected ? 'Press the button, then in Outlook run the macro FS_ExportHistory (Alt+F8) and choose your folders. This page continues by itself.' : 'Connect the Outlook folder first (System > Outlook connection). The history macro is in the outlook folder of the update.'),
        h('button', { class: 'btn primary', type: 'button', 'data-act': 'hx-outlook', disabled: !bridge.connected, onclick: fromOutlook }, 'Ask Outlook for the last ' + S.days + ' days')),
      h('div', { class: 'hx-card' }, h('b', null, '2. From an export file'), h('p', { class: 'muted' }, 'Already ran the macro? Choose freight-signal-history.tsv.'), h('button', { class: 'btn', type: 'button', 'data-act': 'hx-file', onclick: fromFile }, 'Choose export file…')),
      h('div', { class: 'hx-card' }, h('b', null, '3. From saved e-mails'), h('p', { class: 'muted' }, 'Drag e-mails out of Outlook into a folder, then select the .eml files here (both directions: sent and received).'), h('button', { class: 'btn', type: 'button', 'data-act': 'hx-eml', onclick: fromEml }, 'Choose .eml files…'))),
    h('p', { class: 'muted small' }, 'Nothing is uploaded. Nothing is sent. Nothing is added until you review it and press Import.'),
  ];
  const workingView = () => [h('p', { class: 'hx-busy', role: 'status' }, S.msg || 'Working…'), h('p', { class: 'muted' }, S.step === 'waiting' ? 'In Outlook: Alt+F8, choose FS_ExportHistory, Run, then pick the folders to read (Inbox and Sent Items are the default). You can leave this window open.' : '')];

  const pill = (lv) => h('span', { class: 'stat-pill s-' + LEVEL[lv][1] }, h('i', { 'aria-hidden': 'true' }), LEVEL[lv][0]);
  const rowView = (r) => {
    const c = r.cand; const on = S.picked.has(c.key); const open = S.open.has(c.key);
    const st = r.status === 'new' ? h('span', { class: 'hx-tag new' }, 'New carrier') : r.status === 'update' ? h('span', { class: 'hx-tag upd' }, 'Already in database: adds ' + (Object.keys(r.patch.fill).length) + ' blank field' + (Object.keys(r.patch.fill).length === 1 ? '' : 's') + (r.patch.conflicts.length ? ', ' + r.patch.conflicts.length + ' different value' + (r.patch.conflicts.length === 1 ? '' : 's') + ' kept beside yours' : '')) : h('span', { class: 'hx-tag same' }, 'Already in database, nothing new');
    return h('div', { class: 'hx-row' + (on ? ' on' : '') },
      h('div', { class: 'hx-main' },
        h('input', { type: 'checkbox', checked: on, disabled: r.status === 'present', 'aria-label': 'Import ' + (c.name || c.email), onchange: (e) => { if (e.target.checked) S.picked.add(c.key); else S.picked.delete(c.key); redraw(); } }),
        h('div', { class: 'hx-id' }, h('b', null, c.name || '(no company name found)'), h('small', null, [c.mc ? 'MC ' + c.mc : c.dot ? 'DOT ' + c.dot : 'no MC found', c.email, c.phone ? c.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : 'no phone'].filter(Boolean).join('  ·  '))),
        pill(c.level), h('span', { class: 'hx-score', title: 'How much independent evidence there is' }, Math.round(c.score) + '%'),
        h('button', { class: 'btn small', type: 'button', 'aria-expanded': String(open), onclick: () => { if (open) S.open.delete(c.key); else S.open.add(c.key); redraw(); } }, open ? 'Hide proof' : 'Show proof')),
      h('div', { class: 'hx-sub' }, st, h('span', { class: 'muted' }, c.bookings.length + ' booked load' + (c.bookings.length === 1 ? '' : 's') + ', last ' + dayText(c.lastBookedAt)), c.lastRate ? h('span', { class: 'muted' }, 'last rate ' + money(c.lastRate)) : null),
      open ? h('div', { class: 'hx-proof' },
        c.bookings.map(b => h('div', { class: 'hx-book' }, h('b', null, laneText(b.lane) + (b.rate ? '  ·  ' + money(b.rate) + (b.rateConf === 'medium' ? ' (carrier\'s last quote, not confirmed)' : '') : '  ·  rate not clear in the e-mails')), h('small', { class: 'muted' }, ' ' + dayText(b.at) + ' · ' + Math.round(b.score) + '%'), h('ul', null, b.evidence.map(t => h('li', null, t))))),
        c.issues.length ? h('p', { class: 'hx-warn' }, c.issues.join('. ') + '.') : null,
        r.patch && r.patch.conflicts.length ? h('p', { class: 'hx-warn' }, 'Your database says: ' + r.patch.conflicts.map(x => x.field + ' "' + x.have + '" (e-mail says "' + x.found + '")').join('; ') + '. Yours is kept.') : null) : null);
  };
  const reviewView = () => {
    const a = S.analysis, rows = S.plan.rows; const hi = rows.filter(r => r.cand.level === 'high'), md = rows.filter(r => r.cand.level === 'medium');
    const sel = rows.filter(r => S.picked.has(r.cand.key));
    const one = planImport(a, { carriers: state.carriers, coverLog: state.coverLog, history: state.history }, { levels: ['high', 'medium'], only: new Set(sel.map(r => r.cand.key)) });
    return [
      h('div', { class: 'hx-sum' }, [[a.stats.messages.toLocaleString('en-US'), 'messages read'], [a.stats.threads.toLocaleString('en-US'), 'conversations'], [hi.length, 'verified booked carriers'], [md.length, 'need your review'], [Object.values(a.stats.excluded).reduce((x, y) => x + y, 0), 'left out']].map(([n, l]) => h('div', { class: 'hx-stat' }, h('b', null, String(n)), h('span', null, l)))),
      a.stats.messages === 0 ? h('p', { class: 'hx-err' }, 'No messages were found in that period.') : null,
      hi.length ? h('h4', null, 'Verified: booked a load with you (pre-selected)') : null, ...hi.map(rowView),
      md.length ? h('h4', null, 'Needs your review: some signs of a booking, not enough to be sure (not selected)') : null, ...md.map(rowView),
      !hi.length && !md.length ? h('p', { class: 'muted' }, 'No carrier had enough evidence of a booking. Try 90 days, or include more folders (Sent Items and the folder where you keep rate confirmations).') : null,
      a.excluded.length ? h('div', null, h('button', { class: 'btn small', type: 'button', onclick: () => { S.showExcluded = !S.showExcluded; redraw(); } }, (S.showExcluded ? 'Hide' : 'Show') + ' what was left out and why (' + a.excluded.length + ')'),
        S.showExcluded ? h('ul', { class: 'hx-excl' }, a.excluded.slice(0, 80).map(x => h('li', null, h('b', null, x.who || x.email || '?'), ': ' + x.why + (x.lane ? ' (' + laneText(x.lane) + ')' : '')))) : null) : null,
      h('div', { class: 'hx-opts' },
        h('label', null, h('input', { type: 'checkbox', checked: S.addCovers, onchange: (e) => { S.addCovers = e.target.checked; } }), ' Also add the booked loads to the Cover Log (feeds rate history and carrier ranking; not counted toward this week\'s pace)'),
        h('label', null, h('input', { type: 'checkbox', checked: S.keepThreads, onchange: (e) => { S.keepThreads = e.target.checked; } }), ' Keep the quotes and replies I read, to learn typical rates and which carriers answer'),
        h('p', { class: 'muted small' }, 'Selected: ' + sel.length + ' carrier' + (sel.length === 1 ? '' : 's') + '  ·  ' + one.stats.carriersAdded + ' new, ' + one.stats.carriersUpdated + ' updated, ' + (S.addCovers ? one.stats.covers : 0) + ' cover log entr' + (one.stats.covers === 1 ? 'y' : 'ies') + '. Carriers already in your database are never added twice, and values you typed are never overwritten.')),
    ];
  };
  const doneView = () => [h('p', { class: 'hx-ok', role: 'status' }, S.done), h('p', { class: 'muted' }, 'Open Cover Log > Performance to see how the history changes your numbers.')];

  const view = () => (S.step === 'setup' ? setupView() : S.step === 'review' ? reviewView() : S.step === 'done' ? doneView() : workingView());
  m = modal({
    title: 'Import historical emails', wide: true, body: root, onClose: () => { S.cancel = true; },
    actions: [
      { label: 'Close', onClick: () => { S.cancel = true; } },
      { label: 'Import selected', kind: 'primary', keepOpen: true, onClick: async () => {
        if (S.step !== 'review') return false;
        const sel = S.plan.rows.filter(r => S.picked.has(r.cand.key)); if (!sel.length && !S.keepThreads) { toast('Nothing selected.', 'err'); return false; }
        const plan = planImport(S.analysis, { carriers: state.carriers, coverLog: state.coverLog, history: state.history }, { levels: ['high', 'medium'], only: new Set(sel.map(r => r.cand.key)) });
        if (!S.addCovers) plan.covers = [];
        if (!S.keepThreads) plan.threads = [];
        else plan.threads = planImport(S.analysis, { carriers: state.carriers, coverLog: state.coverLog, history: state.history }, { levels: ['high', 'medium'] }).threads;
        const r = await actions.applyHistoryImport(plan);
        S.done = `Done: ${r.added} carrier${r.added === 1 ? '' : 's'} added, ${r.updated} updated${r.duplicates ? ', ' + r.duplicates + ' already there (skipped)' : ''}, ${r.covers} cover log entr${r.covers === 1 ? 'y' : 'ies'}, ${r.threads} conversation${r.threads === 1 ? '' : 's'} kept for rate learning.${r.conflicts ? ' ' + r.conflicts + ' different value' + (r.conflicts === 1 ? '' : 's') + ' found; yours were kept.' : ''}`;
        S.step = 'done'; redraw(); toast('Historical import finished.', 'ok'); return false;
      } },
    ],
  });
  redraw();
  return { close };
}
