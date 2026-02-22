// Weekly Expenses KV-backed app
const API = {
  data: '/api/data',
  weeks: '/api/weeks',
};

const el = (id) => document.getElementById(id);
const days = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const dayCols = ['C','D','E','F','G','H','I']; // Excel cols for Sun..Sat

// Rows requested by user
const rows = [
  {row:8, label:'FROM', type:'text'},
  {row:9, label:'TO', type:'text'},
  {row:10, label:'BUSINESS MILES DRIVEN', type:'number'},
  {row:18, label:'Airfare', type:'number'},
  {row:19, label:'Bus, Limo & Taxi', type:'number'},
  {row:20, label:'Lodging Room & Tax', type:'number'},
  {row:21, label:'Parking / Tolls', type:'number'},
  {row:22, label:'Tips', type:'number'},
  {row:23, label:'Laundry', type:'number'},
  {row:25, label:'Auto Rental', type:'number'},
  {row:26, label:'Auto Rental Fuel', type:'number'},
  {row:34, label:'Internet - Email', type:'number'},
  {row:36, label:'POSTAGE', type:'number'},
  {row:38, label:'PERISHABLE TOOLS', type:'number'},
  {row:39, label:'DUES & SUBSCRIPTIONS', type:'number'},
  {row:42, label:'Breakfast', type:'number'},
  {row:43, label:'Lunch', type:'number'},
  {row:44, label:'Dinner', type:'number'},
];

// State
let currentWeekEnding = '';
let autosaveTimer = null;

function setStatus(msg, kind='') {
  const s = el('saveStatus');
  s.textContent = msg || '';
  s.dataset.kind = kind;
}

function enableUI() {
  // Enable inputs by default; disable actions until a week is selected
  const hasWeek = !!currentWeekEnding;
  el('btnLoad').disabled = !hasWeek;
  el('btnSave').disabled = !hasWeek;
  el('btnClear').disabled = !hasWeek;
  el('btnDownload').disabled = !hasWeek;
  el('btnDeleteWeek').disabled = !hasWeek;
  el('weekSelect').disabled = false;
  el('sundayDate').disabled = false;
}

function toISODate(d) {
  // local date -> YYYY-MM-DD
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const da = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}

function parseISODate(s) {
  // YYYY-MM-DD (local)
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
}

function computeWeekEnding(anyDate) {
  // Round forward to Saturday of that week
  const d = parseISODate(anyDate);
  const dow = d.getDay(); // Sun=0 .. Sat=6
  const add = (6 - dow + 7) % 7; // 0 if already Sat, else days until next Sat
  d.setDate(d.getDate() + add);
  return d;
}

function computeSunday(weekEndingDate) {
  const d = new Date(weekEndingDate);
  d.setDate(d.getDate() - 6);
  return d;
}

function fmtMD(dateObj) {
  const m = dateObj.getMonth()+1;
  const d = dateObj.getDate();
  return `${m}-${d}`;
}

