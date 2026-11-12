# Audit of source material

Sources read in full: `Excel_v3.md` (ThisWorkbook VBA), `Outlook_v3.md` (ThisOutlookSession VBA), 9 screenshots (HOME, FREIGHT SIGNAL, DAT, Spare Load Details, Carrier Database, Inquiry Log + performance dashboard, ZIP Map, User Manual), the F5 logo PNGs, `freight_signal.ico`, and `uszips.csv` (the real ZIP Map).

## Macro → web-app mapping

| Workbook / macro behaviour | Web app | Module |
|---|---|---|
| Double-click AB → parse TQL cell (first `Pickup:`, **last** `Delivery:`, date, weight, trailer) | Paste → parse → review dialog | `core/parser.js` |
| Build 3×3 matrix (`SelectTwoAlternates`, tiers 20–60 / 0–100 / 0–200 / any, scoring by lane history + population − distance) | Matrix button + preview | `core/matrix.js`, `core/zipmap.js` |
| Load group id, Original / Nearby 1–8, alt miles, inquiry count | same fields | `core/matrix.js`, `core/model.js` |
| Priority → target (5/10/15), group-wide; status Covered deletes group | same | `core/model.js`, `store/state.js` |
| `OpenDATRateView` | link only (no pricing fetched) | `core/links.js` |
| Ventusky weather button | link (coordinate form unverified) | `core/links.js` |
| `DraftCarrierOutreach` (Excel; exact lane → state-to-state → origin state; suffix/exact blocklist) | Row *Outreach* (mode "excel") | `core/outreach.js` |
| Outlook lane scan (score, max 5/load, outreach log, substring blocklist) | *Run lane scan* / mode "outlook" | `core/outreach.js` |
| `InboxItems_ItemAdd` chain (inquiry reply, rate engine, flags, log stages) | *Process carrier e-mail* (paste) | `core/inbound.js` |
| Outlook `.Display` of drafts | `.eml` (X-Unsent), mailto, OWA link, clipboard, bulk ZIP | `core/eml.js`, `core/ziparchive.js` |
| Carrier Database / Inquiry Log sheets, Approved = Yes → carrier upsert | CRUD, import/export, filters | `ui/pages/*` |
| DAT sheet (columns A–T) | DAT tab, copy/CSV | `core/dat.js` |
| ZIP Map sheet + `ValidateZipMap` | bundled CSV, header validation, import | `core/zipmap.js` |
| HOME tiles / Performance dashboard | **inferred** definitions | `core/stats.js` |

## Findings in the original macros (preserved, flagged)

1. **Rate regex cannot match comma-formatted rates.** `[0-9]{3,5}(?:,[0-9]{3})?` fails on `$1,650` and `$12,000` (only `$1650`, `$12000`, `$120,000` match). Opt-in fix: *System → Recognise comma-formatted carrier rates*. Default = exact macro behaviour.
2. **Weight parser keeps every digit**: `38.5 lbs` → 385. The app warns when the line has a decimal point.
3. **`InitializeLoadControls` always resets the target to LOW (5)**, even for a row that was already High. Preserved.
4. **Group id timer part** is `Format(Timer*100,"000000")`, which is 7 digits after ~2:46 AM. Preserved.
5. Excel and Outlook use **different blocklist semantics** (suffix/exact vs substring) and different outreach engines. Both are kept, with separate lists.
6. **Subject spacing** `Load available: City, ST to City,ST` (no space after the second comma). Preserved exactly.
7. The macro's picks are **history-dependent** (inquiry counts feed the score), so identical pastes in a different workbook can legitimately pick different alternates.

## Deliberate deviations (all intentional, none hidden)

* Rows have stable ids instead of Excel row numbers; "Posting Row" is shown for reference.
* Outlook can't be watched from a browser → inbound e-mails are pasted; conversation id is derived from sender + normalised subject.
* Several loads can be pasted at once (the macro handles one per cell).
* ZIPs are trimmed before padding.
* Everything the workbook did through `MsgBox` is a dialog; nothing is silent.
