# Weekly Expenses — Reference Notes (v2)

Internal reference for the project. Kept current as the canonical
handoff document — Claude should be able to plan changes from this file
alone, without the zip attached.

Deployed target: `https://exp.jonmercado.com/` (Cloudflare Pages + KV).
Current `APP_VERSION` constant: `82-card-popup-only`.

---

## What changed in v2 (history)

0. **Card tracking, popup-only (`82-card-popup-only`).** Refined v81.
   Card selection happens **only inside the line-item popup** (the `+`
   modal). No inline pickers on the desktop grid or mobile day sheet —
   keeps the entry surface clean. Anything not tagged with a card is
   counted as **Cash**:
   - Cells without a `+` button (mileage, miles, From/To) → Cash.
   - Cells with `+` but no items, or items with no card chosen → Cash.
   - Items with a card chosen → bucketed under that card.

   **Storage and sync.** Card data lives on each line item:
   `{id, amount, vendor, note, card}` inside `entries["{addr}_items"]`.
   That array goes through the standard `/api/data` PUT, so card
   selections sync via Cloudflare KV exactly like every other expense
   field. Open the same report on another device and the card chips
   re-render from KV state. The v81 cell-level `_card` key has been
   removed; any old `_card` keys on existing reports are ignored by
   the new totals math and get cleaned out on the next autosave.

   **Where totals show up.**
   - Tab 1 "By Card (this week)" — current-week per-card sums, with
     Cash row last (only when > 0).
   - Payment Tracker → "Unpaid by Card" — per-card sum of sent-but-
     unpaid reports. Driven by `reportCardTotalsCache`, populated by
     `fetchReportTotal` on the first tracker render and by
     `cacheCurrentReportTotal` after each autosave.
   - Year Stats → "By Card" group at top of each year, bars colored
     to each brand.

   **Brand colors** (in the `CARDS` constant): Citi `#0058A6`,
   United `#002244`, Wells Fargo `#D71E28`, PayPal `#0070BA`,
   Amazon `#FF9900`, Apple Pay `#1D1D1F`. Edit `CARDS` to add or
   remove a card — totals/stats pick it up automatically.

1. **Card tracking, v1 (`81-card-tracking`, superseded by v82).**
   Initial implementation with inline pickers on every cell. Yon
   pushed back: too noisy. Replaced by the popup-only design above.

1. **Multiple reports per week.** KV key:
   `expenses:{sync}:{weekEnding}:{reportId}`. `reportId` is a slug from
   the Business Purpose. Same-slug collisions in the same week →
   `-2`, `-3`, … Legacy v1 keys (`expenses:{sync}:{weekEnding}`) still
   load and show in the dropdown with `(legacy)`.

2. **Autosave.** Every form edit debounces an 800ms PUT. Status pill
   shows `Typing…` → `Saving…` → `Saved ✓`. The old "Save now" button
   is gone. `beforeunload` does a best-effort `keepalive` PUT.

3. **Mobile-first entry UX.** Below 820px viewport: 7-tile day strip,
   tap a tile → full-screen day sheet with categories grouped by
   `Travel / Meals / Travel & Lodging / Other`. Desktop (≥820px) keeps
   the original sticky-grid table.

4. **Cleanup.** Removed orphan root `data.js`/`weeks.js`, unused
   `<dialog id="syncDialog">`, no-op `updateCellItemsDisplay()`, old
   bundled zip, duplicate `.currency-wrap` CSS. Consolidated color
   tokens into `:root` (`--success`, `--accent-weak`, `--input-bg`).

