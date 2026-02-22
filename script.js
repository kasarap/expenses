// Weekly Expenses (Cloudflare Pages + KV)
// No login. Manual Sync Name (like test-entry-log). Week Ending (Saturday) still drives date logic + export.

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
let currentSync = (localStorage.getItem('expenses_sync_name') || '').trim();
let pendingAction = null;
let entryIndex = new Map(); // sync -> {weekEnding}

function safeFilenameBase(weekEndingISO, businessPurpose){
  // Matches the export filename base but without the .xlsx extension.
  const sat = parseISODate(weekEndingISO);
  const sun = computeSundayFromWeekEnding(weekEndingISO);
  const mdSun = fmtMD(sun);
  const mdSat = fmtMD(sat);
  const bp = (businessPurpose || 'Expenses').trim();
  const safeBp = bp.replace(/[\/:*?"<>|]+/g,'').trim() || 'Expenses';
  return `Week ${mdSun} through ${mdSat} - ${safeBp}`;
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
function fmtMD(d){
  return `${d.getMonth()+1}-${d.getDate()}`;
}

function fmtYYMMDD(d){
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yy}.${mm}.${dd}`;
}
function weekLabel(weekEndingISO){
  const sat = parseISODate(weekEndingISO);
  const sun = computeSundayFromWeekEnding(weekEndingISO);
  return `Week ${fmtMD(sun)} through ${fmtMD(sat)}`;
}

function weekLabelWithPrefix(weekEndingISO){
  const sat = parseISODate(weekEndingISO);
  return `${fmtYYMMDD(sat)}`;
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
  // Clear all entry fields + dates (does NOT delete cloud)
  allInputs().forEach(i=>i.value='');
  el('businessPurpose').value='';
  el('sundayDate').value='';
  el('weekEnding').value='';
  currentWeekEnding = null;

  // Reset current sync so next Save prompts for a new Sync Name
  currentSync = '';
  renderSync();

  // Reset dropdown selection
  const sel = el('weekSelect');
  if (sel) sel.value = '';

  computeTotals();
  setStatus('Cleared. Enter a Sunday date (and set Sync Name on Save).');
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
    syncName: currentSync,
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
    let list = Array.isArray(out.entries) ? out.entries : [];
    const sel = el('weekSelect');
    const keep = sel.value;
    sel.innerHTML = '<option value="">(Select a week)</option>';
    entryIndex = new Map();
    list.forEach(item=>{
      const sync = (item && item.sync) ? String(item.sync) : '';
      if (!sync) return;
      const we = (item && item.weekEnding) ? String(item.weekEnding) : '';
      const bp = (item && item.businessPurpose) ? String(item.businessPurpose) : '';
      const updatedAt = (item && item.updatedAt) ? String(item.updatedAt) : '';
      entryIndex.set(sync, { weekEnding: we, businessPurpose: bp, updatedAt });
      const opt=document.createElement('option');
      opt.value=sync;
      const labelWE = we || (sync.match(/^\d{4}-\d{2}-\d{2}$/) ? sync : '');
      if (labelWE){
        const base = safeFilenameBase(labelWE, bp);
        opt.textContent = `${fmtYYMMDD(parseISODate(labelWE))} - ${base}`;
      } else {
        opt.textContent = sync;
      }
      sel.appendChild(opt);
    });
    if (keep && entryIndex.has(keep)) sel.value=keep;
  } catch {
    // ignore
  }
}

async function loadWeek(){
  if (!currentSync) return;
  setStatus('Loading…');
  try{
    const out = await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}`);
    applyData(out.data);
    if (out.data && typeof out.data.weekEnding === 'string' && out.data.weekEnding){
      currentWeekEnding = out.data.weekEnding;
      el('weekEnding').value = currentWeekEnding;
el('sundayDate').value = toISODate(computeSundayFromWeekEnding(currentWeekEnding));
      setButtonsEnabled();
    }
    setStatus(out.data ? 'Loaded.' : 'No saved data (new week).');
  } catch(e){
    setStatus('Load failed.');
  }
}

async function saveWeek(){
  if (!ensureSync('save')) return;
  setStatus('Saving…');
  try{
    await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}`, {
      method:'PUT',
      body: JSON.stringify(serialize())
    });
    setStatus('Saved.');
    await refreshWeekDropdown();
    // ensure selected
    el('weekSelect').value = currentSync;
  } catch(e){
    setStatus('Save failed.');
  }
}

async function deleteWeek(){
  if (!currentSync) return;
  const label = currentWeekEnding ? weekLabelWithPrefix(currentWeekEnding) : currentSync;
  if (!confirm(`Delete saved data for ${label}?`)) return;
  setStatus('Deleting…');
  try{
    await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}`, {method:'DELETE'});
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
  // Optional: require sync only to keep behavior consistent with saved datasets
  if (!ensureSync('export')) return;
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

    // Force Excel to recalc formulas on open (fixes mileage line not updating)
    if (zip.file('xl/calcChain.xml')) zip.remove('xl/calcChain.xml');
    if (zip.file('xl/workbook.xml')){
      const wbXml = await zip.file('xl/workbook.xml').async('string');
      const wbDoc = new DOMParser().parseFromString(wbXml, 'application/xml');
      const calcPr = wbDoc.getElementsByTagName('calcPr')[0];
      if (calcPr) {
        calcPr.setAttribute('fullCalcOnLoad','1');
        calcPr.setAttribute('calcMode','auto');
        calcPr.setAttribute('calcOnSave','1');
        calcPr.setAttribute('calcCompleted','0');
      } else {
        const wb = wbDoc.getElementsByTagName('workbook')[0];
        if (wb){
          const cp = wbDoc.createElementNS(wbDoc.documentElement.namespaceURI,'calcPr');
          cp.setAttribute('fullCalcOnLoad','1');
          cp.setAttribute('calcMode','auto');
          cp.setAttribute('calcOnSave','1');
          cp.setAttribute('calcCompleted','0');
          wb.appendChild(cp);
        }
      }
      zip.file('xl/workbook.xml', new XMLSerializer().serializeToString(wbDoc));
    }

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

    // Leave template mileage rate in B10 to preserve formatting and any future changes.
    // setCellNumber('B10', MILEAGE_RATE);

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
}

