"""
Freight Signal (c) - Outlook integration.

Reproduces V2_OUTLOOK_MACRO.txt using pywin32 (win32com) against the
desktop Outlook application:

  * generate_outreach_for_group - for a Load Group, finds matching
    carriers in the Carrier Database (by state/equipment, scored by
    cover history), skips anyone already contacted for this exact load
    (AlreadyContactedCarrier / outreach_log), and creates a fresh Outlook
    draft per carrier up to the Outreach Target - mirrors
    FindCarriersForLoad / CreateCarrierAvailabilityDraft / LogCarrierOutreach.

  * scan_inbox_once - polls the Inbox, and for each candidate carrier
    email:
      1. Skips blocked senders, automated messages (out-of-office/
         mailer-daemon), and forwards (IsBlockedSender/IsAutomatedMessage/
         IsForward).
      2. Matches the email to an open Load Group two ways: first by the
         [LG-xxxxxxxx] tag Freight Signal puts in its own outreach
         drafts, then - because a carrier replying straight to a DAT
         posting won't have that tag - by fuzzy origin/destination
         city+state phrase matching against every Active posting
         (GetLaneMatchScore/ContainsCityStatePair/NormalizeForMatching).
      3. Extracts a quoted rate using the same "rate/offer/can do/all-in"
         phrase-preference pattern before falling back to a bare dollar
         amount, and validates it's a plausible truckload rate ($250-
         $20,000) (ExtractCarrierRate/IsReasonableCarrierRate).
      4. First reply from a carrier -> drafts a genuine Outlook Reply
         (not a new email - keeps the thread) asking for their best
         all-in rate and ETA (CreateInquiryDraft), logs the inquiry with
         stage INQUIRY_REPLY_SENT.
      5. Follow-up reply with a rate -> drafts a Reply: if the rate is
         within $200 of the load's target rate, "Please confirm your ETA
         to pickup"; otherwise "How close can you come to $X?"
         (CreateRateResponseDraft), flags the original email
         RATE RECEIVED - REVIEW / ETA, and updates the Inquiry Log
         row's stage/rate.
      6. Follow-up reply with no rate -> left for manual review, not
         auto-flagged as a rate email (matches the macro's explicit
         "do NOT blindly flag" rule).

This module only runs on Windows with a signed-in desktop Outlook client.
On any other platform every public function raises
OutlookUnavailableError, which the UI catches and reports as a friendly
message instead of crashing the app.
"""
import re
import sys
import threading

from . import db

RATE_PHRASE_PATTERN = re.compile(
    r"(rate|offer|can do|do for|take|counter|all[\s-]?in|total)"
    r"[^$0-9]{0,40}\$?\s*([0-9]{3,5}(?:,[0-9]{3})?(?:\.\d{1,2})?)",
    re.IGNORECASE,
)
RATE_FALLBACK_PATTERN = re.compile(r"\$\s*([0-9]{3,5}(?:,[0-9]{3})?(?:\.\d{1,2})?)")
LOAD_GROUP_TAG_PATTERN = re.compile(r"\[(LG-[A-Z0-9]{6,})\]")
RATE_MIN, RATE_MAX = 250.0, 20000.0


class OutlookUnavailableError(RuntimeError):
    pass


def _get_outlook():
    if sys.platform != "win32":
        raise OutlookUnavailableError(
            "Outlook automation requires Windows with desktop Outlook installed and signed in."
        )
    try:
        import win32com.client  # noqa: WPS433 (deliberately lazy import)
    except ImportError as exc:
        raise OutlookUnavailableError(
            "pywin32 is not installed. Run: pip install pywin32"
        ) from exc
    try:
        return win32com.client.Dispatch("Outlook.Application")
    except Exception as exc:  # noqa: BLE001
        raise OutlookUnavailableError(
            "Could not connect to Outlook. Make sure desktop Outlook is installed and open."
        ) from exc


# ---------------------------------------------------------------------------
# Text normalization / fuzzy lane matching (mirrors NormalizeForMatching /
# ContainsExactPhrase / ContainsCityStatePair / GetLaneMatchScore)
# ---------------------------------------------------------------------------
_PUNCT_PATTERN = re.compile(r"[,.\-/\\:;()\[\]{}_?!|\u2013\u2014]")


