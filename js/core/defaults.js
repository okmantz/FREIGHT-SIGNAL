// Constants mirrored from the VBA modules. Every value below has a source comment.
// Anything the user can change at runtime lives in Settings (System Control Center) and
// overrides these defaults. Defaults reproduce the macros exactly.

export const DEFAULT_SETTINGS = {
  // Excel v3: LOW_TARGET / MEDIUM_TARGET / HIGH_TARGET
  lowTarget: 5,
  mediumTarget: 10,
  highTarget: 15,
  // Excel v3: MATRIX_ALTERNATES (3 x 3 grid = original + 8)
  matrixAlternates: 8,
  // Excel v3 SelectTwoAlternates: progressive fallback limits [min, max] in miles.
  distanceTiers: [[20, 60], [0, 100], [0, 200], [0, 99999]],
  // Outlook v3: RATE_PROXIMITY, MAX_CARRIERS_PER_LOAD, REQUIRE_BOTH_STATES
  rateProximity: 200,
  maxCarriersPerLoad: 5,
  requireBothStates: false,
  // Outlook v3 IsReasonableCarrierRate: 250..20000
  // Outlook v3's rate regex cannot match comma-formatted rates ($1,650 / $12,000). false = exact macro behaviour.
  recogniseCommaRates: false,
  // DANGER ZONE (v8): let the Outlook macro SEND instead of saving drafts. Both default OFF. Inbound = replies to carriers; outbound = new outreach.
  autoSendInbound: false,
  // v16 safe-send policy (see js/core/sendpolicy.js). sendMode: off | shadow | routine | full. '' = follow the old autoSendInbound switch.
  sendMode: '',
  // v18: wording you taught Freight Signal (see js/core/replylearn.js). Only ever upgrades a message the rules could not understand.
  replyLessons: [],
  sendMaxPerConversation: 3,
  sendMaxPerDay: 60,
  sendDelayMinutes: 3,
  sendMinLaneScore: 220,
  sendWorkHoursOnly: false,
  sendWorkStart: 7,
  sendWorkEnd: 19,
  sendMaxChars: 600,
  sendDuplicateMinutes: 120,
  // v16 coverage: suggest a target rate for a new load from your own results; learn the matrix from qualified responses; hard-lane states (empty = built-in list)
  autoSuggestTarget: true,
  autoEscalateHard: true, rescueWaveSize: 8, rescueMinHoursBetween: 12, rescueMaxPerLoad: 2, rescueMaxHours: 72,
  adaptiveMatrix: true,
  thinOutboundStates: [],
  autoSendOutbound: false,
  maxAutoSendsPerHour: 20,
  minReasonableRate: 250,
  maxReasonableRate: 20000,
  // Blocklists. Excel DraftCarrierOutreach uses IsBlockedSender (suffix "@domain" / exact address).
  // Outlook InboxItems_ItemAdd uses a "contains" test. They are separate lists in the macros.
  // The shipped defaults are EMPTY on purpose: customer domains are company-confidential and must
  // not be committed to a repository. Enter them in Settings (stored only in this browser).
  outreachBlocklist: [],
  inboundBlocklist: [],
  // Split pasted TQL text into loads at lines matching this regex (default: "N pick - M drop").
  loadSeparatorRegex: '^\\s*\\d+\\s*pick\\s*[-–]\\s*\\d+\\s*drop',
  // ------------------------------------------------------------------------------------------------------------
  // FREIGHT SIGNAL 2.0 settings. Nested objects (templates, strategies, ui) are merged with their defaults by the
  // accessor functions in ladder.js / lanes.js, so a settings record saved by an older version keeps working.
  // ------------------------------------------------------------------------------------------------------------
  // Counter ladder, as a PERCENT of the target rate (a flat $200 is 22% of a $900 load but 3% of a $6,000 load).
  //   carrier rate <= target + ladderBookPct %  -> "book it" script (confirm ETA)
  //   carrier rate <= target + ladderSplitPct % -> split-the-difference counter (rounded to ladderRound dollars)
  //   anything higher                           -> target counter ("How close can you come to $target?")
  ladderBookPct: 3,
  ladderSplitPct: 8,
  ladderRound: 5,
  templates: null,                 // null = DEFAULT_TEMPLATES (ladder.js). Editable in System -> Counter ladder & e-mail wording.
  // Lane classes (by lane miles between origin and destination ZIP centres, x1.15 road factor) and the posting strategy per class.
  laneLocalMax: 150,
  laneRegionalMax: 600,
  strategies: null,                // null = DEFAULT_STRATEGIES (lanes.js)
  // 3 x 3 matrix: 'auto' builds straight away unless the plan looks odd; 'ask' always shows the preview first.
  matrixMode: 'auto',
  matrixPins: {},                  // "san leandro|CA" -> [{city,state},{city,state}] : your own preferred alternates for a market
  // Ranked outreach
  carrierRadiusMiles: 75,
  // Auto-expiry: postings whose pickup date has passed are retired (logged in the Cover Log as "Expired", restorable).
  autoExpire: true,
  expireGraceDays: 0,
  // DAT "Contact Method" for new loads: 'Email' (default) or 'Phone'.
  defaultContact: 'Email',
  // Save outreach drafts straight into Outlook's Drafts folder when the Outlook folder is connected.
  draftsToOutlook: true,
  // Brokers you post for. Each gets its own board tab; "All" shows everything.
  brokers: [],
  // Cover pace tracker
  weeklyFloor: 50,
  workDays: [1, 2, 3, 4, 5],       // 0 = Sunday ... 6 = Saturday
  workStart: 7,                    // hour of day (local) the working day starts
  workEnd: 18,                     // hour of day (local) it ends
  // Weather flags use the US National Weather Service alerts API (api.weather.gov). Only pickup/delivery city coordinates are sent.
  weatherFlags: true,
  // Remembered UI state (collapsed sections / lane boxes, active broker tab ...)
  ui: {},
  theme: 'dark',
  // Appearance (themes, accent, background...) and the account profile. null/blank = defaults; see js/ui/appearance.js.
  appearance: null,
  profile: { name: '', title: '', company: '', startPage: 'home' },
  // Sign-in. account = { email, salt, hash, iter, createdAt } (a salted PBKDF2 hash, never the password) once one is created on the
  // Account Settings page or the first-run screen. accountPrompt: '' = ask on first visit, 'skipped' = the person chose "Skip for now".
  account: null,
  accountPrompt: '',
  // The ONE rate typed per load (the "Target rate"): it judges carrier e-mail replies, and (when this is on) it is also the rate that
  // goes into the DAT CSV's "DAT Loadboard Rate" column for every posting that has no rate of its own.
  postTargetOnDat: true,
  // Opt-in reach levers applied to the DAT CSV only (the board keeps the real equipment): see core/dat.js.
  postBroadEquip: false,           // Van -> "Van or Reefer", Flatbed -> "Flatbed or Step Deck"
  postExtended: false,             // turn on DAT's Extended Network for every row (needs a DAT plan that includes it)
  // Outreach mode used by the per-row Carrier Outreach button: 'excel' (tiered, Excel v3) or 'outlook' (lane scan, Outlook v3)
  outreachButtonMode: 'excel',
};

