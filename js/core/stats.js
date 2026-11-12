// Dashboard metrics. The worksheet formulas behind the HOME tiles and the Inquiry Log "PERFORMANCE DASHBOARD"
// were not included in the source files, so each definition below is INFERRED from the screenshot values
// (documented with the numbers it reproduces in docs/OPEN-QUESTIONS.md) and is easy to correct here.

import { safeNumeric, todayKey } from './util.js';
import { activeGroups } from './model.js';

const label = (p) => `${p.originCity},${p.originState}->${p.destCity}, ${p.destState}`; // exact spacing seen in screenshot

export function homeMetrics(postings, inquiries, counters, now = new Date()) {
  const today = todayKey(now);
  const coversToday = counters && counters.coversTodayDate === today ? counters.coversToday : 0;
  return {
    activeLoads: activeGroups(postings),
    activePostingRows: postings.filter(p => String(p.status).toLowerCase() === 'active').length,
    coversToday,
    totalInquiries: (inquiries || []).length,
    lifetimeCovers: counters ? counters.lifetimeCovers || 0 : 0,
  };
}

export function performanceDashboard(postings, inquiries) {
  const originals = postings.filter(p => String(p.variant).toLowerCase() === 'original').length;
  const variations = postings.filter(p => String(p.variant).toLowerCase().startsWith('nearby ')).length;
  const rows = postings.length;
  const totalInq = (inquiries || []).length;
  const unique = new Set((inquiries || []).map(q => String(q.senderEmail ?? '').trim().toLowerCase()).filter(Boolean)).size;
  const ranked = postings
    .map(p => ({ p, n: safeNumeric(p.inquiryCount) }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const best = ranked[0];
  const top5 = ranked.slice(0, 5);
  const top5Sum = top5.reduce((a, x) => a + x.n, 0);
  return {
    loadsProcessed: originals,
    variations,
    totalRows: rows,
    carrierInquiries: totalInq,
    uniqueCarriers: unique,
    avgInquiriesPerLoad: originals ? totalInq / originals : 0,
    avgInquiriesPerPosting: rows ? totalInq / rows : 0,
    bestPosting: best ? label(best.p) : '',
    bestPostingInquiries: best ? best.n : 0,
    top5Engagement: totalInq ? top5Sum / totalInq : 0,
    topMarkets: top5.map(x => ({ label: label(x.p), inquiries: x.n })),
  };
}
