// Team Network storage, cloud flavour: one branch of the Firebase Realtime Database per team, network/teams/<teamId>/.
// Access is decided by database.rules.json: you are in the team when your sign-in has a record under members/. You get that record by
// presenting the team's secret (the second half of the invite code); the secret is checked by the database, not by this app.
//
//   network/teams/<teamId>/
//     meta        { name, createdAt, by }
//     secret      the invite secret (readable only by members)
//     members/<uid>         { name, email, at, seen, code }
//     trucks/<id>           a published truck            tstat/<truckId>   its life-cycle record
//     rescues/<id>          a rescue request             tips/<id>   answers      marks/<tipId>   "this helped" (owner only)
//     posts/<id>            channel messages
//     lane/<yyyymm__uid>/ev/<eventId>   lane events (one shard per person per month: one writer per shard)
//
// The functions take `call` (cloud.dbCall by default) so tests can drive them against an in-memory database.

import * as cloud from './cloud.js';
import { makeInvite, parseInvite } from '../core/netcommon.js';

export class TeamError extends Error { constructor(message, code = 'team') { super(message); this.code = code; } }

const refused = (e) => (e && e.code === 'rules' ? new TeamError('The team area refused access. Check the invite code, and make sure the updated database.rules.json (it now includes the Team Network rules) is published in Firebase.', 'refused') : e);

export class CloudTransport {
  constructor(teamId, call = cloud.dbCall) { this.kind = 'cloud'; this.teamId = teamId; this.call = call; this.base = `network/teams/${teamId}`; }
  async #do(method, path, body, query) { try { return await this.call(method, `${this.base}/${path}`, body, query); } catch (e) { throw refused(e); } }
  async list(col) { const v = await this.#do('GET', col); return v && typeof v === 'object' ? Object.entries(v).map(([key, value]) => ({ key, value })) : []; }
  async put(col, key, value) { await this.#do('PUT', `${col}/${key}`, value); }
  async remove(col, key) { await this.#do('DELETE', `${col}/${key}`); }
  async meta() { return this.#do('GET', 'meta'); }
  /** Lane shards from `sinceMonth` (yyyymm) on, as [{ shard, events: [event...] }]. */
  async laneList(sinceMonth) {
    const q = `orderBy=${encodeURIComponent('"$key"')}&startAt=${encodeURIComponent(`"${sinceMonth}"`)}`;
    const v = await this.#do('GET', 'lane', undefined, q);
    return v && typeof v === 'object' ? Object.entries(v).map(([shard, node]) => ({ shard, events: Object.entries((node && node.ev) || {}).map(([id, e]) => ({ ...e, id: e && e.id ? e.id : id })) })) : [];
  }
  /** Write events (an object id -> event) into one of MY shards. One request, however many events. */
  async lanePutMany(shard, events) { await this.#do('PATCH', `lane/${shard}/ev`, events); }
}

/** Start a new team. Returns { teamId, secret, code, name }. */
export async function createTeam({ name, me, call = cloud.dbCall, invite = makeInvite() }) {
  const base = `network/teams/${invite.teamId}`;
  const now = Date.now();
  try {
    await call('PATCH', base, { meta: { name, createdAt: now, by: me.uid }, secret: invite.secret, [`members/${me.uid}`]: { name: me.name, email: me.email, at: now, seen: now, code: invite.secret } });
  } catch (e) { throw refused(e); }
  return { ...invite, name };
}

/** Join with an invite code. Returns { teamId, secret, code, name }. */
export async function joinTeam({ code, me, call = cloud.dbCall }) {
  const inv = parseInvite(code);
  if (!inv) throw new TeamError('That is not a team code. It looks like ABCD-EFGH-JKLM-NPQR-STUV.', 'badcode');
  const base = `network/teams/${inv.teamId}`;
  const now = Date.now();
  try { await call('PUT', `${base}/members/${me.uid}`, { name: me.name, email: me.email, at: now, seen: now, code: inv.secret }); }
  catch (e) { if (e && e.code === 'rules') throw new TeamError('That team code was not accepted. Check it with the person who invited you.', 'badcode'); throw e; }
  let meta = null; try { meta = await call('GET', `${base}/meta`); } catch { /* the name is cosmetic */ }
  return { ...inv, name: (meta && meta.name) || 'Team' };
}