/**
 * DAT bulk-upload columns, in EXACT template order (24 columns, copied from DAT's "bulk upload template" CSV).
 * DAT's own instructions: "Do not remove or rearrange the columns." A trailing * marks a mandatory field.
 * Letters A..X are the spreadsheet column letters of that template.
 */
export const DAT_COLUMNS = [
  { letter: 'A', key: 'pickupEarliest', header: 'Pickup Earliest*' },
  { letter: 'B', key: 'pickupLatest', header: 'Pickup Latest' },
  { letter: 'C', key: 'length', header: 'Length (ft)*' },
  { letter: 'D', key: 'weight', header: 'Weight (lbs)*' },
  { letter: 'E', key: 'fullPartial', header: 'Full/Partial*' },
  { letter: 'F', key: 'equip', header: 'Equipment*' },
  { letter: 'G', key: 'usePrivate', header: 'Use Private Network*' },
  { letter: 'H', key: 'privateRate', header: 'Private Network Rate' },
  { letter: 'I', key: 'allowPrivBooking', header: 'Allow Private Network Booking' },
  { letter: 'J', key: 'allowPrivBidding', header: 'Allow Private Network Bidding' },
  { letter: 'K', key: 'useDat', header: 'Use DAT Loadboard*' },
  { letter: 'L', key: 'datRate', header: 'DAT Loadboard Rate' },
  { letter: 'M', key: 'allowDatBooking', header: 'Allow DAT Loadboard Booking' },
  { letter: 'N', key: 'useExtended', header: 'Use Extended Network' },
  { letter: 'O', key: 'contact', header: 'Contact Method*' },
  { letter: 'P', key: 'originCity', header: 'Origin City*' },
  { letter: 'Q', key: 'originState', header: 'Origin State*' },
  { letter: 'R', key: 'originZip', header: 'Origin Postal Code' },
  { letter: 'S', key: 'destCity', header: 'Destination City*' },
  { letter: 'T', key: 'destState', header: 'Destination State*' },
  { letter: 'U', key: 'destZip', header: 'Destination Postal Code' },
  { letter: 'V', key: 'comment', header: 'Comment' },
  { letter: 'W', key: 'commodity', header: 'Commodity' },
  { letter: 'X', key: 'referenceId', header: 'Reference ID' },
];

