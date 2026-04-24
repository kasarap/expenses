# Weekly Expenses — Reference Notes (v2)

Internal reference for the project. Updated after the v2 rewrite.
Deployed target: `https://exp.jonmercado.com/`.

## What changed in v2

1. **Multiple reports per week.** The KV key is now
   `expenses:{sync}:{weekEnding}:{reportId}`. `reportId` is a slug derived
   from the Business Purpose (`"Angelton Flights"` → `"angelton-flights"`).
   If the same week already has a report with that exact slug, new ones
   get numbered: `angelton-flights-2`, `angelton-flights-3`, etc.
   **Legacy keys** (`expenses:{sync}:{weekEnding}` from v1) still load
   correctly and show in the dropdown with a `(legacy)` suffix.

2. **Autosave.** Every form edit debounces an 800ms save via `PUT /api/data`.
   Status pill in the header shows `Typing…` → `Saving…` → `Saved ✓`.
   The old "Save now" button is gone. `beforeunload` does a best-effort
   `keepalive` PUT to avoid losing the last keystroke.

3. **Mobile-first entry UX.** Below 820px viewport the desktop 7-column
   table is hidden. Instead the user sees:
   - A 7-tile **day strip** (SUN…SAT), each tile shows the date number
     and the running total for that day. Tiles with entries glow blue.
   - Tapping a tile opens a **full-screen day sheet** showing every
     category for that day in sections (Travel / Meals / Travel & Lodging
     / Other). Left/right arrows in the sheet header navigate between
     days. Day total updates live in the footer.
   - The line-item `+` modal still works from within the day sheet.
   - Desktop (≥820px) still uses the original sticky-grid table.

4. **Cleanup.**
   - Deleted orphan root `data.js` and `weeks.js` (the `functions/api/*`
     versions are what Cloudflare Pages actually routes).
   - Deleted the unused `<dialog id="syncDialog">` markup and related
     `.dialog` CSS — sync name still uses native `prompt()`.
   - Deleted the no-op `updateCellItemsDisplay()` function.
   - Deleted `expenses-kv-webapp-v36.zip` (old bundled dupe).
   - Removed duplicate `.currency-wrap` CSS block that was pasted twice.
   - Consolidated color tokens into `:root` and added `--success`,
     `--accent-weak`, `--input-bg`.
   - Fixed "Weekly Expen ses" typo in the banner comment.
   - Updated README with correct cell targets (E5/H5, not the old E4/G4
     that the README used to claim).

## File layout

```
expenses/
├── index.html                 UI markup (mobile + desktop blocks)
├── styles.css                 dark theme, mobile/desktop media at 820px
├── script.js                  all client logic
├── README.txt                 deploy + overview
├── REFERENCE.md               this file
├── Expenses Form.xlsx         template fetched at export time (unchanged)
├── jszip.min.js               fallback JSZip (loaded if vendor/ fails)
├── vendor/jszip.min.js        primary JSZip path
└── functions/api/
    ├── data.js                GET/PUT/DELETE /api/data  (reportId-aware)
    ├── weeks.js               GET /api/weeks  (returns {reports:[...]})
    ├── login.js               POST /api/login → HMAC token (14d)
    └── _auth.js               requireAuth helper (HMAC verify)
```

## Data model (v2)

- **Sync Name** — same as v1. Namespace per user. Stored in
  `localStorage['expenses_sync_name']`. Sanitized to ≤80 chars.
- **Week Ending** — Saturday. ISO `YYYY-MM-DD`. Derived from Sunday +6.
- **reportId** — slug of Business Purpose, 1–40 chars of `[a-z0-9-]`.
  Unique per `(sync, weekEnding)`. Collision → `-2`, `-3`, …
- **KV key**: `expenses:{sync}:{weekEnding}:{reportId}`.
- **KV value**:
  ```js
  {
    sync, weekEnding, reportId, businessPurpose, updatedAt,
    data: { syncName, weekEnding, reportId, businessPurpose, entries: {...} }
  }
  ```
- **entries** map keyed by Excel cell address:
  - `"C8": "Philadelphia"` (text)
  - `"C18": 245.5` (currency/number)
  - Line-itemized cells: `"C18": <sum>` plus `"C18_items": [{id, amount, vendor, note}, ...]`

## API (v2)

