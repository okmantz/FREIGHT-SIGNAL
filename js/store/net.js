// Team Network service: one place that knows whether you are in a team, how it is stored (Firebase or a shared folder), keeps a local
// copy of the team's data fresh, and offers the actions the pages call (publish a truck, ask for help, answer, post, share lane data).
// Nothing here runs until you create or join a team. Your own data (postings, carriers, covers) never leaves your computer except as the
// few lane facts described in docs/NETWORK.md, and only while "Share lane data" is on.

import * as db from './db.js';
import * as cloud from './cloud.js';
import { state, subscribe } from './state.js';
import { CloudTransport, createTeam as cloudCreate, joinTeam as cloudJoin } from './netcloud.js';
import { FolderTransport, FolderError, folderPermission, pickFolder } from './netfolder.js';
import { newId, makeInvite, oneLine, multiLine, emailOf, DAY, HOUR } from '../core/netcommon.js';
import { buildTruck, cleanTruck, cleanStat, resolveTrucks, statRecord, prunable, searchTrucks } from '../core/trucks.js';
import { buildRescue, cleanRescue, rescueState, rescuePrunable, buildTip, cleanTip, cleanMark, rescueFacts } from '../core/rescue.js';
import { coverEvent, inquiryEvent, outreachEvent, cleanEvent, shardKey, monthKey, summarizeLanes, DEFAULTS as LANE_DEFAULTS } from '../core/laneintel.js';

export const CHANNELS = [
  { id: 'alerts', label: 'Carrier alerts', hint: 'Bad actors, double-brokering, fraud, carriers to avoid.' },
  { id: 'market', label: 'Market talk', hint: 'What lanes and markets feel like today.' },
  { id: 'general', label: 'General', hint: 'Everything else.' },
];
const POST_TTL = 14 * DAY;
const POLL_MS = 30000;

const DEFAULT_CFG = { mode: '', teamId: '', secret: '', name: '', localUid: '', ttlHours: 24, rescueAfterMin: 90, shareLane: true, lastChannelSeen: {}, lastRescueSeen: 0 };
export const net = { ready: false, cfg: { ...DEFAULT_CFG }, status: 'off', error: '', lastPoll: 0, trucks: [], tstat: [], rescues: [], tips: [], marks: [], posts: [], members: [], lane: [], listeners: new Set() };
export const onNet = (fn) => { net.listeners.add(fn); return () => net.listeners.delete(fn); };
const emit = () => { for (const fn of [...net.listeners]) { try { fn(); } catch (e) { console.error(e); } } };

let transport = null, timer = null, polling = null, seen = { c: {}, i: {}, o: {} }, unsub = null, laneTimer = null;
export const joined = () => !!(net.cfg.teamId && net.cfg.mode);
export const transportKind = () => (transport ? transport.kind : '');

/* ------------------------------------------------------------------------------------------------ identity */
export function me() {
  const p = (state.settings && state.settings.profile) || {};
  const b = (state.settings && state.settings.boards) || {};
  if (net.cfg.mode === 'cloud') {
    const u = cloud.user() || {};
    return { uid: u.uid || '', email: u.email || '', name: oneLine(p.name || (u.email || '').split('@')[0] || 'Teammate', 60) };
  }
  return { uid: net.cfg.localUid, email: emailOf(b.contactEmail) || '', name: oneLine(p.name || 'Teammate', 60) };
}
export const myUid = () => me().uid;
const kvSave = () => db.kvSet('network', net.cfg);

/* ------------------------------------------------------------------------------------------------ connect / leave */
async function connect() {
  transport = null;
  if (!joined()) { net.status = 'off'; return; }
  if (net.cfg.mode === 'cloud') {
    if (!cloud.enabled() || !cloud.user()) { net.status = 'signin'; return; }
    transport = new CloudTransport(net.cfg.teamId);
  } else {
    const rec = await db.get('handles', 'team');
    if (!rec || !rec.handle) { net.status = 'reconnect'; net.error = 'Pick the shared folder again on this computer.'; return; }
    const perm = await folderPermission(rec.handle, false);
    if (perm !== 'granted') { net.status = 'reconnect'; net.error = 'Freight Signal needs your OK to open the shared folder again.'; net.pendingHandle = rec.handle; return; }
    transport = new FolderTransport(rec.handle);
  }
  net.status = 'ok'; net.error = '';
}