function buildTable() {
  const tbody = el('entryTable').querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    const tdRow = document.createElement('td'); tdRow.className='sticky'; tdRow.textContent = r.row;
    const tdLabel = document.createElement('td'); tdLabel.className='sticky2'; tdLabel.textContent = r.label;
    tr.appendChild(tdRow); tr.appendChild(tdLabel);
    for (let i=0;i<7;i++){
      const td = document.createElement('td');
      const inp = document.createElement('input');
      inp.dataset.row = String(r.row);
      inp.dataset.col = dayCols[i];
      inp.dataset.type = r.type;
      inp.inputMode = (r.type === 'number') ? 'decimal' : 'text';
      inp.placeholder = (r.type === 'number') ? '0' : '';
      inp.addEventListener('input', () => scheduleAutosave());
      inp.addEventListener('input', () => computeTotals());
      td.appendChild(inp);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
}

function getAllInputs() {
  return Array.from(el('entryTable').querySelectorAll('input'));
}

function clearInputs() {
  getAllInputs().forEach(i => i.value = '');
  el('businessPurpose').value = '';
  el('cellD55').value = '';
  computeTotals();
}

function serializeData() {
  const entries = {};
  getAllInputs().forEach(inp => {
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    const raw = inp.value;
    if (raw === '') return;
    if (inp.dataset.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      entries[addr] = n;
    } else {
      entries[addr] = raw;
    }
  });
  const d55 = el('cellD55').value;
  if (d55 !== '') entries['D55'] = d55;
  return {
    weekEnding: currentWeekEnding,
    businessPurpose: el('businessPurpose').value || '',
    entries
  };
}

function applyData(data) {
  clearInputs();
  if (!data) return;
  if (data.businessPurpose) el('businessPurpose').value = data.businessPurpose;
  if (data.entries && data.entries['D55'] != null) el('cellD55').value = String(data.entries['D55']);
  const map = data.entries || {};
  getAllInputs().forEach(inp => {
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    if (map[addr] == null) return;
    inp.value = String(map[addr]);
  });
  computeTotals();
}

function computeTotals() {
  // Totals include numeric rows only (exclude text rows 8–9 and any text fields)
  const totals = [0,0,0,0,0,0,0];
  getAllInputs().forEach(inp => {
    if (inp.dataset.type !== 'number') return;
    const v = inp.value.trim();
    if (!v) return;
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const idx = dayCols.indexOf(inp.dataset.col);
    if (idx >= 0) totals[idx] += n;
  });
  const ids = ['totSUN','totMON','totTUE','totWED','totTHU','totFRI','totSAT'];
  let week = 0;
  totals.forEach((t,i)=>{
    week += t;
    el(ids[i]).value = t ? t.toFixed(2).replace(/\.00$/,'') : '';
  });
  el('totWEEK').value = week ? week.toFixed(2).replace(/\.00$/,'') : '';
}

async function apiFetch(url, opts={}) {
  const headers = opts.headers ? {...opts.headers} : {};
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, {...opts, headers});
  if (!res.ok) {
    const txt = await res.text().catch(()=> '');
    throw new Error(`${res.status} ${res.statusText}${txt ? ' - ' + txt : ''}`);
  }
  return res;
}

async function refreshWeeks() {
  try {
    const res = await apiFetch(API.weeks);
    const out = await res.json();
    const weeks = Array.isArray(out.weeks) ? out.weeks : [];
    populateWeekSelect(weeks);
  } catch {
    populateWeekSelect([]);
  }
}

function populateWeekSelect(weeks) {
  const sel = el('weekSelect');
  const current = sel.value;
  sel.innerHTML = '<option value="">(Select a week)</option>';
  const unique = Array.from(new Set(weeks)).sort();
  unique.forEach(we => {
    const opt = document.createElement('option');
    opt.value = we;
    opt.textContent = labelForWeek(we);
    sel.appendChild(opt);
  });
  if (current && unique.includes(current)) sel.value = current;
  else if (currentWeekEnding && unique.includes(currentWeekEnding)) sel.value = currentWeekEnding;
}

function ensureWeekOption(weekEnding) {
  const sel = el('weekSelect');
  const exists = Array.from(sel.options).some(o => o.value === weekEnding);
  if (exists) return;
  const opt = document.createElement('option');
  opt.value = weekEnding;
  opt.textContent = labelForWeek(weekEnding);
  sel.appendChild(opt);
}

function labelForWeek(weekEnding) {
  const sat = parseISODate(weekEnding);
  const sun = computeSunday(sat);
  return `Week ${fmtMD(sun)} through ${fmtMD(sat)}`;
}

async function saveWeek() {
  if (!currentWeekEnding) return;
  const payload = serializeData();
  setStatus('Saving…');
  try {
    await apiFetch(API.data, {method:'PUT', body: JSON.stringify(payload)});
    setStatus('Saved.');
    await refreshWeeks();
    ensureWeekOption(currentWeekEnding);
    el('weekSelect').value = currentWeekEnding;
  } catch (e) {
    setStatus('Save failed (check login / KV binding).');
  }
}

