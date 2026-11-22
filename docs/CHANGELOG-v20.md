# Freight Signal v20

Goal of this release: find the most likely carrier for each load, at the best rate, in the least time, and measure whether that is really happening.

## 1. IMPORT HISTORICAL EMAILS (Carrier Database)
A new button next to **Add carrier**. It reads the last **30 or 90 days** of Outlook mail from the folders you choose and adds only the carriers that **really booked a load with you**.

How it decides (all in `js/core/history.js`, unit tested with synthetic e-mails):
- Nothing is imported on one clue. "Please send driver and dispatch info" is only 10 points by itself; it does not prove they answered, that you booked at that rate, or that they did a good job.
- Evidence is scored from text the sender actually typed (quoted history, signatures and your own wording are cut first, so an old quoted message never counts twice):
  rate confirmation **you sent** with an attachment (45) / returned or signed by the carrier (50, or 40 when only the file name suggests it) / "you're booked, all set, confirmed" from you (25) /
  carrier sent driver + truck details **after** you asked or booked (35) / carrier accepted (15) / rate clearly agreed (20) / delivered, POD or "thanks for the load" (25 / 10).
- **Verified** = 70 or more AND at least one strong item (rate confirmation, signed rate con, driver details after a booking, proof of delivery). Verified carriers are pre-selected.
  **Needs your review** = 40 to 69 (shown, NOT selected). Below 40 is never shown as a carrier. Your exact scenario (you ask for driver info, they send it) lands in "needs your review".
- Left out on purpose, and listed with the reason: carriers you never engaged (a **customer** that e-mails YOU a rate confirmation never becomes a carrier), cancellations / no-shows / breakdowns after the booking,
  late / damage / claim problems, coworkers (your own domain), customers in your Customer database, load boards and automatic mailboxes. A mass e-mail to more than 3 carriers proves nothing about any one of them.
- **Rate booked at** is saved only when it is clear: stated in your booking message, typed by both sides, or your offer that they accepted. A rate typed after the booking (renegotiated) leaves it blank rather than guessing.
  A carrier's last quote that you never confirmed is shown as "not confirmed" and is not written to the Cover Log.
