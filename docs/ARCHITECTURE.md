# Architecture

```
index.html  css/app.css  sw.js  manifest.webmanifest
js/
  main.js            shell, hash router, theme, boot (loads state, registers SW)
  core/              PURE logic, no DOM, no storage - unit-tested in Node
    util csv defaults parser zipmap model matrix outreach inbound dat links eml ziparchive stats
  store/
    db.js            IndexedDB wrapper (8 stores, atomic replaceAll, validated import)
    state.js         in-memory state, write-through persistence, `actions` (all mutations)
  ui/
    dom.js           h() element builder (text nodes only - never innerHTML), modal, toast, download, clipboard
    draftcard.js     reviewable draft + hand-off buttons
    importer.js      paste/CSV table import with header matching
    pages/           home board dat spare carriers inquiry zipmap drafts manual system
data/uszips.csv      ZIP Map   data/sample/  fictional sample data
scripts/build-single.mjs   esbuild → dist/freight-signal.html (CSP hashes, ZIP embedded gzip+base64)
tests/unit (node:test)  tests/e2e (Playwright)  tests/fixtures (synthetic)
```

**Data flow:** UI → `actions.*` → mutate in-memory `state` → write to IndexedDB → `emit()` → router re-renders the active page. Core modules never touch storage; they take data and return plans (`planMatrix`, `planExcelOutreach`, `processIncomingEmail` …) that `actions` then apply. That keeps every macro rule testable without a browser.

**Why a faithful port:** function names in `core/` mirror the VBA (`selectTwoAlternates`, `initializeLoadControls`, `processIncomingEmail`) and comments cite the macro rule they reproduce, so a reviewer can diff behaviour.

**Matrix scoring:** candidates in the current tier (`[20,60]` → `[0,100]` → `[0,200]` → any) are scored `laneInquiries·1e6 + history·1e4 + ln(population+1)·10 − distance`; top two distinct markets win; ties keep ZIP Map order. Miles use haversine (R = 3958.7613) and VBA banker's rounding.

**Rendering safety:** the router skips a re-render while a cell has focus so typing is never wiped.