def normalize_for_matching(text_value: str) -> str:
    s = (text_value or "").lower()
    s = s.replace("\r", " ").replace("\n", " ").replace("\t", " ").replace("\xa0", " ")
    s = _PUNCT_PATTERN.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def contains_exact_phrase(normalized_text: str, phrase: str) -> bool:
    normalized_phrase = normalize_for_matching(phrase)
    if not normalized_phrase:
        return False
    return f" {normalized_phrase} " in f" {normalized_text} "


def contains_city_state_pair(normalized_text: str, city: str, state: str) -> bool:
    city_n, state_n = normalize_for_matching(city), normalize_for_matching(state)
    if not city_n or not state_n:
        return False
    return f" {city_n} {state_n} " in f" {normalized_text} "


def get_lane_match_score(normalized_text: str, origin_city, origin_state, dest_city, dest_state) -> int:
    """Returns -1 if the text doesn't clearly reference both the origin
    and destination city; otherwise a score (higher = more confident) so
    the best-matching Active posting wins when several are plausible."""
    if not normalized_text:
        return -1
    if not contains_exact_phrase(normalized_text, origin_city):
        return -1
    if not contains_exact_phrase(normalized_text, dest_city):
        return -1
    score = 200
    if contains_exact_phrase(normalized_text, origin_state):
        score += 10
    if contains_exact_phrase(normalized_text, dest_state):
        score += 10
    if contains_city_state_pair(normalized_text, origin_city, origin_state):
        score += 25
    if contains_city_state_pair(normalized_text, dest_city, dest_state):
        score += 25
    return score


def find_matching_posting(conn, subject: str, body: str):
    """Tag match first (fast path for Freight Signal's own outreach
    drafts), then fuzzy city/state match against every Active posting
    (for carriers replying straight to a DAT posting)."""
    tag_match = LOAD_GROUP_TAG_PATTERN.search(subject or "") or LOAD_GROUP_TAG_PATTERN.search(body or "")
    if tag_match:
        row = conn.execute(
            "SELECT * FROM postings WHERE load_group_id=? AND load_status='Active' LIMIT 1",
            (tag_match.group(1),),
        ).fetchone()
        if row:
            return row

    normalized = normalize_for_matching(f"{subject or ''} {body or ''}")
    best_row, best_score = None, -1
    for row in conn.execute("SELECT * FROM postings WHERE load_status='Active'").fetchall():
        score = get_lane_match_score(normalized, row["origin_city"], row["origin_state"],
                                      row["dest_city"], row["dest_state"])
        if score > best_score:
            best_row, best_score = row, score
    return best_row if best_score >= 0 else None


# ---------------------------------------------------------------------------
# Rate extraction (mirrors ExtractCarrierRate / IsReasonableCarrierRate)
# ---------------------------------------------------------------------------
def is_reasonable_carrier_rate(rate: float) -> bool:
    return RATE_MIN <= rate <= RATE_MAX


def extract_carrier_rate(subject: str, body: str):
    """Returns (rate, found). Prefers phrases like 'rate', 'offer', 'can
    do', 'all-in' near the number before falling back to a bare dollar
    amount, exactly like the VBA two-pass regex."""
    text_value = f"{subject or ''}\n{body or ''}"
    for match in RATE_PHRASE_PATTERN.finditer(text_value):
        try:
            value = float(match.group(2).replace(",", ""))
        except ValueError:
            continue
        if is_reasonable_carrier_rate(value):
            return value, True
    for match in RATE_FALLBACK_PATTERN.finditer(text_value):
        try:
            value = float(match.group(1).replace(",", ""))
        except ValueError:
            continue
        if is_reasonable_carrier_rate(value):
            return value, True
    return 0.0, False


# ---------------------------------------------------------------------------
# Sender / message filtering (mirrors IsBlockedSender / IsAutomatedMessage /
# IsForward)
# ---------------------------------------------------------------------------
def is_blocked_sender(sender_email: str, blocked_domains_csv: str) -> bool:
    sender_email = (sender_email or "").lower()
    for domain in (blocked_domains_csv or "").split(","):
        domain = domain.strip().lower()
        if domain and domain in sender_email:
            return True
    return False


def is_automated_message(sender_email: str, subject: str) -> bool:
    sender_email = (sender_email or "").lower()
    subject = (subject or "").strip().lower()
    if "mailer-daemon" in sender_email or "postmaster" in sender_email:
        return True
    if "out of office" in subject or "automatic reply" in subject:
        return True
    return False


def is_forward(subject: str) -> bool:
    s = (subject or "").strip().upper()
    return s.startswith("FW:") or s.startswith("FWD:")


