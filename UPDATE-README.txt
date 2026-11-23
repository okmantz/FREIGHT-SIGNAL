Freight Signal v20.1 update: paste these files over the repo (same paths, keep the folders), commit, push.

FIX: Auto Rescue no longer turns itself on. It only runs for a load after you press the Auto Rescue button
on that load and click "Start Auto Rescue". Stop now sticks (it was being re-created on the next minute tick).
Any rescue an older version started automatically is ended once, the first time the app loads this version.
The Owen "Start Auto Rescue" button now opens the same Start window instead of starting it directly.

After deploying, hard-refresh once (Ctrl+Shift+R) so the new service-worker cache (v21) loads.
