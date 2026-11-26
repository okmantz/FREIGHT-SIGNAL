# v23

## The More menus can no longer be cut off
The **More** button on the Carrier Database, Customer Database and Inquiry Log (and every menu on the Load Board: *More board actions*, *Find trucks*, each load's and each posting's "more actions") used to open a list pinned to the button's right edge. When the toolbar wrapped and More landed at the left of the page, half of the list slid under the sidebar. Now every menu list is fixed to the screen and placed by `wirePopover` (`js/ui/dom.js`):

* it opens under the button with the left edges lined up, and swaps to right-aligned when that would run off the right edge;
* it flips above the button when there is no room below, never slides under the page header or a pinned toolbar, and scrolls inside itself on a short window;
* it follows its button if you scroll the page, closes with Esc or a click anywhere else, and works from the keyboard (Enter or Down opens it, arrow keys move, Esc closes);
* a load card with a menu open is lifted above the load cards below it, so the list is never painted over.

The toolbar buttons on those pages are now one group (Add, Import, Truck check, **More**) that stays together when the row wraps. The old code also added a document click listener every time the page was drawn; that leak is gone (one shared listener now).

## Covering faster
* **Home is now a work queue.** With loads on the board, the big banner shrinks and **Work next** sits on the first screen: the 5 loads most worth your time (same ranking as the board's worklist), each with **Open** (scrolls the board to it) and **Covered** (opens Mark covered). A button shows how many carrier e-mails need you and opens the Cover Desk. The Cover Desk and Cover Log now have Home tiles.
* **Covered is one click on a collapsed load.** A collapsed load card on the board now has **Covered** beside **Copy details**.
* **Cover Desk call sheet.** *Call these first* now comes right after *Needs your eyes* (the per-load truck-match numbers moved below the trucks). Each row has **Call**, **E-mail** and **Covered by them**, which opens Mark covered with the carrier already filled in. The same **Covered: best load** button is on each available truck.
* **Mark covered by keyboard.** Enter in any one-line box presses the main button, so a cover is: click Covered, type the rate, Enter. The cursor starts in the carrier or rate box, the rate box opens the number pad on touch screens, and a double click can no longer log a cover twice.
* **Every dialog** now puts the cursor in its first box, returns it to where you were when it closes, and presses its main button on Enter (not in a box that offers suggestions, so picking a suggestion cannot submit the form).
* **Keyboard shortcuts** (only when you are not typing, never with Ctrl/Alt/Cmd): `n` new load (Load Board, cursor in the paste box), `/` search this page, `g` then `h b d l c u i r` to jump to Home, Board, Cover Desk, Cover Log, Carriers, Customers, Inquiry Log, Drafts, `?` for the list. There is a "Keyboard shortcuts" link at the bottom of the sidebar.
* **The browser tab shows what needs you**, for example `(2) Cover Desk · FREIGHT SIGNAL by O.K. Mantz`, so you see a held carrier e-mail while you are working in DAT or Outlook.

## Speed
Changes to the data (adding ten loads, a cover, a bulk import) used to redraw the page once per change, and two redraws could overlap. They are now folded into a single redraw (`render` in `js/main.js` waits for a running draw and runs one more afterwards; store changes made in the same moment share one draw).

## Files
`js/ui/dom.js` (menu placement, dialog behaviour), `js/ui/directory.js`, `js/ui/shortcuts.js` (new), `js/main.js`, `js/ui/pages/{board,carriers,customers,inquiry,home,coverdesk}.js`, `js/ui/board/cover.js`, `css/app.css`, `sw.js` (cache v23), `tests/e2e/v23.mjs` (new, `npm run test:v23`), `dist/freight-signal.html` (rebuilt).