el('sundayDate').addEventListener('change', ()=>{
  const v = el('sundayDate').value;
  if (!v) return;
  setWeekFromSunday(v);
  setButtonsEnabled();
});


el('weekSelect').addEventListener('change', async ()=>{
  const v = el('weekSelect').value;
  if (!v) return;
  currentSync = v;
  renderSync();

  const meta = entryIndex.get(v);
  const we = meta && meta.weekEnding ? meta.weekEnding : (v.match(/^\d{4}-\d{2}-\d{2}$/) ? v : '');
  if (we){
    currentWeekEnding = we;
    el('weekEnding').value = we;
    el('sundayDate').value = toISODate(computeSundayFromWeekEnding(we));
  }
  await loadWeek();
  setButtonsEnabled();
});

el('btnSave').addEventListener('click', saveWeek);
el('btnDeleteWeek').addEventListener('click', deleteWeek);
el('btnClear').addEventListener('click', ()=>{ clearInputs(); setStatus('Cleared (not deleted).'); });
el('btnDownload').addEventListener('click', downloadExcel);

// Init (render table independent of sync state)
(function init(){
  buildTable();
  computeTotals();

  // Default to current week (Sunday of this week)
  const today = new Date();
  const sun = new Date(today);
  sun.setDate(today.getDate() - today.getDay());
  el('sundayDate').value = toISODate(sun);
  setWeekFromSunday(toISODate(sun));

  renderSync();

  // Sync dialog (like test-entry-log)
  el('btnChangeSync')?.addEventListener('click', ()=>{
    pendingAction = null;
    openSyncDialog();
  });

  el('syncDialog')?.addEventListener('close', async ()=>{
    const dlg = el('syncDialog');
    if (!dlg) return;
    if (dlg.returnValue !== 'ok') { pendingAction = null; return; }

    const v = sanitizeSyncName(el('syncInput')?.value || '');
    if (!v){
      setStatus('Sync Name not set.', true);
      pendingAction = null;
      renderSync();
      setButtonsEnabled();
      return;
    }
    currentSync = v;
    renderSync();

    // If this sync exists in dropdown, select it
    if (entryIndex.has(currentSync)) el('weekSelect').value = currentSync;

    setButtonsEnabled();

    const act = pendingAction;
    pendingAction = null;
    if (act === 'save') await saveWeek();
    if (act === 'export') await downloadExcel();
  });

  refreshWeekDropdown().then(async ()=>{
    // On page load, automatically select and load the most recently edited entry (top of dropdown)
    const sel = el('weekSelect');
    const firstReal = Array.from(sel.options).find(o=>o.value);
    if (firstReal){
      currentSync = firstReal.value;
      renderSync();
      sel.value = currentSync;
      const meta = entryIndex.get(currentSync);
      const we = meta && meta.weekEnding ? meta.weekEnding : '';
      if (we){
        currentWeekEnding = we;
        el('weekEnding').value = we;
        el('sundayDate').value = toISODate(computeSundayFromWeekEnding(we));
      }
      await loadWeek();
    }
    setButtonsEnabled();
  });

  setButtonsEnabled();
})();

function setButtonsEnabled(){
  // Save/Clear allowed once a week is selected/entered; Sync Name can be set on first Save.
  const hasWeek = !!currentWeekEnding;
  const hasSync = !!currentSync;
  el('btnSave').disabled = !hasWeek;
  el('btnClear').disabled = !hasWeek;
  el('btnDownload').disabled = !hasWeek;
  // Delete only if this sync exists in KV list (so we don't delete an unsaved draft)
  el('btnDeleteWeek').disabled = !(hasSync && entryIndex.has(currentSync));
}
function sanitizeSyncName(s){
  if (!s) return '';
  return String(s).trim().replace(/\s+/g,' ').slice(0,80).replace(/[^\w .\-]/g,'');
}
function renderSync(){
  const pill = el('syncPill');
  if (pill) pill.textContent = currentSync || 'Not set';
  localStorage.setItem('expenses_sync_name', currentSync || '');
}
function openSyncDialog(){
  const dlg = el('syncDialog');
  const inp = el('syncInput');
  if (!dlg || !inp) return;
  inp.value = currentSync || '';
  dlg.showModal();
  setTimeout(()=>inp.focus(), 0);
}
function ensureSync(action){
  if (currentSync) return true;
  pendingAction = action || pendingAction;
  openSyncDialog();
  setStatus('Set Sync Name to save/sync.', true);
  return false;
}


