# v21: Auto Rescue that keeps escalating, primary-carrier stars, real search

## Auto Rescue
- Reaches primary/backup carriers first (first-look wording), then everyone else; call list puts primaries on top.
- Reshuffles the DAT postings when nothing moves: wider reach each round, a market across the state line, never repeats cities already tried, pauses while replies arrive, capped at 6. Single loads get a 3x3 matrix built automatically.
- Escalation rounds repeat every 60 min (30 on Fast) after the timed stages: reshuffle, rate step (+1% per round, never above your max), wider wave, fresh call list.
- Shrinking contact cooldowns (never below 4 h), Standard/Fast pace, max rate prefilled ~12% over target.
- Call outcomes (truck / call back / voicemail / no answer / no truck) are logged and respected.
- Repost banner: DAT only changes when you upload the CSV, so the banner shows a one-click "Download DAT CSV" until you do.
- "Reshuffle wider" in the load menu; "Reshuffle postings now" in the Auto Rescue window.

## Primary carriers
- Gold star on the avatar (outlined star for backup), tooltip names the lane. "Primary" quick view and group. Primary carriers get a ranking boost everywhere.

## Search (Carriers + Customers)
- Live as you type, ranked by relevance (name > MC > phone > email > location > notes), typo-tolerant, phone/MC in any format, optional filler words (inc, llc, trucking), "quoted phrases", operators (mc: st: city: equip: email: phone: name: primary: lane:), match highlighting, closest-match fallback. Clicking a column header switches back to column sorting.