/**
 * Equipment codes accepted on the board / written to the DAT "Equipment*" column. This is DAT One's complete Equipment Type list
 * (code, name, in the order DAT shows it). `fam` = the equipment families the type belongs to; it drives the RateView word, the
 * carrier-database equipment match and the "Find more carriers" label (see core/equipment.js). `rateView` = DAT RateView equipment word
 * (RateView only has Van / Reefer / Flatbed, so everything else uses the closest one).
 * Rule: one entry per code AND per name. The list is de-duplicated below, and tests/unit/equipment.test.js fails if a duplicate sneaks in.
 */
const EQUIPMENT_TABLE = [
  // code, label, families, rateView
  ['V', 'Van', 'van', 'Van'],
  ['R', 'Reefer', 'reefer', 'Reefer'],
  ['F', 'Flatbed', 'flatbed', 'Flatbed'],
  ['AC', 'Auto Carrier', 'other', 'Flatbed'],
  ['BT', 'B-Train', 'other', 'Flatbed'],
  ['CN', 'Conestoga', 'flatbed', 'Flatbed'],
  ['C', 'Container', 'other', 'Van'],
  ['CI', 'Container Insulated', 'other', 'Van'],
  ['CR', 'Container Refrigerated', 'reefer', 'Reefer'],
  ['CV', 'Conveyor', 'other', 'Van'],
  ['DD', 'Double Drop', 'flatbed', 'Flatbed'],
  ['LA', 'Drop Deck Landoll', 'stepdeck', 'Flatbed'],
  ['DT', 'Dump Trailer', 'other', 'Flatbed'],
  ['FA', 'Flatbed Air-Ride', 'flatbed', 'Flatbed'],
  ['FN', 'Flatbed Conestoga', 'flatbed', 'Flatbed'],
  ['F2', 'Flatbed Double', 'flatbed', 'Flatbed'],
  ['FZ', 'Flatbed HazMat', 'flatbed', 'Flatbed'],
  ['FH', 'Flatbed Hotshot', 'flatbed', 'Flatbed'],
  ['MX', 'Flatbed Maxi', 'flatbed', 'Flatbed'],
  ['FD', 'Flatbed or Step Deck', 'flatbed stepdeck', 'Flatbed'],
  ['FC', 'Flatbed w/Chains', 'flatbed', 'Flatbed'],
  ['FS', 'Flatbed w/Sides', 'flatbed', 'Flatbed'],
  ['FT', 'Flatbed w/Tarps', 'flatbed', 'Flatbed'],
  ['FM', 'Flatbed w/Team', 'flatbed', 'Flatbed'],
  ['FO', 'Flatbed (Over Dimension)', 'flatbed', 'Flatbed'],
  ['FR', 'Flatbed/Van/Reefer', 'flatbed van reefer', 'Van'],
  ['HB', 'Hopper Bottom', 'other', 'Flatbed'],
  ['IR', 'Insulated Van or Reefer', 'van reefer', 'Reefer'],
  ['LB', 'Lowboy', 'flatbed', 'Flatbed'],
  ['LR', 'Lowboy or RGN', 'flatbed', 'Flatbed'],
  ['LO', 'Lowboy (Over Dimension)', 'flatbed', 'Flatbed'],
  ['MV', 'Moving Van', 'van', 'Van'],
  ['NU', 'Pneumatic', 'other', 'Van'],
  ['PO', 'Power Only', 'power', 'Van'],
  ['RA', 'Reefer Air-Ride', 'reefer', 'Reefer'],
  ['R2', 'Reefer Double', 'reefer', 'Reefer'],
  ['RZ', 'Reefer HazMat', 'reefer', 'Reefer'],
  ['RN', 'Reefer Intermodal', 'reefer', 'Reefer'],
  ['RL', 'Reefer Logistics', 'reefer', 'Reefer'],
  ['RV', 'Reefer or Vented Van', 'reefer van', 'Reefer'],
  ['RM', 'Reefer w/Team', 'reefer', 'Reefer'],
  ['RP', 'Reefer w/Pallet Exchange', 'reefer', 'Reefer'],
  ['RG', 'Removable Gooseneck', 'flatbed', 'Flatbed'],
  ['SD', 'Step Deck', 'stepdeck', 'Flatbed'],
  ['SR', 'Step Deck or RGN', 'stepdeck', 'Flatbed'],
  ['SN', 'Stepdeck Conestoga', 'stepdeck', 'Flatbed'],
  ['SB', 'Straight Box Truck', 'box', 'Van'],            // DAT has no box-truck RateView word: Van is the closest
  ['ST', 'Stretch Trailer', 'flatbed', 'Flatbed'],
  ['TA', 'Tanker Aluminum', 'other', 'Van'],
  ['TN', 'Tanker Intermodal', 'other', 'Van'],
  ['TS', 'Tanker Steel', 'other', 'Van'],
  ['TT', 'Truck and Trailer', 'other', 'Van'],
  ['VA', 'Van Air-Ride', 'van', 'Van'],
  ['VS', 'Van Conestoga', 'van', 'Van'],
  ['V2', 'Van Double', 'van', 'Van'],
  ['VZ', 'Van HazMat', 'van', 'Van'],
  ['VH', 'Van Hotshot', 'van', 'Van'],
  ['VI', 'Van Insulated', 'van', 'Van'],
  ['VN', 'Van Intermodal', 'van', 'Van'],
  ['VG', 'Van Lift-Gate', 'van', 'Van'],
  ['VL', 'Van Logistics', 'van', 'Van'],
  ['OT', 'Van Open-Top', 'van', 'Van'],
  ['VT', 'Van or Flatbed w/Tarps', 'van flatbed', 'Van'],
  ['VF', 'Van or Flatbed', 'van flatbed', 'Van'],
  ['VR', 'Van or Reefer', 'van reefer', 'Van'],
  ['VB', 'Van Roller Bed', 'van', 'Van'],
  ['V3', 'Van Triple', 'van', 'Van'],
  ['VV', 'Van Vented', 'van', 'Van'],
  ['VW', 'Van w/Blanket Wrap', 'van', 'Van'],
  ['VC', 'Van w/Curtains', 'van', 'Van'],
  ['VP', 'Van w/Pallet Exchange', 'van', 'Van'],
  ['VM', 'Van w/Team', 'van', 'Van'],
  ['SV', 'Sprinter Van', 'sprinter', 'Van'],
  ['SZ', 'Sprinter Van Hazmat', 'sprinter', 'Van'],
  ['SC', 'Sprinter Van Temp-Controlled', 'sprinter reefer', 'Reefer'],
  ['SM', 'Sprinter Van Team', 'sprinter', 'Van'],
  ['BR', 'Straight Box Truck - Reefer', 'box reefer', 'Reefer'],
  ['BZ', 'Straight Box Truck Hazmat', 'box', 'Van'],
  ['PT', 'Power Only Towaway', 'power', 'Van'],
  ['PL', 'Power Only Load Out', 'power', 'Van'],
];

