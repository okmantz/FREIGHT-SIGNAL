import customtkinter as ctk

from .. import theme

MANUAL_TEXT = """\
FREIGHT SIGNAL - USER MANUAL

1. GETTING STARTED
   Everything runs locally on this computer - there is nothing to install
   or configure beyond opening the app. All data is stored in a file
   called freight_signal_data.db in the same folder as the app.

2. ONE-TIME SETUP
   a) Go to the "ZIP Map" tab and import your ZIP Map CSV (columns:
      Zip, City, State, Latitude, Longitude, Population). This powers the
      nearby-city matrix generator.
   b) Go to "Carrier Database" and import your existing carrier list CSV,
      or add carriers manually as they come in.

3. POSTING A LOAD (MANUAL INPUT TAB)
   Paste the load details from your load board in this format:

      Pickup: Aiken, SC 29801
      Delivery: Fletcher, OK 73541
      Pickup Date/Time: 8/14/2026 8:00 AM
      Delivery Date/Time: 8/15/2026
      Weight: 40,000 lbs
      Trailer Type: Dry Van

   Click "Parse Load" to check the extracted fields, choose a Priority
   (Low/Medium/High), set an optional Target Rate, choose how many of the
   9 postings should carry a rate, then click "Generate 9 Postings".

4. THE 3x3 MATRIX - AND HOW IT SELF-OPTIMIZES
   Freight Signal finds up to 2 alternate cities near your origin and up
   to 2 near your destination using the ZIP Map (starting at a 20-60 mile
   ring and automatically widening it if the map is sparse there), and
   crosses them with your original origin/destination to build up to 9
   postings - e.g. Aiken/Augusta/Columbia SC from, to Fletcher/Oklahoma
   City/Wichita Falls OK. The matrix NEVER repeats the same lane twice -
   if the ZIP Map can't find enough distinct nearby cities, you simply
   get fewer than 9 unique postings and a warning explaining why (import
   a denser ZIP Map to fix that), rather than duplicate postings.

   This is adaptive and self-optimizing in two ways, both driven by real
   carrier email activity logged in the Inquiry Log:

     - WHICH ALTERNATE CITIES ARE CHOSEN: a nearby city that has
       generated carrier inquiries historically is ranked ABOVE distance,
       not just blended in with it - a city with any reply history beats
       a closer city with none. Distance is only the tiebreaker among
       cities with equal (usually zero, for a brand-new lane) history.
     - WHICH POSTINGS GET A RATE: when you choose "6 of 9" or "3 of 9",
       Freight Signal gives the rate slots to whichever lanes in the
       matrix have generated the most carrier email replies historically
       - again, before distance. On a brand-new lane with no history yet,
       the closest (original) lane naturally wins the tiebreak, so it
       still behaves sensibly from day one and gets smarter the more you
       use it.

5. FREIGHT SIGNAL ENGINE TAB
   This is your live board of active postings. From here you can:
     - Mark a Load Group "Covered" (removes all 9 postings for that load)
     - Set High / Medium / Low priority for a whole Load Group
     - Toggle Carrier Outreach for a single posting row
     - Draft Outlook outreach emails to matching carriers automatically
     - Export a single Load Group, or all active postings, to a
       DAT-ready CSV (headers are fixed and DAT-compatible)
   The "Inquiries" column shows how many carrier replies that exact lane
   has generated historically - the same number driving the adaptive
   behavior in #4.

6. CARRIER DATABASE TAB
   Your maintained list of carriers by lane, equipment, and rate history.
   Import a CSV, add carriers manually, or let approved Inquiry Log
   entries flow in automatically (see #7).

7. INQUIRY LOG TAB
   Every carrier reply - whether logged manually or picked up by the
   Outlook Inbox Watcher - lands here with Approved defaulted to "No"
   and a Stage (NEW / INQUIRY_REPLY_SENT / RATE_RECEIVED). Marking a row
   "Approved: Yes" moves that carrier into the Carrier Database
   automatically (matched by MC/DOT or email if it already exists,
   otherwise added as new).

   Turn on the "Inbox Watcher" switch to have the app poll your Outlook
   Inbox in the background. For every unread carrier reply it identifies
   the load two ways - first by the Load Group tag Freight Signal
   includes in its own outreach, then by matching the origin/destination
   city names directly against your Active postings (for carriers
   replying straight to a DAT posting, which won't have a tag) - then:
     - First reply from that carrier -> drafts a genuine Outlook Reply
       (keeps the thread) asking for their best all-in rate and ETA.
     - Follow-up reply with a rate -> drafts a Reply: within your Rate
       Proximity setting of the target rate it asks them to confirm ETA;
       otherwise it counters toward your target rate. The original email
       is flagged "RATE RECEIVED - REVIEW / ETA" so it's easy to find.
     - Automated replies, out-of-office messages, forwards, and any
       sender domain you've added to Blocked Sender Domains are skipped.
   All drafts are saved to Drafts for your review - nothing sends
   automatically. You can also click "Scan Outlook Inbox Now" for a
   single on-demand scan, or "Draft Reply in Outlook" to manually
   generate the appropriate reply for a specific Inquiry Log row.

8. EXPORTING TO DAT
   The exported CSV always uses these exact headers, in this exact order,
   so it can be uploaded straight to DAT:
   Pickup Earliest*, Pickup Latest, Length (ft), Weight (lbs),
   Full/Partial*, Equipment*, Use Private Network*, Private Network Rate,
   Allow Private Network Booking, Allow Private Network Bidding,
   Use DAT Loadboard*, DAT Loadboard Rate, Allow DAT Loadboard Booking,
   Use Extended Network, Contact Method*, Origin City*, Origin State*,
   Origin Postal Code, Destination City*, Destination State*,
   Destination Postal Code, Comment, Commodity, Reference ID

9. DARK / LIGHT MODE
   Use the toggle at the bottom of the left sidebar at any time.

10. SCOPE NOTE
   This app was rebuilt from your Excel/VBA Freight Signal workbook and
   Outlook macro to run as a standalone desktop app. It reproduces the
   core workflow end to end (parsing, adaptive/self-optimizing matrix
   generation, Load Group cover/priority control, Inquiry Log approval
   flow into the Carrier Database, DAT export, and Outlook reply
   drafting/inbox integration). If you find a specific edge case from the
   old macros that behaves differently here, flag it and it can be tuned
   further - this is your proprietary system, built to keep evolving
   with you.
"""


class ManualTab(ctk.CTkFrame):
    def __init__(self, master, app):
        super().__init__(master, fg_color="transparent")
        c = theme.colors(app.mode)

        title_frame = ctk.CTkFrame(self, fg_color="transparent")
        title_frame.pack(fill="x", padx=theme.PAD, pady=(theme.PAD, 8))
        ctk.CTkLabel(title_frame, text="User Manual", font=theme.font(20, "bold")).pack(anchor="w")

        box = ctk.CTkTextbox(self, font=theme.font(13), wrap="word", fg_color=c["surface"],
                              corner_radius=theme.RADIUS)
        box.pack(fill="both", expand=True, padx=theme.PAD, pady=(0, theme.PAD))
        box.insert("1.0", MANUAL_TEXT)
        box.configure(state="disabled")
