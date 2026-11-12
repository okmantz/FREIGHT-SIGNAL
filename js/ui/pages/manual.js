import { h } from '../dom.js';

const STEPS = [
  ['A', 'Paste the load', 'On FREIGHT SIGNAL, paste the TQL load text (one or many loads) and press Parse pasted loads. Review the parsed origin, destination, date, weight and equipment, fix anything flagged, then Add to board. The original text is kept with the load.'],
  ['B', 'Build the 3 x 3 matrix', 'Press Matrix on an original row. The app picks two nearby origin markets and two nearby destination markets from the ZIP Map (20–60 miles first, then wider if needed), shows them for approval, and on confirm creates the original plus 8 alternates (9 postings).'],
  ['C', 'Set priority and check the market', 'Priority (Low / Medium / High) sets the outreach target for the whole group. Rate opens DAT RateView for the lane in a new tab; Wx opens weather for the origin.'],
  ['D', 'Post on DAT', 'Open the DAT tab. Copy all rows (or one row) and paste them into your DAT bulk-posting template, or download the CSV. Covered loads are never included.'],
  ['E', 'Carrier outreach', 'Outreach on a row drafts e-mails to carriers in your Carrier Database that run the lane (exact lane, then state-to-state, then origin state). Drafts appear on the Drafts tab. Download .eml files to open them in Outlook as unsent drafts, or use Open in mail app. You press Send.'],
  ['F', 'Handle carrier replies', 'Inquiry Log → Process carrier e-mail: paste the carrier\'s message. The app matches it to a posting, logs it, and drafts your reply (ask for a rate/ETA, or negotiate toward the target rate). Repeat messages are flagged for manual review.'],
  ['G', 'Cover the load', 'Set Status to Covered. The whole group is removed from the board and the covers counters on HOME go up.'],
  ['H', 'Approve carriers', 'In the Inquiry Log set Approved = Yes on a sender to add (or update) them in the Carrier Database.'],
];

export function render() {
  return h('div', { class: 'manual' },
    h('div', { class: 'pagehead' }, h('h2', null, 'User Manual'), h('p', null, 'FREIGHT SIGNAL by O.K. Mantz')),
    h('div', { class: 'banner' }, 'This manual was written from the macros and screenshots. The original workbook\'s manual text below section D was not provided.'),
    h('h3', null, 'Workflow'),
    STEPS.map(([n, t, d]) => h('div', { class: 'step' }, h('div', { class: 'n' }, n), h('div', { class: 't' }, h('b', null, t), d))),
    h('h3', null, 'Rules the app follows'),
    h('ul', null,
      h('li', null, 'Nothing is ever sent automatically. Every e-mail is a draft you review and send yourself.'),
      h('li', null, 'Markets come only from the ZIP Map. If a city cannot be matched, the app tells you and does not guess.'),
      h('li', null, 'RateView and weather are links that open in a new tab. The app does not fetch or invent rates.'),
      h('li', null, 'Everything is stored in this browser (IndexedDB). Use System → Backup regularly: clearing browser data deletes it.')),
    h('h3', null, 'Priority targets'),
    h('p', null, 'Low = 5, Medium = 10, High = 15 outreach drafts per group by default. Change in System.'));
}
