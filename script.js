
// Weekly Expenses (Cloudflare Pages + KV)
// v38-MODAL: Line-item modal for multiple receipts per category/day
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
let currentData = null; // Holds the full entry data (including line items)
let currentEditAddr = null; // Address being edited in modal
const APP_VERSION = '56'; // Update this for each revision

// ============ LINE-ITEM MANAGEMENT ============

// Generate a simple unique ID (timestamp-based)
function generateItemId(){
  return `item_${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
}

// Get all line items for a cell (only actual itemized data)
function getLineItems(addr){
  const items = currentData?.entries?.[`${addr}_items`];
  
  // Only return if there are actual stored items
  if (Array.isArray(items) && items.length > 0) {
    return items;
  }
  
  // For cells with single amounts (no items array), return empty
  // This prevents showing artifacts from old single-value data
  return [];
}

// Set line items for a cell
function setLineItems(addr, items){
  if (!currentData) return;
  if (!currentData.entries) currentData.entries = {};
  
  const total = items.reduce((sum, item)=> sum + (Number(item.amount) || 0), 0);
  currentData.entries[addr] = total > 0 ? total : 0;
  currentData.entries[`${addr}_items`] = items;
}

// Add a new line item to a cell
function addLineItem(addr, amount=0, vendor='', note=''){
  const items = getLineItems(addr);
  items.push({
    id: generateItemId(),
    amount: Number(amount) || 0,
    vendor: vendor || '',
    note: note || ''
  });
  setLineItems(addr, items);
}

// Update a line item
function updateLineItem(addr, itemId, updates){
  const items = getLineItems(addr);
  const idx = items.findIndex(i=> i.id === itemId);
  if (idx >= 0){
    items[idx] = {...items[idx], ...updates};
    setLineItems(addr, items);
  }
}

// Delete a line item
function deleteLineItem(addr, itemId){
  const items = getLineItems(addr).filter(i=> i.id !== itemId);
  setLineItems(addr, items);
}

// ============ MODAL MANAGEMENT ============

function openLineItemModal(addr, categoryLabel, dayId){
  currentEditAddr = addr;
  
  // Get the current input value (if any)
  const inp = el('entryTable').querySelector(`input[data-col="${addr[0]}"][data-row="${addr.substring(1)}"]`);
  const currentInputValue = inp ? Number(inp.value) || 0 : 0;
  
  let items = getLineItems(addr);
  
  // If no items yet but there's a value in the input, convert it to a line item
  if (items.length === 0 && currentInputValue > 0 && !currentData?.entries?.[`${addr}_items`]) {
    items = [{
      id: generateItemId(),
      amount: currentInputValue,
      vendor: '',
      note: ''
    }];
    setLineItems(addr, items);
  }
  
  // Set up modal title
  el('modalTitle').textContent = `${categoryLabel} - ${dayId}`;
  
  // Build items list
  const itemsList = el('modalItemsList');
  itemsList.innerHTML = '';
  
  items.forEach(item => {
    const itemRow = document.createElement('div');
    itemRow.className = 'modal-item-row';
    itemRow.dataset.itemId = item.id;
    
    const amountInput = document.createElement('input');
    amountInput.type = 'number';
    amountInput.inputMode = 'decimal';
    amountInput.placeholder = '0.00';
    amountInput.value = item.amount || '';
    amountInput.className = 'modal-amount-input';
    amountInput.addEventListener('input', (e) => {
      updateLineItem(addr, item.id, {amount: Number(e.target.value) || 0});
      updateModalTotal();
    });
    
    const vendorInput = document.createElement('input');
    vendorInput.type = 'text';
    vendorInput.placeholder = 'Vendor (optional)';
    vendorInput.value = item.vendor || '';
    vendorInput.className = 'modal-vendor-input';
    vendorInput.addEventListener('input', (e) => {
      updateLineItem(addr, item.id, {vendor: e.target.value});
    });
    
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'modal-delete-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.addEventListener('click', () => {
      deleteLineItem(addr, item.id);
      itemRow.remove();
      updateModalTotal();
    });
    
    itemRow.appendChild(amountInput);
    itemRow.appendChild(vendorInput);
    itemRow.appendChild(deleteBtn);
    itemsList.appendChild(itemRow);
  });
  
  // Add new item button
  const addRow = document.createElement('div');
  addRow.className = 'modal-add-row';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'modal-add-btn';
  addBtn.textContent = '+ Add receipt';
  addBtn.addEventListener('click', () => {
    addLineItem(addr, 0, '', '');
    openLineItemModal(addr, categoryLabel, dayId); // Refresh modal
  });
  addRow.appendChild(addBtn);
  itemsList.appendChild(addRow);
  
  // Show modal
  updateModalTotal();
  el('lineItemModal').showModal();
}

function updateModalTotal(){
  if (!currentEditAddr) return;
  const items = getLineItems(currentEditAddr);
  const total = items.reduce((sum, item)=> sum + (Number(item.amount) || 0), 0);
  el('modalTotal').textContent = total > 0 ? `$${total.toFixed(2)}` : '$0.00';
  
  // Also update the main table input in real-time
  const inp = el('entryTable').querySelector(`input[data-col="${currentEditAddr[0]}"][data-row="${currentEditAddr.substring(1)}"]`);
  if (inp){
    inp.value = total > 0 ? total.toFixed(2) : '';
  }
}

function closeLineItemModal(){
  // Update the main table input with the combined total
  if (currentEditAddr && currentData?.entries){
    const items = getLineItems(currentEditAddr);
    const total = items.reduce((sum, item)=> sum + (Number(item.amount) || 0), 0);
    
    // Find and update the input for this cell
    const inp = el('entryTable').querySelector(`input[data-col="${currentEditAddr[0]}"][data-row="${currentEditAddr.substring(1)}"]`);
    if (inp){
      inp.value = total > 0 ? total.toFixed(2) : '';
    }
  }
  
  el('lineItemModal').close();
  currentEditAddr = null;
  computeTotals();
}

// ============ END LINE-ITEM MANAGEMENT ============

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
      const col = dayCols[i];
      const dayId = dayIds[i];
      
      const cellWrapper = document.createElement('div');
      cellWrapper.className = 'cell-wrapper';
      
      const inp=document.createElement('input');
      inp.dataset.row=String(r.row);
      inp.dataset.col=col;
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
        cellWrapper.appendChild(wrap);
        
        // Add line items display below the amount
        const itemsDisplay = document.createElement('div');
        itemsDisplay.className = 'cell-items-display';
        itemsDisplay.dataset.addr = `${col}${r.row}`;
        cellWrapper.appendChild(itemsDisplay);
        
        // Add (+) button for currency cells only
        if (!r.computed){
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'cell-add-btn';
          addBtn.textContent = '+';
          addBtn.dataset.addr = `${col}${r.row}`;
          addBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openLineItemModal(`${col}${r.row}`, r.label, dayId);
          });
          cellWrapper.appendChild(addBtn);
        }
      } else {
        cellWrapper.appendChild(inp);
      }
      
      td.appendChild(cellWrapper);
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
  allInputs().forEach(i=>{ if (i.dataset.computed!=='true') i.value=''; });
  el('businessPurpose').value='';
  currentData = null;
  computeTotals();
}

function clearAllNew(){
  el('sundayDate').value='';
  el('weekEnding').value='';
  setHeaderDatesFromSunday('');
  currentWeekEnding='';
  clearEntryValues();
  currentSync='';
  renderSync();
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

function updateCellItemsDisplay(){
  // Temporarily disabled - showing artifacts
  // Line items are stored and exported, just not displayed in table for now
  const displays = el('entryTable').querySelectorAll('.cell-items-display');
  displays.forEach(display => { display.innerHTML = ''; });
}

function updateButtonColors(){
  // Update + button colors based on whether cell has multiple items
  const buttons = el('entryTable').querySelectorAll('.cell-add-btn');
  buttons.forEach(btn => {
    const addr = btn.dataset.addr;
    const itemsKey = `${addr}_items`;
    const actualItems = currentData?.entries?.[itemsKey];
    
    // Change button color if 2+ items
    if (Array.isArray(actualItems) && actualItems.length > 1){
      btn.classList.add('has-items');
    } else {
      btn.classList.remove('has-items');
    }
  });
}

function computeTotals(){
  recomputeDerived();
  const totals=[0,0,0,0,0,0,0];
  
  allInputs().forEach(inp=>{
    if (inp.dataset.type!=='currency') return;
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    
    const items = getLineItems(addr);
    let cellTotal = 0;
    if (items.length > 0){
      cellTotal = items.reduce((sum, item)=> sum + (Number(item.amount) || 0), 0);
    } else {
      const v=(inp.value||'').trim();
      if (!v) return;
      const n=Number(v);
      if (!Number.isFinite(n)) return;
      cellTotal = n;
    }
    
    const idx=dayCols.indexOf(inp.dataset.col);
    if (idx>=0) totals[idx] += cellTotal;
  });
  let week=0;
  totals.forEach((t,idx)=>{
    week+=t;
    el(`tot${dayIds[idx]}`).value = t ? ('$' + t.toFixed(2)) : '';
  });
  el('totWEEK').value = week ? ('$' + week.toFixed(2)) : '';
  
  // Update button colors to show which cells have multiple items
  updateButtonColors();
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
  
  if (currentData?.entries){
    Object.keys(currentData.entries).forEach(key=>{
      if (key.endsWith('_items')){
        entries[key] = currentData.entries[key];
      }
    });
  }
  
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
  
  currentData = JSON.parse(JSON.stringify(data));
  
  el('businessPurpose').value = data.businessPurpose || '';
  const map = data.entries || {};
  allInputs().forEach(inp=>{
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    if (map[addr]==null) return;
    inp.value = String(map[addr]);
  });
  
  // Clear all line item displays initially
  const displays = el('entryTable').querySelectorAll('.cell-items-display');
  displays.forEach(display => { display.innerHTML = ''; });
  
  computeTotals();
  updateButtonColors();
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
    const outBlob = new Blob([ab], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});

    const bp = el('businessPurpose').value || 'Expenses';
    const sat = parseISODate(currentWeekEnding);
    const sun = computeSundayFromWeekEnding(currentWeekEnding);

    // Filename
    let filename = `Week ${fmtMD(sun)} through ${fmtMD(sat)} - ${bp}.xlsx`;
    
    const weekSelectEl = el('weekSelect');
    if (weekSelectEl && weekSelectEl.value) {
      const selectedOption = weekSelectEl.querySelector(`option[value="${weekSelectEl.value}"]`);
      if (selectedOption) {
        let optionText = selectedOption.textContent.trim();
        optionText = optionText.replace(/^\d{2}\.\d{2}\.\d{2}\s*-\s*/, '').trim();
        filename = optionText + '.xlsx';
      }
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
    setStatus('Excel downloaded.');
  } catch (e){
    console.error(e);
    setStatus('Excel export failed: ' + e.message);
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
  
  // Modal buttons
  el('modalCloseBtn').addEventListener('click', closeLineItemModal);
  el('lineItemModal').addEventListener('cancel', closeLineItemModal);

  if (currentSync){
    try{ await loadWeeksForSync(true); } catch {}
  }

  setButtonsEnabled();
}

init();
