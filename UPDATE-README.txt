Freight Signal v20 update: paste these files over the repo (same paths, keep the folders), commit, push.
Every file here is new or changed; nothing else in the repo needs touching. Includes a rebuilt dist/freight-signal.html.

NEW OUTLOOK MACRO (needed only for IMPORT HISTORICAL EMAILS > "From Outlook"):
  outlook/Outlook_v7_HistoryExport.txt  ->  Outlook > Alt+F11 > Insert > Module > paste the whole file > save.
  Run with Alt+F8 > FS_ExportHistory. It only READS mail; it never sends, moves or deletes anything.
  (Without the macro you can still import: choose a saved export file, or select .eml files.)
  The existing v7 macro is unchanged.

After deploying, hard-refresh once (Ctrl+Shift+R) so the new service-worker cache (v20) loads.
Details: docs/CHANGELOG-v20.md
