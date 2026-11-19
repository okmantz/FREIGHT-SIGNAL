# v14: Team Network

New, all optional. Nothing changes until someone creates or joins a team (sidebar: Team).

- **Team** hub: create a team in a shared folder (no accounts, no setup) or through the Freight Signal account (invite code). People, settings, contact details for other boards.
- **Truck Board**: share a truck after a carrier call (header button "Share a truck", or "Share" on a Carrier Database row). Search by origin ZIP + radius, destination, equipment, date, carrier / MC, e-mail. Trucks expire by themselves (default 24 h, configurable); anyone can mark one booked or withdrawn; only the publisher can put it back.
- **Load Rescue**: "Ask the team" (Find trucks menu, and a nudge after 90 quiet minutes) sends lane, equipment, pickup, target and what was tried. Teammates answer with carriers from their own database, nearby markets, rates, posting cities. The owner marks answers helpful and stays responsible.
- **Lane Intel**: shared, anonymous lane facts built automatically from covers, inquiries and outreach: inquiries, carriers contacted, covers, average carrier ask, last cover, responsive carriers, equipment, monthly trend. Only verified rates count. Advice such as "similar loads needed about $150 more" appears only with 5+ verified covers from 2+ teammates, and shows up on the board strip.
- **Channels**: Carrier alerts, Market talk, General. Messages expire after 14 days.
- **Other boards**: TruckSmarter CSV (their documented Row-Per-Load format) and a Trucker Path sheet (standard, or matched to the template header you paste), plus copy-ready post text.
- `database.rules.json` has the Team Network rules. `sw.js` cache v14. New CSS appended to `css/app.css`.
- Tests: 181 + 2 transport tests (unit), `npm run test:v14` (two browsers against a fake Firebase that models the rules).
