# v22

## Trip miles on every load
The line under the lane title now reads `lbs · miles · equipment · pickup date · target ...`. The miles are the `Miles:` figure from the pasted TQL load when there is one, otherwise the ZIP Map estimate (straight line x 1.15). A pasted figure that is far from the ZIP Map estimate (the cities were edited after pasting) is ignored. (`tripMiles` in `js/core/lanes.js`.)

## Target rate auto-fill
When a load has no target and you have no covers, quotes or DAT average for the lane, the suggested target is now the rule of thumb: **miles x $2 + $200** (700 miles = $1,600), rounded to $25, never under $450. Reefer and flatbed are 15% higher, other equipment 20%. Hard-lane premiums still apply on top, and your own covers, quotes and DAT average still outweigh the rule once you have them. A typed target is never overwritten. (`ruleOfThumbRate` in `js/core/raterec.js`.)

## Same-day delivery on short typed loads
A load typed as a lane ("hayward ca to oakland ca") under 300 miles now gets the same delivery date as the pickup date. 300 miles and over is unchanged: one day per 500 miles, at least one. When the miles cannot be worked out (ZIP Map not loaded) the old next-day default stays.