- Extracts: company name (signature, labelled line, display name; guessed-from-domain is flagged), MC / DOT (only from text the carrier wrote about themselves), e-mail, dispatch / office phone (never the driver's), driver name and phone, truck / trailer number, equipment, lane (origin city/state and destination city/state, checked against the ZIP Map), rate, date.
- **No duplicates, ever.** A candidate is matched to the carrier database by MC / DOT, any e-mail it used, its phone number, or the same company on the same domain, and re-checked against what is stored at the moment you press Import. Two mailboxes of one carrier become one carrier.
- **Never overwrites what you entered.** Fields without e-mail metadata are treated as person-entered and locked. Blanks are filled; a different value is kept beside yours (shown as "kept beside yours" and stored in Dispatch phone / alternate e-mails). A value that came from e-mail at lower confidence can be replaced by a higher-confidence one; anything you type or edit by hand becomes locked.
- Also saved: Cover Log entries for each verified booked load (flagged "from e-mail", not counted toward today's / this week's pace or the weekly goal), and the conversations read (quotes, replies) in a new **history** store used for rate learning and response rates.
- Three ways in: (1) **From Outlook**: press the button, run the macro `FS_ExportHistory` (new file `outlook/Outlook_v7_HistoryExport.txt`), pick your folders (Inbox + Sent Items by default, subfolders optional); the review opens by itself. (2) Choose the exported `freight-signal-history.tsv`. (3) Select saved `.eml` files.
- Nothing is uploaded, sent, or added until you review it and press Import. Importing the same e-mails twice adds nothing.

## 2. Primary carriers ("set as primary")
- Carrier row > **Set as primary...** (or Carrier Database > More > Primary carriers). Pick the lane as city-to-city, or a state pair (SC to GA), or city-to-state; priority Primary or Backup; optional usual rate and note.
- When you download the DAT CSV for a load that matches, a **First call** window opens with an e-mail draft ("driver and dispatch info" included) and a call script; the load also shows "Reach out first" on its plan strip. Wins and offers are counted per assignment.

## 3. Difficulty score and action plan (per load)
Every load shows EASY / MODERATE / HARD / VERY HARD with a 0-100 score from: historical time to cover, carriers already contacted, carrier response and quote rate, how many similar loads covered, rate vs previous covers, distance from major freight markets, day / pickup / season (weekend, holiday week, short notice, weekday that covers slower for you), return freight from the destination, and equipment.
Factors with no data are left out and the rest re-weighted; the badge's tooltip shows how much of the picture was known. **Plan** opens the proof: every factor, why it is hard, the ranked action plan, ranked carriers and rate intelligence.
**It learns:** each covered or expired load stores which approaches were used (primary first, calls, raise rate, wider search, backhaul pitch, truck board, team help) and how it ended. After about 3 similar hard loads the plan quotes the evidence ("tried on 5 similar hard loads: covered 4 (80%), median 3.2 h; without it: 41%") and reorders itself.

## 4. Rate intelligence from your own history
Average carrier quote, average final covered rate, typical negotiation difference (exact from e-mail history, otherwise estimated quotes vs covers and labelled so), lowest successful covered rate, the rate that covered fastest, whether your rate is competitive, and a confidence from the number and age of comparable deals (recent deals weigh more). Also an opening / expected / walk-away plan.

## 5. Shared-network carrier matching
Ranks by what actually happened: covered this exact lane, covered a nearby lane, quoted similar loads, on your Truck Book or the shared truck board near the pickup, delivered to this destination before, covered it for the team, your primary / backup. Recent declines count against a carrier. Distance only breaks ties: a carrier who covered the lane twice outranks a truck parked next to the pickup that never answered.

## 6. FREIGHT SIGNAL measures itself (Cover Log > Is Freight Signal making you faster?)
Average minutes from load entry to cover, average calls per cover, average carriers contacted per cover, % covered by historical carriers, % covered by newly discovered carriers, average margin improvement (vs what the lane covered at before; vs your target when there is no history), time saved by shared carrier intelligence (suggested carriers vs the others), cover rate on difficult vs easy lanes. 30 / 90 days / all time, with the change vs the previous period and the number of loads behind each figure. A snapshot is stored when each load closes (covered OR expired), so the numbers do not change retroactively.
Honest limits: calls are counted from calls you log (call list, "Log call", Call button); loads imported from e-mail have no stopwatch and are left out of timing; numbers are marked "still collecting" until about 8 loads closed with the plan visible.

## Files
- New: `js/core/history.js`, `js/core/lanematch.js`, `js/core/assignments.js`, `js/core/difficulty.js`, `js/core/rateintel.js`, `js/core/networkmatch.js`, `js/core/performance.js`, `js/ui/history.js`, `js/ui/assign.js`, `js/ui/board/plan.js`, `outlook/Outlook_v7_HistoryExport.txt`, `tests/unit/v20-history.test.js`, `tests/unit/v20-intelligence.test.js`, `tests/e2e/v20.mjs` (`npm run test:v20`).
- Changed: `js/store/db.js` (DB version 6: stores `history`, `assignments`, `approaches`; they sync to your account and are in backups), `js/store/state.js`, `js/store/bridge.js`, `js/core/defaults.js`, `js/core/coverlog.js` (imported covers never count toward pace), `js/main.js`, `js/ui/icons.js`, `js/ui/pages/carriers.js`, `js/ui/pages/board.js`, `js/ui/pages/covers.js`, `css/app.css`, `sw.js` (cache v20), `package.json`, `dist/freight-signal.html` (rebuilt).

## Not verified here
The Outlook macro could not be run in a live Outlook from this environment. Run it once on 30 days and compare the message count in its summary box with what you expect. Everything on the app side (parsing, scoring, matching, UI) is covered by unit tests and a real-Chrome end-to-end test that uses a synthetic export file.
