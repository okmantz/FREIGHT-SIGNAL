# v16: smarter e-mail, faster truck coverage

Two goals: carrier replies get an accurate answer (and the routine ones can go out safely on their own), and covering a hard load takes fewer clicks. Nothing was removed.

## The honest limits (read first)
- **No live DAT data.** DAT RateView has no public API and the app cannot read it. The suggested target rate is computed from *your own* covers, the carrier quotes you received and the DAT average you type in. It is a good starting number, not a market quote. It is marked "suggested" until you confirm it, and a suggested rate is never used for an automatic reply.
- **The Outlook macro (v7) could not be run here.** It is a careful port of the tested JavaScript, structurally checked, but nobody has run it inside a real Outlook. Run `FS_SelfTest` first; keep the mode on *Drafts only* or *Shadow* until it passes and the readiness meter agrees with you.
- **"100% accurate" is not claimed.** What is built instead: a precision-first send policy (when in doubt, it drafts and asks you), an exception queue for everything held back, a shadow mode that measures how often you would have agreed, and a 137-case audited regression corpus that every change must pass.

## E-mail (the big one)
- **Reads what the carrier meant, not just numbers.** MC/DOT numbers, phone numbers, ZIPs, addresses, dates and times are no longer mistaken for rates ("1650 can be there by 3pm" is an ETA). "Is it $1,500?" is a question, not a quote. Ranges and two amounts are flagged, per-mile is flagged, "about 1500" and "fifteen hundred" are read but marked *weak*.
- **New situations understood:** thanks / out-of-office (ignored, quietly logged), "send details", "what else do you have" (a truck lead), MC/DOT sent, "talk to my dispatcher", pushback, "call me", bare "booked"/"pass".
- **Better replies:** a carrier who comes down to or under your last offer = agreed; the same rate twice = flagged as a stalemate; the engine never counters backwards. Every message that needs a person still gets a ready-to-edit suggested reply.
- **Safe-send policy (System → Email sending):** *Drafts only* (default) · *Shadow* · *Routine* · *Routine + rate-confirming*. Gates: exact lane match, confirmed target, no weak rate, no extra charges, short thread, per-conversation/day/hour caps, no duplicate kind, optional work hours, ≤600 characters, ≤2 questions, no attachments, no no-reply/own address, delayed delivery (an undo window).
- **Persistent ledger:** every e-mail is processed once (also across restarts); every auto-send is counted.
- **Cover Desk → Needs you:** the exception queue. Each held-back message shows what the carrier said, what the engine would reply and, in plain words, why it was held. Approve, edit or mark it right/wrong; the readiness meter needs ≥98% agreement over ≥30 judged replies.

## Covering trucks
- **Cover Desk** (new, under Workspace): who to call first, the truck book, load bundles/swaps, and which DAT posting combinations actually produce qualified replies.
- **Truck book:** paste a carrier's "truck available" e-mail or a list; it reads equipment, origin, desired destination and dates, merges duplicates, and fades trucks as they go stale (full for 4 h, zero after 36 h). Trucks found in carrier replies are added automatically.
- **Coverage strip on every load:** the best trucks and carriers for that load, with freshness and why, plus backhaul loads for a truck.
- **Carrier consolidation:** duplicate carriers (same MC, e-mail or name) are merged by one button on the Carriers page; the call sheet ranks prospects.
- **Corridors and difficulty:** thin-outbound states (e.g. PA→VA, AZ→FL style lanes) raise the suggested rate and the effort estimate; backhaul pitches name the truck's likely next load.
- **Suggested target rate per load** (blend of your covers, quotes, DAT average you typed and team lane stats), shown as "suggested" until you confirm it.
- **Adaptive DAT matrix:** the nine geographic combinations are scored with quality-weighted, recency-weighted inquiry results (turn off in System).

## Files
New: `js/core/{sendpolicy,ledger,truckbook,corridor,raterec,prospects,effectiveness}.js`, `js/ui/pages/coverdesk.js`, `js/ui/board/coverage.js`, `outlook/Outlook_v7_ThisOutlookSession.txt`, `scripts/gen-selftest.mjs`, `tests/fixtures/email-corpus.json`, six new test files.
Changed: carrier-reply, inbound, ladder, matrix, defaults, bridge, store (IndexedDB v4: `trucks`, `ledger`), board, system, carriers, main, css.
Outlook: replace v6 with v7, then run `FS_Ping` and `FS_SelfTest`.
