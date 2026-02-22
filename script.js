// Weekly Expenses (Cloudflare Pages + KV)
// No login. Sync key = Week Ending (Saturday) in YYYY-MM-DD.

const API = { data: '/api/data', weeks: '/api/weeks' };
const el = (id) => document.getElementById(id);

const dayCols = ['C','D','E','F','G','H','I']; // Sun..Sat
const dayIds  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

// Template mileage rate is stored in B10 (seen in the provided Excel template)
// Used to *display* Personal Car Mileage (row 29) as a derived value.
const MILEAGE_RATE = 0.7; // dollars per mile

// Rows you can edit (per your list) plus a derived display row for Personal Car Mileage (row 29).
// Also re-ordered: meals directly under Personal Car Mileage.
const rows = [
  {row:8,  label:'FROM',                   type:'text'},
  {row:9,  label:'TO',                     type:'text'},
  {row:10, label:'BUSINESS MILES DRIVEN',  type:'number'},
  {row:29, label:`Personal Car Mileage ($${MILEAGE_RATE.toFixed(2)}/mi)`, type:'currency', computed:true},
  {type:'divider'},

  {row:42, label:'Breakfast', type:'currency'},
  {row:43, label:'Lunch', type:'currency'},
  {row:44, label:'Dinner', type:'currency'},
  {type:'divider'},

  // Airfare above Auto Rental
  {row:18, label:'Airfare', type:'currency'},
  {row:19, label:'Bus, Limo & Taxi', type:'currency'},
  {row:20, label:'Lodging Room & Tax', type:'currency'},
  {row:21, label:'Parking / Tolls', type:'currency'},
  {row:22, label:'Tips', type:'currency'},
  {row:23, label:'Laundry', type:'currency'},

  {row:25, label:'Auto Rental', type:'currency'},
  {row:26, label:'Auto Rental Fuel', type:'currency'},
  {type:'divider'},

  {row:34, label:'Internet - Email', type:'currency'},
  {row:36, label:'POSTAGE', type:'currency'},
  {row:38, label:'PERISHABLE TOOLS', type:'currency'},
  {row:39, label:'DUES & SUBSCRIPTIONS', type:'currency'},
];

let currentWeekEnding = ''; // YYYY-MM-DD

function toISODate(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const da=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}
function parseISODate(s){
  const [y,m,d]=s.split('-').map(Number);
  return new Date(y,m-1,d);
}
function computeWeekEndingFromSunday(sundayISO){
  const sun = parseISODate(sundayISO);
  const sat = new Date(sun);
  sat.setDate(sun.getDate()+6);
  return sat;
}
function computeSundayFromWeekEnding(weekEndingISO){
  const sat = parseISODate(weekEndingISO);
  const sun = new Date(sat);
  sun.setDate(sat.getDate()-6);
  return sun;
}
function fmtMD(d){
  return `${d.getMonth()+1}-${d.getDate()}`;
}
function weekLabel(weekEndingISO){
  const sat = parseISODate(weekEndingISO);
  const sun = computeSundayFromWeekEnding(weekEndingISO);
  return `Week ${fmtMD(sun)} through ${fmtMD(sat)}`;
}

function setStatus(msg=''){
  el('saveStatus').textContent = msg;
}

