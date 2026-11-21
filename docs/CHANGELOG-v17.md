# v17

- **Matrix line fixed.** The checkbox cell was being turned into a flex box by a generic style, so its bottom border sat at a different height than the rest of the row. It is a normal table cell again: one continuous line.
- **Auto Rescue** (button on every load): instant match, first wave, widen markets, rate check within the limit you authorise, team rescue, and continuous re-evaluation when a truck, quote or reply appears. Each step changes strategy. A per-carrier and per-load contact cap stops repeat offers. Hard lanes with no replies start it automatically (System setting `autoEscalateHard`). Intervals are proposed, not guaranteed; it runs while the app is open and catches up when you return. It makes drafts only, and raises the rate only up to your stated maximum.
- **Two-way matching engine.** Every new load is matched against every available truck (yours and the team's); every new truck against every open load. Cover Desk shows qualified trucks per load (the success metric).
- **Redesigned lists:** Carrier Database, Customer Database (grouped by company), Cover Log (by day), Inquiry Log (by day), Spare Loads (cards). Search, quick views, filters, grouping, click a row to open its details.
- **Load board:** worklist and scoreboard fold into one collapsible section.
- **Owen** ("What would Owen do?", top bar): offline helper for navigation questions and load-aware advice, with a one-click Auto Rescue start.
- Database version 5 (`matches`, `autorescues` stores).
