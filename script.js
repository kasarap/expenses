
// Weekly Expenses (Cloudflare Pages + KV)
// Sync Name behaves like test-entry-log: persisted per device; prompts on first Save.
// Data is saved per Sync Name + Week Ending (Saturday).

const API = { data: '/api/data', weeks: '/api/weeks' };
const el = (id) => document.getElementById(id);

const dayIds = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const dayLabels = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

const STORAGE_SYNC = 'expenses_sync_v1';

// Editable rows + ordering (no Row column)
// - FROM/TO text
// - Business miles numeric (not currency)
// - Personal car mileage is derived display (currency), exported as cached value
// - Meals moved under mileage
// - Airfare above Auto Rental
const rows = [
  { row: 8,  label: 'FROM', type: 'text' },
  { row: 9,  label: 'TO', type: 'text' },
  { row: 10, label: 'BUSINESS MILES DRIVEN', type: 'number' },

  { row: 29, label: 'Personal Car Mileage', type: 'currency', computed: true },
  { type: 'divider' },

  { row: 42, label: 'Breakfast', type: 'currency' },
  { row: 43, label: 'Lunch', type: 'currency' },
  { row: 44, label: 'Dinner', type: 'currency' },
  { type: 'divider' },

  { row: 18, label: 'Airfare', type: 'currency' },
  { row: 25, label: 'Auto Rental', type: 'currency' },
  { row: 26, label: 'Auto Rental Fuel', type: 'currency' },

  { row: 19, label: 'Bus, Limo & Taxi', type: 'currency' },
  { row: 20, label: 'Lodging Room & Tax', type: 'currency' },
  { row: 21, label: 'Parking / Tolls', type: 'currency' },
  { row: 22, label: 'Tips', type: 'currency' },
  { row: 23, label: 'Laundry', type: 'currency' },

  { row: 34, label: 'Internet - Email', type: 'currency' },
  { row: 36, label: 'POSTAGE', type: 'currency' },
  { row: 38, label: 'PERISHABLE TOOLS', type: 'currency' },
  { row: 39, label: 'DUES & SUBSCRIPTIONS', type: 'currency' },
];

let currentSync = (localStorage.getItem(STORAGE_SYNC) || '').trim() || '';
let currentWeekEnding = ''; // YYYY-MM-DD
let currentSunday = '';     // YYYY-MM-DD
let state = {};             // { [rowNumber]: { [dayIndex]: valueString } }
let ratePerMile = 0.70;     // read from template at export-time if possible

function setStatus(msg, isError=false){
  const s = el('saveStatus');
  if (!s) return;
  s.textContent = msg || '';
  s.classList.toggle('err', !!isError);
}

function formatCurrency(n){
  if (!isFinite(n)) n = 0;
  return n.toLocaleString(undefined, { style:'currency', currency:'USD' });
}

function parseNumber(v){
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v).replace(/[^0-9.\-]/g,'').trim();
  if (!s) return 0;
  const n = Number(s);
  return isFinite(n) ? n : 0;
}

function yyMMdd(dateStr){
  // dateStr YYYY-MM-DD => YY.MM.DD
  if (!dateStr) return '';
  const [y,m,d] = dateStr.split('-');
  return `${y.slice(2)}.${m}.${d}`;
}

function md(dateStr){
  if (!dateStr) return '';
  const [y,m,d] = dateStr.split('-');
  return `${Number(m)}-${Number(d)}`;
}

function computeWeekEndingFromSunday(sundayStr){
  if (!sundayStr) return '';
  const dt = new Date(sundayStr + 'T00:00:00');
  dt.setDate(dt.getDate() + 6);
  return dt.toISOString().slice(0,10);
}

function computeWeekDatesFromSunday(sundayStr){
  const out = [];
  if (!sundayStr) return out;
  const base = new Date(sundayStr + 'T00:00:00');
  for (let i=0;i<7;i++){
    const d = new Date(base);
    d.setDate(base.getDate()+i);
    out.push(d.toISOString().slice(0,10));
  }
  return out;
}

function ensureState(){
  for (const r of rows){
    if (!r.row) continue;
    if (!state[r.row]) state[r.row] = {};
  }
}

