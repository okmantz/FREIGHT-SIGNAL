# FREIGHT SIGNAL — by O.K. Mantz

A local-first browser application that replaces the Excel (ThisWorkbook VBA) + Outlook (ThisOutlookSession VBA) freight automation workbook: paste TQL loads, build the 3 × 3 DAT posting matrix from a ZIP Map, draft carrier outreach, track inquiries and carriers.

* Plain HTML / CSS / JavaScript (ES modules). No frameworks, no runtime dependencies, no build step needed to run.
* **Accounts (v9).** Everyone signs in with an e-mail and password. By default (no setup) accounts live on the computer: several people can each have their own account in the same browser, each with private data, and they can install it as a desktop app. Optionally:
* **Cloud accounts:** with a free Firebase project connected ([docs/CLOUD-SETUP.md](docs/CLOUD-SETUP.md), 5 minutes), anyone with the link can create their own account; everything they enter is saved to it and follows them to any computer. Each person sees only their own data.
* Without the cloud setup, data lives in **this browser's IndexedDB** (one database per account) and nothing is uploaded. No telemetry, analytics, CDN or fonts. The only outside calls are the optional weather lookup and, when cloud accounts are on, Firebase (a CSP enforces it and a test checks it).
* **Never sends e-mail.** Every message is a draft you review: `.eml` file (opens in Outlook as an unsent draft), `mailto:` link, Outlook-on-the-web compose link, or clipboard.
* Chrome / Edge. Works offline after first load.

## Run it

| How | Steps |
|---|---|
| **GitHub Pages** (recommended) | Push to `main`; Settings → Pages → Source: *GitHub Actions*. The `Deploy to GitHub Pages` workflow publishes it. |
| **Single file, no server** | `npm install && npm run build` → open `dist/freight-signal.html` by double-clicking. (The CI run also attaches this file as an artifact.) Data is tied to that file's location: keep it in one place and use *System → Download backup* regularly. |
| **Local server** | `npm run serve` → http://127.0.0.1:8080 |

> Opening `index.html` directly from disk does **not** work (browsers block ES modules on `file://`). Use one of the three options above.

## Workflow

1. **FREIGHT SIGNAL** tab → paste one or many TQL loads → *Parse pasted loads* → review/correct → *Add to board*.
2. *Matrix* on the original row → preview of the 2 alternate origins and 2 alternate destinations (20–60 mi tier first, widening if needed; tiers are configurable) → confirm → original + 8 postings (A-A … C-C).
3. *Rate* (DAT RateView link), *Wx* (weather link), priority (Low 5 / Medium 10 / High 15 targets), *Outreach* (carrier drafts).
4. Type one **Target rate** for the load (it is posted on DAT and judges carrier replies) and press **Download CSV** on the lane (or **Download all**, **Download selected**, or the row's **CSV**). The file is DAT's bulk-upload template exactly (24 columns, LF, no BOM). The *Target $* column is for incoming e-mail only and is never exported.
5. **Outlook:** System → *Outlook connection* → choose your `Documents\FreightSignal` folder, then paste `outlook/Outlook_v5_ThisOutlookSession.txt` into Outlook. See `docs/OUTLOOK-BRIDGE.md`.
5. **Inquiry Log** → *Process carrier e-mail* (paste a carrier reply → logged + draft reply), approve carriers into the **Carrier Database**.
6. Status = **Covered** removes the whole load group and bumps the covers counters.

## Documentation

`docs/` — [CLOUD-SETUP](docs/CLOUD-SETUP.md) · [AUDIT](docs/AUDIT.md) · [OPEN-QUESTIONS](docs/OPEN-QUESTIONS.md) · [FEATURES](docs/FEATURES.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [DATA-STORAGE](docs/DATA-STORAGE.md) · [SECURITY-IT-REVIEW](docs/SECURITY-IT-REVIEW.md) · [PARITY-CHECKLIST](docs/PARITY-CHECKLIST.md) · [TEST-RESULTS](docs/TEST-RESULTS.md) · [LIMITATIONS](docs/LIMITATIONS.md) · [TROUBLESHOOTING](docs/TROUBLESHOOTING.md)

## Tests

```
npm install
npm test                 # 116 unit tests (node:test)
npx playwright install chromium   # or: PW_CHROME=/path/to/chrome
npm run test:e2e         # 35 browser checks against a local server
npm run test:local       # 16 browser checks of on-computer accounts (several people, upgrade, reset, delete)
npm run test:cloud       # 30 browser checks of sign-up / sync / isolation against a fake Firebase
npm run build && npm run test:single   # single-file build from file://
```

## Data in this repo

* `data/uszips.csv` — the ZIP Map supplied by the owner (33,782 rows; looks like a SimpleMaps export — **confirm its license permits redistribution in a repo / Pages site before making the repo public**).
* `data/sample/` and `tests/fixtures/` — synthetic, clearly fictional. No customer, carrier or load data is included. Blocklists ship **empty**; enter them in *System* (stored only in the browser).
