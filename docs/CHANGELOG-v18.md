# Freight Signal v18

## Owen's portraits
- Owen's avatar is now four high-quality portraits (`assets/owen/owen-1..4.webp`) that crossfade in the top bar and change with his mood in the chat
  (thumbs-up when you are on pace or he says thanks, hand-on-chin when he is working something out, relaxed for small talk).
- Header avatar 40 px with a glowing accent ring; chat header 68 px; message avatars 38 px.

## Top bar
- The "ZIP map: 33,782 rows" pill is gone. The cover-pace strip (Today / Week / Short) moves over to fill the space.

## Owen's brain (still 100% offline: no AI service, nothing leaves the browser)
- Reads your whole workspace for every question: open loads, cover log, carriers, customers, trucks, inquiries, held e-mails, pace, settings.
- Understands small talk ("How are you?", jokes, thanks, stress, "what can you do"), date ranges ("covers yesterday", "last week"), typos, and follow-ups ("and this week?", "what about it?").
- New answers: daily summary, "what should I work on first", pace and trend, business analysis, any load / carrier / customer / lane / rate, trucks near a city, best carriers for a lane, held e-mails, settings.
- Calculators: per-mile, margin and markup, price for a target margin, drive time, plain arithmetic.
- About 60 freight terms (deadhead, TONU, detention, ratecon, FSC, COI, ...) and a broker playbook (negotiating, vetting a carrier, silent carriers, follow-ups).
- Rich replies: key facts, ranked rows, numbered steps, buttons, suggested follow-up chips, typing indicator, up-arrow recalls your last question.
- New files: `js/core/owentext.js`, `js/core/owenbrain.js`, `js/core/owendata.js`. Old answers and tests are unchanged.

## Profile pictures
- Account Settings > Profile has a picture picker: Initial (default, first letter of your name) plus King, Queen, Rook, Bishop, Knight and Pawn on a glowing ring.
- Shown in the top bar chip, the profile card and the Team page. Keyboard friendly (arrow keys).

## Load board paste
- Cleaner paste card (auto-growing box, dashed action bar). Same buttons; "Add load" (singular for one load, "Add N loads" when you paste several).

## E-mail replies
- Nothing that was read correctly changes. Added readings: "is this still covered?" / "still avail" (asks availability), "booked already" / "we are full" (decline),
  "still waiting on your rate" / "lowest you can go" (asks rate), paperwork questions (invoice, POD, W-9: held for you), "any update / checking in" (flagged for you, never auto-answered),
  and a truck + timing message keeps the truck lead.
- **Teach it:** on Cover Desk, a message it did not understand has a "This message means..." menu. Pick what it meant and Freight Signal reads the same wording that way next time,
  using YOUR standard reply for that meaning. A lesson only upgrades messages the rules could not read (never a rate, decline or stop), drafts for review, and only becomes eligible to send itself after 3 confirmations. Forget any lesson from the same screen.

## Under the hood
- Service worker cache `freight-signal-v18`; single-file build inlines the Owen portraits and chess pictures.
- Tests: 244 unit tests (7 new). E2E checks updated for the removed ZIP pill.