function clearEntriesOnly(){
  ensureState();
  for (const r of rows){
    if (!r.row) continue;
    for (let di=0; di<7; di++){
      if (r.computed) continue;
      state[r.row][di] = '';
    }
  }
  el('businessPurpose').value = '';
  renderTableValues();
  computeTotals();
}

function clearAllNew(){
  // Clears entries + dates, keeps cloud, resets week selection. Keeps sync? user wants clear entries and dates; keep sync.
  clearEntriesOnly();
  el('sundayDate').value = '';
  el('weekEnding').value = '';
  currentSunday = '';
  currentWeekEnding = '';
  el('weekSelect').value = '';
  updateButtons();
  setStatus('Cleared.', false);
}

function syncPill(){
  const pill = el('syncPill');
  if (!pill) return;
  pill.textContent = currentSync ? currentSync : 'Not set';
  pill.classList.toggle('unset', !currentSync);
}

function promptForSync(){
  const val = prompt('Sync Name (type anything):', currentSync || '');
  if (val === null) return false;
  const s = String(val).trim();
  if (!s) return false;
  currentSync = s;
  localStorage.setItem(STORAGE_SYNC, currentSync);
  syncPill();
  loadWeeksList(); // refresh dropdown for this sync
  return true;
}

function updateButtons(){
  const hasWeek = !!currentWeekEnding;
  el('btnSave').disabled = !hasWeek;
  el('btnClear').disabled = false;
  el('btnDownload').disabled = !hasWeek;
  const sel = el('weekSelect').value;
  el('btnDeleteWeek').disabled = !sel;
}