# ---------------------------------------------------------------------------
# Draft creation - genuine Outlook Reply() calls so the conversation
# thread is preserved, matching CreateInquiryDraft / CreateRateResponseDraft
# ---------------------------------------------------------------------------
def create_inquiry_draft(mail_item, load_group_id: str = "") -> str:
    """First-touch reply asking for the carrier's best all-in rate and
    ETA. Returns the draft's EntryID."""
    reply = mail_item.Reply()
    tag = f" [{load_group_id}]" if load_group_id else ""
    if tag and tag not in (reply.Subject or ""):
        reply.Subject = (reply.Subject or "") + tag
    reply.Body = (
        "What is your best all-in rate? ETA to pickup?\n\n" + (reply.Body or "")
    )
    reply.Save()
    return reply.EntryID


def create_rate_response_draft(mail_item, carrier_rate: float, target_rate: float,
                                rate_proximity: float = 200.0) -> str:
    """Reply logic exactly matching CreateRateResponseDraft: within the
    proximity window, ask for ETA; otherwise counter toward the target
    rate. Returns the draft's EntryID."""
    difference = abs(carrier_rate - target_rate)
    if difference <= rate_proximity:
        response_text = "Please confirm your ETA to pickup."
    else:
        response_text = f"How close can you come to ${target_rate:,.0f}?"
    reply = mail_item.Reply()
    reply.Body = response_text + "\n\n" + (reply.Body or "")
    reply.Save()
    return reply.EntryID


def flag_rate_email(mail_item):
    """Flags the original carrier email so it's visible in Outlook's
    to-do/flagged view, mirroring FlagRateEmail."""
    try:
        mail_item.FlagStatus = 2  # olFlagMarked
        mail_item.FlagRequest = "RATE RECEIVED - REVIEW / ETA"
        mail_item.Importance = 1  # olImportanceNormal
        mail_item.Save()
    except Exception:  # noqa: BLE001 - flagging is best-effort, never fatal
        pass


def flag_no_rate_email(mail_item):
    try:
        mail_item.FlagStatus = 2
        mail_item.FlagRequest = "CARRIER REPLIED - NO RATE GIVEN"
        mail_item.Save()
    except Exception:  # noqa: BLE001
        pass


def flag_repeat_carrier_email(mail_item):
    try:
        mail_item.FlagStatus = 2
        mail_item.FlagRequest = "REPEAT CARRIER - REVIEW"
        mail_item.Save()
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------------------
# Proactive carrier outreach for a Load Group (mirrors FindCarriersForLoad /
# CreateCarrierAvailabilityDraft / LogCarrierOutreach / AlreadyContactedCarrier)
# ---------------------------------------------------------------------------
def create_outreach_draft(outlook, carrier, load_group_id, origin_city, origin_state,
                           dest_city, dest_state, pickup_date, equipment, rate_line=""):
    mail = outlook.CreateItem(0)  # olMailItem
    mail.Subject = f"Truck available? {origin_city}, {origin_state} -> {dest_city}, {dest_state} [{load_group_id}]"
    carrier_name = carrier["carrier_name"] or "there"
    body = (
        f"Hi {carrier_name},\n\n"
        f"Do you have a truck available for the following lane?\n\n"
        f"  Origin: {origin_city}, {origin_state}\n"
        f"  Destination: {dest_city}, {dest_state}\n"
        f"  Pickup: {pickup_date}\n"
        f"  Equipment: {equipment}\n"
        f"{rate_line}\n"
        f"Please reply with your best rate and truck availability and I will get you covered.\n\n"
        f"Thanks,\nFreight Signal"
    )
    mail.Body = body
    if carrier["email"]:
        mail.To = carrier["email"]
    mail.Save()  # saved to Drafts, not sent - matches "review before send" workflow
    return mail.EntryID


def already_contacted_carrier(conn, load_group_id, carrier_id) -> bool:
    row = conn.execute(
        "SELECT 1 FROM outreach_log WHERE load_group_id=? AND carrier_id=? LIMIT 1",
        (load_group_id, carrier_id),
    ).fetchone()
    return row is not None


def log_carrier_outreach(conn, load_group_id, carrier_id, carrier_email):
    with conn:
        conn.execute(
            "INSERT INTO outreach_log (load_group_id, carrier_id, carrier_email, contacted_at) VALUES (?,?,?,?)",
            (load_group_id, carrier_id, carrier_email, db.now_str()),
        )
        conn.execute("UPDATE carriers SET last_contacted=? WHERE id=?", (db.now_str(), carrier_id))


