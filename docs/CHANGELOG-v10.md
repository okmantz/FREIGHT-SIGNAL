# v10: sortable databases, target rate when collapsed, "Find trucks"

## Carrier Database and Customer Database
* Every column header sorts. Click: A-Z (numbers low to high, dates oldest first). Click again: Z-A. Again: random order. Again: back to A-Z. Another column always starts at A-Z. Empty cells always sit at the bottom. The random order holds while you search or edit and only reshuffles on the next click.
* Carrier Database: filter row (equipment, origin state, status, last contact, has e-mail). **Truck check** drafts to exactly the carriers the filters show, so "every Van carrier in TX not contacted in 30+ days" is two clicks.
* E-mail cells are mailto links, phone cells are tel links, and a carrier's MC/DOT opens its FMCSA SAFER record (authority, insurance, safety rating) in a new tab.

## Load board
* A collapsed load shows its target rate as a quiet pill beside the lane title (a faint dashed "Target -" when none is set yet). It was already built but a style rule hid it when collapsed.
* New **Find trucks** menu on every load: ranked call list, **Truck check** (drafts "Do you have any trucks available in <pickup> heading toward <delivery>?" to the 15 best-matched carriers, skipping anyone already asked about the load or contacted in the last 24 hours), DAT Find Trucks, Google Maps carriers near the pickup, FMCSA SAFER, Google Maps route, weather. Drafts only; nothing is sent.

## Home
* Cover toolkit strip: DAT Find Trucks, DAT RateView, FMCSA SAFER, Google Maps, Ventusky.

## Under the hood
* New: `js/core/tablesort.js`, `js/core/resources.js`, `js/ui/tablesort.js`, `js/ui/cells.js`. Changed: carriers, customers, board and home pages, `store/state.js` (`truckCheck` can take a load; new `truckCheckForLoad`), `css/app.css`.
* No new network calls and no CSP change: the links only open when clicked.
* Tests: `tests/unit/v10.test.js` (sorting, MC/DOT parsing, link builders) and new checks in `tests/e2e/run.mjs`.
