# v15: easier to learn, calmer to look at

No feature was removed; things were consolidated or folded away.

**Load card**
- One **Check market rate (RateView)** button per load (was three places). A posting's own RateView link is in its row menu.
- Action bar: Download DAT CSV, Carrier outreach, Mark covered, Copy details, plus *Find trucks* and *More* menus (Edit details, Reshuffle, Save to Spare, Delete). Find more carriers is inside *Find trucks*.
- Priority, contact, broker, reply note and lane scan moved under a *More options* line that shows their current values.
- Postings table is quiet until hovered; the per-row chart button is gone.

**Load Board**
- Empty board shows a 3-step guide; the paste box is compact once loads exist.
- Toolbar: search, filter, sort, Download all, *More* (Copy for DAT, Aging loads, lane scan, DAT-rate switch, collapse/expand). Aging shows as an amber button only when something is aging.
- "Work these first" appears only with two or more loads.
- Nav label renamed Freight Signal -> Load Board.

**Home**: self-ticking *Get started* checklist (Hide button), simpler hero.
**Everywhere**: sidebar sections fold (Team starts folded until you join a team); fixed hidden elements showing (empty pill, Share a truck for non-team users); friendly empty states on Carrier, Customer and Inquiry pages; Outlook guide folded by default on System; Team page shows only the folder option unless cloud accounts are on; manual and tour text updated.

**Tests**: updated for the new layout; e2e fixtures now use a future pickup date (the old fixed date expired and retired the test load).