/** Called once after the app has loaded its own data. */
export async function init() {
  const saved = await db.kvGet('network', null);
  net.cfg = { ...DEFAULT_CFG, ...(saved || {}) };
  seen = await db.kvGet('netseen', { c: {}, i: {}, o: {} });
  net.ready = true;
  await connect();
  if (transport) start();
  if (joined()) emit();            // nobody in a team: nothing changed on screen, so do not redraw the page
}

function start() {
  stop();
  refresh();
  timer = setInterval(() => { if (!document.hidden) refresh(); }, POLL_MS);
  document.addEventListener('visibilitychange', onVis);
  unsub = subscribe(() => { clearTimeout(laneTimer); laneTimer = setTimeout(() => { shareLaneData().catch(() => {}); }, 4000); });
}
const onVis = () => { if (!document.hidden && transport) refresh(); };
function stop() { clearInterval(timer); timer = null; clearTimeout(laneTimer); document.removeEventListener('visibilitychange', onVis); if (unsub) { unsub(); unsub = null; } }

/** Create a team. mode 'cloud' needs a signed-in cloud account; mode 'folder' needs a picked folder handle. */
export async function createTeam({ mode, name, handle }) {
  const label = oneLine(name, 60) || 'My team';
  if (mode === 'cloud') {
    const u = cloud.user(); if (!u) throw new Error('Sign in to your Freight Signal account first.');
    net.cfg = { ...DEFAULT_CFG, mode, name: label };
    const t = await cloudCreate({ name: label, me: { uid: u.uid, email: u.email, name: me().name || u.email } });
    net.cfg = { ...net.cfg, teamId: t.teamId, secret: t.secret };
  } else {
    if (!handle) throw new FolderError('Pick a folder first.');
    await db.put('handles', { key: 'team', handle });
    const t = new FolderTransport(handle); await t.prepare();
    const existing = await t.readTeam();
    if (existing && existing.teamId) throw new FolderError('That folder is already a team folder. Use "Join" instead.', 'exists');
    const inv = makeInvite();
    await t.writeTeam({ teamId: inv.teamId, name: label, createdAt: Date.now(), by: me().name });
    net.cfg = { ...DEFAULT_CFG, mode, name: label, teamId: inv.teamId, secret: '', localUid: newId() };
  }
  await kvSave(); await connect(); await announceSelf(); start(); emit();
  return { code: invite() };
}

/** Join: mode 'cloud' with a code, or mode 'folder' with the same picked folder. */
export async function joinTeam({ mode, code, handle }) {
  if (mode === 'cloud') {
    const u = cloud.user(); if (!u) throw new Error('Sign in to your Freight Signal account first.');
    const t = await cloudJoin({ code, me: { uid: u.uid, email: u.email, name: me().name || u.email } });
    net.cfg = { ...DEFAULT_CFG, mode, name: t.name, teamId: t.teamId, secret: t.secret };
  } else {
    if (!handle) throw new FolderError('Pick the shared folder first.');
    const t = new FolderTransport(handle); await t.prepare();
    const info = await t.readTeam();
    if (!info || !info.teamId) throw new FolderError('That folder is not a Freight Signal team folder yet. Ask the person who created the team which folder to use.', 'notteam');
    await db.put('handles', { key: 'team', handle });
    net.cfg = { ...DEFAULT_CFG, mode, name: info.name || 'Team', teamId: info.teamId, secret: '', localUid: newId() };
  }
  await kvSave(); await connect(); await announceSelf(); start(); emit();
}

export async function reconnect() {
  if (net.cfg.mode === 'folder') {
    let h = net.pendingHandle;
    if (!h || (await folderPermission(h, true)) !== 'granted') { h = await pickFolder(); if (!h) return; }
    await db.put('handles', { key: 'team', handle: h });
  }
  await connect(); if (transport) start(); emit();
}