function buildTable(){
  const tbody = el('entryTable').querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(r=>{
    if (r.type === 'divider'){
      const tr=document.createElement('tr');
      tr.className='divider-row';
      const td=document.createElement('td');
      td.colSpan = 8;
      td.className='divider-cell';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    const tr=document.createElement('tr');

    const tdLabel=document.createElement('td');
    tdLabel.className='stickyLabel';
    tdLabel.textContent=r.label;

    tr.appendChild(tdLabel);

    for (let i=0;i<7;i++){
      const td=document.createElement('td');
      const inp=document.createElement('input');
      inp.dataset.row=String(r.row);
      inp.dataset.col=dayCols[i];
      inp.dataset.type=r.type;
      if (r.computed) { inp.dataset.computed='true'; inp.readOnly = true; inp.tabIndex = -1; }

      if (r.type==='number'){
        inp.inputMode='numeric';
        inp.placeholder='0';
        inp.classList.add('number-right');
      } else if (r.type==='currency'){
        inp.inputMode='decimal';
        inp.placeholder='0.00';
        inp.classList.add('number-right');
      } else {
        inp.inputMode='text';
      }

      inp.addEventListener('input', computeTotals);
      inp.addEventListener('keydown', gridKeydown);
      if (r.computed){
        inp.readOnly = true;
        inp.classList.add('computed');
        inp.tabIndex = -1;
      }
      if (r.type==='currency'){
        const wrap=document.createElement('div');
        wrap.className='currency-wrap';
        wrap.appendChild(inp);
        td.appendChild(wrap);
      } else {
        td.appendChild(inp);
      }
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });
}


function gridKeydown(e){
  if (e.key !== 'Tab') return;
  const inp = e.target;
  if (!inp || !inp.dataset || !inp.dataset.col || !inp.dataset.row) return;
  // Only override tabbing inside the entry grid (tbody inputs)
  if (!el('entryTable').contains(inp)) return;

  e.preventDefault();

  const dir = e.shiftKey ? -1 : 1;
  const col = inp.dataset.col;
  const rowNum = Number(inp.dataset.row);

  // Build ordered list of editable row numbers (skip dividers and computed-only rows)
  const rowOrder = rows.filter(r=>r.type!=='divider').map(r=>r.row);
  const idx = rowOrder.indexOf(rowNum);
  if (idx === -1) return;

  let nextIdx = idx + dir;
  while (nextIdx >= 0 && nextIdx < rowOrder.length){
    const nextRow = rowOrder[nextIdx];
    const next = el('entryTable').querySelector(`tbody input[data-row="${nextRow}"][data-col="${col}"]`);
    if (next && next.tabIndex !== -1 && !next.readOnly){
      next.focus();
      next.select?.();
      return;
    }
    nextIdx += dir;
  }

  // If no next row, fall back to normal tab order outside the grid
  // by focusing the next focusable element in the document.
  const focusables = Array.from(document.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(n=>!n.disabled && n.offsetParent!==null);
  const cur = focusables.indexOf(inp);
  const nxt = focusables[cur + (dir>0?1:-1)];
  if (nxt) nxt.focus();
}

function allInputs(){
  return Array.from(el('entryTable').querySelectorAll('input'));
}

function clearInputs(){
  allInputs().forEach(i=>i.value='');
  el('businessPurpose').value='';
  computeTotals();
}

function recomputeDerived(){
  // Personal Car Mileage (row 29) = Business miles (row 10) * MILEAGE_RATE
  for (let i=0;i<7;i++){
    const milesInp = el('entryTable').querySelector(`input[data-row="10"][data-col="${dayCols[i]}"]`);
    const outInp   = el('entryTable').querySelector(`input[data-row="29"][data-col="${dayCols[i]}"]`);
    if (!milesInp || !outInp) continue;
    const n = Number((milesInp.value || '').trim());
    if (!Number.isFinite(n) || n<=0){
      outInp.value = '';
    } else {
      outInp.value = (n * MILEAGE_RATE).toFixed(2);
    }
  }
}

function computeTotals(){
  recomputeDerived();
  const totals=[0,0,0,0,0,0,0];
  allInputs().forEach(inp=>{
    if (inp.dataset.type!=='currency') return;
    const v=inp.value.trim();
    if (!v) return;
    const n=Number(v);
    if (!Number.isFinite(n)) return;
    const idx=dayCols.indexOf(inp.dataset.col);
    if (idx>=0) totals[idx]+=n;
  });
  let week=0;
  totals.forEach((t,idx)=>{
    week+=t;
    const out = t ? ('$' + t.toFixed(2)) : '';
    el(`tot${dayIds[idx]}`).value = out;
  });
  el('totWEEK').value = week ? ('$' + week.toFixed(2)) : '';
}

function serialize(){
  const entries={};
  allInputs().forEach(inp=>{
    if (inp.dataset.computed==='true') return; // derived display only
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    const raw = inp.value;
    if (raw==='') return;
    if (inp.dataset.type==='number' || inp.dataset.type==='currency'){
      const n=Number(raw);
      if (!Number.isFinite(n)) return;
      entries[addr]=n;
    } else {
      entries[addr]=raw;
    }
  });
  return {
    weekEnding: currentWeekEnding,
    businessPurpose: el('businessPurpose').value || '',
    entries
  };
}

function applyData(data){
  clearInputs();
  if (!data) return;
  el('businessPurpose').value = data.businessPurpose || '';
  const map = data.entries || {};
  allInputs().forEach(inp=>{
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    if (map[addr]==null) return;
    inp.value = String(map[addr]);
  });
  computeTotals();
}

async function apiFetchJson(url, opts={}){
  const headers = opts.headers ? {...opts.headers} : {};
  if (opts.body && !headers['Content-Type']) headers['Content-Type']='application/json';
  const res = await fetch(url, {...opts, headers});
  if (!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`${res.status} ${res.statusText}${t ? ' - '+t : ''}`);
  }
  return res.json();
}

async function refreshWeekDropdown(){
  try{
    const out = await apiFetchJson(API.weeks);
    const weeks = Array.isArray(out.weeks) ? out.weeks : [];
    const sel = el('weekSelect');
    const keep = sel.value;
    sel.innerHTML = '<option value="">(Select a week)</option>';
    weeks.forEach(we=>{
      const opt=document.createElement('option');
      opt.value=we;
      opt.textContent=weekLabel(we);
      sel.appendChild(opt);
    });
    if (keep && weeks.includes(keep)) sel.value=keep;
  } catch {
    // ignore
  }
}

async function loadWeek(){
  if (!currentWeekEnding) return;
  setStatus('Loading…');
  try{
    const out = await apiFetchJson(`${API.data}?weekEnding=${encodeURIComponent(currentWeekEnding)}`);
    applyData(out.data);
    setStatus(out.data ? 'Loaded.' : 'No saved data (new week).');
  } catch(e){
    setStatus('Load failed.');
  }
}

async function saveWeek(){
  if (!currentWeekEnding) return;
  setStatus('Saving…');
  try{
    await apiFetchJson(`${API.data}?weekEnding=${encodeURIComponent(currentWeekEnding)}`, {
      method:'PUT',
      body: JSON.stringify(serialize())
    });
    setStatus('Saved.');
    await refreshWeekDropdown();
    // ensure selected
    el('weekSelect').value = currentWeekEnding;
  } catch(e){
    setStatus('Save failed.');
  }
}

async function deleteWeek(){
  if (!currentWeekEnding) return;
  if (!confirm(`Delete saved data for ${weekLabel(currentWeekEnding)}?`)) return;
  setStatus('Deleting…');
  try{
    await apiFetchJson(`${API.data}?weekEnding=${encodeURIComponent(currentWeekEnding)}`, {method:'DELETE'});
    clearInputs();
    setStatus('Deleted.');
    await refreshWeekDropdown();
    el('weekSelect').value='';
  } catch{
    setStatus('Delete failed.');
  }
}

async function downloadExcel(){
  if (!currentWeekEnding) return;
  setStatus('Building Excel…');
  try{
    if (typeof JSZip === 'undefined') throw new Error('JSZip library not loaded');

    // Fetch template (try encoded + unencoded paths)
    const candidates = [
      '/Expenses%20Form.xlsx','Expenses%20Form.xlsx','/Expenses Form.xlsx','Expenses Form.xlsx'
    ];
    let res=null;
    for (const url of candidates){
      try{
        res = await fetch(url, {cache:'no-store'});
        if (res && res.ok) break;
      } catch {}
    }
    if (!res || !res.ok) throw new Error('Template not found');
    const ab = await res.arrayBuffer();

    const zip = await JSZip.loadAsync(ab);

    // Load sheet XML
    const sheetPath = 'xl/worksheets/sheet1.xml';
    const sheetXml = await zip.file(sheetPath).async('string');
    const parser = new DOMParser();
    const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');

    const bp = (el('businessPurpose')?.value || '').trim();
    const satISO = currentWeekEnding;
    const sat = parseISODate(satISO);
    const sun = computeSundayFromWeekEnding(satISO);

    // Helpers
    const xmlNS = sheetDoc.documentElement.namespaceURI;
    function qsa(node, sel){ return Array.from(node.querySelectorAll(sel)); }
    function findCell(ref){ return sheetDoc.querySelector(`c[r="${ref}"]`); }
    function ensureRow(rowNum){
      const sheetData = sheetDoc.getElementsByTagName('sheetData')[0];
      let row = sheetDoc.querySelector(`row[r="${rowNum}"]`);
      if (row) return row;
      row = sheetDoc.createElementNS(xmlNS, 'row');
      row.setAttribute('r', String(rowNum));
      const rows = qsa(sheetData, 'row');
      const after = rows.find(r => parseInt(r.getAttribute('r'),10) > rowNum);
      if (after) sheetData.insertBefore(row, after);
      else sheetData.appendChild(row);
      return row;
    }
    function colToNum(col){
      let n=0;
      for (const ch of col){ n = n*26 + (ch.charCodeAt(0)-64); }
      return n;
    }
    function splitRef(ref){
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      return {col:m[1], row:parseInt(m[2],10)};
    }
    function ensureCell(ref){
      let cell = findCell(ref);
      if (cell) return cell;
      const {col,row} = splitRef(ref);
      const rowEl = ensureRow(row);
      cell = sheetDoc.createElementNS(xmlNS,'c');
      cell.setAttribute('r', ref);
      const cells = qsa(rowEl,'c');
      const target = colToNum(col);
      const after = cells.find(c => colToNum(splitRef(c.getAttribute('r')).col) > target);
      if (after) rowEl.insertBefore(cell, after);
      else rowEl.appendChild(cell);
      return cell;
    }
    function setCellNumber(ref, num){
      const cell = ensureCell(ref);
      cell.removeAttribute('t');
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      const v = sheetDoc.createElementNS(xmlNS,'v');
      v.textContent = String(num);
      cell.appendChild(v);
    }
    function setCellStringInline(ref, str){
      const cell = ensureCell(ref);
      cell.setAttribute('t','inlineStr');
      while (cell.firstChild) cell.removeChild(cell.firstChild);
      const is = sheetDoc.createElementNS(xmlNS,'is');
      const t = sheetDoc.createElementNS(xmlNS,'t');
      if (/^\s|\s$/.test(str)) t.setAttribute('xml:space','preserve');
      t.textContent = str;
      is.appendChild(t);
      cell.appendChild(is);
    }
    function fmtMDY(d){ return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }

    // Header fields: fill week-ending and business purpose into E5 and H5.
    // Also write E4 for compatibility with any unmerged variants.
    setCellStringInline('E4', fmtMDY(sat));
    setCellStringInline('E5', fmtMDY(sat));
    setCellStringInline('H5', bp);

    for (let i=0;i<7;i++){
      const d = new Date(sun);
      d.setDate(sun.getDate()+i);
      setCellStringInline(`${dayCols[i]}7`, fmtMDY(d));
    }

    const payload = serialize();
    for (const [addr,val] of Object.entries(payload.entries || {})){
      if (typeof val === 'number') setCellNumber(addr, val);
      else setCellStringInline(addr, String(val));
    }

    setCellNumber('B10', MILEAGE_RATE);

    const serializer = new XMLSerializer();
    zip.file(sheetPath, serializer.serializeToString(sheetDoc));

    const outBlob = await zip.generateAsync({type:'blob'});

    const mdSun = fmtMD(sun);
    const mdSat = fmtMD(sat);
    const safeBp = (bp || 'Expenses').replace(/[\/:*?"<>|]+/g,'').trim();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = `Week ${mdSun} through ${mdSat} - ${safeBp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    setStatus('Excel downloaded.');
  } catch (err) {
    console.error(err);
    setStatus(`Excel export failed: ${err?.message || err}`);
  }
}


// UI events
function setWeekFromSunday(sundayISO){
  const sat = computeWeekEndingFromSunday(sundayISO);
  currentWeekEnding = toISODate(sat);
  el('weekEnding').value = currentWeekEnding;
  el('weekSelect').value = currentWeekEnding; // may not exist yet; ok
}

el('sundayDate').addEventListener('change', async ()=>{
  const v = el('sundayDate').value;
  if (!v) return;
  setWeekFromSunday(v);
  await loadWeek(); // auto-load if it exists
});

el('weekSelect').addEventListener('change', async ()=>{
  const v = el('weekSelect').value;
  if (!v) return;
  currentWeekEnding = v;
  el('weekEnding').value = v;
  el('sundayDate').value = toISODate(computeSundayFromWeekEnding(v));
  await loadWeek();
});

el('btnSave').addEventListener('click', saveWeek);
el('btnDeleteWeek').addEventListener('click', deleteWeek);
el('btnClear').addEventListener('click', ()=>{ clearInputs(); setStatus('Cleared (not deleted).'); });
el('btnDownload').addEventListener('click', downloadExcel);

(function init(){
  buildTable();
  computeTotals();

  // Default to current week (Sunday of this week)
  const today = new Date();
  const sun = new Date(today);
  sun.setDate(today.getDate() - today.getDay());
  el('sundayDate').value = toISODate(sun);
  setWeekFromSunday(toISODate(sun));

  refreshWeekDropdown().then(async ()=>{
    // If this week exists in dropdown, keep it selected
    el('weekSelect').value = currentWeekEnding;
    await loadWeek();
  });

  // enable buttons once we have a week ending
  setButtonsEnabled(true);
})();

function setButtonsEnabled(on){
  el('btnSave').disabled = !on;
  el('btnClear').disabled = !on;
  el('btnDownload').disabled = !on;
  el('btnDeleteWeek').disabled = !on;
}