/** Drop any repeated code or repeated name (case/punctuation-insensitive); the first entry wins. */
export function dedupeEquipment(rows) {
  const codes = new Set(), names = new Set(), out = [];
  for (const r of rows) {
    const code = String(r.code).trim().toUpperCase();
    const name = String(r.label).toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!code || codes.has(code) || names.has(name)) continue;
    codes.add(code); names.add(name); out.push({ ...r, code });
  }
  return out;
}

export const EQUIPMENT = dedupeEquipment(EQUIPMENT_TABLE.map(([code, label, fam, rateView]) => ({ code, label, fam: fam.split(' '), rateView })));

export const CUSTOMER_HEADERS = [
  'Company', 'Contact Name', 'Title', 'Email', 'Phone', 'City', 'State', 'Industry / Commodity', 'Typical Lanes', 'Equipment', 'Status', 'Last Contacted', 'Notes',
];
export const CUSTOMER_KEYS = [
  'company', 'contactName', 'title', 'email', 'phone', 'city', 'state', 'industry', 'lanes', 'equipment', 'status', 'lastContacted', 'notes',
];

export const CARRIER_HEADERS = [
  'Origin City', 'Origin State', 'Destination City', 'Destination State', 'Carrier Name', 'MC/DOT', 'Email', 'Phone',
  'Equipment', 'Preferred Pickup Dates', 'Rate', 'Last Covered', 'Cover Count', 'Last Contacted', 'Response Rate', 'Status', 'Notes',
];

