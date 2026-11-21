# Freight Signal v19

## Load board
- The paste box says "Paste load data here to add to board". "TQL" is gone from the Load board page (placeholder, steps, tooltips, edit dialog) and from the first-run tour step.
- **Type a lane instead of pasting a load.** One load per line, in any of these forms: `aiken sc-fletcher ok`, `aiken sc to fletcher ok`,
  `Aiken south carolina to fletcher oklahoma`, `Aiken, SC -> Fletcher, OK`, `aiken sc fletcher ok`, `from aiken sc to fletcher ok`.
  Cities are checked against the ZIP Map (St / Saint, Ft / Fort, Mt / Mount, hyphens and one- or two-letter typos are handled; a typo fix is flagged in the row).
  ZIPs fill in automatically, or type them (`Aiken SC 29801 to Fletcher OK 73541`).
- **Defaults when not typed:** 53 ft dry van, 40,000 lbs, pickup today. Optional extras on the line override them: `reefer`, `flatbed`, `45,000 lbs` / `45k`, `11/25` or `tomorrow`, `48ft`.
- **Load details are always built in the standard layout** (1 pick - 1 drop, Pickup / Delivery with FCFS 08:00 to 16:00, Weight, Commodity, Temp, Miles, Trailer Type, Trailer Size)
  and saved as the load's details, so Copy details, the first reply to a carrier and Edit load details all use them. The delivery date is the pickup plus one day per 500 miles (at least one day).
  The details are rebuilt from whatever is in the preview row when you press Add, so a weight or pickup date you fix there carries through.
- A paste that has `Pickup:` / `Delivery:` labels (a real load) is read exactly as before and keeps its own text as the load details.
- Overview cards (Active loads, Need attention, Ready to book, Inquiries in), the Worklist and the Scoreboard now sit directly under the page header, above the paste box.

## Files
- New: `js/core/quickload.js`, `tests/unit/quickload.test.js`, `tests/e2e/v19.mjs` (`npm run test:v19`).
- Changed: `js/ui/board/flow.js`, `js/ui/pages/board.js`, `js/core/tourSteps.js`, `sw.js` (cache v19), `package.json`, `dist/freight-signal.html` (rebuilt).