def generate_outreach_for_group(conn, group_id, max_count=None):
    """Finds matching, not-yet-contacted carriers for a load group's lane
    and creates Outlook drafts, up to the group's Outreach Target."""
    outlook = _get_outlook()
    postings = conn.execute(
        "SELECT * FROM postings WHERE load_group_id=?", (group_id,)
    ).fetchall()
    if not postings:
        return []
    target = max_count or postings[0]["outreach_target"] or 2
    origin_city, origin_state = postings[0]["origin_city"], postings[0]["origin_state"]
    dest_city, dest_state = postings[0]["dest_city"], postings[0]["dest_state"]
    equipment = postings[0]["equipment"]

    carriers = conn.execute(
        "SELECT * FROM carriers WHERE lower(origin_state)=? OR lower(dest_state)=? "
        "ORDER BY cover_count DESC LIMIT ?",
        (origin_state.lower(), dest_state.lower(), target * 4),
    ).fetchall()

    created = []
    for carrier in carriers:
        if len(created) >= target:
            break
        if not carrier["email"]:
            continue
        if already_contacted_carrier(conn, group_id, carrier["id"]):
            continue
        entry_id = create_outreach_draft(
            outlook, carrier, group_id, origin_city, origin_state, dest_city, dest_state,
            postings[0]["pickup_earliest"], equipment,
        )
        log_carrier_outreach(conn, group_id, carrier["id"], carrier["email"])
        created.append((carrier["id"], entry_id))

    with conn:
        conn.execute("UPDATE postings SET carrier_outreach='Yes' WHERE load_group_id=?", (group_id,))
    return created


# ---------------------------------------------------------------------------
# Inbox processing (mirrors ProcessIncomingCarrierEmail / ProcessCarrierInquiry)
# ---------------------------------------------------------------------------
def _find_existing_inquiry(conn, conversation_id, sender_email):
    if conversation_id:
        row = conn.execute(
            "SELECT * FROM inquiries WHERE conversation_id=? ORDER BY id DESC LIMIT 1", (conversation_id,)
        ).fetchone()
        if row:
            return row
    if sender_email:
        row = conn.execute(
            "SELECT * FROM inquiries WHERE lower(email)=? ORDER BY id DESC LIMIT 1", (sender_email.lower(),)
        ).fetchone()
        if row:
            return row
    return None


