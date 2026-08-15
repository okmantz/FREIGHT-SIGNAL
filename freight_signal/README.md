# Freight Signal © (by O.K. Mantz)
**Intelligent Carrier Sourcing Optimization Engine**

A standalone Windows desktop app that replaces the Freight Signal Excel/VBA
workbook and Outlook macro with one self-contained, no-coding-required
application. Sleek dark/light UI, local SQLite storage, DAT-ready CSV
export, and Outlook drafting/inbox integration.

---

## What's in this zip

```
freight_signal/
  main.py                     <- app entry point
  requirements.txt
  freight_signal/             <- all application code
    app.py                    <- main window / sidebar navigation
    theme.py                  <- design tokens (black/silver/blue palette, matches the logo)
    db.py                     <- local SQLite persistence
    parsing.py                <- load-details text parser
    geo.py                    <- adaptive, self-optimizing nearby-city scoring
    engine.py                 <- posting matrix generator (never duplicates a lane)
    csv_io.py                 <- DAT CSV export + ZIP Map / Carrier CSV import
    outlook_integration.py    <- Outlook reply drafting, fuzzy lane matching, inbox watcher
    ui_widgets.py              <- shared table/toast widgets
    tabs/                     <- one file per tab (Freight Signal Engine, Manual
                                  Input, Carrier Database, Inquiry Log, ZIP Map,
                                  User Manual)
  sample_data/sample_zip_map.csv   <- small sample ZIP Map to try immediately
  assets/                     <- app icon + small logo mark (cropped from your artwork)
  .github/workflows/build.yml <- builds FreightSignal.exe automatically
  README.md                   <- this file
```

---

## Option A — Get the .exe with zero coding (recommended for your work computer)

This is the path that needs **no Python installed on your Windows work
computer at all.**

1. **Create a new GitHub repository** (github.com → New repository →
   name it e.g. `freight-signal` → Create).
2. **Push this folder's contents** to that repository. Easiest way if
   you don't already use git:
   - On the repo page, click **"Add file" → "Upload files"**.
   - Drag in *everything inside this unzipped folder* (keep the folder
     structure — the `.github` folder must stay at the top level).
   - Click **Commit changes**.
3. GitHub Actions will automatically start building. Click the
   **Actions** tab in your repo and watch the **"Build Freight Signal
   Windows EXE"** workflow run (takes 2-3 minutes).
4. When it finishes (green checkmark), click into that run, scroll to
   **Artifacts**, and download **FreightSignal-Windows-EXE** — that's a
   zip containing `FreightSignal.exe`.
5. Copy `FreightSignal.exe` to your work computer (email it to
   yourself, OneDrive, USB, etc.) and double-click it. That's it — no
   install, no Python, nothing else needed. Windows Defender/SmartScreen
   may show a one-time "unknown publisher" warning the first time you
   run an unsigned .exe — click **More info → Run anyway**.

**Tip:** if you'd rather get a permanent download link instead of an
Actions artifact, push a version tag (`git tag v1.0 && git push --tags`,
or use GitHub's "Create a new release" UI and tag it `v1.0`). The
workflow will attach `FreightSignal.exe` directly to that Release, and
Releases don't expire the way Actions artifacts eventually do.

The app is fully self-contained after that: on first launch it creates
`freight_signal_data.db` next to the .exe and is ready to use
immediately — import your ZIP Map and Carrier Database CSVs from inside
the app and you're live.

---

## Option B — Run it directly with Python (for testing/tweaking)

```
pip install -r requirements.txt
python main.py
```

Works on Windows, macOS, or Linux for the UI/engine/CSV features. Outlook
drafting and the Inbox Watcher require Windows with desktop Outlook
installed and signed in (they're automatically disabled with a friendly
message elsewhere).

---

## First-run checklist inside the app

1. **ZIP Map tab** → Import ZIP Map CSV → point it at your full ZIP
   database (or try `sample_data/sample_zip_map.csv` first).
2. **Carrier Database tab** → Import Carrier CSV, or add carriers by hand.
3. **Manual Input tab** → paste a load, click Parse Load, set priority /
   target rate / how many of the 9 postings should carry a rate, click
   **Generate 9 Postings**.
4. **Freight Signal Engine tab** → review the 9 postings, mark
   priority/covered, draft Outlook outreach, export to DAT CSV.
5. **Inquiry Log tab** → turn on the Inbox Watcher (or scan manually) to
   pull in carrier replies; approve a carrier to move them into the
   Carrier Database automatically.

Full walkthrough is also built into the app's **User Manual** tab.

---

## Notes on scope

This was rebuilt from the two attached VBA macros (`V2_EXCEL_MACRO.txt`,
`V2_OUTLOOK_MACRO.txt`) to reproduce the full workflow — parsing, an
adaptive/self-optimizing posting matrix, Load Group cover/priority
propagation, Inquiry Log → Carrier Database approval flow, exact DAT CSV
headers, and real Outlook reply drafting/inbox integration (thread-
preserving replies, fuzzy lane matching, rate extraction, sender
filtering) — as a standalone Python/Tkinter desktop app rather than a
line-by-line VBA port. If you hit a specific behavior from the old
workbook that doesn't match here, flag it and it can be tuned further.

**Self-optimizing behavior:** the matrix never duplicates a lane — if the
ZIP Map is too sparse near a city to find distinct alternates, you get a
smaller (but fully unique) matrix and a clear warning instead. Both which
alternate cities get chosen AND which postings get a rate are ranked by
real carrier email history first, distance second — a lane that's
generated replies before is favored over a closer lane with no track
record. This gets better the more you use it.
