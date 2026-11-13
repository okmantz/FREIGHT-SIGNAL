# v7 changes

1. **Straight Box Truck (SB)** is in the equipment list, is recognised from TQL text ("Straight Truck", "Box Truck"), ranks carriers that list box trucks, and exports as `SB`. DAT RateView has no box-truck rate, so RateView uses Van for it.
2. **Checkboxes match the app.** Same rounded corners, border and accent as the inputs and buttons, a drawn check mark, hover and keyboard-focus rings. The switches keep their own look. A ticked row also gets a light highlight.
3. **60-second tour on Home.** A tour card sits under the Home numbers (plus the existing button in the top row). It replays the tour any time.
4. **DAT avg strip** at the top of every matrix. DAT does not publish a rate feed, so you type the RateView average once; it is kept on every posting of the load and shows $/mile, how old it is, and how your target compares. "Use as target" copies it into the target rate. Before an average is entered, the strip shows what that lane last covered at.
5. **Cleaner priority frame.** One hairline in the priority colour (green Low, amber Medium, red High), a soft tint from the top and a fading edge line, instead of a solid bar. **Collapsed** loads get a left-to-right colour wash and a left rail, so priority still reads at a glance.
6. **Find more carriers** button on every matrix. It opens DAT Find Trucks and copies the origin ("Chicago, IL"); the confirmation lists the destination, equipment and pickup to enter. DAT does not support a link that pre-fills that search.

Fix: picking a skin or background could be undone a moment later by an unrelated refresh (weather, timers, replies) before it finished saving. The look is now re-applied from storage only when the stored value actually changes. This made two browser checks flaky; they are stable now.

Service worker cache is `freight-signal-v7`. 102 unit tests, 121 browser checks.