5. **Payment Tracker tab (`62-payment-tracker`).** Two tabs added (tab bar sticky below the main bar). Tab 1 = existing expense entry. Tab 2 = Payment Tracker: lists all reports from `reportsCache` with fetched/cached totals, Sent and Paid date inputs (stored in KV under key `tracker:{sync}` AND mirrored to localStorage, served by `functions/api/tracker.js`), Copy Unpaid button (generates text lines for unpaid reports suitable for pasting in an email), and a summary section with Owe (sent but not paid), Spent (current year total), and editable prior-year spend. Report totals are fetched on first open (all in parallel via `fetchReportTotal`) and cached in `reportTotalsCache` in-memory; they are also cached after each successful autosave via `cacheCurrentReportTotal`. Tracker re-renders when switching to tab 2 or after `loadWeeksForSync` completes while on tab 2.

6. **Optimistic concurrency control (OCC) — `60-v2-occ`.** Prevents
   stale tabs (e.g. phone left open with empty fields) from clobbering
   edits made on another device. See "OCC / multi-device" below.

---

## File layout

```
expenses/
├── index.html                 ~164 lines. UI markup — desktop table block
│                              (.desktop-only) + mobile day strip / day
│                              sheet (.mobile-only) + line-item modal +
│                              header. No <form>; all event-driven.
├── styles.css                 ~449 lines. Dark theme. Tokens in :root.
│                              Mobile/desktop split at @media (max-width: 820px).
├── script.js                  ~1424 lines. All client logic (see map below).
├── README.txt                 Deploy + usage overview.
├── REFERENCE.md               This file.
├── Expenses Form.xlsx         Template fetched at export time. Untouched
│                              by the app — only modified in-memory during
│                              download.
├── jszip.min.js               Fallback JSZip (loaded if vendor/ fails).
├── vendor/jszip.min.js        Primary JSZip path (~96K).
└── functions/api/
    ├── data.js   ~132 lines.  GET/PUT/DELETE /api/data. reportId-aware.
    │                          Implements OCC on PUT.
    ├── weeks.js  ~52 lines.   GET /api/weeks → {reports:[…]}.
    ├── login.js  ~54 lines.   POST /api/login → HMAC token (14d). Not enforced.
    └── _auth.js  ~44 lines.   requireAuth helper. Not used anywhere.
```

---

## Data model

- **Sync Name** — namespace per user. `localStorage['expenses_sync_name']`.
  Sanitized to ≤80 chars. Single-line, whitespace collapsed.
- **Week Ending** — Saturday, ISO `YYYY-MM-DD`. Derived from
  `Sunday + 6` via `computeWeekEndingFromSunday()`.
- **reportId** — slug of BP, 1–40 chars `[a-z0-9-]`. Unique per
  `(sync, weekEnding)`. Collision → `-2`, `-3`. Empty BP → `untitled`.
- **KV key**: `expenses:{sync}:{weekEnding}:{reportId}`.
- **KV value** (server-side wrapper around `data`):
  ```js
  {
    sync, weekEnding, reportId, businessPurpose, updatedAt,
    data: { syncName, weekEnding, reportId, businessPurpose, entries: {…} }
  }
  ```
- **entries** map keyed by Excel cell address:
  - `"C8": "Philadelphia"` (text)
  - `"C18": 245.5` (currency/number)
  - Line-itemized: `"C18": <sum>` plus
    `"C18_items": [{id, amount, vendor, note, card}, …]`
  - `card` on a line item is one of: `citi`, `united`, `wells`,
    `paypal`, `amazon`, `apple`, or `''` (no card = cash).
    Stored verbatim through `/api/data` PUT, so it syncs across
    devices via KV alongside the rest of the report.

---

## API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/data?sync=&weekEnding=&reportId=` | → `{data, updatedAt}`. |
| GET | `/api/data?sync=&weekEnding=` | Loads legacy key (v1). |
| GET | `/api/data?sync=` | Most recent across whole sync namespace. |
| PUT | `/api/data?sync=&weekEnding=&reportId=` | Body: `{businessPurpose, entries, clientKnownUpdatedAt?, force?}`. Returns 409 on conflict (unless `force:true`). 200 → `{ok:true, updatedAt}`. |
| DELETE | `/api/data?sync=&weekEnding=&reportId=` | Delete one report. |
| DELETE | `/api/data?sync=&weekEnding=` | Delete legacy key. |
| GET | `/api/weeks?sync=` | → `{reports: [{weekEnding, reportId, legacy, businessPurpose, updatedAt}, …]}`. |
| POST | `/api/login` | Signed 14d HMAC token. Not enforced anywhere. |

