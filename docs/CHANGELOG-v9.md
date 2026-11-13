# v9 changelog: accounts (on this computer, or in the cloud)

0. **Accounts on this computer (default, no setup).** Sign in / Create account with e-mail + password. Several people can each have an account in the same browser; each gets their own private on-device database. The previous single sign-in keeps working and keeps its data. Forgot password resets on that computer (data kept). Delete account removes the account and its data. **Install app** button in Account Settings (desktop icon, own window, offline). `npm run test:local`.
   Also fixed: dialogs and messages opened from the sign-in screen (forgot password) were hidden behind it.

Everything below applies when cloud accounts are switched on:

1. **Real accounts.** Sign in / Create account screen (e-mail + password, Firebase Authentication). Anyone with the link can sign up and gets their own private workspace. Forgot password sends a real reset e-mail.
2. **Everything is saved to the account**: loads, matrix groups, carriers, customers, inquiries, outreach history, drafts, spare loads, cover log, counters and all settings (profile, appearance, templates, blocklists). Sign in on any computer and it is all there.
3. **Works offline.** IndexedDB stays the on-device working copy (now one database per person, so two people on one computer never see each other's data). Changes upload automatically (about 1.5 s after the last edit), and unsent changes survive closing the tab.
4. **Sync status** pill in the header (Saved to account / Saving... / Offline: will sync / Sync problem) and **Account Settings > Account & sync**: Sync now, **Invite people** link, change password, e-mail a reset link, sign out, sign out and remove this device's copy, delete account.
5. **Data from before accounts** found in the browser is offered to the first account that signs in there.
6. Changes made on another computer appear without reloading (checked on returning to the tab and every minute). Same list edited in two places at once: the latest save wins, with a notice.
7. `database.rules.json` (the privacy rule to publish in Firebase), `docs/CLOUD-SETUP.md` (5-minute setup), `js/config.js` (the two values to fill in).
8. **Single-file build fixed.** `scripts/build-single.mjs` expanded `$'`-style sequences inside the bundled JS, which corrupted `dist/freight-signal.html` (it had grown to 6 MB with 17 CSP tags and would not start). It now uses safe replacements; the rebuilt file is 2.7 MB and passes `npm run test:single`.
9. If `js/config.js` is left empty nothing changes: browser-only storage and the old local sign-in.

Tests: `npm test` (116 unit tests incl. new `tests/unit/cloud.test.js`), `npm run test:cloud` (30 browser checks against a fake Firebase: sign-up, sign-in on a second computer, isolation between people, the database rule, offline edits, password change, account deletion).
