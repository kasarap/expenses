// Weekly Expenses (Cloudflare Pages + KV)
// No login. Sync works like test-entry-log: stored per-device; Change switches sync; first Save prompts if not set.
// Data is stored per Sync Name AND Week Ending: expenses:<sync>:<weekEnding>

const API = { data: '/api/data', weeks: '/api/weeks' };
const el = (id) => document.getElementById(id);

const dayCols = ['C','D','E','F','G','H','I']; // Sun..Sat
const dayIds  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

const MILEAGE_RATE = 0.7; // display + cached export for Personal Car Mileage

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

let currentWeekEnding = ''; // YYYY-MM-DD
let currentSync = (localStorage.getItem('expenses_sync_name') || '').trim();

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
function safeFilenameBase(weekEndingISO, businessPurpose){
  const sat = parseISODate(weekEndingISO);
  const sun = computeSundayFromWeekEnding(weekEndingISO);
  const mdSun = fmtMD(sun);
  const mdSat = fmtMD(sat);
  const bp = (businessPurpose || 'Expenses').trim();
  const safeBp = bp.replace(/[\/:*?"<>|]+/g,'').trim() || 'Expenses';
  return `Week ${mdSun} through ${mdSat} - ${safeBp}`;
}

function setStatus(msg=''){ el('saveStatus').textContent = msg; }

function renderSync(){
  el('syncPill').textContent = currentSync ? currentSync : 'Not set';
}

function setButtons(){
  const hasWeek = !!currentWeekEnding;
  el('btnSave').disabled = !hasWeek;
  el('btnClear').disabled = false;
  el('btnDownload').disabled = !hasWeek;
  el('btnDeleteWeek').disabled = !el('weekSelect').value;
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
  if (!el('entryTable').contains(inp)) return;
  e.preventDefault();

  const dir = e.shiftKey ? -1 : 1;
  const col = inp.dataset.col;
  const rowNum = Number(inp.dataset.row);

  const rowOrder = rows.filter(r=>r.type!=='divider').map(r=>r.row);
  const idx = rowOrder.indexOf(rowNum);
  if (idx === -1) return;

  let nextIdx = idx + dir;
  while (nextIdx >= 0 && nextIdx < rowOrder.length){
    const nextRow = rowOrder[nextIdx];
    const next = el('entryTable').querySelector(`tbody input[data-row="${nextRow}"][data-col="${col}"]`);
    if (next && next.tabIndex !== -1 && !next.readOnly){
      next.focus(); next.select?.(); return;
    }
    nextIdx += dir;
  }
}

function allInputs(){
  return Array.from(el('entryTable').querySelectorAll('input'));
}

function clearEntriesOnly(){
  allInputs().forEach(i=>i.value='');
  el('businessPurpose').value='';
  computeTotals();
}

function clearAll(){
  clearEntriesOnly();
  el('sundayDate').value='';
  el('weekEnding').value='';
  currentWeekEnding = '';
  el('weekSelect').value='';
  setButtons();
  setStatus('Cleared.');
}

function recomputeDerived(){
  for (let i=0;i<7;i++){
    const milesInp = el('entryTable').querySelector(`input[data-row="10"][data-col="${dayCols[i]}"]`);
    const outInp   = el('entryTable').querySelector(`input[data-row="29"][data-col="${dayCols[i]}"]`);
    if (!milesInp || !outInp) continue;
    const n = Number((milesInp.value || '').trim());
    if (!Number.isFinite(n) || n<=0) outInp.value = '';
    else outInp.value = (n * MILEAGE_RATE).toFixed(2);
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
    businessPurpose: el('businessPurpose').value || '',
    entries
  };
}

function applyData(data){
  clearEntriesOnly();
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
  const text = await res.text();
  if (!res.ok){
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return text ? JSON.parse(text) : {};
}

async function refreshWeekDropdown(autoLoadMostRecent=false){
  const sel = el('weekSelect');
  sel.innerHTML = '<option value="">(Select a week)</option>';
  if (!currentSync){ setButtons(); return; }

  const out = await apiFetchJson(`${API.weeks}?sync=${encodeURIComponent(currentSync)}`);
  const list = Array.isArray(out.entries) ? out.entries : [];

  list.forEach(item=>{
    const we = String(item.weekEnding||'');
    const bp = String(item.businessPurpose||'');
    const opt=document.createElement('option');
    opt.value = we;
    opt.textContent = `${fmtYYMMDD(parseISODate(we))} - ${safeFilenameBase(we, bp)}`;
    sel.appendChild(opt);
  });

  if (autoLoadMostRecent && list.length){
    sel.value = list[0].weekEnding;
    await loadWeek(list[0].weekEnding);
  }

  setButtons();
}

async function loadWeek(weekEndingISO){
  if (!currentSync || !weekEndingISO) return;
  setStatus('Loading…');
  const out = await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(weekEndingISO)}`);
  currentWeekEnding = weekEndingISO;
  el('weekEnding').value = weekEndingISO;
  el('sundayDate').value = toISODate(computeSundayFromWeekEnding(weekEndingISO));
  applyData(out.data);
  setStatus('Loaded.');
  setButtons();
}

function ensureSync(){
  if (currentSync) return true;
  const v = prompt('Enter Sync Name (type anything):');
  if (!v) return false;
  currentSync = v.trim();
  if (!currentSync) return false;
  localStorage.setItem('expenses_sync_name', currentSync);
  renderSync();
  // After setting sync, load most recent for that sync (requested behavior A).
  refreshWeekDropdown(true).catch(()=>{});
  return true;
}

async function saveWeek(){
  if (!currentWeekEnding){ setStatus('Pick a Sunday date first.'); return; }
  if (!ensureSync()) return;

  setStatus('Saving…');
  await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(currentWeekEnding)}`, {
    method:'PUT',
    body: JSON.stringify(serialize())
  });
  setStatus('Saved.');
  await refreshWeekDropdown(false);
  el('weekSelect').value = currentWeekEnding;
  setButtons();
}

async function deleteWeek(){
  const we = el('weekSelect').value;
  if (!currentSync || !we) return;
  if (!confirm(`Delete saved data for ${fmtYYMMDD(parseISODate(we))}?`)) return;
  setStatus('Deleting…');
  await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(we)}`, { method:'DELETE' });
  // If you deleted the currently loaded week, clear entries for that week.
  if (currentWeekEnding === we){
    clearEntriesOnly();
    setStatus('Deleted. (Week kept selected; enter new values or pick another week.)');
  } else {
    setStatus('Deleted.');
  }
  await refreshWeekDropdown(false);
}

function onSundayChange(){
  const sundayISO = el('sundayDate').value;
  if (!sundayISO) return;
  const sat = computeWeekEndingFromSunday(sundayISO);
  const weekEndingISO = toISODate(sat);

  // If switching to a different week, clear entries automatically (but keep Sync).
  const switching = currentWeekEnding && weekEndingISO !== currentWeekEnding;
  currentWeekEnding = weekEndingISO;
  el('weekEnding').value = weekEndingISO;

  if (switching){
    clearEntriesOnly();
    el('weekSelect').value = '';
    setStatus('New week selected (cleared entries).');
  }
  setButtons();
}

async function downloadExcel(){
  if (!currentWeekEnding){ setStatus('Pick a Sunday date first.'); return; }
  if (!ensureSync()) return;

  setStatus('Building Excel…');
  try{
    if (typeof JSZip === 'undefined') throw new Error('JSZip library not loaded');

    // Fetch template
    const candidates = ['/Expenses%20Form.xlsx','Expenses%20Form.xlsx','/Expenses Form.xlsx','Expenses Form.xlsx'];
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

    // Helper to set a cell in sheet XML (inline string or number). Keeps it simple and robust.
    const sheetPath = 'xl/worksheets/sheet1.xml';
    const sheetXml = await zip.file(sheetPath).async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(sheetXml, 'application/xml');

    function setCell(addr, value, type){
      // type: 'n' number, 's' shared string (we use inlineStr for simplicity), 'str' inline string
      let c = doc.querySelector(`c[r="${addr}"]`);
      if (!c){
        // find row
        const rowNum = Number(addr.match(/\d+$/)[0]);
        let row = doc.querySelector(`row[r="${rowNum}"]`);
        if (!row){
          row = doc.createElement('row');
          row.setAttribute('r', String(rowNum));
          // append in order (simple append; Excel will still open)
          doc.querySelector('sheetData').appendChild(row);
        }
        c = doc.createElement('c');
        c.setAttribute('r', addr);
        row.appendChild(c);
      }
      // clear children
      while (c.firstChild) c.removeChild(c.firstChild);

      if (type === 'n'){
        c.removeAttribute('t');
        const v = doc.createElement('v');
        v.textContent = String(value);
        c.appendChild(v);
      } else {
        c.setAttribute('t','inlineStr');
        const is = doc.createElement('is');
        const t = doc.createElement('t');
        t.textContent = String(value);
        is.appendChild(t);
        c.appendChild(is);
      }
    }

    // Fill header fields
    setCell('E5', currentWeekEnding, 'str');
    setCell('H5', el('businessPurpose').value || '', 'str');

    // Fill date row (row 7) C7..I7 with ISO dates
    const sun = computeSundayFromWeekEnding(currentWeekEnding);
    for (let i=0;i<7;i++){
      const d = new Date(sun);
      d.setDate(sun.getDate()+i);
      setCell(`${dayCols[i]}7`, toISODate(d), 'str');
    }

    // Entries: write raw inputs, plus cached personal mileage numbers so it displays even without recalculation.
    const data = serialize();
    for (const [addr,val] of Object.entries(data.entries||{})){
      if (typeof val === 'number') setCell(addr, val, 'n');
      else setCell(addr, val, 'str');
    }
    // Cached personal mileage row values
    for (let i=0;i<7;i++){
      const miles = Number(data.entries?.[`${dayCols[i]}10`] || 0);
      const pm = miles ? (miles * MILEAGE_RATE) : 0;
      if (pm) setCell(`${dayCols[i]}29`, pm, 'n');
    }

    const outXml = new XMLSerializer().serializeToString(doc);
    zip.file(sheetPath, outXml);

    const outBlob = await zip.generateAsync({type:'blob'});
    const base = safeFilenameBase(currentWeekEnding, el('businessPurpose').value || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = `${base}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setStatus('Excel downloaded.');
  } catch(e){
    setStatus(`Excel export failed: ${e.message || e}`);
  }
}

