// Outlook bridge file formats. Pure functions (no DOM / no File System Access) so they can be unit-tested in Node.
//
// WHY A BRIDGE: Freight Signal keeps its data in the browser (IndexedDB), which Outlook VBA cannot see. The app therefore
// writes small, plain-text, tab-separated files into ONE folder you choose (default suggestion: Documents\FreightSignal),
// and the Outlook macro reads / appends to the same folder with ordinary VBA file I/O (no Excel, no ADODB, no COM add-ins).
//
//   freight-signal-postings.tsv        app  -> Outlook   every posting Outlook may match a carrier e-mail against
//   freight-signal-config.tsv          app  -> Outlook   rate window, rate proximity, blocklist (never committed to the repo)
//   freight-signal-inquiries.tsv       Outlook -> app    append-only event log (one line per Outlook action)
//   freight-signal-outlook-status.txt  Outlook -> app    heartbeat so the app can show "Outlook connected"
//
// All files are ASCII only (VBA's native file I/O is ANSI, so anything else would be corrupted).
// Tabs / newlines inside a field are escaped as \t and \n, backslash as \\ (the macro reverses this).

export const BRIDGE_VERSION = 'v1';
export const FILES = {
  postings: 'freight-signal-postings.tsv',
  config: 'freight-signal-config.tsv',
  inquiries: 'freight-signal-inquiries.tsv',
  status: 'freight-signal-outlook-status.txt',
};
export const POSTING_COLS = ['PostingId', 'Row', 'GroupId', 'Variant', 'OriginCity', 'OriginState', 'OriginZip', 'DestCity', 'DestState', 'DestZip',
  'Equipment', 'PickupDate', 'Weight', 'DatRate', 'TargetRate', 'Priority', 'Status', 'Outreach', 'InquiryCount', 'Details', 'Notes'];
export const INQUIRY_COLS = ['ConversationId', 'Timestamp', 'SenderEmail', 'Subject', 'PostingId', 'PostingRow', 'Stage', 'CarrierRate', 'TargetRate', 'Action', 'Flag', 'EventCount'];

/** ASCII-safe single field: accents folded, other non-ASCII dropped, control chars escaped. */
export function encodeField(v) {
  let s = String(v ?? '');
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ');
  s = s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r\n|\r|\n/g, '\\n');
  return s.replace(/[^\x20-\x7e]/g, '');
}

export function decodeField(s) {
  let out = ''; const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\' && i + 1 < t.length) { const n = t[++i]; out += n === 't' ? '\t' : n === 'n' ? '\n' : n; } else out += c;
  }
  return out;
}

const line = (cells) => cells.map(encodeField).join('\t');

/** Postings feed. `now` only goes in the header line. */
export function postingsFile(postings, now = new Date()) {
  const rows = postings
    .filter(p => String(p.status ?? 'Active').toLowerCase() !== 'covered')
    .map((p) => line([p.id, postings.indexOf(p) + 2, p.groupId, p.variant, p.originCity, p.originState, p.originZip, p.destCity, p.destState, p.destZip,
      p.equip, p.pickupEarliest, p.weight, p.datRate, p.targetRate, p.priority, p.status || 'Active', p.outreach, p.inquiryCount, p.details, p.notes]));
  return ['#FREIGHT-SIGNAL-BRIDGE', BRIDGE_VERSION, now.toISOString(), rows.length].join('\t') + '\r\n'
    + POSTING_COLS.join('\t') + '\r\n' + rows.join('\r\n') + (rows.length ? '\r\n' : '');
}

/** Same content as postingsFile but without the timestamp: used to decide whether anything actually changed. */
export const postingsFingerprint = (postings) => postingsFile(postings, new Date(0));

export function configFile(settings) {
  const out = [
    ['rateProximity', settings.rateProximity], ['minRate', settings.minReasonableRate], ['maxRate', settings.maxReasonableRate],
    ['recogniseCommaRates', settings.recogniseCommaRates ? 1 : 0],
  ];
  for (const b of settings.inboundBlocklist || []) out.push(['inboundBlock', b]);
  return ['#FREIGHT-SIGNAL-CONFIG', BRIDGE_VERSION].join('\t') + '\r\n' + out.map(line).join('\r\n') + '\r\n';
}

/** Header + (no events yet). Outlook appends below this. */
export const inquiriesHeader = () => INQUIRY_COLS.join('\t') + '\r\n';

const num = (v) => { const n = Number(String(v ?? '').replace(/[$,]/g, '')); return Number.isFinite(n) ? n : 0; };

