
// Weekly Expenses (Cloudflare Pages + KV)
// Sync behaves like test-entry-log:
// - Sync Name is a namespace (same sync across multiple weeks)
// - On page load (if Sync exists) auto-load most recent week for that sync
// - Change Sync loads its weeks and auto-loads most recent (A)

const API = { data: '/api/data', weeks: '/api/weeks' };
const el = (id) => document.getElementById(id);

const dayCols = ['C','D','E','F','G','H','I']; // Sun..Sat
const dayIds  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

const MILEAGE_RATE = 0.7; // $/mile (display + export cached values)

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

let currentSync = (localStorage.getItem('expenses_sync_name') || '').trim();
let currentWeekEnding = ''; // YYYY-MM-DD
let weeksCache = []; // [{weekEnding,businessPurpose,updatedAt}]
let loading = false;

function setStatus(msg=''){ el('saveStatus').textContent = msg; }
function renderSync(){
  el('syncPill').textContent = currentSync || 'Not set';
  localStorage.setItem('expenses_sync_name', currentSync || '');
}
function sanitizeSyncName(s){
  if (!s) return '';
  return String(s).trim().replace(/\s+/g,' ').slice(0,80);
}

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
function fmtMD(d){ return `${d.getMonth()+1}-${d.getDate()}`; }
function fmtYYMMDD(d){
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yy}.${mm}.${dd}`;
}

function setHeaderDatesFromSunday(sundayISO){
  // sundayISO: YYYY-MM-DD
  const dateEls = {
    SUN: el('dateSUN'), MON: el('dateMON'), TUE: el('dateTUE'),
    WED: el('dateWED'), THU: el('dateTHU'), FRI: el('dateFRI'), SAT: el('dateSAT')
  };
  if (!sundayISO){
    Object.values(dateEls).forEach(x=>{ if (x) x.textContent=''; });
    return;
  }
  const sun = parseISODate(sundayISO);
  for (let i=0;i<7;i++){
    const d = new Date(sun);
    d.setDate(sun.getDate()+i);
    const id = dayIds[i];
    const txt = `${d.getMonth()+1}/${d.getDate()}`;
    if (dateEls[id]) dateEls[id].textContent = txt;
  }
}
function safeFilenameBase(weekEndingISO, businessPurpose){
  const sat = parseISODate(weekEndingISO);
  const sun = computeSundayFromWeekEnding(weekEndingISO);
  const bp = (businessPurpose || 'Expenses').trim();
  const safeBp = bp.replace(/[\/:*?"<>|]+/g,'').trim() || 'Expenses';
  return `Week ${fmtMD(sun)} through ${fmtMD(sat)} - ${safeBp}`;
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
      if (r.computed){
        inp.dataset.computed='true';
        inp.readOnly = true;
        inp.tabIndex = -1;
        inp.classList.add('computed','number-right');
      }

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
  if (!el('entryTable').contains(inp)) return;
  e.preventDefault();
  const dir = e.shiftKey ? -1 : 1;
  const col = inp.dataset.col;
  const rowNum = Number(inp.dataset.row);

  const rowOrder = rows.filter(r=>r.type!=='divider' && !r.computed).map(r=>r.row);
  const idx = rowOrder.indexOf(rowNum);
  if (idx === -1) return;
  let nextIdx = idx + dir;
  while (nextIdx >= 0 && nextIdx < rowOrder.length){
    const nextRow = rowOrder[nextIdx];
    const next = el('entryTable').querySelector(`tbody input[data-row="${nextRow}"][data-col="${col}"]`);
    if (next){ next.focus(); next.select?.(); return; }
    nextIdx += dir;
  }
}

function allInputs(){ return Array.from(el('entryTable').querySelectorAll('input')); }

function clearEntryValues(){
  allInputs().forEach(i=>{ if (i.dataset.computed!=='true') i.value=''; else i.value=''; });
  el('businessPurpose').value='';
  computeTotals();
}

function clearAllNew(){
  el('sundayDate').value='';
  el('weekEnding').value='';
  setHeaderDatesFromSunday('');
  currentWeekEnding='';
  clearEntryValues();
  // Reset sync so next save prompts (matches your "New (clear all)" expectation)
  currentSync='';
  renderSync();
  setHeaderDatesFromSunday(el('sundayDate').value);
  weeksCache=[];
  renderWeeksDropdown();
  setButtonsEnabled();
  setStatus('Cleared. Set Sunday date and Sync Name on Save.');
}

function recomputeDerived(){
  for (let i=0;i<7;i++){
    const milesInp = el('entryTable').querySelector(`input[data-row="10"][data-col="${dayCols[i]}"]`);
    const outInp   = el('entryTable').querySelector(`input[data-row="29"][data-col="${dayCols[i]}"]`);
    if (!milesInp || !outInp) continue;
    const n = Number((milesInp.value || '').trim());
    outInp.value = (Number.isFinite(n) && n>0) ? (n * MILEAGE_RATE).toFixed(2) : '';
  }
}

function computeTotals(){
  recomputeDerived();
  const totals=[0,0,0,0,0,0,0];
  allInputs().forEach(inp=>{
    if (inp.dataset.type!=='currency') return;
    const v=(inp.value||'').trim();
    if (!v) return;
    const n=Number(v);
    if (!Number.isFinite(n)) return;
    const idx=dayCols.indexOf(inp.dataset.col);
    if (idx>=0) totals[idx]+=n;
  });
  let week=0;
  totals.forEach((t,idx)=>{
    week+=t;
    el(`tot${dayIds[idx]}`).value = t ? ('$' + t.toFixed(2)) : '';
  });
  el('totWEEK').value = week ? ('$' + week.toFixed(2)) : '';
}

function serialize(){
  const entries={};
  allInputs().forEach(inp=>{
    if (inp.dataset.computed==='true') return;
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    const raw = (inp.value ?? '');
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
    syncName: currentSync,
    weekEnding: currentWeekEnding,
    businessPurpose: el('businessPurpose').value || '',
    entries
  };
}

function applyData(data){
  clearEntryValues();
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
  const txt = await res.text().catch(()=> '');
  if (!res.ok){
    throw new Error(txt || `${res.status} ${res.statusText}`);
  }
  return txt ? JSON.parse(txt) : {};
}

function renderWeeksDropdown(selectedWeekEnding=''){
  const sel = el('weekSelect');
  sel.innerHTML = '<option value="">(Select a week)</option>';
  const sorted = [...weeksCache].sort((a,b)=> (b.weekEnding||'').localeCompare(a.weekEnding||''));
  for (const w of sorted){
    const opt=document.createElement('option');
    opt.value = w.weekEnding;
    const label = `${fmtYYMMDD(parseISODate(w.weekEnding))} - ${safeFilenameBase(w.weekEnding, w.businessPurpose)}`;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (selectedWeekEnding){
    sel.value = selectedWeekEnding;
  }
}

async function loadWeeksForSync(autoLoadMostRecent=true){
  if (!currentSync){
    weeksCache=[];
    renderWeeksDropdown();
    return;
  }
  const out = await apiFetchJson(`${API.weeks}?sync=${encodeURIComponent(currentSync)}`);
  weeksCache = Array.isArray(out.weeks) ? out.weeks : [];
  renderWeeksDropdown();
  if (autoLoadMostRecent && weeksCache.length){
    const most = [...weeksCache].sort((a,b)=> (b.weekEnding||'').localeCompare(a.weekEnding||''))[0];
    await loadWeek(most.weekEnding);
  }
}

async function loadWeek(weekEndingISO){
  if (!currentSync) return;
  if (!weekEndingISO) return;
  loading = true;
  setStatus('Loading…');
  try{
    const out = await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(weekEndingISO)}`);
    currentWeekEnding = weekEndingISO;
    el('weekEnding').value = weekEndingISO;
    el('sundayDate').value = toISODate(computeSundayFromWeekEnding(weekEndingISO));
    setHeaderDatesFromSunday(el('sundayDate').value);
    applyData(out.data);
    renderWeeksDropdown(weekEndingISO);
    setStatus('Loaded.');
  } catch(e){
    console.error(e);
    setStatus('Load failed.');
  } finally {
    loading = false;
    setButtonsEnabled();
  }
}

