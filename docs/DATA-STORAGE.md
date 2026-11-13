# What is stored where

Everything is in this browser profile's **IndexedDB** database `freight-signal` (origin-scoped: the Pages URL, or the specific `file://` path for the single-file build). Nothing is stored on any server **unless cloud accounts are switched on** (see below).

## Accounts on this computer (v9, default)

Each account has its own IndexedDB database (`freight-signal-l-<id>`; the first account on a browser that already held data keeps the original `freight-signal`). The account list (e-mail, salted password hash, database name) is in `localStorage` key `fs-local-accounts`; the signed-in marker is `fs-local-session`. Deleting an account deletes its database. Use *System > Download backup* to keep or move a copy.

## Cloud accounts (v9, optional)

When `js/config.js` holds a Firebase project, the database is named `freight-signal-u-<account id>` (one per person on that browser) and is the on-device copy of the account. Every list except the ZIP Map and the Outlook folder handle is also saved to `users/<account id>/` in Firebase Realtime Database: `stores/<name>` (the rows as JSON text) and `rev/<name>` (a random token that changes on each save, used to detect changes from another computer). `localStorage` holds the sign-in token (`fs-cloud-session`) and, per account, which revisions were last synced and which lists have unsent changes (`fs-sync-<id>`). The local password record in the settings is never uploaded. Setup and privacy notes: [CLOUD-SETUP](CLOUD-SETUP.md).

| Store | Contents |
|---|---|
| `postings` | board rows incl. source TQL text, matrix group ids, priority/status |
| `carriers` | Carrier Database |
| `inquiries` | Inquiry Log |
| `outreach` | log of (load, carrier) outreach drafts used to avoid duplicates |
| `drafts` | generated e-mail drafts (text only) |
| `spares` | Spare Load Details |
| `kv` | settings (targets, tiers, **blocklists**, theme) and counters |
| `zipmap` | cached copy of the ZIP Map CSV |

Also: without cloud accounts `localStorage` is not used for data (the theme mirror and sign-in markers only). A service worker caches the app files (not your data).

**Backup:** *System → Download backup (.json)* contains everything above except the ZIP Map. It holds carrier e-mail addresses and load details — treat as confidential. Restore validates the file before changing anything.

**Risks:** clearing site data / browser cleanup tools / a different profile or browser = data not visible. Use backups. `navigator.storage.persist()` is requested to reduce eviction.