Env vars: `APP_USER`, `APP_PASS`, `TOKEN_SECRET`. KV binding: `EXPENSES_KV`.

---

## OCC / multi-device (added in `60-v2-occ`)

**Problem.** Same report open on two devices. Idle tab has empty/stale
fields. Its autosave (or `beforeunload` flush) overwrites the other
tab's real edits — last writer wins, data lost.

**Solution.** Server-enforced timestamp gate on PUT.

- **Server (`functions/api/data.js`).** On PUT, compares the existing
  record's `updatedAt` to `body.clientKnownUpdatedAt`. If the server is
  newer (or the client supplied no baseline but a record exists),
  returns 409 with `{error:'conflict', serverUpdatedAt, data}`. The
  `force:true` body flag bypasses the check (used by the "Overwrite
  with mine" button). On success returns `{ok:true, updatedAt}` so the
  client can update its baseline.
- **Client (`script.js`).** Two new state vars:
  - `clientKnownUpdatedAt` — set from server's `updatedAt` on
    `loadReport()` and after every successful PUT. `null` for brand
    new reports / new weeks (signals "no baseline; only safe if no
    record exists").
  - `conflictPaused` — once a 409 hits, autosave is suspended until
    the user resolves via the banner. `canAutosave()` checks this.
  - On 409, `showConflictBanner()` injects a fixed-position red banner
    at the top with two buttons:
    - **Reload latest** → calls `loadReport(currentMeta)`, replaces the
      form with the server's version, drops local edits.
    - **Overwrite with mine** → re-PUTs with `force:true`, takes the
      server's new `updatedAt`, autosave resumes.
- **Baseline lifecycle.** Reset to `null` on `startOver`,
  `newReportSameWeek`, week change in `onSundayChange`, and after
  deleting the loaded report. Banner is also removed in those paths.
- **`beforeunload` flush** sends `clientKnownUpdatedAt` too — a stale
  unload fire from the idle tab will get 409'd and silently dropped
  (we can't act on it post-unload, but at least nothing is corrupted).
- **Slug promotion edge case.** When `currentReportId` is `untitled`
  and gets promoted to a real slug, the baseline is reset to `null`
  because the new key is brand-new on the server.

**What this does NOT cover** (intentional):
- Real-time merge between two simultaneously-edited tabs. We pick a
  winner and ask the user to reload — same approach as Google Docs
  offline conflicts. Field-level merge is overkill for this app.
- Background polling to detect remote changes proactively. Conflicts
  surface only when this client tries to save.

---

## Row catalog (`script.js` `rows` array, top of file)

Columns C–I map to SUN–SAT. `group` controls the mobile day-sheet
section.

| Row | Label | Type | Group |
|-----|-------|------|-------|
| 8  | From                            | text     | Travel |
| 9  | To                              | text     | Travel |
| 10 | Business Miles Driven           | number   | Travel |
| 29 | Personal Car Mileage ($0.70/mi) | currency (computed = miles × 0.70) | Travel |
| 42 | Breakfast                       | currency | Meals |
| 43 | Lunch                           | currency | Meals |
| 44 | Dinner                          | currency | Meals |
| 18 | Airfare                         | currency | Travel & Lodging |
| 19 | Bus, Limo & Taxi                | currency | Travel & Lodging |
| 20 | Lodging Room & Tax              | currency | Travel & Lodging |
| 21 | Parking / Tolls                 | currency | Travel & Lodging |
| 22 | Tips                            | currency | Travel & Lodging |
| 23 | Laundry                         | currency | Travel & Lodging |
| 25 | Auto Rental                     | currency | Travel & Lodging |
| 26 | Auto Rental Fuel                | currency | Travel & Lodging |
| 34 | Internet - Email                | currency | Other |
| 36 | Postage                         | currency | Other |
| 38 | Perishable Tools                | currency | Other |
| 39 | Dues & Subscriptions            | currency | Other |

`MILEAGE_RATE = 0.7`. Row 29 is auto-computed from row 10, read-only in
the UI. **Not written on Excel export** — the template's own formula
computes it from the miles in row 10.

---

## `script.js` function map

Section headers in code are `// ==================== NAME ====================`.
Approximate line numbers for navigation:

- `~9`   — `API` constant, route paths.
- `~49`  — `APP_VERSION` constant.
- `~52`  — STATE block: `currentSync`, `currentWeekEnding`,
  `currentReportId`, `reportsCache`, `currentData`, `loading`,
  `currentEditAddr`, `activeDayIdx`, `autosaveTimer`,
  `clientKnownUpdatedAt`, `conflictPaused`.
- `~65`  — `slugifyBP`, `computeReportId`.
- `~89`  — Line-item helpers: `getLineItems`, `setLineItems`,
  `addLineItem`, `updateLineItem`, `deleteLineItem`.
- `~122` — `openLineItemModal`, `updateModalTotal`, `closeLineItemModal`.
- `~238` — Date utils: `toISODate`, `parseISODate`,
  `computeWeekEndingFromSunday`, `computeSundayFromWeekEnding`,
  `fmtMD`, `fmtYYMMDD`, `setHeaderDatesFromSunday`,
  `safeFilenameBase`.
- `~297` — `buildTable` builds the desktop input grid.
- `~379` — `gridKeydown` (arrow-key nav across the grid).
- `~404` — `onEntryInputChanged` — fires on every input event,
  triggers totals recompute and `scheduleAutosave()`.
- `~411` — `dayTotalFromInputs(dayIdx)`.
- `~430` — `renderMobileDayStrip`.
- `~482` — `openDaySheet` / `closeDaySheet` / `renderDaySheetBody`.
- `~627` — `getInputValueForAddr` / `setInputValueForAddr` —
  mobile↔desktop input sync helpers.
- `~660` — `clearEntryValues`.
- `~668` — `startOver`, `newReportSameWeek` (both reset OCC state).
- `~705` — `recomputeDerived` (row 29 = row 10 × MILEAGE_RATE).
- `~715` — `updateButtonColors`.
- `~728` — `computeTotals` — daily + weekly totals; updates pill text.
- `~762` — `serialize` — produces `{syncName, weekEnding, reportId,
  businessPurpose, entries}`. Carries `_items` arrays from
  `currentData`. Autosave wraps this and adds `clientKnownUpdatedAt`.
- `~792` — `applyData` — clears form, hydrates from data object.
- `~811` — `apiFetchJson` — wraps `fetch`. **Surfaces `err.status`
  and `err.body`** so `performAutosave` can detect 409.
- `~826` — `reportDropdownLabel`, `renderWeeksDropdown`.
- `~857` — `loadWeeksForSync(autoLoadMostRecent=true)`.
- `~872` — `loadReport(meta)` — sets `clientKnownUpdatedAt` from
  response, clears `conflictPaused`.
- `~901` — `canAutosave` — gate (sync & week & !loading & !conflictPaused).
- `~904` — `scheduleAutosave` — 800ms debounce.
- `~910` — `performAutosave` — sends `clientKnownUpdatedAt`, handles
  409 by setting `conflictPaused` and calling `showConflictBanner`.
- `~999` — `showConflictBanner` — injects banner with Reload /
  Overwrite buttons. Self-removing.
- `~1050` — `deleteCurrentReport` — also resets OCC state on
  delete-of-loaded.
- `~1100` — `downloadExcel` — fetches template, splices values into
  `xl/worksheets/sheet1.xml`, writes via JSZip.
- `~1271` — Sync name helpers: `sanitizeSyncName`, `renderSync`,
  `ensureSync`, `changeSync`. Still uses `prompt()`.
- `~1299` — `setStatus`, `setButtonsEnabled`.
- `~1315` — `onSundayChange`, `onWeekSelectChange`,
  `onBusinessPurposeChange`.
- `~1351` — `init` — wires DOM events, attaches `beforeunload`.

DOM IDs (from `index.html`, accessed via `el(id)`):
`businessPurpose`, `entryTable`, `sundayDate`, `weekEnding`,
`weekSelect`, `dateSUN..dateSAT`, `totWEEK`, `lastSaved`,
`saveStatus`, `syncPill`, `dayStrip`, `mobileWeekTotal`,
`daySheetOverlay`, `daySheetTitle`, `daySheetDate`, `daySheetTotal`,
`daySheetBody`, `daySheetPrev`, `daySheetNext`, `daySheetClose`,
`daySheetDone`, `modalOverlay`, `modalTitle`, `modalItemsList`,
`modalTotal`, `modalSaveBtn`, `modalCloseBtn`, `btnSave`, `btnClear`,
`btnDownload`, `btnDeleteWeek`, `btnNewReport`, `btnChangeSync`,
`conflictBanner` (created dynamically by `showConflictBanner`).

---

## Mobile ↔ desktop split

- `@media (max-width: 820px)` hides `.desktop-only` and shows
  `.mobile-only`.
- The mobile day strip reads values straight out of the desktop
  table's hidden inputs — those are the **canonical source of truth**.
- The day sheet's inputs are transient DOM created on open; writing
  to them syncs back to the matching desktop input by
  `data-col` / `data-row`.
- Line-item modal works from both UIs; on close it repaints the day
  sheet and the day strip.

---

## Known gotchas / notes to future me

1. `beforeunload` autosave uses `fetch(..., {keepalive:true})`. Limited
   payload size (Chrome: 64KB). Expense data is tiny, fine.
2. Directly typing into a cell that has line items will **overwrite**
   them: the day sheet's currency input clears `{addr}_items` when the
   user types a new number. The main table's `+` button path preserves
   items. Deliberate — typing a plain number is a clear "replace" signal.
3. The sync name still uses native `prompt()`. To replace, bring back a
   `<dialog>` element wired up properly.
4. `_auth.js` / `/api/login` exist but remain not enforced on
   data/weeks. The live site runs open.
5. `reportDropdownLabel` appends `[reportId]` suffix only when two
   reports in the same week share an identical Business Purpose
   (collisions force this).
6. **Legacy reports + autosave.** A loaded legacy key
   (`expenses:{sync}:{weekEnding}` with no reportId) gets autosaved to
   a NEW v2 key on the next edit, because PUT requires reportId. The
   legacy key is left in place until manually deleted. OCC sees this
   as a brand-new write (baseline `null`, new key) → no conflict.
7. **OCC false positives.** Two tabs that both legitimately have the
   latest version, and both edit at the same time, will conflict —
   whoever PUTs second gets 409. This is correct behavior; the user is
   prompted to reload or overwrite. Do NOT auto-merge silently.
8. **iOS Safari mobile quirks** for date inputs: required
   `-webkit-appearance` handling and care with flex/overflow on the
   card containers. Past sessions hit "date input escaping the card";
   the fix involved input wrapper overflow + appearance resets.
9. **Open issue: uneven vertical borders when printing populated
   forms to PDF.** Yon reports random vertical lines rendering bolder
   than others when doing Excel → File → Print → Save as PDF. The
   issue does NOT appear in Excel's on-screen view, only in the
   printed PDF. Two unsuccessful attempts so far:
   - **Border XML reconciliation** (reverted): tried fixing 351
     "asymmetries" between adjacent cells' shared edges. Made no
     visible difference at best, made things worse when top/bottom
     edges were also reconciled (medium borders from row 5 boxes
     propagated down into row 6 day headers).
   - **Print scale lock** (reverted, `61-print-scale`): forced
     `scale=60` and `fitToPage=0` on the generated xlsx. This cropped
     content off the bottom of the printout AND did not fix the
     unevenness, so it was reverted.
   The template (`Expenses Form.xlsx`) is byte-identical to a version
   that previously printed cleanly per Yon, so the cause is likely
   something Excel changes between save-and-reopen, or an environment
   factor. **Next attempt should start from a known-clean reference
   xlsx** (Yon to provide) and diff the printed PDFs / underlying
   XML pixel-by-pixel before theorizing. Do not repeat either of the
   above approaches.

10. **"Cash" is the catch-all bucket.** In every per-card total
    (Tab 1, Tracker, Year Stats), `Cash` collects: (a) mileage
    reimbursement (row 10 miles × $0.70), (b) line items with no
    card chosen, (c) plain non-itemized amounts. Edit `CARDS` to add
    a real card — anything not assigned falls here. The bucket key
    in code is literally `'cash'` (was `'unassigned'` in v81).

11. **Card data syncs via the main report PUT, not a side channel.**
    Cards live on items inside `entries[addr_items]`, so they
    piggy-back on the standard autosave → `/api/data` PUT → KV. No
    separate endpoint. Open a report on a second device, get the same
    cards. The Payment Tracker and Mercado tabs still use their own
    `tracker:` / `meal_tracker:` KV keys (v80) for sent/paid dates;
    card totals there are derived in-memory from each report's items.

12. **`reportCardTotalsCache` population.** Tracker's "Unpaid by
    Card" depends on this in-memory cache. Populated by
    `fetchReportTotal` (when tracker first loads, fetches every
    report in parallel) and `cacheCurrentReportTotal` (after each
    autosave on the open report). `renderTracker` awaits all fetches
    before computing, so the cache is fully populated by render time.
    `recalcSummary` (toggle sent/paid date) reads cache, no refetch.

---

## Where to make future changes

- New fields / row changes → `script.js` → `rows` array (top of file)
- Add/edit/remove a card → `script.js` → `CARDS` constant. Each entry:
  `{key, label, short, bg, fg}`. The `key` is what's stored in
  `entries`; bg/fg must be valid CSS colors. Adding a card immediately
  surfaces in the picker, all totals, and stats — no other touch-ups
  needed.
- Excel cell mapping → `script.js` → `downloadExcel()`
- Styling / tokens → `styles.css` → `:root`
- Autosave timing → `script.js` → `scheduleAutosave()` (800ms debounce)
- Conflict UI → `script.js` → `showConflictBanner()`
- OCC server logic → `functions/api/data.js` → PUT branch
- Mobile breakpoint → `styles.css` → `@media (max-width: 820px)`
- API shape → `functions/api/*.js`

---

## Working agreements (Yon ↔ Claude)

- Yon communicates terse + direct. Claude makes decisive choices and
  ships changes rather than asking for ratification on small calls.
- Short corrections like "no change" / "still broken" mean the fix
  didn't land — pick a different approach, ask a targeted multiple-
  choice clarifier if the failure mode is ambiguous.
- Deliverables ship as a downloadable zip of the full project.
- iOS Safari is the primary mobile test surface.
- Largely mechanical refactors are fine for Sonnet-class work; reserve
  Opus for design/architecture decisions.
- **REFERENCE.md is the canonical handoff doc.** At session start
  Claude reads REFERENCE.md FIRST (before opening any other file in
  the zip) so it can plan changes from this file alone without wasting
  tokens scanning source files unnecessarily. Claude updates
  REFERENCE.md alongside code changes in the same delivery.