function buildTable(){
  const tbody = el('entryTable').querySelector('tbody');
  tbody.innerHTML = '';

  for (const r of rows){
    if (r.type === 'divider'){
      const tr = document.createElement('tr');
      tr.className = 'divider';
      const td = document.createElement('td');
      td.colSpan = 8;
      td.innerHTML = '<div class="dividerLine"></div>';
      tr.appendChild(td);
      tbody.appendChild(tr);
      continue;
    }

    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.className = 'stickyLabel';
    tdLabel.textContent = r.label;
    tr.appendChild(tdLabel);

    for (let di=0; di<7; di++){
      const td = document.createElement('td');

      const inp = document.createElement('input');
      inp.dataset.row = String(r.row);
      inp.dataset.day = String(di);

      if (r.computed){
        inp.readOnly = true;
        inp.className = 'computed';
      } else if (r.type === 'text'){
        inp.type = 'text';
      } else {
        inp.type = 'text';
        inp.inputMode = 'decimal';
      }

      inp.addEventListener('input', ()=>{
        if (r.computed) return;
        ensureState();
        state[r.row][di] = inp.value;
        computeTotals();
      });

      inp.addEventListener('keydown', (e)=>{
        if (e.key === 'Tab'){
          e.preventDefault();
          moveFocusVertical(inp, e.shiftKey ? -1 : 1);
        }
      });

      td.appendChild(inp);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }

  renderTableValues();
}

function getEditableRowsForTab(){
  // returns list of row numbers in visual order that have editable inputs for tab navigation
  const out = [];
  for (const r of rows){
    if (!r.row) continue;
    if (r.computed) continue;
    out.push(r.row);
  }
  return out;
}

function moveFocusVertical(currentInput, dir){
  const row = Number(currentInput.dataset.row);
  const day = Number(currentInput.dataset.day);
  const order = getEditableRowsForTab();
  const idx = order.indexOf(row);
  if (idx === -1) return;

  let nextIdx = idx + dir;
  let nextDay = day;

  if (nextIdx < 0){
    // wrap to previous day, last row
    nextDay = Math.max(0, day-1);
    nextIdx = order.length-1;
  } else if (nextIdx >= order.length){
    // wrap to next day, first row
    nextDay = Math.min(6, day+1);
    nextIdx = 0;
  }

  const nextRow = order[nextIdx];
  const sel = `input[data-row="${nextRow}"][data-day="${nextDay}"]`;
  const next = document.querySelector(sel);
  if (next) next.focus();
}

function renderTableValues(){
  ensureState();

  for (const r of rows){
    if (!r.row) continue;
    for (let di=0; di<7; di++){
      const inp = document.querySelector(`input[data-row="${r.row}"][data-day="${di}"]`);
      if (!inp) continue;

      if (r.computed){
        // computed personal car mileage from miles
        const miles = parseNumber(state[10]?.[di] || '');
        const val = miles * ratePerMile;
        inp.value = val ? formatCurrency(val) : '';
      } else {
        inp.value = state[r.row]?.[di] ?? '';
      }
    }
  }
}

function computeTotals(){
  // Totals include currency rows + computed mileage row, exclude FROM/TO and miles
  const totByDay = Array(7).fill(0);

  for (let di=0; di<7; di++){
    let sum = 0;

    for (const r of rows){
      if (!r.row) continue;

      if (r.row === 8 || r.row === 9) continue;   // from/to
      if (r.row === 10) continue;                 // miles driven not currency

      if (r.row === 29){
        const miles = parseNumber(state[10]?.[di] || '');
        sum += miles * ratePerMile;
        continue;
      }

      const v = state[r.row]?.[di] ?? '';
      sum += parseNumber(v);
    }

    totByDay[di] = sum;
  }

  let week = 0;
  for (let di=0; di<7; di++){
    week += totByDay[di];
    el('tot' + dayIds[di]).value = totByDay[di] ? formatCurrency(totByDay[di]) : '';
  }
  el('totWEEK').value = week ? formatCurrency(week) : '';
}

async function apiFetch(url, opts){
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  if (!res.ok){
    const msg = (json && (json.error || json.message)) ? (json.error || json.message) : (text || res.statusText);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return json;
}

function fileBaseName(){
  // Week m-d through m-d - Business Purpose
  const bp = (el('businessPurpose').value || '').trim();
  const dates = computeWeekDatesFromSunday(currentSunday);
  if (dates.length !== 7) return bp ? bp : 'Week';
  const from = md(dates[0]);
  const to = md(dates[6]);
  const base = `Week ${from} through ${to}` + (bp ? ` - ${bp}` : '');
  return base;
}

function dropdownLabel(entry){
  // YY.MM.DD - <file base> (no .xlsx)
  const dt = yyMMdd(entry.weekEnding);
  const base = entry.fileBase || entry.sync || '';
  return `${dt} - ${base}`;
}

async function loadWeeksList(){
  const sel = el('weekSelect');
  sel.innerHTML = '<option value="">(Select a week)</option>';

  if (!currentSync) { updateButtons(); return; }

  try{
    const data = await apiFetch(`${API.weeks}?sync=${encodeURIComponent(currentSync)}`);
    const entries = (data && data.entries) ? data.entries : [];
    // entries already sorted; populate
    for (const e of entries){
      const opt = document.createElement('option');
      opt.value = e.weekEnding; // identify by weekEnding within this sync
      opt.textContent = dropdownLabel(e);
      sel.appendChild(opt);
    }

    // auto-load most recent edited (first) if nothing selected
    if (entries.length){
      if (!sel.value){
        sel.value = entries[0].weekEnding;
        await loadSelectedWeek();
      }
    }
  }catch(err){
    // ignore
  }finally{
    updateButtons();
  }
}

async function loadSelectedWeek(){
  const week = el('weekSelect').value;
  if (!currentSync || !week) { updateButtons(); return; }

  try{
    const data = await apiFetch(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(week)}`);
    const rec = data && data.data ? data.data : null;
    if (!rec) return;

    // Set dates
    currentWeekEnding = rec.weekEnding || week;
    currentSunday = rec.sundayDate || '';
    el('weekEnding').value = currentWeekEnding || '';
    if (currentSunday) el('sundayDate').value = currentSunday;

    el('businessPurpose').value = rec.businessPurpose || '';

    state = rec.state || {};
    ensureState();
    renderTableValues();
    computeTotals();
    setStatus('Loaded.', false);
  }catch(err){
    setStatus('Load failed: ' + err.message, true);
  }finally{
    updateButtons();
  }
}

async function saveNow(){
  if (!currentSunday || !currentWeekEnding){
    setStatus('Enter Sunday date first.', true);
    return;
  }
  if (!currentSync){
    const ok = promptForSync();
    if (!ok) return;
  }

  const payload = {
    sync: currentSync,
    weekEnding: currentWeekEnding,
    sundayDate: currentSunday,
    businessPurpose: (el('businessPurpose').value || '').trim(),
    fileBase: fileBaseName(),
    state,
  };

  try{
    await apiFetch(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(currentWeekEnding)}`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
    });
    setStatus('Saved.', false);
    await loadWeeksList();
    el('weekSelect').value = currentWeekEnding;
    updateButtons();
  }catch(err){
    setStatus('Save failed: ' + err.message, true);
  }
}

