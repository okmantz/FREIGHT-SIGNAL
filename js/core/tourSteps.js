// The first-login "60-second tour": plain data, so the wording can be edited (and tested) without touching the UI code.
//   route   the page (hash) to show for the step
//   target  CSS selectors tried in order; the first one found is highlighted. None found (e.g. the board is still empty) = a centred card.
//   icon    a name from ui/icons.js
export const TOUR_VERSION = 1;

export const TOUR_STEPS = [
  { id: 'welcome', route: '#/home', target: [], icon: 'sparkle', title: 'Welcome to Freight Signal',
    body: 'A 60-second tour of the whole workflow: paste a load, post it on DAT, get carriers working it, and log the cover. Nothing is ever sent for you; every message is a draft you review.',
    next: 'Start the tour' },
  { id: 'outlook', route: '#/system', target: ['details[data-sect="outlook"]', '#nav a[data-tab="system"]'], icon: 'mail', title: '1. Connect Outlook (one time)',
    body: 'Open System, then Connect to Outlook. Choose your Documents\\FreightSignal folder and paste the macro into Outlook once. After that, carrier replies land in the app and drafts save straight to your Outlook Drafts. It takes about two minutes.' },
  { id: 'paste', route: '#/board', target: ['.pastepanel', '#nav a[data-tab="board"]'], icon: 'board', title: '2. Paste your first load',
    body: 'On the Freight Signal page, paste your TQL load text into this box. It is read as you paste. Fix anything highlighted, add a target rate if you know it, then press Add (or Ctrl+Enter).' },
  { id: 'matrix', route: '#/board', target: ['.lanebox', '.pastepanel'], icon: 'grid', title: '3. One load becomes nine postings',
    body: 'Your original (A-A) plus 8 nearby origin and destination pairings are built for you. Type one Target rate for the whole load. To post only some of them with a rate, say 2 of the 9, type a DAT rate on those rows and leave the others blank.' },
  { id: 'post', route: '#/board', target: ['[data-act="csv-all"]', '.boardbar', '.pastepanel'], icon: 'download', title: '4. Post it on DAT',
    body: 'Press Download all (or a load\'s Download CSV) and upload the file in DAT\'s bulk posting tool. Downloading also starts the load\'s clock, so the guided notes know how long it has been live. DAT RateView on each load opens the market rate.' },
  { id: 'guide', route: '#/board', target: ['.lanebox .guide', '.lanebox', '.pastepanel'], icon: 'bulb', title: '5. Follow the Next step panel',
    body: 'Every load has its own guided notes. In the first 30 minutes: hold. At 30 minutes: refresh. At one hour with no inquiries something is wrong, and it lists exactly what to check for that load. After that it escalates: reprice, second wave, new cities, calls.' },
  { id: 'carriers', route: '#/carriers', target: ['#view .toolbar', '#nav a[data-tab="carriers"]'], icon: 'carriers', title: '6. Build your carrier list',
    body: 'Import your carriers here once. Freight Signal ranks them by lane and drafts outreach to the best matches with the Carrier outreach button on each load. Carriers who cover for you float to the top over time.' },
  { id: 'inquiry', route: '#/inquiry', target: ['#view .toolbar', '#nav a[data-tab="inquiry"]'], icon: 'inquiry', title: '7. Work the replies',
    body: 'When a carrier replies, paste it into Process carrier e-mail (Outlook does this by itself once connected). It is logged, a reply is drafted, and good carriers can be approved into your Carrier Database.' },
  { id: 'cover', route: '#/board', target: ['[data-act="mark-covered"]', '#pace', '.pastepanel'], icon: 'check', title: '8. Mark it covered',
    body: 'When a carrier books it, press Mark covered and pick the posting and carrier. It goes to the Cover Log and counts toward your weekly pace (top right). The week runs Monday to Sunday, and reaching your weekly floor earns a little celebration.',
    next: 'Start working' },
];
