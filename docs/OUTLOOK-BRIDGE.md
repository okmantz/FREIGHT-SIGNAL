# Outlook bridge

Outlook VBA cannot read data stored inside a browser (IndexedDB). Freight Signal therefore shares what Outlook needs through **one plain-text folder**, and the v5 macro reads and appends to it with ordinary VBA file I/O (no Excel, no ADODB, no references).

```
 Freight Signal (Chrome/Edge)                      Outlook (macro v5)
  ├─ freight-signal-postings.tsv   ───────────────▶  reads: which lanes are posted, target rate, details
  ├─ freight-signal-config.tsv     ───────────────▶  reads: rate proximity, plausible rate window, inbound blocklist
  ◀─ freight-signal-inquiries.tsv  ◀───────────────  appends: one line per Outlook action (inquiry draft, rate draft, flag ...)
  ◀─ freight-signal-outlook-status.txt ◀────────────  writes: heartbeat ("Outlook connected")
```

All files are ASCII, tab separated. Tabs/newlines inside a field are written as `\t` / `\n`, a backslash as `\\`.

## Setup (once)
1. Create `Documents\FreightSignal`.
2. Freight Signal → **System → Outlook connection → Choose Outlook folder…** → pick that folder → Allow.
3. Outlook → `Alt+F11` → *ThisOutlookSession* → paste `outlook/Outlook_v5_ThisOutlookSession.txt` → save → restart Outlook. (If your Documents folder is redirected or the folder lives elsewhere, set `FOLDER_OVERRIDE` at the top of the macro.)
4. `Alt+F8` → run **FS_Diagnostics**. It lists each file it found, the postings it read, the rate rules and the blocklist size.

Macro commands: `FS_Ping`, `FS_Diagnostics`, `FS_Reload`, `ProcessUnreadNow` (handle e-mail that arrived while Outlook was closed).

## What happens, step by step (same as the Excel + Outlook v3 workflow)
| Step | Outlook | Freight Signal |
|---|---|---|
| Carrier asks about a lane in a posting | Matches the lane (same scoring as v3: city/state in subject beats body), saves a reply with the load details + "What is your best all-in rate? ETA to pickup?", **displays** it, logs `INQUIRY_REPLY_SENT` | Adds the inquiry to the Inquiry Log, bumps the posting's inquiry count once |
| Carrier replies with a rate | Saves (not displays) either "How close can you come to $target?" or, within the proximity, "Please confirm your ETA to pickup." and flags it; logs `RATE_RESPONSE_SENT` + rate | Updates the same inquiry (stage, last rate, last action) |
| No rate detected | Flags `MANUAL REVIEW - NO RATE DETECTED` | Updates the inquiry |
| Another e-mail after a rate response | Flags `FOLLOW-UP - MANUAL REVIEW - NO AUTO REPLY`, no draft | Stage `FOLLOWUP_FLAGGED` |

Nothing is sent by the app or the macro. The *target rate* comes from the load's **Target rate** field (falling back to a posting's DAT rate override); it is used for e-mail decisions.

## Differences from v3 (deliberate)
* Reads the folder instead of `FREIGHT SIGNAL.xlsm`; postings are identified by a stable `PostingId` instead of a row number (row number is still logged).
* Inbound blocklist comes from **System → Blocklists** via the config file (no company domains in the macro).
* `IsForward` precedence bug fixed; "Val()" rate parsing unchanged; comma rates (`$1,650`) optional via System setting.
* v3's carrier-database outreach scan is **not** in the macro; use **Board → Run lane scan** (it creates the same drafts as `.eml` files).

## Not verified
The macro could not be executed in a real Outlook while building this. The file formats, matching, rate parsing and the app-side import are covered by automated tests (`tests/unit/bridge.test.js`, e2e "bridge" checks using a stand-in folder). Run `FS_Diagnostics`, then send yourself a test inquiry before relying on it.

## Troubleshooting
* *Outlook shows "waiting"*: run `FS_Ping`; confirm both sides use the same folder (`FS_Diagnostics` prints the path the macro found).
* *Folder asks for permission after restarting Chrome*: press **Reconnect folder**.
* *Errors*: the macro appends to `freight-signal-outlook-errors.txt` in the same folder.
