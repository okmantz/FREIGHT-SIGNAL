Freight Signal v21 update: paste these files over the repo (same paths, keep the folders), commit, push.

NEW: Auto Rescue reshuffles cities and nearby states, escalates every round, reaches primary carriers first, logs call outcomes, and shows an "Upload to DAT" banner with a one-click CSV download.
NEW: gold star on primary carriers (Carriers page, call list, Auto Rescue), plus a Primary view.
NEW: rebuilt Carrier and Customer search: live, ranked, typo-tolerant. See docs/CHANGELOG-v21.md.

Reshuffles and rate changes only change Freight Signal. Re-upload the DAT CSV (the banner prompts you). Nothing is ever sent automatically.
After deploying, hard-refresh once (Ctrl+Shift+R) so the new service-worker cache (v22) loads.