- `GET  /api/data?sync=&weekEnding=&reportId=` → `{data | null}`
- `GET  /api/data?sync=&weekEnding=`           → loads legacy key (v1 compat)
- `GET  /api/data?sync=`                       → most recent across sync
- `PUT  /api/data?sync=&weekEnding=&reportId=` body `{businessPurpose, entries}` → `{ok:true}`
- `DELETE /api/data?sync=&weekEnding=&reportId=` → `{ok:true}`
- `DELETE /api/data?sync=&weekEnding=`           → deletes legacy key
- `GET  /api/weeks?sync=` → `{reports: [{weekEnding, reportId, legacy, businessPurpose, updatedAt}, …]}`
- `POST /api/login`       → signed 14d token (still not enforced anywhere)

Env vars: `APP_USER`, `APP_PASS`, `TOKEN_SECRET`. KV binding: `EXPENSES_KV`.

## Row catalog (script.js `rows` array)

Columns C–I map to SUN–SAT. Each entry also has a `group` used by the
mobile day sheet to section the form.

| Row | Label | Type | Group |
|-----|-------|------|-------|
| 8  | From                           | text     | Travel |
| 9  | To                             | text     | Travel |
| 10 | Business Miles Driven          | number   | Travel |
| 29 | Personal Car Mileage ($0.70/mi)| currency (computed = miles × 0.70) | Travel |
| 42 | Breakfast                      | currency | Meals |
| 43 | Lunch                          | currency | Meals |
| 44 | Dinner                         | currency | Meals |
| 18 | Airfare                        | currency | Travel & Lodging |
| 19 | Bus, Limo & Taxi               | currency | Travel & Lodging |
| 20 | Lodging Room & Tax             | currency | Travel & Lodging |
| 21 | Parking / Tolls                | currency | Travel & Lodging |
| 22 | Tips                           | currency | Travel & Lodging |
| 23 | Laundry                        | currency | Travel & Lodging |
| 25 | Auto Rental                    | currency | Travel & Lodging |
| 26 | Auto Rental Fuel               | currency | Travel & Lodging |
| 34 | Internet - Email               | currency | Other |
| 36 | Postage                        | currency | Other |
| 38 | Perishable Tools               | currency | Other |
| 39 | Dues & Subscriptions           | currency | Other |

`MILEAGE_RATE = 0.7` is the only hardcoded rate. Row 29 is auto-computed
from row 10 and is read-only in the UI. On export, row 29 is NOT written —
the Excel template computes it from the miles value in row 10.

## Autosave behavior

- Trigger: any `input` event on the BP input, any entry field, or any
  line-item modal edit.
- Guard: autosave only fires when both Sync Name AND currentWeekEnding
  are set.
- Debounce: 800ms after last keystroke.
- On unload: if there's a pending save, a `keepalive: true` fetch is
  fired as a best-effort.
- reportId resolution:
  - If `currentReportId === ''`, compute from current BP (`computeReportId`).
  - If `currentReportId === 'untitled'`, try to upgrade once the user
    types a real BP. Otherwise keep the existing slug stable so we don't
    accidentally fork the KV key mid-edit. Renames happen via
    "+ New report (same week)".

## Mobile ↔ desktop split

- `@media (max-width: 820px)` hides `.desktop-only` and shows `.mobile-only`.
- The mobile "day strip" reads values straight out of the desktop table's
  hidden inputs — they're the canonical source of truth.
- The day sheet's inputs are transient DOM created on open; writing to
  them syncs back to the matching desktop input by `data-col`/`data-row`.
- Line-item modal works from both UIs; on close it repaints the day sheet
  and the day strip.

## Known gotchas / notes to future me

1. `beforeunload` autosave uses `fetch(..., {keepalive:true})`. Limited
   payload size (Chrome: 64KB). Expense data is tiny, fine.
2. Directly typing into a cell that has line items will **overwrite** them:
   the day sheet's currency input clears `{addr}_items` when the user types
   a new number. The main table's `+` button path preserves items. This is
   deliberate — typing a plain number is a clear signal to replace, not
   merge.
3. The sync name `prompt()` still exists. If we want a nicer dialog,
   bring back a `<dialog>` element wired up properly.
4. `_auth.js` / `/api/login` exist but remain not enforced on data/weeks.
   Leaving that call unchanged per v1 behavior — the live site was
   already running open.
5. `reportDropdownLabel` appends `[reportId]` suffix only when two reports
   in the same week share an identical Business Purpose (which should
   basically never happen, but back-compat + collisions require it).

## Where to make future changes

- New fields / row changes → `script.js` → `rows` array (top of file)
- Excel cell mapping → `script.js` → `downloadExcel()`
- Styling / tokens → `styles.css` → `:root`
- Autosave timing → `script.js` → `scheduleAutosave()` (800ms debounce)
- Mobile breakpoint → `styles.css` → `@media (max-width: 820px)`
- API shape → `functions/api/*.js`