export async function leave() {
  stop();
  if (transport && transport.kind === 'cloud') { try { await cloud.dbCall('DELETE', `network/teams/${net.cfg.teamId}/members/${myUid()}`); } catch { /* ignore */ } }
  transport = null;
  net.cfg = { ...DEFAULT_CFG }; Object.assign(net, { trucks: [], tstat: [], rescues: [], tips: [], marks: [], posts: [], members: [], lane: [], status: 'off', error: '' });
  seen = { c: {}, i: {}, o: {} };
  await kvSave(); await db.kvSet('netseen', seen); try { await db.del('handles', 'team'); } catch { /* ignore */ }
  emit();
}

/** The code to hand to a teammate (cloud teams). Folder teams just share the folder. */
export function invite() {
  if (net.cfg.mode !== 'cloud' || !net.cfg.teamId) return '';
  const raw = (net.cfg.teamId + net.cfg.secret).toUpperCase();
  return raw.match(/.{1,4}/g).join('-');
}

export async function saveCfg(patch) { net.cfg = { ...net.cfg, ...patch }; await kvSave(); emit(); }

async function announceSelf() {
  if (!transport) return;
  const m = me(); const now = Date.now();
  try { await transport.put('members', m.uid, { name: m.name, email: m.email, at: now, seen: now, ...(transport.kind === 'cloud' ? { code: net.cfg.secret } : {}) }); } catch { /* shows up as an error on the next refresh */ }
}

/* ------------------------------------------------------------------------------------------------ reading */
const vals = (rows, clean) => rows.map(r => clean({ id: r.key, ...r.value })).filter(Boolean);

export function refresh() {
  if (!transport) return Promise.resolve();
  if (polling) return polling;
  net.status = net.status === 'ok' ? 'ok' : 'loading';
  polling = (async () => {
    try {
      const t = transport;
      const [members, trucks, tstat, rescues, tips, marks, posts, lane] = await Promise.all([
        t.list('members'), t.list('trucks'), t.list('tstat'), t.list('rescues'), t.list('tips'), t.list('marks'), t.list('posts'),
        t.laneList(monthKey(Date.now() - (LANE_DEFAULTS.days + 31) * DAY)),
      ]);
      net.members = members.map(r => ({ uid: r.key, name: oneLine(r.value && r.value.name, 60), email: emailOf(r.value && r.value.email), at: Number(r.value && r.value.at) || 0, seen: Number(r.value && r.value.seen) || 0 }));
      net.trucks = vals(trucks, cleanTruck);
      net.tstat = tstat.map(r => cleanStat({ ...r.value, id: r.value && r.value.id ? r.value.id : r.key })).filter(Boolean);
      net.rescues = vals(rescues, cleanRescue);
      net.tips = vals(tips, cleanTip);
      net.marks = marks.map(r => cleanMark({ id: r.key, ...r.value })).filter(Boolean);
      net.posts = posts.map(r => cleanPost({ id: r.key, ...r.value })).filter(Boolean).sort((a, b) => b.at - a.at);
      net.lane = lane.flatMap(s => s.events.map(cleanEvent).filter(Boolean));
      net.status = 'ok'; net.error = ''; net.lastPoll = Date.now();
      housekeeping().catch(() => {});
    } catch (e) {
      net.status = e && e.code === 'permission' ? 'reconnect' : 'error';
      net.error = (e && e.message) || 'Could not reach the team.';
    } finally { polling = null; emit(); }
  })();
  return polling;
}

function cleanPost(p) {
  if (!p || !p.id || !p.uid || !CHANNELS.some(c => c.id === p.ch)) return null;
  const text = multiLine(p.text, 1200); const at = Number(p.at);
  if (!text || !Number.isFinite(at)) return null;
  return { id: String(p.id), ch: p.ch, uid: String(p.uid), by: oneLine(p.by, 60), at, text };
}

