# v11: edit load details after the matrix, and a reply note per load

## Edit load details after the 3 x 3 matrix exists
- New **Edit details** button in each load's action bar (also "View / edit load details" in the **...** menu). It opens the load's details in an editable box instead of a read-only one.
- **Save** writes the edited text to all 9 postings of the load, so it does not matter which posting a carrier's e-mail matches. The edit also survives **Reshuffle postings**.
- A preview underneath shows the first reply exactly as a carrier will get it (details, your note, then the ETA / rate question), and updates as you type.
- "Edit every field" on a single posting no longer lets the details or the note drift out of step with the other postings: those two fields are saved on the whole load.

## Reply note
- New **Reply note** field on every load card (for example "Need FMCSA sticker"). Type it, press Enter; it is saved on all 9 postings.
- In the first reply to a carrier inquiry the note goes **under the load details and above** "What is your best all-in rate? ETA to pickup?" (or above your target-rate wording when the carrier only asked "rate?"). No note = the reply is unchanged.
- Multi-line notes are supported (use the Edit details box).
- The Excel macro wrote `::` into the notes cell when empty. The app now treats that as "no note", so it can never appear in a reply. The Outlook macro already ignored it.

## Files
`js/core/loaddetails.js` (cleanNote, groupNote, detailsWithNote, applyLoadText), `js/core/inbound.js`, `js/store/state.js` (setLoadText), `js/ui/pages/board.js`, `css/app.css`.
Tests: `tests/unit/v11-notes.test.js`, `tests/e2e/notes.mjs` (`npm run test:notes`).
