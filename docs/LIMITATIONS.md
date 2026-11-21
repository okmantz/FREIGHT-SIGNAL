# Known limitations

* **Parity unverified** against your real workbook/mailbox (see PARITY-CHECKLIST, OPEN-QUESTIONS).
* **TQL parser tested only on synthetic text.** A real block may expose label variations.
* **No inbox watching.** Browsers cannot (and should not) read Outlook; carrier replies are pasted.
* **Drafts, not Outlook-native drafts.** `.eml` opens as an editable unsent message in classic Outlook; behaviour in new Outlook / Outlook on the web was not tested. `mailto:` bodies are length-limited by the mail client.
* **No live pricing.** RateView/weather are links; the app cannot fetch DAT rates. The *suggested* target (v16) is computed only from your own covers, quotes and the DAT average you type, and is never used for an automatic reply until you confirm it.
* **Weather URL with coordinates unverified.**
* **DAT team codes (VM, RM):** written to DAT exactly as typed; confirm your DAT account accepts them. DAT Loadboard Rate is whatever you type (no pricing is computed).
* **Outlook v4 macro is untested in a real Outlook.** It could not be run here (no Outlook). Run `FS_Diagnostics` first. The Outlook *carrier outreach scan* of v3 stays in the app (Board → Run lane scan).
* **Outlook bridge needs Chrome or Edge** (File System Access API) and the app tab open; Chrome may ask to re-grant folder access after a restart.
* **Dashboard/HOME formulas inferred.**
* **Storage is per browser profile/origin.** Different browser, profile, URL, or moved `file://` path = separate data. Back up.
* **Single user, single device.** No sync. Two tabs of the same app can overwrite each other's edits (last write wins).
* **Chrome only was tested;** Edge shares the engine but was not run.
* **Large ZIP Map** (6 MB) is parsed on load (~1 s on a typical machine); first load on slow links is heavier. Cached afterwards.
* No Excel `.xlsx` import/export; use CSV or paste from Excel.

* **Outlook v7 macro is untested in a real Outlook** (v16). Run `FS_SelfTest`, keep *Drafts only* / *Shadow* until it passes and the readiness meter is green. Deferred delivery relies on Outlook running (or Exchange cached mode) at the delivery time.
* **E-mail accuracy is bounded, not perfect.** The safe-send policy sends only what it is certain about; everything else is drafted for you (Cover Desk → Needs you). Real replies will surface cases the 137-case corpus does not contain: add them to `tests/fixtures/email-corpus.json`.
