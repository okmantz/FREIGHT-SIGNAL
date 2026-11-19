// Team channels: three focused places to talk (carrier alerts, market talk, general) instead of one big inbox.
import { h, toast, confirmDialog } from '../dom.js';
import * as net from '../../store/net.js';
import { pageHead, emptyState, iconBtn } from '../chrome.js';
import { ago } from '../../core/netcommon.js';
import { notJoined } from './team.js';

const view = { ch: 'alerts' };

export function render() {
  if (!net.joined()) return notJoined('channels');
  const ch = net.CHANNELS.find(c => c.id === view.ch) || net.CHANNELS[0];
  net.markSeen('chat', ch.id);
  const uid = net.myUid();
  const unread = (id) => net.net.posts.filter(p => p.ch === id && p.uid !== uid && p.at > ((net.net.cfg.lastChannelSeen || {})[id] || 0)).length;
  const tabs = h('div', { class: 'chtabs' }, net.CHANNELS.map(c => h('button', { class: 'chtab' + (c.id === ch.id ? ' active' : ''), type: 'button', 'data-channel': c.id, onclick: () => { view.ch = c.id; net.net.listeners.forEach(f => f()); } }, c.label, c.id !== ch.id && unread(c.id) ? h('span', { class: 'badge' }, unread(c.id)) : null)));
  const ta = h('textarea', { class: 'cell', rows: 2, maxlength: 1200, placeholder: ch.hint, 'aria-label': 'Message', 'data-live': '1', 'data-fk': 'chat-text' });
  const send = async () => { const r = await net.post(ch.id, ta.value); if (!r.ok) return toast(r.error, 'warn'); ta.value = ''; };
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(); });
  const posts = net.net.posts.filter(p => p.ch === ch.id).slice(0, 80);
  return h('div', null,
    pageHead({ icon: 'mail', title: 'Team Channels', sub: 'Alerts about carriers, market talk, and everything else. Messages disappear after two weeks.' }), tabs,
    h('div', { class: 'panel' }, ta, h('div', { class: 'toolbar' }, iconBtn('send', 'Post', { class: 'primary', 'data-act': 'post-message', onclick: send }), h('small', { class: 'muted' }, 'Ctrl+Enter sends. Never paste customer names or rates you were told in confidence.'))),
    posts.length ? posts.map(p => h('div', { class: 'panel post', 'data-post': p.id }, h('div', { class: 'truck-head' }, h('b', null, p.by || 'Teammate'), h('span', { class: 'muted small' }, ago(p.at)),
      p.uid === uid ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await confirmDialog('Delete message', 'Remove this message for everyone?', 'Delete')) net.deletePost(p.id); } }, 'Delete') : null), h('div', { class: 'postbody' }, p.text)))
      : emptyState({ icon: 'mail', title: 'Quiet in here', text: ch.hint }));
}
