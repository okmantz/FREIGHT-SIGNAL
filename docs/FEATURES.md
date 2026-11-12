# Feature status

Legend: **Tested** = automated unit and/or browser test passes · **Partial** = built, only part verified · **Untested** = built, not verified here.

| Feature | Status | Evidence |
|---|---|---|
| TQL parse, multi-load split, manual correction, source preserved | Tested (synthetic fixtures) | unit + e2e |
| 9 postings (original + Nearby 1–8, 3×3, A-A…C-C order) | Tested | unit + e2e |
| ZIP Map load (33,782 rows), header validation, city→ZIP, distance, radius search | Tested | unit + e2e |
| Distance tiers configurable | Tested | unit |
| Exact macro formatting: RateView URL, outreach subject/body, "I can do" replies | Tested | unit |
| Weather link | Partial (opens; coordinate URL unverified) | unit builds URL only |
| Priority/target propagation, Covered removes group, counters | Tested | unit + e2e |
| Carrier Database CRUD, import (paste/CSV), export, search | Tested (CRUD/import); export Partial | e2e |
| Inquiry Log CRUD, filters, import/export, Approved → carrier upsert | Tested (add via processing, approve); manual edit/import Partial | e2e |
| Outreach drafts (Excel tiered; Outlook lane scan), blocklists | Tested | unit; Excel path e2e |
| Inbound e-mail processing (inquiry reply, rate within/outside target, repeat flag, filters) | Tested | unit + e2e |
| `.eml` (X-Unsent) / bulk ZIP / mailto / OWA / clipboard | Tested as files; **Untested in real Outlook** | unit + e2e + `unzip -t` |
| Persistence (IndexedDB), reload, backup/restore, bad-backup rejection | Tested | e2e |
| Offline use | Tested (network off after load) | e2e |
| Single-file build from `file://` | Tested | `single.mjs` |
| No external requests / no telemetry | Tested | e2e |
| Markup injection inert | Tested | e2e |
| Light/dark/auto mode | Tested | e2e |
| Account Settings: profile, 10 interface themes, accent colours (10 + custom), 16 backgrounds (animated scenes, seasons, gradient, own image), density, corners, type, sidebar | Tested | e2e |
| Copy original load details (lane header, each row, edit window, Spare cards) | Tested | e2e + unit |
| Spare Load Details | Partial (behaviour inferred) | manual only |
| DAT bulk-upload CSV (all / lane / selected / single), exact 24-column template header, DAT rate per posting or per lane | Tested against the real template header | unit + e2e |
| Lane boxes (one box per lane, 9 postings each), delete posting / selection / group, priority → target (5/10/15) | Tested incl. real-focus regression | e2e |
| City change → ZIP (origin and destination), equipment V R F SD VM RM | Tested | unit + e2e |
| Outlook bridge (folder feed + v4 macro) | App side tested with a stand-in folder; **VBA not run in real Outlook** | unit + e2e |
| Performance dashboard / HOME metrics | Partial (inferred formulas) | rendering only |
| Microsoft Edge | **Untested** (Chromium engine; only Chrome run) | – |
| GitHub Pages deployment | **Untested** (workflow written, not run) | – |
| Parity with your workbook | **Untested** — see PARITY-CHECKLIST | – |