function ensureSync(){
  if (currentSync) return true;
  const v = prompt('Enter Sync Name (type anything):', '');
  const s = sanitizeSyncName(v);
  if (!s) return false;
  currentSync = s;
  renderSync();
  return true;
}

async function saveWeek(){
  if (!currentWeekEnding){
    setStatus('Enter a Sunday date first.');
    return;
  }
  if (!ensureSync()) { setStatus('Sync Name not set.'); return; }
  setStatus('Saving…');
  try{
    const body = JSON.stringify(serialize());
    await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(currentWeekEnding)}`, {method:'PUT', body});
    // Optimistic insert/update
    const existing = weeksCache.find(w=>w.weekEnding===currentWeekEnding);
    const bp = el('businessPurpose').value || '';
    const nowIso = new Date().toISOString();
    if (existing){
      existing.businessPurpose = bp;
      existing.updatedAt = nowIso;
    } else {
      weeksCache.push({weekEnding: currentWeekEnding, businessPurpose: bp, updatedAt: nowIso});
    }
    renderWeeksDropdown(currentWeekEnding);
    setStatus('Saved.');
  } catch(e){
    console.error(e);
    setStatus('Save failed.');
  }
}

async function deleteWeek(){
  const selWe = el('weekSelect').value || currentWeekEnding;
  if (!currentSync || !selWe){
    setStatus('Pick a week to delete.');
    return;
  }
  if (!confirm(`Delete saved data for week ending ${selWe}?`)) return;
  setStatus('Deleting…');
  try{
    await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(selWe)}`, {method:'DELETE'});
    weeksCache = weeksCache.filter(w=>w.weekEnding !== selWe);
    if (currentWeekEnding === selWe){
      clearEntryValues();
      currentWeekEnding='';
      el('sundayDate').value='';
      el('weekEnding').value='';
    }
    renderWeeksDropdown();
    setStatus('Deleted.');
  } catch(e){
    console.error(e);
    setStatus('Delete failed.');
  } finally {
    setButtonsEnabled();
  }
}

