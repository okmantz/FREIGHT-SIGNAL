// "What would Owen do?" (v18): the in-app helper. A button in the top bar opens a chat panel.
// Answers come from js/core/owen.js (offline engine that reads YOUR workspace: loads, covers, carriers, trucks, e-mails). Nothing leaves the browser.
// Owen has four portraits (assets/owen/owen-1..4.webp). They crossfade in the button while idle and the one that fits his mood is shown next to each answer.
import { h, toast } from './dom.js';
import { icon } from './icons.js';
import { state, actions } from '../store/state.js';
import { answer, loadAdvice } from '../core/owen.js';
import { headsOf, laneDifficulty } from '../core/corridor.js';
import { matchesForLoad, QUALIFIED } from '../core/matching.js';
import { placeText } from '../core/netcommon.js';
import { safeNumeric } from '../core/util.js';
import { paceStats, laneMemory } from '../core/coverlog.js';
import { activeTrucks } from '../core/truckbook.js';
import { exceptionQueue, ledgerSummary } from '../core/ledger.js';
import { sendModeOf } from '../core/sendpolicy.js';

const MOODS = { smart: 'assets/owen/owen-1.webp', thumbs: 'assets/owen/owen-2.webp', think: 'assets/owen/owen-3.webp', relax: 'assets/owen/owen-4.webp' };
const ORDER = ['smart', 'thumbs', 'think', 'relax'];
const START_CHIPS = ['Give me a summary', 'What should I work on first?', 'How am I doing this week?', 'How are you?', 'What is deadhead?'];
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

let panel = null, log = null, input = null, chipsEl = null, started = false, busy = false, idleTimer = 0, moodTimer = 0;
const history = [];                 // { who:'me'|'owen', text, steps, rows, facts, links, act, follow, mood }
const mem = {};                     // conversation memory for follow-ups ("and this week?", "what about it?")
const sent = [];                    // what the user asked, for the up-arrow recall
const avatars = new Set();          // live portrait elements, so the mood can change them together

/** A round portrait that holds all four pictures and fades between them (the classes live in css/app.css). */
export function owenAvatar(size = '', mood = 'smart') {
  const el = h('span', { class: 'ow-avatar ' + size, 'aria-hidden': 'true' });
  for (const m of ORDER) el.appendChild(h('img', { src: MOODS[m], alt: '', width: 96, height: 96, 'data-mood': m, decoding: 'async', draggable: 'false', class: m === mood ? 'on' : '' }));
  avatars.add(el); return el;
}
function showMood(el, mood) { for (const img of el.children) img.classList.toggle('on', img.dataset.mood === mood); }
function setMood(mood, only) { for (const el of (only ? [only] : [...avatars])) { if (!el.isConnected) { avatars.delete(el); continue; } showMood(el, mood); } }
function startIdle() {
  if (idleTimer || reduced()) return;
  let i = 0; idleTimer = setInterval(() => { if (document.hidden || busy) return; i = (i + 1) % ORDER.length; for (const el of [...avatars]) { if (!el.isConnected) { avatars.delete(el); continue; } if (el.classList.contains('idle')) showMood(el, ORDER[i]); } }, 6500);
}