def scan_inbox_once(conn, unread_only=True):
    """Scans the Inbox once, drafts replies as appropriate, flags rate
    emails, and logs/updates the Inquiry Log. Returns count of inquiries
    logged or updated."""
    outlook = _get_outlook()
    namespace = outlook.GetNamespace("MAPI")
    inbox = namespace.GetDefaultFolder(6)  # olFolderInbox
    items = inbox.Items
    items.Sort("[ReceivedTime]", True)

    blocked_domains = db.get_setting("blocked_sender_domains", "")
    rate_proximity = float(db.get_setting("rate_proximity_dollars", "200") or 200)

    touched = 0
    for item in list(items)[:200]:
        try:
            if unread_only and not getattr(item, "UnRead", False):
                continue
            subject = getattr(item, "Subject", "") or ""
            body = getattr(item, "Body", "") or ""
            sender_email = getattr(item, "SenderEmailAddress", "") or ""
            sender_name = getattr(item, "SenderName", "") or ""
            conversation_id = getattr(item, "ConversationID", "") or ""

            if is_forward(subject):
                continue
            if is_automated_message(sender_email, subject):
                item.UnRead = False
                continue
            if is_blocked_sender(sender_email, blocked_domains):
                item.UnRead = False
                continue

            posting = find_matching_posting(conn, subject, body)
            if not posting:
                continue  # can't identify the load - leave for manual review, don't guess

            existing = _find_existing_inquiry(conn, conversation_id, sender_email)
            carrier_rate, rate_found = extract_carrier_rate(subject, body)
            target_rate_row = conn.execute(
                "SELECT dat_loadboard_rate FROM postings WHERE load_group_id=? LIMIT 1",
                (posting["load_group_id"],),
            ).fetchone()
            target_rate = None
            try:
                target_rate = float(target_rate_row["dat_loadboard_rate"]) if target_rate_row and target_rate_row["dat_loadboard_rate"] else None
            except (TypeError, ValueError):
                target_rate = None

            if existing is None:
                try:
                    create_inquiry_draft(item, posting["load_group_id"])
                except Exception:  # noqa: BLE001
                    pass
                within_target = ""
                if rate_found and target_rate:
                    within_target = "Yes" if abs(carrier_rate - target_rate) <= rate_proximity else "No"
                with conn:
                    conn.execute(
                        """INSERT INTO inquiries (
                            load_group_id, carrier_name, email, origin_city, origin_state,
                            dest_city, dest_state, equipment, rate, quoted_within_target,
                            approved, date_added, source, notes, stage, conversation_id, entry_id
                        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (posting["load_group_id"], sender_name, sender_email, posting["origin_city"],
                         posting["origin_state"], posting["dest_city"], posting["dest_state"],
                         posting["equipment"], str(carrier_rate) if rate_found else "", within_target,
                         "No", db.now_str(), "Outlook Inbox Watcher", f"Subject: {subject[:200]}",
                         "INQUIRY_REPLY_SENT", conversation_id, getattr(item, "EntryID", "")),
                    )
                touched += 1
            elif rate_found and target_rate:
                try:
                    create_rate_response_draft(item, carrier_rate, target_rate, rate_proximity)
                    flag_rate_email(item)
                except Exception:  # noqa: BLE001
                    pass
                within_target = "Yes" if abs(carrier_rate - target_rate) <= rate_proximity else "No"
                with conn:
                    conn.execute(
                        "UPDATE inquiries SET rate=?, quoted_within_target=?, stage='RATE_RECEIVED', "
                        "notes=notes || ' | Rate reply ' || ? WHERE id=?",
                        (str(carrier_rate), within_target, db.now_str(), existing["id"]),
                    )
                touched += 1
            elif existing["stage"] == "INQUIRY_REPLY_SENT":
                try:
                    flag_no_rate_email(item)
                except Exception:  # noqa: BLE001
                    pass
            else:
                try:
                    flag_repeat_carrier_email(item)
                except Exception:  # noqa: BLE001
                    pass

            item.UnRead = False
        except Exception:  # noqa: BLE001 - keep scanning even if one item fails
            continue
    return touched


def draft_reply_for_inquiry(conn, inquiry_row):
    """Manual 'Draft Reply' button in the Inquiry Log: re-opens the
    original carrier email by its stored EntryID and creates the
    appropriate draft (inquiry follow-up or rate response) on demand,
    for when the automatic Inbox Watcher isn't running."""
    if not inquiry_row["entry_id"]:
        raise OutlookUnavailableError(
            "This inquiry wasn't logged from an Outlook email (no EntryID on file), so there's nothing to reply to."
        )
    outlook = _get_outlook()
    namespace = outlook.GetNamespace("MAPI")
    mail_item = namespace.GetItemFromID(inquiry_row["entry_id"])

    rate_proximity = float(db.get_setting("rate_proximity_dollars", "200") or 200)
    if inquiry_row["rate"]:
        target_row = conn.execute(
            "SELECT dat_loadboard_rate FROM postings WHERE load_group_id=? LIMIT 1",
            (inquiry_row["load_group_id"],),
        ).fetchone()
        target_rate = None
        try:
            target_rate = float(target_row["dat_loadboard_rate"]) if target_row and target_row["dat_loadboard_rate"] else None
        except (TypeError, ValueError):
            target_rate = None
        if target_rate:
            return create_rate_response_draft(mail_item, float(inquiry_row["rate"]), target_rate, rate_proximity)
    return create_inquiry_draft(mail_item, inquiry_row["load_group_id"] or "")


class InboxWatcher:
    """Background polling thread wrapper around scan_inbox_once, so the UI
    can start/stop it from a toggle switch."""

    def __init__(self, conn_factory, interval_sec=60, on_result=None, on_error=None):
        self._conn_factory = conn_factory
        self._interval = interval_sec
        self._on_result = on_result
        self._on_error = on_error
        self._stop_event = threading.Event()
        self._thread = None

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop_event.set()

    def is_running(self):
        return bool(self._thread and self._thread.is_alive())

    def _run(self):
        while not self._stop_event.is_set():
            try:
                conn = self._conn_factory()
                count = scan_inbox_once(conn)
                conn.close()
                if self._on_result:
                    self._on_result(count)
            except Exception as exc:  # noqa: BLE001
                if self._on_error:
                    self._on_error(exc)
            self._stop_event.wait(self._interval)