document.addEventListener('DOMContentLoaded', async ()=>{
  buildTable();
  renderSync();
  setButtons();
  computeTotals();

  el('btnSave').addEventListener('click', ()=>saveWeek().catch(e=>setStatus(`Save failed: ${e.message||e}`)));
  el('btnClear').addEventListener('click', ()=>{ clearAll(); });
  el('btnDeleteWeek').addEventListener('click', ()=>deleteWeek().catch(e=>setStatus(`Delete failed: ${e.message||e}`)));
  el('btnDownload').addEventListener('click', ()=>downloadExcel());

  el('sundayDate').addEventListener('change', onSundayChange);

  el('weekSelect').addEventListener('change', async ()=>{
    const we = el('weekSelect').value;
    if (!we) { setButtons(); return; }
    if (!currentSync){
      // If user picks a week but sync isn't set, ask for it then reload list.
      if (!ensureSync()) { el('weekSelect').value=''; return; }
      // ensureSync auto-loads most recent; user explicitly picked one -> load it
    }
    await loadWeek(we);
  });

  el('btnChangeSync').addEventListener('click', async ()=>{
    const v = prompt('Enter Sync Name (type anything):', currentSync || '');
    if (v == null) return;
    const nv = v.trim();
    if (!nv){ return; }
    currentSync = nv;
    localStorage.setItem('expenses_sync_name', currentSync);
    renderSync();
    await refreshWeekDropdown(true); // auto-load most recent for that sync (behavior A)
  });

  // Initial: if sync is set, load its most recent week.
  if (currentSync){
    try { await refreshWeekDropdown(true); }
    catch { /* ignore */ }
  }
});