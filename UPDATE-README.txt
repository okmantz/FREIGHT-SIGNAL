Freight Signal v22 update: paste these files over the repo (same paths, keep the folders), commit, push.

NEW: trip miles on every load card, between the weight and the equipment.
NEW: target rate auto-fill uses the rule of thumb (miles x $2 + $200) when you have no history for the lane.
NEW: typed loads under 300 miles are picked up and delivered the same day.
See docs/CHANGELOG-v22.md.

dist/freight-signal.html is the rebuilt single-file version; it is only needed if you use that file.
After deploying, hard-refresh once (Ctrl+Shift+R).
