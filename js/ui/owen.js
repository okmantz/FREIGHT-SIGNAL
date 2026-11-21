// "What would Owen do?" widget (v17): a helper button in the top bar (next to Account and Sign out) that opens a small chat panel.
// Answers come from js/core/owen.js (offline knowledge base + load-aware advice). Nothing is sent anywhere.
import { h, toast } from './dom.js';
import { icon } from './icons.js';
import { state, actions } from '../store/state.js';
import { answer, loadAdvice, SUGGESTIONS } from '../core/owen.js';
import { headsOf, laneDifficulty } from '../core/corridor.js';
import { matchesForLoad, QUALIFIED } from '../core/matching.js';
import { placeText } from '../core/netcommon.js';
import { safeNumeric } from '../core/util.js';

const FACE = 'assets/owen/owen-face.png';
let panel = null, log = null, input = null, started = false;
const history = [];   // {who:'me'|'owen', text, steps, links, act}

/** Facts about every open load, so Owen can talk about YOUR loads, not just the app. */
export function loadFacts(now = Date.now()) {
  return headsOf(state.postings).filter(p => p.status !== 'Covered' && p.status !== 'Expired').map(p => {
    const group = state.postings.filter(x => (x.groupId || x.id) === (p.groupId || p.id));
    const created = Date.parse(p.createdAt); const age = Number.isFinite(created) ? Math.max(0, (now - created) / 60000) : 0;
    const inq = state.inquiries.filter(i => group.some(g => g.id === i.postingId)).length;
    const hard = (() => { try { return !!laneDifficulty(p, { zipMap: state.zip, settings: state.settings }).tough; } catch { return false; } })();
    const rs = state.autoRescues.find(r => r.id === p.id);
    const matches = matchesForLoad(state.matches, p.id).filter(m => QUALIFIED.includes(m.tier)).length;
    const title = placeText(p.originCity, p.originState) + ' to ' + placeText(p.destCity, p.destState);
    return { id: p.id, title, keys: [p.loadNumber, p.originCity, p.destCity, title], ageMin: age, inquiries: inq, matches, hard, targetRate: safeNumeric(p.targetRate), postings: group.length, contacted: state.outreach.filter(o => o.postingId === p.id).length, rescue: rs ? rs.status : '', stuckScore: (inq ? 0 : 3) + (hard ? 2 : 0) + Math.min(5, age / 120) + (matches ? 0 : 1) };
  });
}

const go = (route) => { location.hash = '#/' + route; closePanel(); };
function bubble(m) {
  const body = h('div', { class: 'ow-msg ' + m.who }, h('p', null, m.text),
    m.steps && m.steps.length ? h('ol', null, m.steps.map(s => h('li', null, s))) : null,
    (m.links || m.act) ? h('div', { class: 'ow-links' },
      (m.links || []).map(l => h('button', { class: 'btn small', type: 'button', 'data-route': l.route, onclick: () => go(l.route) }, l.label, icon('chevright', 12))),
      (m.act || []).map(a => h('button', { class: 'btn small primary', type: 'button', onclick: () => doAct(a, m) }, a.label))) : null);
  return m.who === 'owen' ? h('div', { class: 'ow-row' }, h('img', { class: 'ow-face', src: FACE, alt: '', width: 28, height: 28 }), body) : h('div', { class: 'ow-row me' }, body);
}
async function doAct(a, m) {
  if (a.id === 'open-load') return go('board');
  if (a.id === 'auto-rescue' && m.loadId) { await actions.startAutoRescue(m.loadId, {}); toast('Auto Rescue started for that load.', 'ok'); say('owen', { text: 'Done. Auto Rescue is working it now. Open the load to set the highest rate it may offer, or to watch its log.', links: [{ label: 'Open Load Board', route: 'board' }] }); }
}
function paint() {
  if (!log) return; while (log.firstChild) log.removeChild(log.firstChild);
  for (const m of history) log.appendChild(bubble(m));
  log.scrollTop = log.scrollHeight;
}
function say(who, m) { history.push({ who, ...m }); paint(); }
function ask(text) {
  const q = String(text || '').trim(); if (!q) return;
  say('me', { text: q });
  const loads = loadFacts(); const a = answer(q, { loads });
  setTimeout(() => say('owen', a), 220);
}
function hello() {
  const loads = loadFacts(); const stuck = loads.filter(l => l.stuckScore >= 4).length;
  say('owen', { text: loads.length ? `Hey, Owen here. You have ${loads.length} open load${loads.length === 1 ? '' : 's'}` + (stuck ? `, and ${stuck} look${stuck === 1 ? 's' : ''} quiet.` : '.') + ' Ask me where something is, or tell me which load is stuck and I will tell you what I would do.' : 'Hey, Owen here. Ask me where anything is, how to do something, or add a load and I will help you cover it.' });
}
function openPanel() {
  if (panel) return; started = started || (hello(), true);
  input = h('input', { type: 'text', placeholder: 'Ask Owen anything…', 'aria-label': 'Ask Owen', autocomplete: 'off', 'data-live': '' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const v = input.value; input.value = ''; ask(v); } });
  log = h('div', { class: 'ow-log', role: 'log', 'aria-live': 'polite' });
  panel = h('aside', { class: 'owen-panel', role: 'dialog', 'aria-label': 'What would Owen do?' },
    h('header', null, h('img', { class: 'ow-face big', src: FACE, alt: '', width: 40, height: 40 }), h('div', null, h('b', null, 'What would Owen do?'), h('small', null, 'Your built-in freight helper')),
      h('button', { class: 'btn small', type: 'button', 'aria-label': 'Close', onclick: closePanel }, icon('close', 14))),
    log,
    h('div', { class: 'ow-chips' }, SUGGESTIONS.map(s => h('button', { type: 'button', class: 'ow-chip', onclick: () => ask(s) }, s))),
    h('div', { class: 'ow-input' }, input, h('button', { class: 'btn primary', type: 'button', 'aria-label': 'Send', onclick: () => { const v = input.value; input.value = ''; ask(v); } }, icon('send', 15))));
  document.body.appendChild(panel); paint(); input.focus();
  document.addEventListener('keydown', onEsc);
}
const onEsc = (e) => { if (e.key === 'Escape') closePanel(); };
function closePanel() { if (!panel) return; panel.remove(); panel = null; log = null; document.removeEventListener('keydown', onEsc); }
export const toggleOwen = () => (panel ? closePanel() : openPanel());
export const askOwen = (q) => { openPanel(); ask(q); };

/** Put the button in the top bar, right before the Account and Sign out buttons. */
export function mountOwen() {
  const bar = document.querySelector('.hdr-actions'); if (!bar || document.getElementById('owenbtn')) return;
  const btn = h('button', { id: 'owenbtn', class: 'hdr-btn owenbtn', type: 'button', title: 'What would Owen do? Ask for help with anything', 'aria-label': 'What would Owen do?', onclick: toggleOwen },
    h('img', { class: 'ow-face', src: FACE, alt: '', width: 24, height: 24 }), h('span', null, 'What would Owen do?'));
  const ref = document.getElementById('themebtn') || bar.firstChild; bar.insertBefore(btn, ref);
}
