# v12: trustworthy carrier rates, pickup date on collapsed loads, sort by pickup date

## 1. A logged rate has to be believable before it can be "inside your booking band"
**The bug.** Loads of every price (target $4,200 and up, and many others) showed "Ready to book: carrier quoted $700, inside your booking band" although no carrier had quoted $700.

Two things combined:
* The **v4 / v5 Outlook macros read every number in the whole e-mail**, including your own quoted load text, signature and thread, and logged the first plausible one. The app then trusted it.
* In the counter ladder **any rate below target is "book it"**, so a stray $700 on a $4,200 load looked like a gift instead of a misread.
* A second hole: the "rate looks wrong" flag lived on the log line, and the carrier's *next* reply overwrote it, which turned the bad rate back into a normal quote.

**The fix** (`js/core/quotes.js`, used by the board, the Inquiry Log and Mark covered):
* A quote counts only when it is inside the plausible range, not flagged unreadable, and **between half and three times the target** (the same limits the reply engine already used for "rate looks wrong").
* Log lines written by the old macro (they carry no *Intent*) are **unverified**: never shown as "Ready to book". They get a "confirm in the e-mail" note instead, and are rejected outright when the number is one that appears in your own load text, the subject line or the lane mileage.
* Anything set aside is **explained, not hidden**: the load card shows "Ignored a logged rate ($700) that does not fit the $4,200 target - check the e-mail", and the Inquiry Log shows the rate crossed out with a warning mark (hover for the reason).
* Mark covered no longer pre-fills a rate the app does not trust.
* System → Outlook connection shows a red banner when the macro is v5 or older, with the fix: copy the v6 macro over the old one. The README and docs still told you to install v5; they now say v6.

## 2. The e-mail reader (shared by the app and the v6 macro)
Found by testing realistic replies:
* **A rate at the end of a line was cancelled by the first word of the next line.** `Rate: $4200` followed by `DH 700` or `Miles 715` found no rate at all, because the "is it followed by miles / lbs?" check could look across the line break. It now stays on the same line.
* **A lumper / detention / TONU / deposit amount could be read as the rate.** `I need $700 for lumper plus 4200 line haul` logged $700. Those amounts are now skipped, and "line haul" (two words) is recognised.
* Also skipped as units: deadhead (`700 DH`), mpg, stops, loads, trucks, units, cents.
* A fee written *before* its amount (`detention $700` next to `4200 all in`) still shows as two amounts, which is sent to you for a look rather than guessed.

These rules live in `RULES` and are written into `freight-signal-config.tsv`, so the v6 macro picks them up the next time Freight Signal writes its config (open the app once after updating).

## 3. Pickup date on collapsed loads
A quiet "PICKUP Thu, Nov 19" sits beside the target pill on every collapsed load (hover for the full date and "in 3 days"). It is plain muted text, amber only when the pickup is today or already past. A load with no date shows a faint dash.

## 4. Sort loads by pickup date
New **Sort** control in the board toolbar: *Board order* (default), *Pickup date: soonest first*, *Pickup date: latest first*. Loads with no readable date always go last; loads that pick up on the same day keep their board order, and a typed time ("11/16/2026 08:00") orders loads within a day. The choice is remembered.

## Files
New: `js/core/quotes.js`, `tests/unit/v12-quotes-pickup.test.js`, `tests/e2e/v12.mjs` (`npm run test:v12`).
Changed: `js/core/worklist.js`, `js/core/carrierreply.js`, `js/core/expiry.js`, `js/ui/pages/board.js`, `js/ui/pages/inquiry.js`, `js/ui/pages/system.js`, `js/ui/board/cover.js`, `css/app.css`, `README.md`, `docs/OUTLOOK-BRIDGE.md`, `docs/SECURITY-IT-REVIEW.md`, `package.json`, `tests/e2e/run.mjs`, `dist/freight-signal.html` (rebuilt).

## Tests
* Unit: 146 pass (14 new). The new `$700` tests fail on the old code and pass on the new.
* Browser: `test:v12` 16/16; `test:single` all pass.
* `tests/e2e/run.mjs` had three problems of its own, fixed here: a hard-coded 2026-11-11 "Outlook last seen" date that went stale after 36 hours, a `.menu summary` selector that matched the newer "Find trucks" menu, and a ladder check that expected exactly 3 text boxes. Two other checks in that file (the DAT-avg $/mile line and the cover-log row) are timing-sensitive and fail intermittently with or without these changes.
