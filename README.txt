Weekly Expenses (Cloudflare Pages + KV)

What this does
- Web page to enter weekly expenses during the week
- Sync key (Sync Name) is automatically the Week Ending (Saturday) date
- Saves/loads data from Cloudflare KV (so you can open anytime)
- Exports a filled Excel using your template "Expenses Form.xlsx"
  - E4 = Week Ending (YYYY-MM-DD)
  - G4 = Business Purpose of Expenses
  - C7..I7 = Sunday..Saturday date strings (M/D/YYYY)
  - Writes your selected rows into columns C..I
  - Writes D55 from the single input

Deploy steps (Cloudflare Pages)
1) Create a GitHub repo and push the folder contents.
2) Cloudflare Dashboard → Pages → Create a project → Connect to Git → select the repo.
3) Framework preset: None
   Build command: (leave blank)
   Build output directory: / (root)
4) Create KV namespace:
   Cloudflare Dashboard → Workers & Pages → KV → Create namespace (name it e.g. EXPENSES)
5) Bind KV to Pages Functions:
   Pages → your project → Settings → Functions → KV bindings
   - Variable name: EXPENSES_KV
   - KV namespace: (select the one you created)

6) Add environment variables (Pages → Settings → Environment variables):
   - APP_USER = (same username as your other site)
   - APP_PASS = (same password as your other site)
   - TOKEN_SECRET = (any long random string)

7) Deploy. Open the site, login, pick a date, and start entering values.

Notes
- Data is stored under keys like: expenses:YYYY-MM-DD (Saturday date)
- "Clear inputs" only clears the on-screen form (it does not delete KV).
- You can re-load the week anytime using the date picker.

