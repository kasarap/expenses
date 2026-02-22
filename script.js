// Weekly Expenses (Cloudflare Pages + KV)
// No login. Manual Sync Name (like test-entry-log). Week Ending (Saturday) still drives date logic + export.

// Pages Functions endpoints
// /api/weeks?sync=... -> list weeks for current sync
// /api/data?sync=...&weekEnding=YYYY-MM-DD -> get/put/delete a specific week
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
let entryIndex = new Map(); // weekEnding -> {businessPurpose, updatedAt}


function rebuildWeekSelectOptions(){
  entryIndex = new Map();
    list.forEach(item=>{
      const we = (item && item.weekEnding) ? String(item.weekEnding) : '';
      const bp = (item && item.businessPurpose) ? String(item.businessPurpose) : '';
      const updatedAt = (item && item.updatedAt) ? String(item.updatedAt) : '';
      if (!we) return;
      entryIndex.set(we, { businessPurpose: bp, updatedAt });
    });
    rebuildWeekSelectOptions();
    const sel = el('weekSelect');
    if (keep && entryIndex.has(keep)) sel.value=keep;
  } catch {
    // ignore
  }
}

async function loadWeek(){
  if (!currentSync || !currentWeekEnding) return;
  setStatus('Loading…');
  try{
    const out = await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(currentWeekEnding)}`);
    applyData(out.data);
    setStatus(out.data ? 'Loaded.' : 'No saved data (new week).');
  } catch(e){
    setStatus('Load failed.');
  }
}

async function saveWeek(){
  if (!ensureSync('save')) return;
  if (!currentWeekEnding) { setStatus('Pick a Sunday date first.'); return; }
  setStatus('Saving…');
  try{
    const payload = serialize();
    await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(currentWeekEnding)}`, {
      method:'PUT',
      body: JSON.stringify(payload)
    });

    // Optimistically update dropdown immediately (KV list can be eventually consistent).
    const bp = (el('businessPurpose')?.value || '').trim();
    const updatedAt = new Date().toISOString();
    entryIndex.set(currentWeekEnding, { businessPurpose: bp, updatedAt });
    rebuildWeekSelectOptions(); // ensures newest-first ordering
    el('weekSelect').value = currentWeekEnding;

    // Still refresh from server in the background to pick up any remote edits
    refreshWeekDropdown().catch(()=>{});
    setStatus('Saved.');
  } catch(e){
    setStatus(`Save failed: ${e?.message || e}`);
  }
}

async function deleteWeek(){
  if (!currentSync || !currentWeekEnding) return;
  const label = weekLabelWithPrefix(currentWeekEnding);
  if (!confirm(`Delete saved data for ${label}?`)) return;
  setStatus('Deleting…');
  try{
    await apiFetchJson(`${API.data}?sync=${encodeURIComponent(currentSync)}&weekEnding=${encodeURIComponent(currentWeekEnding)}`, {method:'DELETE'});
    clearInputs({ resetSync:false, resetDates:false, resetWeekSelect:true });
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

    
    // Personal Car Mileage: write cached values into row 29 so it appears even if Excel doesn't recalc immediately.
    // We only export the MILES input row (10); the template retains formulas, but cached values make it robust.
    const rate = MILEAGE_RATE;
    let weekMileageTotal = 0;
    for (let i=0;i<7;i++){
      const milesAddr = `${dayCols[i]}10`;
      const miles = Number(payload.entries?.[milesAddr] || 0);
      const amt = Math.round((miles * rate) * 100) / 100;
      weekMileageTotal += amt;
      setCellNumber(`${dayCols[i]}29`, amt);
    }
    setCellNumber('J29', Math.round(weekMileageTotal*100)/100);

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
  // If switching to a different week, clear entry fields automatically but keep Sync.
  const nextSat = toISODate(computeWeekEndingFromSunday(v));
  if (currentWeekEnding && nextSat !== currentWeekEnding){
    clearInputs({ resetSync:false, resetDates:false, resetWeekSelect:true });
  }
  setWeekFromSunday(v);
  setButtonsEnabled();
});


el('weekSelect').addEventListener('change', async ()=>{
  const v = el('weekSelect').value;
  if (!v) return;
  currentWeekEnding = v;
  el('weekEnding').value = v;
  el('sundayDate').value = toISODate(computeSundayFromWeekEnding(v));
  await loadWeek();
  setButtonsEnabled();
});

el('btnSave').addEventListener('click', saveWeek);
el('btnDeleteWeek').addEventListener('click', deleteWeek);
el('btnClear').addEventListener('click', ()=>{ clearInputs({ resetSync:false, resetDates:true, resetWeekSelect:true }); setStatus('Cleared (not deleted).'); });
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

  // Load weeks for current sync (if any) and auto-load most recent
  refreshWeekDropdown().then(async ()=>{
    const sel = el('weekSelect');
    const firstReal = Array.from(sel.options).find(o=>o.value);
    if (firstReal){
      currentWeekEnding = firstReal.value;
      sel.value = currentWeekEnding;
      el('weekEnding').value = currentWeekEnding;
      el('sundayDate').value = toISODate(computeSundayFromWeekEnding(currentWeekEnding));
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
  // Delete only if the selected week exists in KV list for this sync
  el('btnDeleteWeek').disabled = !(hasSync && hasWeek && entryIndex.has(currentWeekEnding));
}
function sanitizeSyncName(s){
  if (!s) return '';
  return String(s).trim().replace(/\s+/g,' ').slice(0,80).replace(/[^\w .\-]/g,'');
}
function renderSync(){
  const pill = el('syncPill');
  if (pill) pill.textContent = currentSync || 'Not set';
  localStorage.setItem('expenses_sync_name', currentSync || '');
  // When sync changes, refresh the week list for that sync
  refreshWeekDropdown().then(async ()=>{
    const sel = el('weekSelect');
    const firstReal = Array.from(sel.options).find(o=>o.value);
    if (firstReal){
      currentWeekEnding = firstReal.value;
      sel.value = currentWeekEnding;
      el('weekEnding').value = currentWeekEnding;
      el('sundayDate').value = toISODate(computeSundayFromWeekEnding(currentWeekEnding));
      await loadWeek();
    } else {
      // No saved weeks for this sync
      const v = el('sundayDate').value;
      if (v) setWeekFromSunday(v);
    }
    setButtonsEnabled();
  });
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


