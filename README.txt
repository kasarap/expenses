Travel Expense Report Web App (Template Filler)

What this does
- Loads the included Excel template: "Expenses Form.xlsx"
- You enter values in the webpage during the week
- Click "Download filled Excel" to generate a completed .xlsx with formulas preserved

Files
- index.html
- styles.css
- script.js
- Expenses Form.xlsx  (your template)

Deploy on Cloudflare Pages (no build step)
1) Create a new GitHub repo (example: expense-report-web)
2) Upload these files to the repo root:
   - index.html
   - styles.css
   - script.js
   - Expenses Form.xlsx
3) Cloudflare Dashboard → Workers & Pages → Pages → Create a project → Connect to Git
4) Pick the repo
5) Framework preset: None
6) Build command: (leave blank)
7) Build output directory: /  (or leave blank; Cloudflare will serve the repo root)
8) Deploy

Notes
- Draft auto-saves locally in your browser (localStorage). Nothing is uploaded.
- If you ever change the Excel template layout, the row mappings in script.js may need updates.
