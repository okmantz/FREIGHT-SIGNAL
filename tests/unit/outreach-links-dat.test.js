import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPosting, targetForPriority, setGroupPriority, coverPosting, initializeLoadControls } from '../../js/core/model.js';
import { DEFAULT_SETTINGS, CARRIER_KEYS } from '../../js/core/defaults.js';
import { planExcelOutreach, isBlockedExcel, isBlockedOutlook, buildExcelSubject, planOutlookScan } from '../../js/core/outreach.js';
import { rateViewUrl, ventuskyUrl } from '../../js/core/links.js';
import { parseDelimited } from '../../js/core/csv.js';

const P = (o = {}) => { const p = blankPosting({ originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', details: 'Pickup: Chicago, IL 60601\nDelivery: Atlanta, GA 30303\nWeight: 38000', pickupEarliest: '11/16/2026', pickupLatest: '11/16/2026', weight: '38000', ...o }); initializeLoadControls(p); return p; };
const C = (o) => ({ id: o.email, ...Object.fromEntries(CARRIER_KEYS.map(k => [k, ''])), status: 'Active', ...o });

test('RateView URL matches the macro format exactly', () => {
  assert.equal(rateViewUrl(P()).url, 'https://iq.dat.com/rateview/chicago-il~atlanta-ga~Van');
  assert.equal(rateViewUrl(P({ originCity: 'St. Louis', originState: 'MO', equip: 'R' })).url, 'https://iq.dat.com/rateview/st.%20louis-mo~atlanta-ga~Reefer');
  assert.equal(rateViewUrl(P({ originCity: 'Winston-Salem', originState: 'NC', equip: 'F' })).url, 'https://iq.dat.com/rateview/winston_salem-nc~atlanta-ga~Flatbed');
  assert.equal(rateViewUrl(P({ destCity: '' })).ok, false);
});
test('weather link: fallback and coordinate forms', () => {
  assert.equal(ventuskyUrl(NaN, NaN), 'https://www.ventusky.com/');
  assert.ok(ventuskyUrl(41.8, -87.6).startsWith('https://www.ventusky.com/?p=41.800;-87.600'));
});
test('priority -> target mapping and group propagation', () => {
  assert.deepEqual(targetForPriority('High'), { priority: 'High', target: 15 });
  assert.deepEqual(targetForPriority('Medium'), { priority: 'Medium', target: 10 });
  assert.deepEqual(targetForPriority('anything'), { priority: 'Low', target: 5 });
  const rows = [P({ groupId: 'G1' }), P({ groupId: 'G1' }), P({ groupId: 'G2' })];
  setGroupPriority(rows, 'G1', 'High');
  assert.deepEqual(rows.map(r => r.priority), ['High', 'High', 'Low']);
});
test('covering a posting removes its whole group only', () => {
  const rows = [P({ groupId: 'G1' }), P({ groupId: 'G1' }), P({ groupId: 'G2' }), P()];
  const { remaining, removed } = coverPosting(rows, rows[0].id);
  assert.equal(removed.length, 2); assert.equal(remaining.length, 2);
  assert.equal(coverPosting(rows, rows[3].id).removed.length, 1);
});
test('Excel blocklist: suffix and exact; Outlook blocklist: substring', () => {
  assert.equal(isBlockedExcel('x@blocked.example', ['@blocked.example']), true);
  assert.equal(isBlockedExcel('x@notblocked.example', ['@blocked.example']), false);
  assert.equal(isBlockedExcel('a@b.example', ['a@b.example']), true);
  assert.equal(isBlockedOutlook('someone@mail.blocked.example', ['blocked.example']), true);
});
test('Excel outreach: tiered selection, subject, body, blocklist, never sends', () => {
  const carriers = [
    C({ email: 'exact@x.example', originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', carrierName: 'Exact' }),
    C({ email: 'state@x.example', originCity: 'Joliet', originState: 'IL', destCity: 'Macon', destState: 'GA', carrierName: 'State' }),
    C({ email: 'blocked@bad.example', originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA' }),
    C({ email: 'inactive@x.example', originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA', status: 'Inactive' }),
    C({ email: 'other@x.example', originCity: 'Miami', originState: 'FL', destCity: 'Atlanta', destState: 'GA' }),
  ];
  const res = planExcelOutreach(P(), carriers, { ...DEFAULT_SETTINGS, outreachBlocklist: ['@bad.example'] });
  const to = res.drafts.map(d => d.to);
  assert.ok(to.includes('exact@x.example')); assert.ok(to.includes('state@x.example'));
  assert.ok(!to.includes('blocked@bad.example')); assert.ok(!to.includes('other@x.example'));
  assert.equal(buildExcelSubject(P()), 'Load available: Chicago, IL to Atlanta,GA'); // exact macro spacing
  assert.ok(res.drafts[0].body.includes('We have the following load available:'));
  assert.ok(res.drafts.every(d => d.tier));
});
test('Excel outreach: missing state is reported, not guessed', () => {
  const r = planExcelOutreach(P({ originState: '' }), [], DEFAULT_SETTINGS);
  assert.equal(r.drafts.length, 0); assert.match(r.detail, /origin state/i);
});
test('Outlook scan: respects max per load and never duplicates (load, email)', () => {
  const carriers = Array.from({ length: 8 }, (_, i) => C({ email: `c${i}@x.example`, originCity: 'Chicago', originState: 'IL', destCity: 'Atlanta', destState: 'GA' }));
  const p = P({ outreach: 'Yes' });
  const s1 = planOutlookScan([p], carriers, [], { ...DEFAULT_SETTINGS, maxCarriersPerLoad: 3 });
  assert.equal(s1.drafts.length, 3);
  const s2 = planOutlookScan([p], carriers, s1.logEntries, { ...DEFAULT_SETTINGS, maxCarriersPerLoad: 3 });
  const first = new Set(s1.drafts.map(d => d.to));
  assert.ok(s2.drafts.every(d => !first.has(d.to)));
  assert.ok(s1.drafts[0].subject.startsWith('Truck Available?'));
});
