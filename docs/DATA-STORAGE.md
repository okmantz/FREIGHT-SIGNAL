# What is stored where

Everything is in this browser profile's **IndexedDB** database `freight-signal` (origin-scoped: the Pages URL, or the specific `file://` path for the single-file build). Nothing is stored on any server.

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

Also: `localStorage` is not used. A service worker caches the app files (not your data).

**Backup:** *System → Download backup (.json)* contains everything above except the ZIP Map. It holds carrier e-mail addresses and load details — treat as confidential. Restore validates the file before changing anything.

**Risks:** clearing site data / browser cleanup tools / a different profile or browser = data not visible. Use backups. `navigator.storage.persist()` is requested to reduce eviction.
