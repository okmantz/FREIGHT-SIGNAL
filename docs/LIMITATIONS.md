# Known limitations

* **Parity unverified** against your real workbook/mailbox (see PARITY-CHECKLIST, OPEN-QUESTIONS).
* **TQL parser tested only on synthetic text.** A real block may expose label variations.
* **No inbox watching.** Browsers cannot (and should not) read Outlook; carrier replies are pasted.
* **Drafts, not Outlook-native drafts.** `.eml` opens as an editable unsent message in classic Outlook; behaviour in new Outlook / Outlook on the web was not tested. `mailto:` bodies are length-limited by the mail client.
* **No pricing.** RateView/weather are links; the app never fetches or estimates rates.
* **Weather URL with coordinates unverified.**
* **DAT header text unverified;** DAT Loadboard Rate not computed.
* **Dashboard/HOME formulas inferred.**
* **Storage is per browser profile/origin.** Different browser, profile, URL, or moved `file://` path = separate data. Back up.
* **Single user, single device.** No sync. Two tabs of the same app can overwrite each other's edits (last write wins).
* **Chrome only was tested;** Edge shares the engine but was not run.
* **Large ZIP Map** (6 MB) is parsed on load (~1 s on a typical machine); first load on slow links is heavier. Cached afterwards.
* No Excel `.xlsx` import/export; use CSV or paste from Excel.
