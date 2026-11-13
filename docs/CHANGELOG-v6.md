# v6 changes

1. **Drag to reorder brokers.** Drag the broker tabs on the Freight Signal page, or the grip handles in System > Brokers. Keyboard: focus a broker and press Alt+Left/Right (tabs) or Alt+Up/Down (list). The order is saved and survives reloads.
2. **DAT rate per posting.** Every row in the matrix has a "DAT rate" box for the rate actually posted on DAT. Type it on only the postings you want priced (for example 2 of the 9). When a load has any DAT rate typed, only those postings carry a rate in the CSV and the rest go out blank. With none typed, "Post target rate on DAT" behaves as before. "Use the target on all" clears the typed rates. The target rate still judges carrier replies.
3. **Clean is the default background.** New installs, and anyone who never picked a look, get Clean. Anyone who chose a background keeps it.
4. **Cover week resets Monday 00:00.** The week runs Monday to Sunday. Pace, "contacted this week" and the pace tooltip all use it, the app re-renders itself at the rollover, and the tooltip shows the week range and when it resets.
5. **Confetti at 50 covers.** One short, themed burst plus a small banner on the cover that reaches the weekly floor (System > Pace, default 50), once per week. System > Pace has a "Preview the celebration" button. It is skipped when reduced motion is on.
6. **Bigger checkboxes** on every posting row and the select-all box.
7. **Guided notes rewritten.** The clock starts when you download the DAT CSV (logged as "posted"). 0-30 min: hold the price. 30-60 min: refresh and re-post. 1-2 h: "something's not working", with a checklist specific to that load (DAT required fields, search your own lane, pickup date, rate against the last cover on the lane, contact method, equipment and weight). 2 h or more, or urgent pickup: escalation ladder (outreach, reprice, second wave, re-city, call, customer). Every note names the lane, equipment, pickup and rate. Stale threshold is 1 h for all lane classes.
8. **DAT RateView is a button** on the lane action bar and on every row, no longer inside a dropdown.
9. **Copy details works while collapsed.** A "Copy details" button sits on the collapsed load header.
10. **60-second tour** on first sign-in: 9 steps (welcome, Outlook, paste, matrix, post on DAT, guided notes, carrier database, inquiries, log the cover). Esc skips, arrow keys move. Replay from Home ("Take the 60-second tour") or the Manual.

Also: service worker cache is now `freight-signal-v6`; Manual updated; 15 new unit tests (99 total) and 109 browser checks.
