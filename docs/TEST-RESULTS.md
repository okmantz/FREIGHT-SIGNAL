# Test results

Run on 2026-11-12 in the build container: Node v22.23.4, Google Chrome via Playwright 1.63.0. **All results below are real output from those runs;** nothing is assumed. Items not run are listed under *Not tested*.

## Unit tests (`npm test`): 43 / 43 passed

- PASS rate extraction
- PASS new inquiry: matches the posting, logs it, drafts a reply (never sends)
- PASS no matching lane -> no draft
- PASS filters: blocklist, automated, forwards
- PASS conversation: rate far from target -> negotiate; near target -> ETA; then repeat -> flagged
- PASS .eml is an UNSENT draft with a decodable UTF-8 body
- PASS mailto / OWA links are encoded
- PASS store-only ZIP writer: CRC32 and archive structure
- PASS RateView URL matches the macro format exactly
- PASS weather link: fallback and coordinate forms
- PASS priority -> target mapping and group propagation
- PASS covering a posting removes its whole group only
- PASS Excel blocklist: suffix and exact; Outlook blocklist: substring
- PASS Excel outreach: tiered selection, subject, body, blocklist, never sends
- PASS Excel outreach: missing state is reported, not guessed
- PASS Outlook scan: respects max per load and never duplicates (load, email)
- PASS DAT export: column order A..T, header, CSV/TSV, one row per live posting
- PASS DAT header override replaces header text by position
- PASS parses the synthetic TQL fixture
- PASS equipment codes
- PASS weight keeps digits only (macro quirk) and a decimal point triggers a warning
- PASS malformed input is reported, never thrown
- PASS multi-stop uses first Pickup and LAST Delivery (and warns)
- PASS splitLoads: several loads in one paste
- PASS splitLoads: dashed separators and single block fallback
- PASS vbaRound uses banker's rounding like VBA Round()
- PASS normalizeZip pads to 5 digits and trims
- PASS haversine distance Chicago -> Atlanta is about 590 miles
- PASS normalizeDateString outputs m/d/yyyy without leading zeros
- PASS group id has the documented shape
- PASS formatCurrency0
- PASS CSV: quotes, embedded commas/newlines, CRLF round trip
- PASS CSV: BOM stripped and tab detection
- PASS real ZIP Map loads (33,782 rows) and resolves city -> ZIP
- PASS ZipMap rejects a file with missing headers with a readable error
- PASS matrix: exactly 9 postings, original + Nearby 1..8, all distinct lanes
- PASS matrix: 3x3 grid order (origin outer loop, destination inner loop)
- PASS matrix: alternates come from the ZIP Map and respect the 20-60 mile first tier
- PASS matrix: distance tiers are configurable
- PASS matrix: unknown city never invents geography
- PASS matrix: missing ZIP Map is a clear error
- PASS matrix: prior inquiries on a lane influence selection (history scoring) deterministically
- PASS hasAlternates blocks a second matrix on the same group

## Browser end-to-end (`npm run test:e2e`): 35 / 35 passed (3 consecutive runs, stable)

- PASS app boots; bundled ZIP Map loaded (33,782 rows)
- PASS branding present
- PASS parse review dialog shows parsed origin
- PASS load added to board
- PASS matrix preview lists 3 origins + 3 destinations
- PASS matrix creates exactly 9 postings
- PASS second matrix on same group is refused
- PASS DAT tab lists 9 rows
- PASS carrier added
- PASS carrier import (header recognised)
- PASS outreach creates drafts for matching carriers
- PASS outreach dialog states nothing was sent
- PASS .eml download is an unsent draft
- PASS drafts persisted on Drafts tab
- PASS bulk ZIP has valid signature
- PASS inbound e-mail creates a reply DRAFT
- PASS inquiry logged
- PASS Approved = Yes adds the sender to the Carrier Database
- PASS carriers survive reload (IndexedDB)
- PASS board survives reload
- PASS priority change applies to all 9 rows
- PASS High priority sets target 15
- PASS backup contains carriers, postings, inquiries
- PASS Covered removes the entire group
- PASS Covers counter incremented
- PASS restore brings the 9 postings back
- PASS bad backup rejected, data intact
- PASS HTML in data is rendered as text, not executed
- PASS ZIP Map search by ZIP
- PASS ZIP Map nearby markets within 20-60 miles
- PASS light theme applies
- PASS theme persists after reload
- PASS works with network off (board renders, data present)
- PASS no console/page errors during the run
- PASS no requests left the origin (no telemetry/CDN)

## Single-file build from file:// (`npm run test:single`): 7 / 7 passed

- PASS single file boots from file://
- PASS embedded ZIP Map decompressed (33,782 rows)
- PASS parse + matrix work in the single-file build
- PASS IndexedDB persists on file:// across reload
- PASS logo embedded
- PASS no console errors / CSP violations
- PASS no network requests

## What these tests do and do not prove

* Parsing is tested on **synthetic** TQL text I wrote from the macro's label logic, not on a real TQL export.
* Macro-parity is tested **rule by rule against the VBA source** (formats, tiers, regexes, state machine) — not against your live workbook output.
* The matrix test asserts structure (9 distinct lanes, order, 20–60 mi tier, ZIPs exist in the map), not that the picks equal Excel's.

## Not tested (be aware)

* Opening the `.eml` / mailto / OWA link in **real Outlook** (classic, new, web).
* Microsoft **Edge**.
* **GitHub Pages** deployment and the CI workflows (written, never executed).
* The live **RateView** and **Ventusky** pages (links are built and asserted, not opened against the sites).
* Behaviour on your IT-managed machine (policy blocks, storage clearing on exit).
* Parity with your real workbook (see PARITY-CHECKLIST.md).
