# Parity checklist (run against your workbook)

I could not run your Excel/Outlook, so parity is **not verified**. Do this once:

1. Export your workbook's `ZIP Map`, `Carrier Database`, `Inquiry Log` to CSV/paste from Excel; import into *Carrier Database → Import…* and *Inquiry Log → Import…* (history changes which alternates win).
2. Take 3–5 real loads you already built in Excel. Paste the same TQL text into the board.
3. Compare, per load: parsed origin/destination/date/weight/equipment; the six alternate markets (names and miles); group of 9 rows; target for each priority.
4. Compare RateView URL (open both), outreach subject/body for one carrier, and the list of carriers drafted.
5. Paste two real carrier replies into *Process carrier e-mail* and compare the draft with what Outlook produced.
6. Record differences; likely causes: macro version (open question 12), inquiry history, comma-rate quirk (13), blocklist entries.

Known expected differences are in `AUDIT.md` ("Deliberate deviations").