async function downloadExcel(){
  if (!currentWeekEnding){ setStatus('Enter a Sunday date first.'); return; }
  if (!ensureSync()) { setStatus('Sync Name not set.'); return; }

  setStatus('Building Excel…');
  try{
    if (typeof JSZip === 'undefined') throw new Error('JSZip library not loaded');
    const candidates = ['/Expenses%20Form.xlsx','Expenses%20Form.xlsx','/Expenses Form.xlsx','Expenses Form.xlsx'];
    let res=null;
    for (const url of candidates){
      try{ res = await fetch(url, {cache:'no-store'}); if (res && res.ok) break; } catch {}
    }
    if (!res || !res.ok) throw new Error('Template not found');
    const ab = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(ab);

    if (zip.file('xl/calcChain.xml')) zip.remove('xl/calcChain.xml');

    const sheetPath = 'xl/worksheets/sheet1.xml';
    const sheetXml = await zip.file(sheetPath).async('string');
    const sheetDoc = new DOMParser().parseFromString(sheetXml, 'application/xml');
    const xmlNS = sheetDoc.documentElement.namespaceURI;

    const bp = (el('businessPurpose')?.value || '').trim();
    const satISO = currentWeekEnding;
    const sat = parseISODate(satISO);
    const sun = computeSundayFromWeekEnding(satISO);

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

    // Cached Personal Car Mileage values in row 29 based on miles (row 10).
    let mileageWeekTotal = 0;
    for (let i=0;i<7;i++){
      const miles = Number(payload.entries?.[`${dayCols[i]}10`] ?? 0);
      const amt = (Number.isFinite(miles) ? miles : 0) * MILEAGE_RATE;
      if (amt > 0){
        mileageWeekTotal += amt;
        setCellNumber(`${dayCols[i]}29`, Number(amt.toFixed(2)));
      }
    }
    if (mileageWeekTotal > 0){
      setCellNumber(`J29`, Number(mileageWeekTotal.toFixed(2)));
    }

    zip.file(sheetPath, new XMLSerializer().serializeToString(sheetDoc));
    const outBlob = await zip.generateAsync({type:'blob'});

    const safeBp = (bp || 'Expenses').replace(/[\/:*?"<>|]+/g,'').trim() || 'Expenses';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = `Week ${fmtMD(sun)} through ${fmtMD(sat)} - ${safeBp}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    setStatus('Excel downloaded.');
  } catch (e){
    console.error(e);
    setStatus('Excel export failed.');
  }
}

function setButtonsEnabled(){
  const hasWeek = !!currentWeekEnding;
  el('btnSave').disabled = !hasWeek;
  el('btnClear').disabled = false;
  el('btnDownload').disabled = !hasWeek;
  el('btnDeleteWeek').disabled = !(!!currentSync && !!el('weekSelect').value);
}

function onSundayChange(){
  const v = el('sundayDate').value;
  if (!v) return;
  const sat = computeWeekEndingFromSunday(v);
  const newWeekEnding = toISODate(sat);
  if (currentWeekEnding && newWeekEnding !== currentWeekEnding){
    // New week: clear entries automatically, keep sync
    clearEntryValues();
    el('weekSelect').value = '';
    setStatus('New week selected. Entries cleared.');
  }
  currentWeekEnding = newWeekEnding;
  el('weekEnding').value = currentWeekEnding;
  setHeaderDatesFromSunday(v);
  setButtonsEnabled();
}

async function onWeekSelectChange(){
  const we = el('weekSelect').value;
  if (!we) return;
  await loadWeek(we);
}

async function changeSync(){
  const v = prompt('Sync Name (type anything):', currentSync || '');
  const s = sanitizeSyncName(v);
  if (!s) return;
  currentSync = s;
  renderSync();
  await loadWeeksForSync(true);
  setButtonsEnabled();
}

async function init(){
  buildTable();
  computeTotals();
  renderSync();

  el('sundayDate').addEventListener('change', onSundayChange);
  el('weekSelect').addEventListener('change', onWeekSelectChange);
  el('btnSave').addEventListener('click', saveWeek);
  el('btnDeleteWeek').addEventListener('click', deleteWeek);
  el('btnClear').addEventListener('click', clearAllNew);
  el('btnDownload').addEventListener('click', downloadExcel);
  el('btnChangeSync').addEventListener('click', changeSync);

  // If sync exists, load its most recent week automatically (A)
  if (currentSync){
    try{ await loadWeeksForSync(true); } catch {}
  }

  setButtonsEnabled();
}

init();
