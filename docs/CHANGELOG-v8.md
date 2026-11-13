# v8 changelog

1. **Target rate on collapsed loads** - a subtle chip next to the lane details.
2. **Rate increases are judged from what is posted on DAT.** If any posting carries its own DAT rate, the suggestion and the Raise button move those rates (the target stays put). With no DAT rates anywhere, the target is the posted rate, as before.
3. **Reshuffle postings** button on every matrix: replaces the 8 nearby postings with new, higher-cover-chance markets. Cities already tried are remembered and skipped; per-posting DAT rates carry over.
4. **"Ready to book" only when a carrier actually quoted a rate inside the band.** Rates are read only from the carrier's own words (quoted history, signatures and your own wording are removed first). The flag now names the carrier and the rate.
5. **Guided notes**: a new, lane-specific note every 30 minutes the load is live, written from the lane, the inquiry count and recency, quotes, and what has already been tried.
6. **E-mail logic rewritten** (`js/core/carrierreply.js`, shared with the Outlook macro through the config file). "rate?" -> "How close can you come to $X?"; "still available?" -> yes + ask for rate and ETA; a rate -> book / split / counter; "ok" to your counter -> confirm and ask for ETA; anything unclear, a question, a pushback, several rates, a per-mile rate, "call me" or a stop request -> no reply, flagged for you. Tested on 77 sample replies (`tests/fixtures/carrier-replies.json`).
7. **Danger zone: two auto-send switches** (inbound replies, outbound outreach), both OFF by default. Only the Outlook macro v6 can send; sends need the switch, the app's certainty, a single normal recipient and are capped per hour.

## Outlook macro v6
Replace the macro with `outlook/Outlook_v6_ThisOutlookSession.txt` (Alt+F11 > ThisOutlookSession), restart Outlook, then run `FS_Diagnostics` and `FS_SelfTest`. The VBA could not be run in a real Outlook while building this, so run `FS_SelfTest` first and keep auto-send off until it passes.

Old inquiry-log rows that were logged with a bogus rate can be fixed in the Inquiry Log.