export const CARRIER_KEYS = [
  'originCity', 'originState', 'destCity', 'destState', 'carrierName', 'mc', 'email', 'phone',
  'equipment', 'preferredPickupDates', 'rate', 'lastCovered', 'coverCount', 'lastContacted', 'responseRate', 'status', 'notes',
];

export const INQUIRY_HEADERS = [
  'Conversation ID', 'Date Counted', 'Sender Email', 'Email Subject', 'Posting Row', 'Origin City', 'Origin State',
  'Destination City', 'Destination State', 'Count After Inquiry', 'Target Rate', 'Status', 'Conversation Stage',
  'Rate Response Sent', 'Last Carrier Rate', 'Last Action', 'Conversation Event Count', 'Approved', 'Date Added',
];

export const INQUIRY_KEYS = [
  'conversationId', 'dateCounted', 'senderEmail', 'subject', 'postingRow', 'originCity', 'originState',
  'destCity', 'destState', 'countAfterInquiry', 'targetRate', 'status', 'stage',
  'rateResponseSent', 'lastCarrierRate', 'lastAction', 'eventCount', 'approved', 'dateAdded',
];

/** Row colours from ApplyPriorityFormatting */
export const PRIORITY_COLORS = { High: '#FFC7CE', Medium: '#FFEB9C', Low: '#DAF2D0' };

export const VENTUSKY_URL = 'https://www.ventusky.com/';
export const RATEVIEW_BASE = 'https://iq.dat.com/rateview/';
/** DAT One "Find Trucks" (carrier search). DAT publishes no deep link that pre-fills the form, so the app opens this page and copies the lane. */
export const FINDTRUCK_URL = 'https://one.dat.com/search-trucks';