/* ------------------------------------------------------------------------------------------------ derived views */
export const resolvedTrucks = (now = Date.now()) => resolveTrucks(net.trucks, net.tstat, now);
export const searchBoard = (q, now = Date.now()) => searchTrucks(resolvedTrucks(now), q, { zipMap: state.zip, now });
export const openRescues = (now = Date.now()) => net.rescues.filter(r => rescueState(r, now) === 'open').sort((a, b) => b.at - a.at);
export const tipsFor = (rid) => net.tips.filter(t => t.rid === rid).sort((a, b) => a.at - b.at);
export const laneSummaries = (now = Date.now()) => summarizeLanes(net.lane, { now, uid: myUid() });
/** My open rescue for this posting's lane, if I already asked. */
export const rescueFor = (p) => net.rescues.find(r => r.uid === myUid() && rescueState(r, Date.now()) === 'open' && r.oCity === p.originCity && r.dCity === p.destCity && r.oState === String(p.originState || '').toUpperCase()) || null;

/** Numbers for the sidebar badges. */
export function badges(now = Date.now()) {
  const uid = myUid();
  const trucks = resolvedTrucks(now).filter(t => t.status === 'open' && t.uid !== uid && t.at > (net.cfg.lastTruckSeen || 0)).length;
  const rescue = openRescues(now).filter(r => r.uid !== uid && !net.tips.some(t => t.rid === r.id && t.uid === uid)).length;
  const seenAt = net.cfg.lastChannelSeen || {};
  const chat = net.posts.filter(p => p.uid !== uid && p.at > (seenAt[p.ch] || 0)).length;
  return { trucks, rescue, chat };
}
export const markSeen = async (what, ch) => {
  // Only when something new has arrived, otherwise opening a page would save, re-draw, and save again forever.
  if (what === 'trucks') { if (net.trucks.some(t => t.at > (net.cfg.lastTruckSeen || 0))) await saveCfg({ lastTruckSeen: Date.now() }); }
  else if (what === 'chat') { const seenAt = (net.cfg.lastChannelSeen || {})[ch] || 0; if (net.posts.some(p => p.ch === ch && p.at > seenAt)) await saveCfg({ lastChannelSeen: { ...(net.cfg.lastChannelSeen || {}), [ch]: Date.now() } }); }
};

/* ------------------------------------------------------------------------------------------------ actions */
const need = () => { if (!transport) throw new Error(net.error || 'Join a team first (Team page).'); return transport; };

export async function publishTruck(form) {
  const t = need(); const m = me();
  const r = buildTruck(form, m, { now: Date.now(), zipMap: state.zip, ttlHours: form.ttl === 'date' ? undefined : (Number(form.ttl) || net.cfg.ttlHours), id: newId() });
  if (!r.ok) return r;
  await t.put('trucks', r.truck.id, r.truck);
  net.trucks = [...net.trucks, r.truck]; emit();
  return r;
}

/** action: 'booked' | 'withdrawn' | 'renew'. Anyone may book or withdraw; only the publisher may renew. */
export async function truckAction(truckId, action, opts = {}) {
  const t = need(); const truck = net.trucks.find(x => x.id === truckId); if (!truck) throw new Error('That truck is gone.');
  const rec = statRecord(truck, action, me(), { now: Date.now(), ttl: opts.ttl || net.cfg.ttlHours });
  await t.put('tstat', truckId + '__' + rec.by.slice(0, 20), rec);
  net.tstat = [...net.tstat.filter(s => !(s.id === truckId && s.by === rec.by)), rec]; emit();
}

export async function askForHelp(members, { note = '', miles = 0 } = {}) {
  const t = need();
  const facts = rescueFacts(members, { outreach: state.outreach, inquiries: state.inquiries, now: Date.now() });
  const r = buildRescue(members, facts, me(), { note, miles, now: Date.now(), id: newId() });
  if (!r.ok) return r;
  const rescue = r.rescue;
  await t.put('rescues', rescue.id, rescue);
  net.rescues = [...net.rescues, rescue]; emit();
  return { ok: true, rescue };
}

export async function closeRescue(id, status = 'covered') {
  const t = need(); const r = net.rescues.find(x => x.id === id); if (!r || r.uid !== myUid()) return;
  const next = { ...r, status, closedAt: Date.now() };
  await t.put('rescues', id, next); net.rescues = net.rescues.map(x => (x.id === id ? next : x)); emit();
}

