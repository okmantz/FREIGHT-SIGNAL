# Team Network (v14)

## Two ways to connect a team
| | Shared folder | Freight Signal account |
|---|---|---|
| Setup | pick the same folder (network drive, OneDrive / SharePoint) | needs cloud accounts (docs/CLOUD-SETUP.md) and the v14 rules published |
| Join | choose "Join with this folder" | 20-character invite code |
| Works in | Chrome / Edge on a computer | any browser |
| Speed | as fast as the folder syncs | about 30 seconds |
| Who is in | anyone who can open the folder | anyone with the code |

## Channels
Carrier alerts, Market talk, General. Trucks, rescues and lane data have their own pages, so there is no single inbox to wade through.

## What leaves your computer
Only what you press share on, plus (while "Share anonymous lane data" is on) lane events: lane, equipment, miles, rates, hours to cover, a carrier name and MC. Never customers, load text, notes, e-mail addresses or phone numbers of carriers (a carrier without an MC is identified by a one-way hash of the e-mail).

## Truck life cycle
Open until its expiry (4 h to 7 days, default 24 h). Anyone can mark it booked or withdrawn (a separate status record, so two people never overwrite each other). Only the publisher can put it back or re-list it. Expired records are deleted by their publisher's app a week later.

## Lane advice rules
A rate counts only if verified (a believable quote from the app's own inquiry flow, or a cover with a carrier and a rate close to the target). Advice needs 5 verified covers from 2 teammates in the last 180 days, same lane first, then lanes of the same equipment family and similar length. Otherwise the board says how much is still missing instead of guessing.

## Other boards
TruckSmarter: Row-Per-Load CSV exactly as documented; e-mail it to TruckSmarter's load intake. Trucker Path has no published bulk format: the app writes a standard sheet, or reproduces the header row you paste from their template and lists any column it could not fill. Delivery dates are estimates from miles and your miles-per-day setting.

## Limits
Folder teams rely on the folder's own permissions. Firebase rules were checked only against the app's model of them (tests/e2e/fake-firebase.mjs), not Google's emulator: after publishing, create a team and join from a second account once to confirm.
