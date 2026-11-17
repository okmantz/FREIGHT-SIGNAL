# v13 - full DAT equipment list, load-visibility fixes

## Equipment
* The equipment list is now DAT One's complete list: 80 types (V, R, F, AC, BT, CN, C, CI, CR, CV, DD, LA, DT, FA ... PT, PL), in DAT's order, one entry per code and per name. `js/core/defaults.js` de-duplicates it on load and `tests/unit/equipment.test.js` fails if a duplicate or a missing type ever appears.
* Two names changed to DAT's own wording: VM = "Van w/Team" (was "Van Team"), RM = "Reefer w/Team" (was "Reefer Team"). Codes did not change, so saved loads are unaffected.
* New `js/core/equipment.js`: each type belongs to one or more families (van / reefer / flatbed / step deck / box / power only / sprinter). RateView, the carrier-database equipment match and "Find more carriers" use it, so e.g. a Flatbed Conestoga (FN) no longer opens a *Van* RateView and no longer ranks van carriers first. RateView only knows Van / Reefer / Flatbed, so every type maps to the closest.
* Pasted TQL "Trailer Type:" text now maps to the right DAT type. **"Van or Reefer" used to become plain Van (hiding the load from reefer trucks); it is now VR.** Same for Flatbed or Step Deck (FD), Flatbed/Van/Reefer (FR), Lowboy, Conestoga, Power Only, Sprinter, Hazmat and the rest. Plain Van / Reefer / Flatbed / Step Deck / Box Truck / Team give the same codes as before.
* The equipment drop-down shows "VM · Van w/Team" instead of a bare code.

## Accuracy fixes that affect what carriers see
* **Weight.** The macro kept every digit on the Weight line: `38,000.00 lbs` became 3,800,000 lbs and `42000 lbs (40 pallets)` became 4,200,040. A posting that heavy is filtered out by carriers' searches. The first number on the line is now used (commas and cents handled). A weight over 80,000 lbs, or under 100, now shows a warning when you paste.
* **City-name matching on inbound e-mail.** A carrier e-mail that says "St. Louis" / "Ft. Worth" / "Mt. Vernon" did not match a posting stored as "Saint Louis" / "Fort Worth" / "Mount Vernon" (the ZIP Map spells them out), so the inquiry was silently dropped: no draft, no count. St./Saint, Ft./Fort and Mt./Mount are now the same on both sides, in the app (`util.js`) **and in the Outlook macro (v6.1 - paste it again)**.

## New, off by default: System -> "DAT reach (more inquiries)"
* *Post a Van as "Van or Reefer" and a Flatbed as "Flatbed or Step Deck"* - export only; the board keeps the real equipment. A Step Deck is never widened.
* *Turn on DAT Extended Network for every posting* - needs a DAT plan that includes it.

## Tests
157 unit tests (was 146). E2E: the two equipment checks were updated to the new list. `board survives reload` and the check after it fail in this build environment on the unmodified repo too.