export async function addTip(rescue, input) {
  const t = need();
  const r = buildTip(input, rescue, me(), { now: Date.now(), id: newId() });
  if (!r.ok) return r;
  await t.put('tips', r.tip.id, r.tip); net.tips = [...net.tips, r.tip]; emit();
  return r;
}

export async function markTip(tip, helpful = true) {
  const t = need();
  if (helpful) { const mk = { id: tip.id, rid: tip.rid, by: myUid(), v: 'helpful', at: Date.now() }; await t.put('marks', tip.id, mk); net.marks = [...net.marks.filter(m => m.id !== tip.id), mk]; }
  else { await t.remove('marks', tip.id); net.marks = net.marks.filter(m => m.id !== tip.id); }
  emit();
}

export async function post(ch, text) {
  const t = need(); const body = multiLine(text, 1200);
  if (!body) return { ok: false, error: 'Type a message first.' };
  const m = me(); const p = { id: newId(), ch, uid: m.uid, by: m.name, at: Date.now(), text: body };
  if (!cleanPost(p)) return { ok: false, error: 'Pick a channel.' };
  await t.put('posts', p.id, p); net.posts = [p, ...net.posts]; emit();
  return { ok: true };
}
export async function deletePost(id) { const t = need(); await t.remove('posts', id); net.posts = net.posts.filter(p => p.id !== id); emit(); }

/* ------------------------------------------------------------------------------------------------ lane data (opt-in per team, on by default) */
/** Turn new covers, inquiries and outreach into anonymous lane events and write them to MY shard. Each fact is sent once. */
export async function shareLaneData() {
  if (!transport || !net.cfg.shareLane || !state.ready) return 0;
  const m = me(); if (!m.uid) return 0;
  const ctx = { postings: state.postings, carriers: state.carriers, settings: state.settings, zipMap: state.zip };
  const byShard = new Map(); const mark = [];
  const add = (kind, key, ev) => { if (!ev) { seen[kind][key] = 1; return; } const sk = shardKey(ev.t, m.uid); if (!byShard.has(sk)) byShard.set(sk, {}); byShard.get(sk)[ev.id] = ev; mark.push([kind, key]); };
  for (const e of state.coverLog) if (!seen.c[e.id]) add('c', e.id, coverEvent(e, m, ctx));
  for (const q of state.inquiries) if (!seen.i[q.id]) add('i', q.id, inquiryEvent(q, m, ctx));
  for (const o of state.outreach) { const k = o.key || o.id || ''; if (k && !seen.o[k]) add('o', k, outreachEvent(o, m, ctx)); }
  let sent = 0;
  for (const [sk, evs] of byShard) { await transport.lanePutMany(sk, evs); sent += Object.keys(evs).length; }
  for (const [kind, key] of mark) seen[kind][key] = 1;
  if (sent || mark.length) await db.kvSet('netseen', seen);
  if (sent) refresh();
  return sent;
}

/* ------------------------------------------------------------------------------------------------ cleanup */
/** Remove MY expired records so the team's space stays small. Only the writer of a record can delete it. */
async function housekeeping() {
  const t = transport; if (!t) return; const uid = myUid(); const now = Date.now();
  const rows = resolvedTrucks(now);
  for (const r of rows) if (r.uid === uid && prunable(r, now)) { await t.remove('trucks', r.id).catch(() => {}); await t.remove('tstat', r.id + '__' + String(uid).slice(0, 20)).catch(() => {}); }
  for (const r of net.rescues) if (r.uid === uid && rescuePrunable(r, now)) {
    await t.remove('rescues', r.id).catch(() => {});
    for (const tip of net.tips) if (tip.rid === r.id) { await t.remove('tips', tip.id).catch(() => {}); await t.remove('marks', tip.id).catch(() => {}); }
  }
  for (const p of net.posts) if (p.uid === uid && now - p.at > POST_TTL) await t.remove('posts', p.id).catch(() => {});
  await t.put('members', uid, { name: me().name, email: me().email, at: (net.members.find(x => x.uid === uid) || {}).at || now, seen: now, ...(t.kind === 'cloud' ? { code: net.cfg.secret } : {}) }).catch(() => {});
}

export const _test = { cleanPost, reset: () => { stop(); transport = null; } };
