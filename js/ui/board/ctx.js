// Shared helpers for the board: the analysis context and the per-load advice inputs.
import { state } from '../../store/state.js';
import { carrierDepth } from '../../core/worklist.js';
import { rankCarriers, outreachCount } from '../../core/ranking.js';

export const boardCtx = (now = new Date()) => ({
  postings: state.postings, inquiries: state.inquiries, drafts: state.drafts, coverLog: state.coverLog, carriers: state.carriers,
  zip: state.zip, settings: state.settings, now, weather: state.weather, carrierRev: state.carrierRev, outreach: state.outreach,
});

/** { depth, unusedDepth, wave } for one load: how many carriers fit, how many of those have not been contacted about it, how big a wave is. */
export function adviceExtra(box, ctx) {
  const head = box.head;
  const ids = new Set(box.members.map(m => m.id));
  const contacted = new Set(state.outreach.filter(o => ids.has(o.postingId)).map(o => String(o.email || '').toLowerCase()));
  for (const d of state.drafts) if (ids.has(d.postingId) && d.to) contacted.add(String(d.to).toLowerCase());
  const depth = state.carriers.length ? carrierDepth(head, ctx) : 0;
  const unusedDepth = state.carriers.length ? rankCarriers(head, state.carriers, { zip: state.zip, settings: state.settings, coverLog: state.coverLog, inquiries: state.inquiries, exclude: contacted }).filter(r => 'ABCD'.includes(r.tier)).length : 0;
  return { depth, unusedDepth, wave: outreachCount(head, state.settings, state.zip), now: ctx.now };
}
