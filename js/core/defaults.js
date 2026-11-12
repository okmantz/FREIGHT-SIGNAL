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
  minReasonableRate: 250,
  maxReasonableRate: 20000,
  // Blocklists. Excel DraftCarrierOutreach uses IsBlockedSender (suffix "@domain" / exact address).
  // Outlook InboxItems_ItemAdd uses a "contains" test. They are separate lists in the macros.
  // The shipped defaults are EMPTY on purpose: customer domains are company-confidential and must
  // not be committed to a repository. Enter them in Settings (stored only in this browser).
  outreachBlocklist: [],
  inboundBlocklist: [],
  // Optional override for the DAT bulk-upload header row (tab- or comma-separated).
  datHeaderOverride: '',
  // Split pasted TQL text into loads at lines matching this regex (default: "N pick - M drop").
  loadSeparatorRegex: '^\\s*\\d+\\s*pick\\s*[-–]\\s*\\d+\\s*drop',
  theme: 'dark',
  // Outreach mode used by the per-row Carrier Outreach button: 'excel' (tiered, Excel v3) or 'outlook' (lane scan, Outlook v3)
  outreachButtonMode: 'excel',
};

/**
 * DAT bulk-posting columns, in sheet order A..T (letters match the VBA: P=origin city ... T=dest state).
 * The header TEXT for columns F..O and R is read from truncated screenshot headers and is UNVERIFIED;
 * it can be overridden in Settings with the exact header row from the real DAT template.
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
