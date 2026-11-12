# Notes for IT / security review

* **Static site only.** No server component, no accounts, no database server.
* **No network use at runtime** except loading the app's own files from the host. No CDN, fonts, analytics, telemetry, or API calls. CSP (`connect-src 'self'`; single-file build: `connect-src 'none'`) enforces it; an e2e test fails if any request leaves the origin.
* **No secrets** in the repository. Blocklists ship empty and are entered at runtime.
* **No Outlook/Exchange/Graph access, no macros, no COM, no credentials.** The app cannot read or send mail. Outlook is touched only when *the user* opens a downloaded `.eml` or clicks a `mailto:` / OWA link.
* **XSS:** UI is built with DOM text nodes (no `innerHTML`); CSP forbids inline script in the hosted build and allows only hashed scripts in the single file. An e2e test injects `<img onerror>` into data and verifies it stays inert.
* **Outbound links** (`iq.dat.com`, `ventusky.com`, `outlook.office.com`) open in a new tab with `noopener,noreferrer`; no company data is put in those URLs except lane text for RateView (city/state/equipment) and, for OWA, the draft the user clicked.
* **Third-party data:** `data/uszips.csv` (licence to be confirmed). Dev-only deps: `playwright`, `esbuild`. No runtime dependencies.
* **Bypassing controls:** nothing in the app attempts to. The `.eml`/`mailto:` route is the standard supported way to create unsent drafts.
* **Data at rest** is unencrypted browser storage, like any web app on that profile; rely on disk encryption / profile controls.