// ------------------------------------------------------------------------------------------------ what Owen can see
/** Facts about every open load. */
export function loadFacts(now = Date.now()) {
  return headsOf(state.postings).filter(p => p.status !== 'Covered' && p.status !== 'Expired').map(p => {
    const group = state.postings.filter(x => (x.groupId || x.id) === (p.groupId || p.id));
    const created = Date.parse(p.createdAt); const age = Number.isFinite(created) ? Math.max(0, (now - created) / 60000) : 0;
    const inq = state.inquiries.filter(i => group.some(g => g.id === i.postingId)).length;
    const hard = (() => { try { return !!laneDifficulty(p, { zipMap: state.zip, settings: state.settings }).tough; } catch { return false; } })();
    const rs = state.autoRescues.find(r => r.id === p.id);
    const matches = matchesForLoad(state.matches, p.id).filter(m => QUALIFIED.includes(m.tier)).length;
    const title = placeText(p.originCity, p.originState) + ' to ' + placeText(p.destCity, p.destState);
    let memRate = 0; try { const m = laneMemory(state.coverLog, p, state.zip, Number(state.settings.carrierRadiusMiles) || 75); memRate = m && m.last ? safeNumeric(m.last.rate) : 0; } catch { /* no lane memory */ }
    return { id: p.id, title, loadNumber: p.loadNumber || '', oCity: p.originCity, oState: p.originState, dCity: p.destCity, dState: p.destState, broker: p.broker || '', equip: p.equip || '', pickup: p.pickupEarliest || '',
      keys: [p.loadNumber, p.originCity, p.destCity, title], ageMin: age, inquiries: inq, matches, hard, targetRate: safeNumeric(p.targetRate), datAvg: safeNumeric(p.datAvg), memRate, postings: group.length,
      contacted: state.outreach.filter(o => o.postingId === p.id).length, rescue: rs ? rs.status : '', stuckScore: (inq ? 0 : 3) + (hard ? 2 : 0) + Math.min(5, age / 120) + (matches ? 0 : 1) };
  });
}
/** The whole workspace as plain data for the answer engine. Built fresh for every question so the numbers are never stale. */
export function snapshot(now = Date.now()) {
  const s = state.settings || {}, pf = s.profile || {};
  const loads = loadFacts(now);
  const byPosting = new Map(state.postings.map(p => [p.id, p]));
  const inquiries = state.inquiries.map(q => { const p = byPosting.get(q.postingId) || {}; return { ...q, originCity: q.originCity || p.originCity, originState: q.originState || p.originState, destCity: q.destCity || p.destCity, destState: q.destState || p.destState }; });
  let pace = null; try { pace = paceStats(state.coverLog, s, new Date(now), null); } catch { /* no log yet */ }
  let held = 0, sentToday = 0; try { held = exceptionQueue(state.ledger).length; sentToday = ledgerSummary(state.ledger, now).auto; } catch { /* ledger not loaded */ }
  let trucks = []; try { trucks = activeTrucks(state.trucks, now); } catch { /* no trucks */ }
  return { now, name: pf.name || '', loads, covers: state.coverLog || [], carriers: state.carriers || [], customers: state.customers || [], inquiries, trucks, pace, held, sentToday,
    settings: { weeklyFloor: s.weeklyFloor, brokers: s.brokers || [], sendMode: sendModeOf(s), ladderBookPct: s.ladderBookPct, ladderSplitPct: s.ladderSplitPct } };
}

// ------------------------------------------------------------------------------------------------ rendering
const go = (route) => { location.hash = '#/' + route; closePanel(); };
function bubble(m) {
  const kv = m.facts && m.facts.length ? h('dl', { class: 'ow-kv' }, m.facts.map(([k, v]) => [h('dt', null, k), h('dd', null, v)])) : null;
  const rows = m.rows && m.rows.length ? h('ul', { class: 'ow-list' }, m.rows.map(([a, b]) => h('li', null, h('span', null, a), h('span', null, b)))) : null;
  const body = h('div', { class: 'ow-msg ' + m.who }, h('p', null, m.text), kv, rows,
    m.steps && m.steps.length ? h('ol', null, m.steps.map(s => h('li', null, s))) : null,
    (m.links || m.act) ? h('div', { class: 'ow-links' },
      (m.links || []).map(l => h('button', { class: 'btn small', type: 'button', 'data-route': l.route, onclick: () => go(l.route) }, l.label, icon('chevright', 12))),
      (m.act || []).map(a => h('button', { class: 'btn small primary', type: 'button', onclick: () => doAct(a, m) }, a.label))) : null);
  return m.who === 'owen' ? h('div', { class: 'ow-row' }, owenAvatar('sm', m.mood || 'smart'), body) : h('div', { class: 'ow-row me' }, body);
}
function typingRow() { return h('div', { class: 'ow-row', id: 'ow-typing' }, owenAvatar('sm', 'think'), h('div', { class: 'ow-msg owen', 'aria-label': 'Owen is typing' }, h('span', { class: 'ow-typing' }, h('i'), h('i'), h('i')))); }
function paint() {
  if (!log) return; while (log.firstChild) log.removeChild(log.firstChild);
  for (const m of history) log.appendChild(bubble(m));
  if (busy) log.appendChild(typingRow());
  log.scrollTop = log.scrollHeight;
}
function paintChips(list) {
  if (!chipsEl) return; while (chipsEl.firstChild) chipsEl.removeChild(chipsEl.firstChild);
  for (const s of (list && list.length ? list : START_CHIPS).slice(0, 6)) chipsEl.appendChild(h('button', { type: 'button', class: 'ow-chip', onclick: () => ask(s) }, s));
}
function say(who, m) { history.push({ who, ...m }); if (history.length > 60) history.splice(0, history.length - 60); paint(); }

async function doAct(a, m) {
  if (a.id === 'open-load') return go('board');
  if (a.id === 'auto-rescue' && m.loadId) { await actions.startAutoRescue(m.loadId, {}); toast('Auto Rescue started for that load.', 'ok'); say('owen', { mood: 'thumbs', text: 'Done. Auto Rescue is working it now. Open the load to set the highest rate it may offer, or to watch its log.', links: [{ label: 'Open Load Board', route: 'board' }] }); }
}