/**
 * Fold the append-only Outlook event log into one record per conversation: first line gives dateCounted,
 * the LAST line wins for everything else. Malformed / partial lines (e.g. Outlook mid-write) are skipped.
 */
export function foldInquiryEvents(text) {
  const byId = new Map();
  const lines = String(text ?? '').split(/\r?\n/);
  for (const ln of lines) {
    if (!ln || ln.startsWith('ConversationId') || ln.startsWith('#')) continue;
    const c = ln.split('\t');
    if (c.length < INQUIRY_COLS.length || !c[0].trim()) continue;
    const r = Object.fromEntries(INQUIRY_COLS.map((k, i) => [k, decodeField(c[i])]));
    const prev = byId.get(r.ConversationId);
    byId.set(r.ConversationId, { ...r, firstTimestamp: prev ? prev.firstTimestamp : r.Timestamp });
  }
  return [...byId.values()].map(r => ({
    conversationId: r.ConversationId, dateCounted: toIso(r.firstTimestamp), lastEventAt: toIso(r.Timestamp), senderEmail: r.SenderEmail, subject: r.Subject,
    postingId: r.PostingId, postingRow: num(r.PostingRow), stage: String(r.Stage).toUpperCase(), lastCarrierRate: r.CarrierRate === '' ? '' : num(r.CarrierRate),
    targetRate: num(r.TargetRate), lastAction: r.Action, flag: r.Flag, eventCount: num(r.EventCount) || 1,
  }));
}

/** Outlook writes "yyyy-mm-dd hh:nn:ss" local time; accept ISO as well. */
function toIso(s) {
  const t = String(s ?? '').trim(); if (!t) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d/.test(t) ? t.replace(' ', 'T') : t);
  return isNaN(d) ? t : d.toISOString();
}

/** Parse freight-signal-outlook-status.txt (key=value lines). */
export function parseStatus(text) {
  const o = {};
  for (const ln of String(text ?? '').split(/\r?\n/)) { const i = ln.indexOf('='); if (i > 0) o[ln.slice(0, i).trim()] = ln.slice(i + 1).trim(); }
  return { lastSeen: toIso(o.lastSeen), postingsRead: num(o.postingsRead), lastEvent: o.lastEvent || '', macroVersion: o.macroVersion || '', folder: o.folder || '' };
}

/**
 * Turn folded Outlook records into app changes.
 * Returns { creates:[inquiry], patches:[{id, patch}], postingBumps:[{id, count}] } without touching anything.
 */
export function planInquirySync(records, inquiries, postings) {
  const creates = [], patches = [], postingBumps = [];
  const byConv = new Map(inquiries.map(q => [String(q.conversationId).toLowerCase(), q]));
  const bumped = new Map();
  for (const r of records) {
    const q = byConv.get(r.conversationId.toLowerCase());
    const posting = postings.find(p => p.id === r.postingId) || null;
    if (!q) {
      const base = posting ? safeInt(posting.inquiryCount) + (bumped.get(posting.id) || 0) : 0;
      const count = posting ? base + 1 : '';
      if (posting) bumped.set(posting.id, (bumped.get(posting.id) || 0) + 1);
      creates.push({
        conversationId: r.conversationId, dateCounted: r.dateCounted, senderEmail: r.senderEmail, subject: r.subject,
        postingId: r.postingId, postingRow: r.postingRow,
        originCity: posting ? posting.originCity : '', originState: posting ? posting.originState : '',
        destCity: posting ? posting.destCity : '', destState: posting ? posting.destState : '',
        countAfterInquiry: count, targetRate: r.targetRate, status: 'INQUIRY', stage: r.stage,
        rateResponseSent: r.stage === 'RATE_RESPONSE_SENT' ? 'YES' : 'NO', lastCarrierRate: r.lastCarrierRate, lastAction: r.lastAction,
        flag: r.flag, eventCount: r.eventCount, approved: 'No', dateAdded: '', source: 'outlook',
      });
      continue;
    }
    if (safeInt(q.eventCount) >= r.eventCount && q.stage === r.stage && q.lastAction === r.lastAction) continue; // already applied
    patches.push({
      id: q.id,
      patch: { stage: r.stage, lastAction: r.lastAction, flag: r.flag, eventCount: r.eventCount, lastCarrierRate: r.lastCarrierRate,
        rateResponseSent: r.stage === 'RATE_RESPONSE_SENT' ? 'YES' : q.rateResponseSent },
    });
  }
  for (const [id, n] of bumped) { const p = postings.find(x => x.id === id); postingBumps.push({ id, count: safeInt(p.inquiryCount) + n }); }
  return { creates, patches, postingBumps };
}
const safeInt = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