async function deleteSelected(){
  const week = el('weekSelect').value;
  if (!currentSync || !week) return;
  if (!confirm('Delete this saved entry?')) return;

  try{
    await apiFetch(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(week)}`, { method:'DELETE' });
    setStatus('Deleted.', false);
    el('weekSelect').value = '';
    clearEntriesOnly();
    await loadWeeksList();
  }catch(err){
    setStatus('Delete failed: ' + err.message, true);
  }
}

function onSundayChange(){
  const s = el('sundayDate').value;
  if (!s) return;

  const newWeekEnding = computeWeekEndingFromSunday(s);
  const changedWeek = (currentWeekEnding && newWeekEnding && currentWeekEnding !== newWeekEnding);

  currentSunday = s;
  currentWeekEnding = newWeekEnding;
  el('weekEnding').value = currentWeekEnding;

  // if changing to a different week, clear entries automatically (keep sync)
  if (changedWeek){
    clearEntriesOnly();
    el('weekSelect').value = '';
  }
  updateButtons();
  setStatus('', false);
}

function onChangeSync(){
  const ok = promptForSync();
  if (!ok) return;
  // changing sync clears currently loaded week selection and entries (but not needed; we'll keep dates)
  el('weekSelect').value = '';
  clearEntriesOnly();
  loadWeeksList();
  updateButtons();
}

function excelSerial(dateStr){
  // Excel serial date number (1900 system). Using 1899-12-30 baseline.
  const dt = new Date(dateStr + 'T00:00:00');
  const epoch = Date.UTC(1899,11,30);
  return Math.round((dt.getTime() - epoch) / 86400000);
}

function xmlEscape(s){
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&apos;');
}

function findCell(doc, addr){
  return doc.querySelector(`c[r="${addr}"]`);
}

function setCellInlineStr(doc, addr, text){
  let c = findCell(doc, addr);
  if (!c){
    // create cell in the appropriate row
    const rowNum = Number(addr.match(/\d+/)[0]);
    const row = doc.querySelector(`row[r="${rowNum}"]`) || createRow(doc, rowNum);
    c = doc.createElementNS(row.namespaceURI, 'c');
    c.setAttribute('r', addr);
    row.appendChild(c);
  }
  c.setAttribute('t', 'inlineStr');
  // remove existing v/f
  const v = c.querySelector('v'); if (v) v.remove();
  // set inline string
  let is = c.querySelector('is');
  if (!is){
    is = doc.createElementNS(c.namespaceURI, 'is');
    c.appendChild(is);
  } else {
    is.innerHTML = '';
  }
  const t = doc.createElementNS(c.namespaceURI, 't');
  t.textContent = text;
  is.appendChild(t);
}

function setCellNumber(doc, addr, num, preserveFormula=true){
  let c = findCell(doc, addr);
  if (!c){
    const rowNum = Number(addr.match(/\d+/)[0]);
    const row = doc.querySelector(`row[r="${rowNum}"]`) || createRow(doc, rowNum);
    c = doc.createElementNS(row.namespaceURI, 'c');
    c.setAttribute('r', addr);
    row.appendChild(c);
  }
  // remove inlineStr
  if (c.getAttribute('t') === 'inlineStr') c.removeAttribute('t');
  // keep formula if exists and preserveFormula true
  const f = c.querySelector('f');
  if (f && !preserveFormula) f.remove();
  let v = c.querySelector('v');
  if (!v){
    v = doc.createElementNS(c.namespaceURI, 'v');
    c.appendChild(v);
  }
  v.textContent = String(num);
}

function createRow(doc, rowNum){
  const sheetData = doc.querySelector('sheetData');
  const row = doc.createElementNS(doc.documentElement.namespaceURI, 'row');
  row.setAttribute('r', String(rowNum));
  sheetData.appendChild(row);
  return row;
}

async function exportExcel(){
  if (!currentSunday || !currentWeekEnding){
    setStatus('Enter Sunday date first.', true);
    return;
  }

  try{
    const tpl = await fetch('Expenses%20Form.xlsx');
    if (!tpl.ok) throw new Error('Template not found');
    const buf = await tpl.arrayBuffer();

    const zip = await JSZip.loadAsync(buf);
    const sheetPath = 'xl/worksheets/sheet1.xml';
    const xmlText = await zip.file(sheetPath).async('text');

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');

    // read mileage rate from B10 if possible
    try{
      const b10 = findCell(doc, 'B10');
      if (b10){
        const v = b10.querySelector('v');
        if (v){
          const n = parseNumber(v.textContent);
          if (n > 0 && n < 10) ratePerMile = n;
        }
      }
    }catch{}

    // Header cells
    setCellNumber(doc, 'E5', excelSerial(currentWeekEnding), true);
    setCellNumber(doc, 'E4', excelSerial(currentWeekEnding), true); // compatibility
    setCellInlineStr(doc, 'H5', (el('businessPurpose').value || '').trim());

    // Date row C7-I7
    const weekDates = computeWeekDatesFromSunday(currentSunday);
    const cols = ['C','D','E','F','G','H','I'];
    for (let i=0;i<7;i++){
      setCellNumber(doc, `${cols[i]}7`, excelSerial(weekDates[i]), true);
    }

    // Fill rows
    ensureState();
    const rowToType = {};
    for (const r of rows){
      if (!r.row) continue;
      rowToType[r.row] = r;
    }

    // For each row with actual mapping: write values into C..I
    for (const r of rows){
      if (!r.row) continue;
      if (r.row === 29) continue; // computed handled below
      for (let di=0; di<7; di++){
        const addr = `${cols[di]}${r.row}`;
        const val = state[r.row]?.[di] ?? '';
        if (r.type === 'text'){
          setCellInlineStr(doc, addr, String(val || ''));
        } else if (r.type === 'number'){
          setCellNumber(doc, addr, parseNumber(val), true);
        } else {
          // currency numeric
          setCellNumber(doc, addr, parseNumber(val), true);
        }
      }
    }

    // Personal mileage row 29: keep formula, but set cached v
    let weekMileage = 0;
    for (let di=0; di<7; di++){
      const miles = parseNumber(state[10]?.[di] || '');
      const amt = miles * ratePerMile;
      weekMileage += amt;
      setCellNumber(doc, `${cols[di]}29`, amt, true);
    }
    // total col J29
    setCellNumber(doc, `J29`, weekMileage, true);

    // Force recalc on open (calcChain may exist)
    try{
      const wbPath = 'xl/workbook.xml';
      const wbText = await zip.file(wbPath).async('text');
      const wbDoc = parser.parseFromString(wbText, 'application/xml');
      let calcPr = wbDoc.querySelector('calcPr');
      if (!calcPr){
        const wb = wbDoc.querySelector('workbook');
        calcPr = wbDoc.createElementNS(wb.namespaceURI, 'calcPr');
        wb.appendChild(calcPr);
      }
      calcPr.setAttribute('calcMode','auto');
      calcPr.setAttribute('fullCalcOnLoad','1');
      zip.file(wbPath, new XMLSerializer().serializeToString(wbDoc));
    }catch{}

    const outXml = new XMLSerializer().serializeToString(doc);
    zip.file(sheetPath, outXml);

    const outBuf = await zip.generateAsync({ type:'arraybuffer' });
    const blob = new Blob([outBuf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

    const a = document.createElement('a');
    const base = fileBaseName();
    a.download = `${base}.xlsx`;
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 250);
    setStatus('Exported.', false);
  }catch(err){
    setStatus('Excel export failed: ' + err.message, true);
  }
}

function init(){
  syncPill();
  buildTable();
  computeTotals();

  el('btnSave').addEventListener('click', saveNow);
  el('btnDeleteWeek').addEventListener('click', deleteSelected);
  el('btnClear').addEventListener('click', clearAllNew);
  el('btnChangeSync').addEventListener('click', onChangeSync);
  el('btnDownload').addEventListener('click', exportExcel);

  el('weekSelect').addEventListener('change', loadSelectedWeek);
  el('sundayDate').addEventListener('change', onSundayChange);

  // enable buttons initial
  updateButtons();

  if (currentSync){
    loadWeeksList();
  }
}

document.addEventListener('DOMContentLoaded', init);