function ask(text) {
  const q = String(text || '').trim().slice(0, 400); if (!q || busy) return;
  sent.push(q); if (sent.length > 30) sent.shift();
  say('me', { text: q });
  let a;
  try { a = answer(q, { loads: loadFacts(), data: snapshot(), mem }); } catch (e) { a = { topic: 'error', mood: 'think', text: 'I hit a snag reading that. Try asking it another way, for example "give me a summary".' }; }
  busy = true; setMood('think'); paint();
  // a short, length-aware pause so the reply feels considered, never slow
  const wait = Math.min(900, 260 + String(a.text || '').length * 2.2);
  setTimeout(() => {
    busy = false; mem.last = { q, topic: a.topic };
    say('owen', a); setMood(a.mood || 'smart', panelAvatar); paintChips(a.follow);
    clearTimeout(moodTimer); moodTimer = setTimeout(() => { if (panelAvatar && panelAvatar.isConnected) setMood('smart', panelAvatar); }, 9000);
  }, reduced() ? 0 : wait);
}

let panelAvatar = null;
function hello() {
  const d = snapshot(); const loads = d.loads; const quiet = loads.filter(l => l.stuckScore >= 4).length;
  const hr = new Date().getHours(); const part = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const first = String(d.name || '').trim().split(/\s+/)[0];
  say('owen', { mood: 'thumbs', text: `${part}${first ? ', ' + first : ''}. Owen here. ` + (loads.length ? `You have ${loads.length} open load${loads.length === 1 ? '' : 's'}${quiet ? `, and ${quiet} look${quiet === 1 ? 's' : ''} quiet` : ''}${d.held ? `, plus ${d.held} e-mail${d.held === 1 ? '' : 's'} waiting for you` : ''}. ` : 'Your board is empty, so paste a load whenever you are ready. ') + 'Ask me anything: a load, a carrier, a rate, your week, a freight term, or just say hi.' });
}

function openPanel() {
  if (panel) return;
  if (!started) { started = true; hello(); }
  input = h('input', { type: 'text', placeholder: 'Ask Owen anything…', 'aria-label': 'Ask Owen', autocomplete: 'off', maxlength: 400, 'data-live': '' });
  let recall = sent.length;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = input.value; input.value = ''; recall = sent.length + 1; ask(v); }
    else if (e.key === 'ArrowUp' && sent.length) { e.preventDefault(); recall = Math.max(0, recall - 1); input.value = sent[recall] || ''; }
    else if (e.key === 'ArrowDown' && sent.length) { e.preventDefault(); recall = Math.min(sent.length, recall + 1); input.value = sent[recall] || ''; }
  });
  log = h('div', { class: 'ow-log', role: 'log', 'aria-live': 'polite' });
  chipsEl = h('div', { class: 'ow-chips' });
  panelAvatar = owenAvatar('xl', 'thumbs');
  panel = h('aside', { class: 'owen-panel', role: 'dialog', 'aria-label': 'What would Owen do?' },
    h('header', null, panelAvatar, h('div', null, h('b', null, 'What would Owen do?'), h('small', null, 'Reads your board, covers, carriers and trucks. Works offline.')),
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Close', onclick: closePanel }, icon('close', 14))),
    log, chipsEl,
    h('div', { class: 'ow-input' }, input, h('button', { class: 'btn primary', type: 'button', 'aria-label': 'Send', onclick: () => { const v = input.value; input.value = ''; ask(v); } }, icon('send', 15))));
  document.body.appendChild(panel); paintChips(); paint(); input.focus();
  document.addEventListener('keydown', onEsc);
}
const onEsc = (e) => { if (e.key === 'Escape') closePanel(); };
function closePanel() { if (!panel) return; panel.remove(); panel = null; log = null; chipsEl = null; panelAvatar = null; document.removeEventListener('keydown', onEsc); clearTimeout(moodTimer); }
export const toggleOwen = () => (panel ? closePanel() : openPanel());
export const askOwen = (q) => { openPanel(); ask(q); };

/** Put the button in the top bar, right before the Account and Sign out buttons. */
export function mountOwen() {
  const bar = document.querySelector('.hdr-actions'); if (!bar || document.getElementById('owenbtn')) return;
  const face = owenAvatar('idle', 'smart');
  const btn = h('button', { id: 'owenbtn', class: 'hdr-btn owenbtn', type: 'button', title: 'What would Owen do? Ask for help with anything', 'aria-label': 'What would Owen do?', onclick: toggleOwen },
    face, h('span', null, 'What would Owen do?'));
  const ref = document.getElementById('themebtn') || bar.firstChild; bar.insertBefore(btn, ref);
  startIdle();
}
export { loadAdvice };
