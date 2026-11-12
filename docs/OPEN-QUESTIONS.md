# Missing / unverifiable information (please answer or supply)

Each item is something the supplied files did not contain. The app uses the stated default and keeps it easy to change.

| # | Question | Current behaviour |
|---|---|---|
| 1 | A **real TQL load text block** (the screenshots truncate it). | Parser built from the macro's label logic; tested only on a **synthetic** fixture. Paste a real one (redact names) and run it. |
| 2 | ~~Exact DAT bulk-template header text~~ | **Resolved:** the real template was supplied; the export uses its exact 24-column header (tested). |
| 3 | **Formulas for HOME tiles and the Performance Dashboard.** | Inferred (see `core/stats.js`). |
| 4 | **DAT Loadboard Rate (col L)** logic. | Typed per posting or per lane box; exported as whole dollars. Separate from the target rate. |
| 5 | **Ventusky URL** the workbook button opens. | `ventusky.com`; with coordinates `?p=lat;lng;8&l=temperature-2m` (**unverified**). |
| 6 | What does **SYSTEM CONTROL CENTER** do? | *System* page covers settings, backup, blocklists, counters. |
| 7 | **Spare Load Details**: exact macro behaviour. | Inferred from the screenshot (park/restore load groups). |
| 8 | **User Manual** text below section D; High target vs `HIGH_TARGET = 15`. | New manual written from the macros. Defaults 5/10/15. |
| 9 | Outlook `IsForward` line syntax / exact filter semantics. | FW:/FWD: subject prefix. |
| 10 | **Inquiry Log history** for parity runs. | Import via *Inquiry Log → Import…*; see PARITY-CHECKLIST. |
| 11 | **ZIP Map licence** (looks like SimpleMaps `uszips.csv`). | Bundled as supplied. Confirm redistribution terms before a public repo. |
| 12 | The screenshot's San Leandro → Hayward pick (< 20 mi) contradicts v3's 20–60 first tier. | Code follows v3 as supplied; your workbook may be a different macro version. |
| 13 | Should comma rates (`$1,650`) be recognised? | **Decision needed** (macro does not). Off by default. |
| 14 | "Approved from Inquiry Log…" note on Carrier Database isn't produced by v3. | `Notes` stays as typed. |
| 15 | Is a **covers counter** formula in the workbook? | App increments on Covered (inferred). Editable in *System*. |