async function deleteWeek() {
  if (!currentWeekEnding) return;
  if (!confirm(`Delete saved data for week ending ${currentWeekEnding}? This cannot be undone.`)) return;
  setStatus('Deleting…');
  try {
    await apiFetch(`${API.data}?weekEnding=${encodeURIComponent(currentWeekEnding)}`, { method:'DELETE' });
    clearInputs();
    setStatus('Deleted.');
    await refreshWeeks();
    el('weekSelect').value = '';
  } catch {
    setStatus('Delete failed.');
  }
}

function scheduleAutosave() {
  if (!) return;
  if (!currentWeekEnding) return;
  setStatus('Editing…');
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveWeek(), 700);
}

async function downloadExcel() {
  if (!currentWeekEnding) return;
  setStatus('Building Excel…');
  try {
    const templateRes = await fetch('Expenses Form.xlsx', {cache:'no-store'});
    const buf = await templateRes.arrayBuffer();
    const wb = XLSX.read(buf, {type:'array'});
    const ws = wb.Sheets['Page 1'] || wb.Sheets[wb.SheetNames[0]];

    // Set Week Ending (E4) and Business Purpose (G4)
    ws['E4'] = {t:'s', v: currentWeekEnding};
    const bp = el('businessPurpose').value || '';
    ws['G4'] = {t:'s', v: bp};

    // Set date row (C7..I7)
    const sat = parseISODate(currentWeekEnding);
    const sun = computeSunday(sat);
    for (let i=0;i<7;i++){
      const d = new Date(sun);
      d.setDate(sun.getDate() + i);
      const addr = `${dayCols[i]}7`;
      // Write as string date like M/D/YYYY (keeps template consistent)
      const s = `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`;
      ws[addr] = {t:'s', v:s};
    }

    // Write entries
    const payload = serializeData();
    for (const [addr, val] of Object.entries(payload.entries || {})) {
      if (typeof val === 'number') ws[addr] = {t:'n', v: val};
      else ws[addr] = {t:'s', v: String(val)};
    }

    // Export filename: Week m-d through m-d - (business purpose).xlsx
    const mdSun = fmtMD(sun);
    const mdSat = fmtMD(sat);
    const safeBp = (bp || 'Expenses').replace(/[\\/:*?"<>|]+/g,'').trim();
    const fname = `Week ${mdSun} through ${mdSat} - ${safeBp}.xlsx`;
    XLSX.writeFile(wb, fname);
    setStatus('Excel downloaded.');
  } catch (e) {
    setStatus('Excel export failed. (Template missing or blocked by browser?)');
  }
}

// UI wiring
buildTable();

el('sundayDate').addEventListener('change', () => {
  const v = el('sundayDate').value;
  if (!v) return;
  const sun = parseISODate(v);
  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  currentWeekEnding = toISODate(sat);
  el('weekEnding').value = currentWeekEnding;
  ensureWeekOption(currentWeekEnding);
  el('weekSelect').value = currentWeekEnding;
  loadWeek();
});

el('businessPurpose').addEventListener('input', () => scheduleAutosave());
el('cellD55').addEventListener('input', () => scheduleAutosave());

// On load: set default anyDate = today
(function init(){
  const today = new Date();
  // Default Sunday = Sunday of the current week (local)
  const sun = new Date(today);
  sun.setDate(today.getDate() - today.getDay());
  el('sundayDate').value = toISODate(sun);

  const sat = new Date(sun);
  sat.setDate(sun.getDate() + 6);
  currentWeekEnding = toISODate(sat);
  el('weekEnding').value = currentWeekEnding;

  enableUI();
  refreshWeeks().then(() => {
    ensureWeekOption(currentWeekEnding);
    el('weekSelect').value = currentWeekEnding;
    loadWeek();
  });
})();