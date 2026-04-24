Weekly Expenses (Cloudflare Pages + KV) — v2
==============================================

What this does
--------------
- Enter expenses for one week at a time in a web page
- Sync key (Sync Name) is a user-chosen namespace — one person can keep
  many weeks of reports under one Sync Name
- Multiple reports per week: each report is uniquely identified by
  week-ending date + a slug from the Business Purpose
- Autosaves every edit (debounced ~800ms)
- Exports a filled Excel using the template "Expenses Form.xlsx":
    - E5 = Week Ending (Saturday date, as an Excel date serial)
    - H5 = Business Purpose of Expenses
    - C7..I7 = Sunday..Saturday dates (Excel date serials)
    - Entries write into columns C..I by row (see rows table in script.js)

Multiple reports for the same week
----------------------------------
Two reports with the same Saturday date are kept separate as long as they
have different Business Purposes. If you really want two reports with the
exact same week AND Business Purpose, click "+ New report (same week)" first
to start a blank one; it gets auto-suffixed (e.g. "angelton-flights-2").

Deploy steps (Cloudflare Pages)
-------------------------------
1. Push this folder to a GitHub repo.
2. Cloudflare Dashboard → Pages → Create project → Connect to Git →
   select the repo.
3. Framework preset: None. Build command: (blank). Build output: / (root).
4. Create a KV namespace (Workers & Pages → KV → Create namespace,
   name it e.g. EXPENSES).
5. Bind KV to Pages Functions (Pages → Settings → Functions → KV bindings):
   - Variable name: EXPENSES_KV
   - KV namespace: (the one you created)
6. Environment variables (Pages → Settings → Environment variables):
   - APP_USER      — optional login user (see note on auth below)
   - APP_PASS      — optional login pass
   - TOKEN_SECRET  — any long random string (for /api/login HMAC)
7. Deploy. Open the site, set Sync Name, pick a Sunday, start typing.

Data shape in KV
----------------
Key:   expenses:{sync}:{YYYY-MM-DD}:{reportSlug}
       (Legacy single-report-per-week keys "expenses:{sync}:{YYYY-MM-DD}"
        are still readable and listed with a "(legacy)" tag.)

Value: {
  sync, weekEnding, reportId, businessPurpose, updatedAt,
  data: { syncName, weekEnding, reportId, businessPurpose, entries: {...} }
}

entries is keyed by Excel cell address (e.g. "C18"). Line-itemized cells
also have a sibling "C18_items" array of {id, amount, vendor, note}.

Note on auth
------------
/api/login exists and issues a signed 14-day token, and _auth.js exports
a requireAuth helper, but /api/data and /api/weeks don't currently
invoke it. If you want these endpoints gated, wire requireAuth into the
top of each handler and have the client attach the Bearer token.

Clearing vs deleting
--------------------
- "Start over" clears the on-screen form only (the saved report stays in KV).
- "Delete this report" removes the selected report from KV.

See REFERENCE.md for implementation details.
