import { h } from '../dom.js';
import { EQUIPMENT } from '../../core/defaults.js';

// Section navigation uses scrollIntoView (not #anchors) because the app's router owns the URL hash.
const go = (id) => { const el = document.getElementById('man-' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

const SECTIONS = [
  ['start', 'Quick start'], ['board', 'The board'], ['dat', 'DAT & rates'], ['outreach', 'Carriers & outreach'],
  ['outlook', 'Outlook'], ['tools', 'Weather & RateView'], ['safety', 'Backup & safety'], ['help', 'Troubleshooting'],
];

const sec = (id, n, title, ...body) => h('section', { class: 'man-sec', id: 'man-' + id }, h('h3', null, h('span', { class: 'num' }, n), title), ...body);
const steps = (...items) => h('ol', { class: 'man-steps' }, items.map(i => h('li', null, i)));
const note = (text, kind = '') => h('div', { class: 'man-note ' + kind }, text);
const card = (t, d) => h('div', { class: 'man-card' }, h('b', null, t), h('p', null, d));
const table = (head, rows) => h('table', { class: 'man-table' }, h('thead', null, h('tr', null, head.map(x => h('th', null, x)))), h('tbody', null, rows.map(r => h('tr', null, r.map(c => h('td', null, c))))));

export function render() {
  return h('div', { class: 'man' },
    h('div', { class: 'man-hero' },
      h('div', { class: 'eyebrow' }, 'User guide'),
      h('h2', null, 'Intelligent Carrier Sourcing Optimization System'),
      h('p', null, 'Freight Signal turns one load into nine DAT postings, sets your rates, drafts carrier outreach and tracks every reply. This guide takes about five minutes to read.')),
    h('nav', { class: 'man-toc', 'aria-label': 'Guide sections' }, SECTIONS.map(([id, t]) => h('button', { type: 'button', onclick: () => go(id) }, t))),

    sec('start', 1, 'Quick start',
      steps(
        h('span', null, h('b', null, 'Paste the load. '), 'On FREIGHT SIGNAL paste the TQL text and press ', h('b', null, 'Parse pasted loads'), '. Check the origin, destination, date, weight and equipment, then ', h('b', null, 'Add to board'), '.'),
        h('span', null, h('b', null, 'Build the matrix. '), 'Press ', h('b', null, 'Build 3×3 matrix'), '. Approve the nearby markets and you get one lane box holding all 9 postings.'),
        h('span', null, h('b', null, 'Set priority and rates. '), 'Pick Low / Medium / High for the box and type one Target rate for the whole load. It is the rate posted on DAT and the price used to judge carrier replies.'),
        h('span', null, h('b', null, 'Download the DAT file. '), 'Press ', h('b', null, 'Download CSV'), ' on the lane, or ', h('b', null, 'Download all'), ' at the top, and upload it in DAT’s bulk posting tool.'),
        h('span', null, h('b', null, 'Work the replies. '), 'Carrier e-mails land in Outlook, which drafts your answers from the same postings (section 5). Nothing is sent until you press Send.'))),

    sec('board', 2, 'The board: one box per lane',
      h('p', null, 'Every lane lives in its own box. The header names the lane (for example ', h('b', null, 'Modesto, CA → Reno, NV'), '), and everything below it belongs to that lane: the original posting plus its eight nearby alternates.'),
      h('div', { class: 'man-cards' },
        card('A-A = the original', 'Postings are labelled by grid position. A is the original origin / destination, B and C are the two nearby markets. A-B means original origin to the first nearby destination.'),
        card('Priority sets the target', 'Changing Priority on a box updates the whole box at once: Low = 5, Medium = 10, High = 15 outreach emails. The badge in the header shows the live number.'),
        card('Edit anywhere', 'Every cell is editable. Change a city and its ZIP follows automatically (origin and destination). If the city is not in the ZIP Map you get a warning instead of a guess.'),
        card('Tick, then act', 'Use the checkboxes to select postings across lanes, then Download selected or Delete selected from the bar that appears.')),
      h('p', null, h('b', null, 'Deleting. '), 'The red ✕ deletes one posting. ', h('b', null, 'Delete group'), ' deletes the whole box. Both ask first. Setting a load to Covered removes the whole group and counts a cover.')),

    sec('dat', 3, 'DAT, rates and CSV downloads',
      h('div', { class: 'man-note' }, h('b', null, 'One rate per load. '), 'The ', h('b', null, 'Target rate'), ' in the load details is the rate for every posting in the matrix. It is posted on DAT (switch “Post target rate on DAT” off to leave the CSV rate blank) and it is the price carrier e-mail replies are judged against.'),
      table(['I want to…', 'Do this'], [
        ['Post the same rate on all 9', 'Type it in Target rate in the load details and press Enter.'],
        ['Rate only some postings', 'Open a posting’s ⋯ menu, choose Edit every field and fill “DAT rate override”.'],
        ['Download everything', 'Download all in the top bar.'],
        ['Download one lane', 'Download CSV in the lane box.'],
        ['Download some postings', 'Tick them, then Download selected.'],
        ['Download one posting', 'CSV at the end of that row.']]),
      note('The file is DAT’s bulk template exactly: the same 24 columns in the same order, header row and one line per posting, with no instruction rows. If a required field is missing you are told which postings DAT would reject before the file downloads.'),
      h('h4', null, 'Equipment codes'),
      table(['Code', 'Equipment'], EQUIPMENT.map(e => [h('span', { class: 'kbd' }, e.code), e.label])),
      note('Team codes (VM, RM) are written to DAT exactly as shown. If DAT rejects one on your account, tell your admin which code your template expects and change it in the Eq column.')),

    sec('outreach', 4, 'Carriers and outreach',
      h('p', null, 'Add your approved carriers in the Carrier Database with their lanes. Outreach on a posting drafts e-mails to carriers that run the lane (exact lane first, then state to state, then origin state), up to your target number. Review the drafts on the Drafts tab and send them from your mail app.'),
      h('div', { class: 'man-cards' },
        card('Run lane scan', 'Drafts outreach for every Active posting whose Outreach cell is Yes.'),
        card('Inquiry Log', 'Every carrier conversation, its stage, the last rate and what was done. Approve a sender to add them to the Carrier Database.'),
        card('Drafts', 'Everything the app prepared. Download .eml files to open them in Outlook as unsent drafts.'))),

    sec('outlook', 5, 'Outlook connection',
      h('p', null, 'Outlook cannot see data inside a browser, so Freight Signal shares your postings with it through one folder on your computer. The Outlook macro reads that folder, drafts the replies, and tells the app what it did.'),
      steps(
        h('span', null, 'Create a folder called ', h('span', { class: 'kbd' }, 'FreightSignal'), ' inside Documents.'),
        h('span', null, 'In Freight Signal open ', h('b', null, 'System → Outlook connection'), ' and press ', h('b', null, 'Choose Outlook folder…'), '. Pick that folder and allow access.'),
        h('span', null, 'In Outlook press ', h('span', { class: 'kbd' }, 'Alt+F11'), ', open ', h('b', null, 'ThisOutlookSession'), ', paste the contents of ', h('span', { class: 'kbd' }, 'outlook/Outlook_v5_ThisOutlookSession.txt'), ', save and restart Outlook.'),
        h('span', null, 'Run ', h('span', { class: 'kbd' }, 'FS_Diagnostics'), ' (Alt+F8). It lists the files it found and how many postings it can read. The System page then shows ', h('b', null, 'Outlook connected'), '.')),
      table(['When…', 'Outlook does this'], [
        ['A carrier asks about a posting', 'Matches the lane, drafts a reply with the load details and “best all-in rate? ETA?” and opens it for you.'],
        ['They reply with a rate far from target', 'Saves a counter draft “How close can you come to $target?”.'],
        ['They reply within $200 of target', 'Saves “Please confirm your ETA to pickup” and flags the e-mail.'],
        ['They write again after that', 'Flags it FOLLOW-UP – MANUAL REVIEW and drafts nothing.']]),
      note('Postings sync within moments of any change, so an e-mail about a posting you added a minute ago is already matched. Covered or deleted postings stop matching. Keep Freight Signal open in Chrome or Edge while you work; Outlook’s activity appears in the Inquiry Log within a few seconds.')),

    sec('tools', 6, 'Weather and RateView',
      h('p', null, h('b', null, 'Wx'), ' on a posting opens Ventusky weather at the origin. The ', h('b', null, 'Ventusky weather'), ' button on HOME opens the general map. ', h('b', null, 'Rate'), ' opens DAT RateView for the lane and equipment in a new tab. The app never fetches or invents rates.')),

    sec('safety', 7, 'Backup and safety',
      h('div', { class: 'man-cards' },
        card('Everything stays local', 'Loads, carriers and logs live in this browser only. The Outlook folder holds postings, the rate window and your inbound blocklist.'),
        card('Nothing is sent for you', 'Every e-mail, by the app or by Outlook, is a draft until you press Send.'),
        card('Back up often', 'System → Download backup. Clearing browser data erases the board.'))),

    sec('help', 8, 'Troubleshooting',
      table(['Symptom', 'Fix'], [
        ['ZIP did not change after editing a city', 'The city or state is not in the ZIP Map (a warning appears). Check the spelling or type the ZIP yourself.'],
        ['DAT rejects a row', 'Use the warning shown at download: it names the posting and missing field. Dates must be m/d/yyyy.'],
        ['Outlook shows “waiting”', 'Press Write postings now, then run FS_Ping in Outlook. Make sure both use the same folder.'],
        ['Folder asks for permission again', 'Chrome forgets folder access after a restart. Press Reconnect folder once.'],
        ['No draft for a carrier e-mail', 'The lane (city names) must appear in the subject or body and match a posting on the board.']])));
}
