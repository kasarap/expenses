// Weekly Expenses — v2
// Changes from v1:
//  - Multiple reports per week: key is expenses:{sync}:{weekEnding}:{reportId}
//  - Debounced autosave on any change (first save requires sync + sunday date)
//  - Mobile UX: day-picker strip + per-day entry sheet (desktop keeps the grid)
//  - Back-compat: legacy keys expenses:{sync}:{weekEnding} still load correctly
//  - Cleanup: removed orphan dialogs, no-op display function, stale comments

const API = { data: '/api/data', weeks: '/api/weeks' };
const el = (id) => document.getElementById(id);

const dayCols = ['C','D','E','F','G','H','I']; // Sun..Sat
const dayIds  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const dayLongNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

const MILEAGE_RATE = 0.7; // $/mile

// Row catalog. Grouped by section with explicit group labels so we can render
// them on mobile. 'divider' rows split sections visually in the desktop table.
const rows = [
  {row:8,  label:'From',                        type:'text',     group:'Travel'},
  {row:9,  label:'To',                          type:'text',     group:'Travel'},
  {row:10, label:'Business Miles Driven',       type:'number',   group:'Travel'},
  {row:29, label:`Personal Car Mileage ($${MILEAGE_RATE.toFixed(2)}/mi)`,
                                                type:'currency', group:'Travel', computed:true},
  {type:'divider'},

  {row:42, label:'Breakfast',                   type:'currency', group:'Meals'},
  {row:43, label:'Lunch',                       type:'currency', group:'Meals'},
  {row:44, label:'Dinner',                      type:'currency', group:'Meals'},
  {type:'divider'},

  {row:18, label:'Airfare',                     type:'currency', group:'Travel & Lodging'},
  {row:19, label:'Bus, Limo & Taxi',            type:'currency', group:'Travel & Lodging'},
  {row:20, label:'Lodging Room & Tax',          type:'currency', group:'Travel & Lodging'},
  {row:21, label:'Parking / Tolls',             type:'currency', group:'Travel & Lodging'},
  {row:22, label:'Tips',                        type:'currency', group:'Travel & Lodging'},
  {row:23, label:'Laundry',                     type:'currency', group:'Travel & Lodging'},
  {row:25, label:'Auto Rental',                 type:'currency', group:'Travel & Lodging'},
  {row:26, label:'Auto Rental Fuel',            type:'currency', group:'Travel & Lodging'},
  {type:'divider'},

  {row:34, label:'Internet - Email',            type:'currency', group:'Other'},
  {row:36, label:'Postage',                     type:'currency', group:'Other'},
  {row:38, label:'Perishable Tools',            type:'currency', group:'Other'},
  {row:39, label:'Dues & Subscriptions',        type:'currency', group:'Other'},
];

const APP_VERSION = '62-payment-tracker';

// ==================== STATE ====================
let currentSync = (localStorage.getItem('expenses_sync_name') || '').trim();
let currentWeekEnding = '';   // YYYY-MM-DD
let currentReportId   = '';   // slug; empty until first save or a report is loaded
let reportsCache = [];        // [{weekEnding, reportId, legacy, businessPurpose, updatedAt}]
let currentData = null;       // {syncName, weekEnding, businessPurpose, entries:{...}}
let loading = false;
let currentEditAddr = null;   // line-item modal state
let activeDayIdx = null;      // day sheet state (0..6)
let autosaveTimer = null;
let clientKnownUpdatedAt = null; // server's updatedAt at last load/save; null = no baseline (new report)
let conflictPaused = false;   // when true, autosave is suspended pending user reload/override

// ==================== SLUG / REPORT ID ====================
function slugifyBP(bp){
  let base = (bp || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'')
    .slice(0,40)
    .replace(/-+$/,''); // truncation could leave a trailing dash
  return base || 'untitled';
}
// Returns a unique reportId for this week. If the desired slug (from BP) is
// already used by a DIFFERENT report in the same week, appends -2, -3, ...
function computeReportId(bp, weekEnding, excludeReportId=''){
  const base = slugifyBP(bp);
  const taken = new Set(
    reportsCache
      .filter(r => r.weekEnding === weekEnding && !r.legacy && r.reportId !== excludeReportId)
      .map(r => r.reportId)
  );
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// ==================== LINE ITEMS ====================
function generateItemId(){
  return `item_${Date.now()}_${Math.random().toString(36).slice(2,11)}`;
}
function getLineItems(addr){
  const items = currentData?.entries?.[`${addr}_items`];
  return Array.isArray(items) && items.length > 0 ? items : [];
}
function setLineItems(addr, items){
  if (!currentData) currentData = { entries: {} };
  if (!currentData.entries) currentData.entries = {};
  const total = items.reduce((s, it)=> s + (Number(it.amount)||0), 0);
  currentData.entries[addr] = total > 0 ? total : 0;
  currentData.entries[`${addr}_items`] = items;
}
function addLineItem(addr, amount=0, vendor='', note=''){
  const items = getLineItems(addr).slice();
  items.push({ id:generateItemId(), amount:Number(amount)||0, vendor:vendor||'', note:note||'' });
  setLineItems(addr, items);
}
function updateLineItem(addr, itemId, updates){
  const items = getLineItems(addr).slice();
  const idx = items.findIndex(i => i.id === itemId);
  if (idx >= 0){
    items[idx] = { ...items[idx], ...updates };
    setLineItems(addr, items);
  }
}
function deleteLineItem(addr, itemId){
  const items = getLineItems(addr).filter(i => i.id !== itemId);
  setLineItems(addr, items);
}

// ==================== LINE-ITEM MODAL ====================
function openLineItemModal(addr, categoryLabel, dayId){
  currentEditAddr = addr;

  const inp = el('entryTable').querySelector(
    `input[data-col="${addr[0]}"][data-row="${addr.substring(1)}"]`
  );
  const currentInputValue = inp ? Number(inp.value) || 0 : 0;

  let items = getLineItems(addr);
  // If the cell has a plain amount but no item array yet, seed an item from it
  if (items.length === 0 && currentInputValue > 0 && !currentData?.entries?.[`${addr}_items`]){
    items = [{ id:generateItemId(), amount:currentInputValue, vendor:'', note:'' }];
    setLineItems(addr, items);
  }

  el('modalTitle').textContent = `${categoryLabel} - ${dayId}`;
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
    amountInput.addEventListener('input', (e)=>{
      updateLineItem(addr, item.id, { amount:Number(e.target.value)||0 });
      updateModalTotal();
      scheduleAutosave();
    });

    const vendorInput = document.createElement('input');
    vendorInput.type = 'text';
    vendorInput.placeholder = 'Vendor (optional)';
    vendorInput.value = item.vendor || '';
    vendorInput.className = 'modal-vendor-input';
    vendorInput.addEventListener('input', (e)=>{
      updateLineItem(addr, item.id, { vendor:e.target.value });
      scheduleAutosave();
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'modal-delete-btn';
    deleteBtn.textContent = '\u2715';
    deleteBtn.addEventListener('click', ()=>{
      deleteLineItem(addr, item.id);
      itemRow.remove();
      updateModalTotal();
      scheduleAutosave();
    });

    itemRow.appendChild(amountInput);
    itemRow.appendChild(vendorInput);
    itemRow.appendChild(deleteBtn);
    itemsList.appendChild(itemRow);
  });

  const addRow = document.createElement('div');
  addRow.className = 'modal-add-row';
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'modal-add-btn';
  addBtn.textContent = '+ Add receipt';
  addBtn.addEventListener('click', ()=>{
    addLineItem(addr, 0, '', '');
    openLineItemModal(addr, categoryLabel, dayId); // refresh
    scheduleAutosave();
  });
  addRow.appendChild(addBtn);
  itemsList.appendChild(addRow);

  updateModalTotal();
  const overlay = el('modalOverlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function updateModalTotal(){
  if (!currentEditAddr) return;
  const items = getLineItems(currentEditAddr);
  const total = items.reduce((s, it)=> s + (Number(it.amount)||0), 0);
  el('modalTotal').textContent = total > 0 ? `$${total.toFixed(2)}` : '$0.00';
  // reflect in main table input
  const inp = el('entryTable').querySelector(
    `input[data-col="${currentEditAddr[0]}"][data-row="${currentEditAddr.substring(1)}"]`
  );
  if (inp){ inp.value = total > 0 ? total.toFixed(2) : ''; }
  // reflect in mobile sheet if it's open on this day
  const sheetInp = document.querySelector(
    `#daySheetBody input[data-col="${currentEditAddr[0]}"][data-row="${currentEditAddr.substring(1)}"]`
  );
  if (sheetInp){ sheetInp.value = total > 0 ? total.toFixed(2) : ''; }
}
function closeLineItemModal(){
  if (currentEditAddr && currentData?.entries){
    const items = getLineItems(currentEditAddr);
    const total = items.reduce((s, it)=> s + (Number(it.amount)||0), 0);
    const inp = el('entryTable').querySelector(
      `input[data-col="${currentEditAddr[0]}"][data-row="${currentEditAddr.substring(1)}"]`
    );
    if (inp){ inp.value = total > 0 ? total.toFixed(2) : ''; }
  }
  el('modalOverlay').style.display = 'none';
  document.body.style.overflow = '';
  currentEditAddr = null;
  computeTotals();
  renderMobileDayStrip();
  if (activeDayIdx !== null) renderDaySheetBody(activeDayIdx);
}

// ==================== DATES / FORMAT ====================
function toISODate(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,'0');
  const da=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${da}`;
}
function parseISODate(s){
  const [y,m,d] = s.split('-').map(Number);
  return new Date(y, m-1, d);
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
    SUN:el('dateSUN'), MON:el('dateMON'), TUE:el('dateTUE'),
    WED:el('dateWED'), THU:el('dateTHU'), FRI:el('dateFRI'), SAT:el('dateSAT')
  };
  if (!sundayISO){
    Object.values(dateEls).forEach(x => { if (x) x.textContent = ''; });
    renderMobileDayStrip();
    return;
  }
  const sun = parseISODate(sundayISO);
  for (let i=0; i<7; i++){
    const d = new Date(sun);
    d.setDate(sun.getDate()+i);
    const id = dayIds[i];
    if (dateEls[id]) dateEls[id].textContent = `${d.getMonth()+1}/${d.getDate()}`;
  }
  renderMobileDayStrip();
}

function safeFilenameBase(weekEndingISO, businessPurpose){
  const sat = parseISODate(weekEndingISO);
  const sun = computeSundayFromWeekEnding(weekEndingISO);
  const bp = (businessPurpose || 'Expenses').trim();
  const safeBp = bp.replace(/[\/:*?"<>|]+/g,'').trim() || 'Expenses';
  return `Week ${fmtMD(sun)} through ${fmtMD(sat)} - ${safeBp}`;
}

// ==================== DESKTOP TABLE ====================
function buildTable(){
  const tbody = el('entryTable').querySelector('tbody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    if (r.type === 'divider'){
      const tr = document.createElement('tr');
      tr.className = 'divider-row';
      const td = document.createElement('td');
      td.colSpan = 8;
      td.className = 'divider-cell';
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.className = 'stickyLabel';
    tdLabel.textContent = r.label;
    tr.appendChild(tdLabel);

    for (let i=0; i<7; i++){
      const td = document.createElement('td');
      const col = dayCols[i];
      const dayId = dayIds[i];

      const cellWrapper = document.createElement('div');
      cellWrapper.className = 'cell-wrapper';

      const inp = document.createElement('input');
      inp.dataset.row = String(r.row);
      inp.dataset.col = col;
      inp.dataset.type = r.type;
      if (r.computed){
        inp.dataset.computed = 'true';
        inp.readOnly = true;
        inp.tabIndex = -1;
        inp.classList.add('computed','number-right');
      }
      if (r.type === 'number'){
        inp.inputMode = 'numeric';
        inp.placeholder = '0';
        inp.classList.add('number-right');
      } else if (r.type === 'currency'){
        inp.inputMode = 'decimal';
        inp.placeholder = '0.00';
        inp.classList.add('number-right');
      } else {
        inp.inputMode = 'text';
      }

      inp.addEventListener('input', onEntryInputChanged);
      inp.addEventListener('keydown', gridKeydown);

      if (r.type === 'currency'){
        const wrap = document.createElement('div');
        wrap.className = 'currency-wrap';
        wrap.appendChild(inp);
        cellWrapper.appendChild(wrap);

        if (!r.computed){
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'cell-add-btn';
          addBtn.textContent = '+';
          addBtn.dataset.addr = `${col}${r.row}`;
          addBtn.addEventListener('click', (e)=>{
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

  const rowOrder = rows.filter(r => r.type !== 'divider' && !r.computed).map(r => r.row);
  const idx = rowOrder.indexOf(rowNum);
  if (idx === -1) return;
  let nextIdx = idx + dir;
  while (nextIdx >= 0 && nextIdx < rowOrder.length){
    const nextRow = rowOrder[nextIdx];
    const next = el('entryTable').querySelector(
      `tbody input[data-row="${nextRow}"][data-col="${col}"]`
    );
    if (next){ next.focus(); next.select?.(); return; }
    nextIdx += dir;
  }
}

function allInputs(){ return Array.from(el('entryTable').querySelectorAll('input')); }

function onEntryInputChanged(){
  computeTotals();
  renderMobileDayStrip();
  scheduleAutosave();
}

// ==================== MOBILE DAY STRIP ====================
function dayTotalFromInputs(dayIdx){
  const col = dayCols[dayIdx];
  let total = 0;
  allInputs().forEach(inp => {
    if (inp.dataset.col !== col) return;
    if (inp.dataset.type !== 'currency') return;
    const addr = `${col}${inp.dataset.row}`;
    const items = getLineItems(addr);
    if (items.length > 0){
      total += items.reduce((s, it)=> s + (Number(it.amount)||0), 0);
    } else {
      const v = (inp.value || '').trim();
      const n = v ? Number(v) : 0;
      if (Number.isFinite(n)) total += n;
    }
  });
  return total;
}

function renderMobileDayStrip(){
  const strip = el('dayStrip');
  if (!strip) return;
  strip.innerHTML = '';

  const sundayISO = el('sundayDate').value;
  const sun = sundayISO ? parseISODate(sundayISO) : null;

  for (let i=0; i<7; i++){
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'day-tile';
    tile.dataset.dayIdx = String(i);

    const dow = document.createElement('div');
    dow.className = 'dow';
    dow.textContent = dayIds[i];

    const dom = document.createElement('div');
    dom.className = 'dom';
    if (sun){
      const d = new Date(sun); d.setDate(sun.getDate()+i);
      dom.textContent = String(d.getDate());
    } else {
      dom.textContent = '—';
    }

    const amt = document.createElement('div');
    amt.className = 'amt';
    const total = dayTotalFromInputs(i);
    if (total > 0){
      tile.classList.add('has-entries');
      amt.textContent = `$${total.toFixed(2)}`;
    } else {
      amt.textContent = '';
    }

    tile.appendChild(dow);
    tile.appendChild(dom);
    tile.appendChild(amt);
    tile.addEventListener('click', ()=> openDaySheet(i));
    strip.appendChild(tile);
  }

  const weekTotEl = el('mobileWeekTotal');
  if (weekTotEl){
    const wk = [0,1,2,3,4,5,6].reduce((s,i)=> s + dayTotalFromInputs(i), 0);
    weekTotEl.textContent = wk > 0 ? `$${wk.toFixed(2)}` : '$0.00';
  }
}

// ==================== DAY SHEET (mobile) ====================
function openDaySheet(dayIdx){
  activeDayIdx = dayIdx;
  renderDaySheetBody(dayIdx);
  const overlay = el('daySheetOverlay');
  overlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
function closeDaySheet(){
  el('daySheetOverlay').style.display = 'none';
  document.body.style.overflow = '';
  activeDayIdx = null;
  renderMobileDayStrip();
}
function renderDaySheetBody(dayIdx){
  el('daySheetTitle').textContent = dayLongNames[dayIdx];

  const sundayISO = el('sundayDate').value;
  if (sundayISO){
    const d = new Date(parseISODate(sundayISO));
    d.setDate(d.getDate()+dayIdx);
    const month = d.toLocaleString(undefined, { month:'short' });
    el('daySheetDate').textContent = `${month} ${d.getDate()}`;
  } else {
    el('daySheetDate').textContent = 'Set Sunday date first';
  }

  const col = dayCols[dayIdx];
  const body = el('daySheetBody');
  body.innerHTML = '';

  // group rows by `group`
  const sections = [];
  let currentSection = null;
  rows.forEach(r => {
    if (r.type === 'divider'){ currentSection = null; return; }
    if (!currentSection || currentSection.title !== r.group){
      currentSection = { title:r.group, items:[] };
      sections.push(currentSection);
    }
    currentSection.items.push(r);
  });

  sections.forEach(section => {
    const sec = document.createElement('div');
    sec.className = 'sheet-section';

    const title = document.createElement('div');
    title.className = 'sheet-section-title';
    title.textContent = section.title;
    sec.appendChild(title);

    section.items.forEach(r => {
      const field = document.createElement('div');
      field.className = 'sheet-field';

      const lbl = document.createElement('div');
      lbl.className = 'sheet-field-label';
      lbl.textContent = r.label;
      field.appendChild(lbl);

      const ctrl = document.createElement('div');
      ctrl.className = 'sheet-field-control';

      const addr = `${col}${r.row}`;
      const existingVal = getInputValueForAddr(addr);

      if (r.type === 'currency'){
        const wrap = document.createElement('div');
        wrap.className = 'sheet-currency-wrap';
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.inputMode = 'decimal';
        inp.placeholder = '0.00';
        inp.className = 'sheet-input';
        inp.dataset.col = col;
        inp.dataset.row = String(r.row);
        inp.value = existingVal;
        if (r.computed){
          inp.readOnly = true; inp.tabIndex = -1; inp.classList.add('computed');
        }
        inp.addEventListener('input', (e)=>{
          setInputValueForAddr(addr, e.target.value);
          // If the user types directly into a line-itemized cell, clear items
          // and fall back to a single amount so the table stays consistent.
          if (currentData?.entries?.[`${addr}_items`]){
            delete currentData.entries[`${addr}_items`];
          }
          computeTotals();
          updateDaySheetTotal();
          scheduleAutosave();
        });
        wrap.appendChild(inp);
        ctrl.appendChild(wrap);

        if (!r.computed){
          const addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'sheet-add-btn';
          addBtn.textContent = '+';
          const hasItems = getLineItems(addr).length > 1;
          if (hasItems) addBtn.classList.add('has-items');
          addBtn.addEventListener('click', ()=>{
            openLineItemModal(addr, r.label, dayIds[dayIdx]);
          });
          ctrl.appendChild(addBtn);
        }
      } else if (r.type === 'number'){
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.inputMode = 'numeric';
        inp.placeholder = '0';
        inp.className = 'sheet-input';
        inp.dataset.col = col;
        inp.dataset.row = String(r.row);
        inp.value = existingVal;
        inp.addEventListener('input', (e)=>{
          setInputValueForAddr(addr, e.target.value);
          computeTotals();
          updateDaySheetTotal();
          scheduleAutosave();
        });
        ctrl.appendChild(inp);
      } else {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'sheet-input text-input';
        inp.dataset.col = col;
        inp.dataset.row = String(r.row);
        inp.value = existingVal;
        inp.addEventListener('input', (e)=>{
          setInputValueForAddr(addr, e.target.value);
          scheduleAutosave();
        });
        ctrl.appendChild(inp);
      }

      field.appendChild(ctrl);
      sec.appendChild(field);
    });

    body.appendChild(sec);
  });

  updateDaySheetTotal();
}
function getInputValueForAddr(addr){
  const col = addr[0];
  const row = addr.substring(1);
  const inp = el('entryTable').querySelector(`input[data-col="${col}"][data-row="${row}"]`);
  return inp ? (inp.value || '') : '';
}
function setInputValueForAddr(addr, val){
  const col = addr[0];
  const row = addr.substring(1);
  const inp = el('entryTable').querySelector(`input[data-col="${col}"][data-row="${row}"]`);
  if (inp){
    inp.value = val;
    // recompute derived mileage synchronously so the day sheet sees it
  }
}
function updateDaySheetTotal(){
  if (activeDayIdx === null) return;
  const total = dayTotalFromInputs(activeDayIdx);
  el('daySheetTotal').textContent = total > 0 ? `$${total.toFixed(2)}` : '$0.00';
  // also update the computed mileage field in the open sheet if present
  const milesInp = document.querySelector(
    `#daySheetBody input[data-col="${dayCols[activeDayIdx]}"][data-row="10"]`
  );
  const mileageOut = document.querySelector(
    `#daySheetBody input[data-col="${dayCols[activeDayIdx]}"][data-row="29"]`
  );
  if (milesInp && mileageOut){
    const n = Number(milesInp.value || '');
    mileageOut.value = (Number.isFinite(n) && n > 0) ? (n * MILEAGE_RATE).toFixed(2) : '';
  }
}

// ==================== CLEAR / NEW ====================
function clearEntryValues(){
  allInputs().forEach(i => { if (i.dataset.computed !== 'true') i.value = ''; });
  el('businessPurpose').value = '';
  currentData = null;
  computeTotals();
  renderMobileDayStrip();
}

function startOver(){
  // Keep the sync name; clear only the current report state.
  if (!confirm('Start a new report from scratch? The current report stays saved.')) return;
  el('sundayDate').value = '';
  el('weekEnding').value = '';
  setHeaderDatesFromSunday('');
  currentWeekEnding = '';
  currentReportId = '';
  clientKnownUpdatedAt = null;
  conflictPaused = false;
  const cb = el('conflictBanner'); if (cb) cb.remove();
  el('weekSelect').value = '';
  clearEntryValues();
  setButtonsEnabled();
  setStatus('New report ready. Pick a Sunday date to begin.');
}

function newReportSameWeek(){
  // Only meaningful if we have a week selected.
  if (!currentWeekEnding){
    setStatus('Pick a Sunday date first, then create the new report.');
    return;
  }
  // Keep the sync and the dates; drop the report identity and entries.
  currentReportId = '';
  clientKnownUpdatedAt = null;
  conflictPaused = false;
  const cb = el('conflictBanner'); if (cb) cb.remove();
  clearEntryValues();
  el('weekSelect').value = '';
  setButtonsEnabled();
  setStatus('New report for this week. Enter a different Business Purpose.');
  const bp = el('businessPurpose');
  bp.focus();
}

// ==================== TOTALS ====================
function recomputeDerived(){
  for (let i=0; i<7; i++){
    const milesInp = el('entryTable').querySelector(`input[data-row="10"][data-col="${dayCols[i]}"]`);
    const outInp   = el('entryTable').querySelector(`input[data-row="29"][data-col="${dayCols[i]}"]`);
    if (!milesInp || !outInp) continue;
    const n = Number((milesInp.value || '').trim());
    outInp.value = (Number.isFinite(n) && n > 0) ? (n * MILEAGE_RATE).toFixed(2) : '';
  }
}

function updateButtonColors(){
  const buttons = el('entryTable').querySelectorAll('.cell-add-btn');
  buttons.forEach(btn => {
    const addr = btn.dataset.addr;
    const actualItems = currentData?.entries?.[`${addr}_items`];
    if (Array.isArray(actualItems) && actualItems.length > 1){
      btn.classList.add('has-items');
    } else {
      btn.classList.remove('has-items');
    }
  });
}

function computeTotals(){
  recomputeDerived();
  const totals = [0,0,0,0,0,0,0];

  allInputs().forEach(inp => {
    if (inp.dataset.type !== 'currency') return;
    const addr = `${inp.dataset.col}${inp.dataset.row}`;

    const items = getLineItems(addr);
    let cellTotal = 0;
    if (items.length > 0){
      cellTotal = items.reduce((s, it)=> s + (Number(it.amount)||0), 0);
    } else {
      const v = (inp.value || '').trim();
      if (!v) return;
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      cellTotal = n;
    }
    const idx = dayCols.indexOf(inp.dataset.col);
    if (idx >= 0) totals[idx] += cellTotal;
  });

  let week = 0;
  totals.forEach((t, idx) => {
    week += t;
    el(`tot${dayIds[idx]}`).value = t ? `$${t.toFixed(2)}` : '';
  });
  el('totWEEK').value = week ? `$${week.toFixed(2)}` : '';

  updateButtonColors();
}

// ==================== SERIALIZE / APPLY ====================
function serialize(){
  const entries = {};
  allInputs().forEach(inp => {
    if (inp.dataset.computed === 'true') return;
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    const raw = inp.value ?? '';
    if (raw === '') return;
    if (inp.dataset.type === 'number' || inp.dataset.type === 'currency'){
      const n = Number(raw);
      if (!Number.isFinite(n)) return;
      entries[addr] = n;
    } else {
      entries[addr] = raw;
    }
  });
  // carry line-item arrays
  if (currentData?.entries){
    Object.keys(currentData.entries).forEach(key => {
      if (key.endsWith('_items')) entries[key] = currentData.entries[key];
    });
  }
  return {
    syncName: currentSync,
    weekEnding: currentWeekEnding,
    reportId: currentReportId,
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
  allInputs().forEach(inp => {
    const addr = `${inp.dataset.col}${inp.dataset.row}`;
    if (map[addr] == null) return;
    inp.value = String(map[addr]);
  });

  computeTotals();
  updateButtonColors();
  renderMobileDayStrip();
}

// ==================== API ====================
async function apiFetchJson(url, opts={}){
  const headers = opts.headers ? { ...opts.headers } : {};
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { ...opts, headers });
  const txt = await res.text().catch(()=> '');
  if (!res.ok){
    const err = new Error(txt || `${res.status} ${res.statusText}`);
    err.status = res.status;
    try { err.body = txt ? JSON.parse(txt) : null; } catch { err.body = null; }
    throw err;
  }
  return txt ? JSON.parse(txt) : {};
}

// ==================== REPORTS LIST ====================
function reportDropdownLabel(r){
  const yy = fmtYYMMDD(parseISODate(r.weekEnding));
  const bp = (r.businessPurpose || '').trim() || 'Untitled';
  const suffix = r.legacy ? ' (legacy)' : '';
  // If the same BP is used more than once for this week, append the reportId
  const sameWeekSameBP = reportsCache.filter(x =>
    x.weekEnding === r.weekEnding
    && (x.businessPurpose || '').trim() === (r.businessPurpose || '').trim()
  );
  const disamb = (sameWeekSameBP.length > 1 && r.reportId) ? ` [${r.reportId}]` : '';
  return `${yy} - ${bp}${disamb}${suffix}`;
}
function renderWeeksDropdown(){
  const sel = el('weekSelect');
  sel.innerHTML = '<option value="">(Select a report)</option>';
  for (const r of reportsCache){
    const opt = document.createElement('option');
    opt.value = r.legacy ? `legacy:${r.weekEnding}` : `${r.weekEnding}:${r.reportId}`;
    opt.textContent = reportDropdownLabel(r);
    sel.appendChild(opt);
  }
  if (currentWeekEnding){
    const match = currentReportId
      ? `${currentWeekEnding}:${currentReportId}`
      : `legacy:${currentWeekEnding}`;
    if ([...sel.options].some(o => o.value === match)){
      sel.value = match;
    }
  }
}

async function loadWeeksForSync(autoLoadMostRecent=true){
  if (!currentSync){
    reportsCache = [];
    renderWeeksDropdown();
    return;
  }
  const out = await apiFetchJson(`${API.weeks}?sync=${encodeURIComponent(currentSync)}`);
  reportsCache = Array.isArray(out.reports) ? out.reports : [];
  renderWeeksDropdown();
  if (autoLoadMostRecent && reportsCache.length){
    const most = reportsCache[0];
    await loadReport(most);
  }
  if (activeTab === 2) renderTracker();
}

async function loadReport(meta){
  if (!currentSync) return;
  if (!meta || !meta.weekEnding) return;
  loading = true;
  setStatus('Loading…');
  try{
    const qs = new URLSearchParams({ sync: currentSync, weekEnding: meta.weekEnding });
    if (meta.reportId) qs.set('reportId', meta.reportId);
    const out = await apiFetchJson(`${API.data}?${qs.toString()}`);
    currentWeekEnding = meta.weekEnding;
    currentReportId = meta.reportId || '';
    clientKnownUpdatedAt = out.updatedAt || null;
    conflictPaused = false;
    el('weekEnding').value = meta.weekEnding;
    el('sundayDate').value = toISODate(computeSundayFromWeekEnding(meta.weekEnding));
    setHeaderDatesFromSunday(el('sundayDate').value);
    applyData(out.data);
    renderWeeksDropdown();
    setStatus('Loaded.');
  } catch(e){
    console.error(e);
    setStatus('Load failed.');
  } finally {
    loading = false;
    setButtonsEnabled();
  }
}

// ==================== AUTOSAVE ====================
function canAutosave(){
  return !!currentSync && !!currentWeekEnding && !loading && !conflictPaused;
}
function scheduleAutosave(){
  if (!canAutosave()) return;
  setStatus('Typing…');
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(performAutosave, 800);
}
async function performAutosave(){
  if (!canAutosave()) return;

  // If no reportId yet, compute one from the BP now. If the BP is empty,
  // the slug becomes 'untitled' which is fine for a scratch save.
  const bp = el('businessPurpose').value || '';
  let oldReportIdToClean = null;
  if (!currentReportId){
    currentReportId = computeReportId(bp, currentWeekEnding);
  } else if (currentReportId === 'untitled'){
    // Promote 'untitled' → real slug once the user types a real BP. Clean up
    // the orphan 'untitled' key so we don't leave two copies in KV.
    const candidate = computeReportId(bp, currentWeekEnding, currentReportId);
    if (candidate !== 'untitled' && candidate !== currentReportId){
      oldReportIdToClean = currentReportId;
      currentReportId = candidate;
      // New slug → fresh key with no server record yet.
      clientKnownUpdatedAt = null;
    }
  }
  // For any other existing reportId we keep the key stable — renaming happens
  // through the "+ New report (same week)" button.

  setStatus('Saving…');
  try{
    const payload = serialize();
    payload.clientKnownUpdatedAt = clientKnownUpdatedAt || '';
    const body = JSON.stringify(payload);
    const qs = new URLSearchParams({
      sync: currentSync,
      weekEnding: currentWeekEnding,
      reportId: currentReportId
    });
    const out = await apiFetchJson(`${API.data}?${qs.toString()}`, { method:'PUT', body });
    if (out && out.updatedAt) clientKnownUpdatedAt = out.updatedAt;

    // If we promoted untitled → real slug, delete the untitled key.
    if (oldReportIdToClean){
      try {
        const cleanQs = new URLSearchParams({
          sync: currentSync,
          weekEnding: currentWeekEnding,
          reportId: oldReportIdToClean
        });
        await apiFetchJson(`${API.data}?${cleanQs.toString()}`, { method:'DELETE' });
        reportsCache = reportsCache.filter(r =>
          !(r.weekEnding === currentWeekEnding && r.reportId === oldReportIdToClean && !r.legacy)
        );
      } catch {/* non-fatal */}
    }

    // update cache
    const existing = reportsCache.find(r =>
      r.weekEnding === currentWeekEnding && r.reportId === currentReportId && !r.legacy
    );
    const nowIso = clientKnownUpdatedAt || new Date().toISOString();
    if (existing){
      existing.businessPurpose = bp;
      existing.updatedAt = nowIso;
    } else {
      reportsCache.unshift({
        weekEnding: currentWeekEnding,
        reportId: currentReportId,
        legacy: false,
        businessPurpose: bp,
        updatedAt: nowIso
      });
    }
    reportsCache.sort((a,b) => {
      if (a.weekEnding !== b.weekEnding) return b.weekEnding.localeCompare(a.weekEnding);
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    renderWeeksDropdown();
    setStatus('Saved ✓');
    cacheCurrentReportTotal();
  } catch(e){
    if (e && e.status === 409){
      // Another device wrote a newer version. Stop autosaving until the user
      // decides — reload (recommended, drops local edits) or overwrite.
      conflictPaused = true;
      clearTimeout(autosaveTimer);
      showConflictBanner();
      setStatus('Conflict — newer data on another device.');
      return;
    }
    console.error(e);
    setStatus('Save failed — will retry on next change.');
  }
}

function showConflictBanner(){
  let banner = el('conflictBanner');
  if (!banner){
    banner = document.createElement('div');
    banner.id = 'conflictBanner';
    banner.style.cssText = [
      'position:fixed','left:0','right:0','top:0','z-index:9999',
      'background:#7a1f1f','color:#fff','padding:10px 14px',
      'font:600 14px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif',
      'display:flex','gap:10px','align-items:center','justify-content:center',
      'flex-wrap:wrap','box-shadow:0 2px 8px rgba(0,0,0,.4)'
    ].join(';');
    banner.innerHTML = `
      <span>This report was updated on another device. Your unsaved local edits won't be saved automatically.</span>
      <button id="conflictReload" style="background:#fff;color:#7a1f1f;border:0;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer;">Reload latest</button>
      <button id="conflictOverwrite" style="background:transparent;color:#fff;border:1px solid #fff;border-radius:6px;padding:6px 12px;font-weight:700;cursor:pointer;">Overwrite with mine</button>
    `;
    document.body.appendChild(banner);
    el('conflictReload').addEventListener('click', async ()=>{
      banner.remove();
      conflictPaused = false;
      try {
        await loadReport({ weekEnding: currentWeekEnding, reportId: currentReportId });
      } catch {}
    });
    el('conflictOverwrite').addEventListener('click', async ()=>{
      banner.remove();
      conflictPaused = false;
      // Force a save that ignores the baseline check.
      try {
        const payload = serialize();
        payload.force = true;
        const body = JSON.stringify(payload);
        const qs = new URLSearchParams({
          sync: currentSync,
          weekEnding: currentWeekEnding,
          reportId: currentReportId
        });
        setStatus('Saving…');
        const out = await apiFetchJson(`${API.data}?${qs.toString()}`, { method:'PUT', body });
        if (out && out.updatedAt) clientKnownUpdatedAt = out.updatedAt;
        setStatus('Saved ✓');
      } catch (err){
        console.error(err);
        setStatus('Overwrite failed.');
      }
    });
  }
}

// ==================== DELETE ====================
async function deleteCurrentReport(){
  const selVal = el('weekSelect').value;
  if (!selVal){
    setStatus('Pick a report to delete.');
    return;
  }
  let weekEnding, reportId, legacy = false;
  if (selVal.startsWith('legacy:')){
    weekEnding = selVal.slice(7);
    reportId = '';
    legacy = true;
  } else {
    const i = selVal.indexOf(':');
    weekEnding = selVal.slice(0, i);
    reportId = selVal.slice(i+1);
  }
  const label = legacy ? `legacy report for ${weekEnding}` : `report for ${weekEnding}`;
  if (!confirm(`Delete the ${label}?`)) return;

  setStatus('Deleting…');
  try{
    const qs = new URLSearchParams({ sync: currentSync, weekEnding });
    if (!legacy) qs.set('reportId', reportId);
    await apiFetchJson(`${API.data}?${qs.toString()}`, { method:'DELETE' });

    reportsCache = reportsCache.filter(r =>
      !(r.weekEnding === weekEnding && r.reportId === reportId && r.legacy === legacy)
    );
    // If it was the loaded report, reset
    if (currentWeekEnding === weekEnding && currentReportId === reportId){
      clearEntryValues();
      currentWeekEnding = '';
      currentReportId = '';
      clientKnownUpdatedAt = null;
      conflictPaused = false;
      const cb = el('conflictBanner'); if (cb) cb.remove();
      el('sundayDate').value = '';
      el('weekEnding').value = '';
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

// ==================== EXCEL EXPORT ====================
async function downloadExcel(){
  if (!currentWeekEnding){ setStatus('Enter a Sunday date first.'); return; }
  if (!ensureSync()){ setStatus('Sync Name not set.'); return; }

  setStatus('Building Excel…');
  try{
    if (typeof JSZip === 'undefined') throw new Error('JSZip library not loaded');
    const candidates = ['/Expenses%20Form.xlsx','Expenses%20Form.xlsx','/Expenses Form.xlsx','Expenses Form.xlsx'];
    let res = null;
    for (const url of candidates){
      try{ res = await fetch(url, { cache:'no-store' }); if (res && res.ok) break; } catch {}
    }
    if (!res || !res.ok) throw new Error('Template not found');

    const ab = await res.arrayBuffer();
    const zip = await JSZip.loadAsync(ab);
    const sheetPath = 'xl/worksheets/sheet1.xml';
    const workbookPath = 'xl/workbook.xml';
    const sheetXml = await zip.file(sheetPath).async('string');
    const sheetDoc = new DOMParser().parseFromString(sheetXml, 'application/xml');
    const sheetData = sheetDoc.getElementsByTagName('sheetData')[0];
    const workbookXml = await zip.file(workbookPath).async('string');
    const workbookDoc = new DOMParser().parseFromString(workbookXml, 'application/xml');

    function excelSerialFromDate(dateObj){
      const utc = Date.UTC(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
      return utc / 86400000 + 25569;
    }
    function cellParts(ref){
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) throw new Error(`Invalid cell reference: ${ref}`);
      return { col:m[1], row:Number(m[2]) };
    }
    function colNumber(col){
      let n = 0;
      for (let i=0; i<col.length; i++) n = (n*26) + (col.charCodeAt(i)-64);
      return n;
    }
    function ensureRow(rowNum){
      let row = sheetDoc.querySelector(`row[r="${rowNum}"]`);
      if (row) return row;
      row = sheetDoc.createElementNS(sheetDoc.documentElement.namespaceURI, 'row');
      row.setAttribute('r', String(rowNum));
      const rowsEls = Array.from(sheetData.getElementsByTagName('row'));
      const next = rowsEls.find(r => Number(r.getAttribute('r')) > rowNum);
      if (next) sheetData.insertBefore(row, next);
      else sheetData.appendChild(row);
      return row;
    }
    function ensureCell(ref){
      let cell = sheetDoc.querySelector(`c[r="${ref}"]`);
      if (cell) return cell;
      const { col, row } = cellParts(ref);
      const rowEl = ensureRow(row);
      cell = sheetDoc.createElementNS(sheetDoc.documentElement.namespaceURI, 'c');
      cell.setAttribute('r', ref);
      const cells = Array.from(rowEl.getElementsByTagName('c'));
      const thisCol = colNumber(col);
      const next = cells.find(c => colNumber(cellParts(c.getAttribute('r')).col) > thisCol);
      if (next) rowEl.insertBefore(cell, next);
      else rowEl.appendChild(cell);
      return cell;
    }
    function clearCellChildren(cell){
      Array.from(cell.children).forEach(child => {
        const tag = child.localName || child.nodeName;
        if (tag === 'v' || tag === 'is' || tag === 'f') cell.removeChild(child);
      });
    }
    function setCellNumber(ref, value){
      const cell = ensureCell(ref);
      clearCellChildren(cell);
      cell.removeAttribute('t');
      const v = sheetDoc.createElementNS(sheetDoc.documentElement.namespaceURI, 'v');
      v.textContent = String(value);
      cell.appendChild(v);
    }
    function setCellText(ref, value){
      const cell = ensureCell(ref);
      clearCellChildren(cell);
      cell.setAttribute('t','inlineStr');
      const is = sheetDoc.createElementNS(sheetDoc.documentElement.namespaceURI, 'is');
      const t  = sheetDoc.createElementNS(sheetDoc.documentElement.namespaceURI, 't');
      if (/^\s|\s$/.test(value)) t.setAttribute('xml:space','preserve');
      t.textContent = value;
      is.appendChild(t);
      cell.appendChild(is);
    }
    function setCellDate(ref, dateObj){ setCellNumber(ref, excelSerialFromDate(dateObj)); }
    function clearCellValue(ref){
      const cell = sheetDoc.querySelector(`c[r="${ref}"]`);
      if (!cell) return;
      clearCellChildren(cell);
      cell.removeAttribute('t');
    }
    function forceWorkbookRecalc(){
      let calcPr = workbookDoc.getElementsByTagName('calcPr')[0];
      if (!calcPr){
        calcPr = workbookDoc.createElementNS(workbookDoc.documentElement.namespaceURI, 'calcPr');
        workbookDoc.documentElement.appendChild(calcPr);
      }
      calcPr.setAttribute('calcMode','auto');
      calcPr.setAttribute('fullCalcOnLoad','1');
      calcPr.setAttribute('forceFullCalc','1');
      calcPr.setAttribute('calcCompleted','0');
    }

    const bp  = (el('businessPurpose')?.value || '').trim();
    const sat = parseISODate(currentWeekEnding);
    const sun = computeSundayFromWeekEnding(currentWeekEnding);

    // Header cells
    if (bp) setCellText('H5', bp); else clearCellValue('H5');
    setCellDate('E5', sat);

    // Date row 7 — Sunday..Saturday
    for (let i=0; i<7; i++){
      const d = new Date(sun);
      d.setDate(d.getDate()+i);
      setCellDate(`${dayCols[i]}7`, d);
    }

    // Entries — one value per cell (sum line items)
    allInputs().forEach(inp => {
      if (inp.dataset.computed === 'true') return;
      const addr = `${inp.dataset.col}${inp.dataset.row}`;
      if (inp.dataset.type === 'currency'){
        const items = currentData?.entries?.[`${addr}_items`];
        let exportVal;
        if (Array.isArray(items) && items.length > 0){
          exportVal = items.reduce((s, it)=> s + (Number(it.amount)||0), 0);
        } else {
          const v = (inp.value || '').trim();
          exportVal = v ? Number(v) : 0;
        }
        if (Number.isFinite(exportVal) && exportVal > 0) setCellNumber(addr, exportVal);
        else clearCellValue(addr);
      } else if (inp.dataset.type === 'number'){
        const v = (inp.value || '').trim();
        const n = v ? Number(v) : 0;
        if (Number.isFinite(n) && n > 0) setCellNumber(addr, n);
        else clearCellValue(addr);
      } else {
        const v = (inp.value || '').trim();
        if (v) setCellText(addr, v);
        else clearCellValue(addr);
      }
    });

    forceWorkbookRecalc();

    zip.file(sheetPath, new XMLSerializer().serializeToString(sheetDoc));
    zip.file(workbookPath, new XMLSerializer().serializeToString(workbookDoc));
    const outBlob = await zip.generateAsync({ type:'blob' });

    const filename = `${safeFilenameBase(currentWeekEnding, bp)}.xlsx`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(outBlob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=> URL.revokeObjectURL(a.href), 1000);
    setStatus('Excel downloaded.');
  } catch(e){
    console.error(e);
    setStatus('Excel export failed: ' + e.message);
  }
}

// ==================== SYNC NAME ====================
function sanitizeSyncName(s){
  if (!s) return '';
  return String(s).trim().replace(/\s+/g,' ').slice(0,80);
}
function renderSync(){
  el('syncPill').textContent = currentSync || 'Not set';
  localStorage.setItem('expenses_sync_name', currentSync || '');
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
async function changeSync(){
  const v = prompt('Sync Name (type anything):', currentSync || '');
  const s = sanitizeSyncName(v);
  if (!s) return;
  currentSync = s;
  renderSync();
  await loadWeeksForSync(true);
  setButtonsEnabled();
}

// ==================== MISC UI ====================
function setStatus(msg=''){
  el('saveStatus').textContent = msg;
  if (msg === 'Saved ✓'){
    const now = new Date();
    const time = now.toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
    const date = now.toLocaleDateString(undefined, {month:'short', day:'numeric'});
    el('lastSaved').textContent = `Last saved ${date} at ${time}`;
  }
}
function setButtonsEnabled(){
  const hasWeek = !!currentWeekEnding;
  el('btnDownload').disabled = !hasWeek;
  el('btnDeleteWeek').disabled = !el('weekSelect').value;
  el('btnNewReport').disabled = !hasWeek;
  el('btnSave').disabled = !hasWeek || !currentSync;
}
function onSundayChange(){
  const v = el('sundayDate').value;
  if (!v) return;
  const sat = computeWeekEndingFromSunday(v);
  const newWeekEnding = toISODate(sat);
  if (currentWeekEnding && newWeekEnding !== currentWeekEnding){
    clearEntryValues();
    currentReportId = '';
    clientKnownUpdatedAt = null;
    conflictPaused = false;
    const cb = el('conflictBanner'); if (cb) cb.remove();
    el('weekSelect').value = '';
    setStatus('New week selected. Entries cleared.');
  }
  currentWeekEnding = newWeekEnding;
  el('weekEnding').value = currentWeekEnding;
  setHeaderDatesFromSunday(v);
  setButtonsEnabled();
}
async function onWeekSelectChange(){
  const v = el('weekSelect').value;
  if (!v) return;
  let meta;
  if (v.startsWith('legacy:')){
    meta = { weekEnding: v.slice(7), reportId: '', legacy: true };
  } else {
    const i = v.indexOf(':');
    meta = { weekEnding: v.slice(0, i), reportId: v.slice(i+1), legacy: false };
  }
  await loadReport(meta);
}
function onBusinessPurposeChange(){
  scheduleAutosave();
}

// ==================== INIT ====================
async function init(){
  buildTable();
  computeTotals();
  renderSync();
  renderMobileDayStrip();

  el('sundayDate').addEventListener('change', onSundayChange);
  el('weekSelect').addEventListener('change', onWeekSelectChange);
  el('businessPurpose').addEventListener('input', onBusinessPurposeChange);

  el('btnDeleteWeek').addEventListener('click', deleteCurrentReport);
  el('btnClear').addEventListener('click', startOver);
  el('btnNewReport').addEventListener('click', newReportSameWeek);
  el('btnSave').addEventListener('click', ()=>{
    clearTimeout(autosaveTimer);
    performAutosave();
  });
  el('btnDownload').addEventListener('click', downloadExcel);
  el('btnChangeSync').addEventListener('click', changeSync);

  // Tab switching
  el('tabBtn1').addEventListener('click', ()=> switchTab(1));
  el('tabBtn2').addEventListener('click', ()=> switchTab(2));
  el('btnCopyUnpaid').addEventListener('click', copyUnpaidReports);

  // Line-item modal
  el('modalCloseBtn').addEventListener('click', closeLineItemModal);
  el('modalSaveBtn').addEventListener('click', closeLineItemModal);
  el('modalOverlay').addEventListener('click', (e)=>{
    if (e.target === el('modalOverlay')) closeLineItemModal();
  });

  // Day sheet
  el('daySheetClose').addEventListener('click', closeDaySheet);
  el('daySheetDone').addEventListener('click', closeDaySheet);
  el('daySheetPrev').addEventListener('click', ()=>{
    if (activeDayIdx === null) return;
    if (activeDayIdx > 0) openDaySheet(activeDayIdx - 1);
  });
  el('daySheetNext').addEventListener('click', ()=>{
    if (activeDayIdx === null) return;
    if (activeDayIdx < 6) openDaySheet(activeDayIdx + 1);
  });

  // Flush pending autosave when leaving the page
  window.addEventListener('beforeunload', ()=>{
    if (autosaveTimer){
      clearTimeout(autosaveTimer);
      // Best-effort synchronous-ish save; fetch keepalive works on unload.
      if (canAutosave()){
        try{
          const payload = serialize();
          payload.clientKnownUpdatedAt = clientKnownUpdatedAt || '';
          const body = JSON.stringify(payload);
          if (!currentReportId){
            currentReportId = computeReportId(el('businessPurpose').value || '', currentWeekEnding);
          }
          const qs = new URLSearchParams({
            sync: currentSync, weekEnding: currentWeekEnding, reportId: currentReportId
          });
          fetch(`${API.data}?${qs.toString()}`, {
            method:'PUT',
            headers:{ 'Content-Type':'application/json' },
            body,
            keepalive:true
          });
        } catch {}
      }
    }
  });

  if (currentSync){
    try{ await loadWeeksForSync(true); } catch {}
  }

  setButtonsEnabled();
}

init();

// ==================== PAYMENT TRACKER (Tab 2) ====================

// localStorage key for tracker data (sent/paid dates + prev-year amounts)
function trackerStorageKey(){
  return `tracker:${currentSync}`;
}

// Load tracker data object: { "weekEnding:reportId": {sent, paid}, "__prevYear__2025": "41307.52" }
function loadTrackerData(){
  if (!currentSync) return {};
  try{
    const raw = localStorage.getItem(trackerStorageKey());
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveTrackerData(data){
  if (!currentSync) return;
  localStorage.setItem(trackerStorageKey(), JSON.stringify(data));
}

// Cache of report totals: "weekEnding:reportId" → number
const reportTotalsCache = {};

// Store the current report's total whenever autosave fires (called from performAutosave).
function cacheCurrentReportTotal(){
  if (!currentWeekEnding || !currentReportId) return;
  const weekTotal = parseFloat((el('totWEEK').value || '').replace(/[$,]/g,'')) || 0;
  reportTotalsCache[`${currentWeekEnding}:${currentReportId}`] = weekTotal;
}

// Format a report label matching the screenshot style
// "Week M-D through M-D - Business Purpose"
function trackerReportLabel(r){
  const we = parseISODate(r.weekEnding); // Saturday
  const sun = computeSundayFromWeekEnding(r.weekEnding);
  const sunMD = `${sun.getMonth()+1}-${sun.getDate()}`;
  const satMD = `${we.getMonth()+1}-${we.getDate()}`;
  const bp = (r.businessPurpose || '').trim() || 'Untitled';
  return `Week ${sunMD} through ${satMD} - ${bp}`;
}

// Fetch a report's total from the API (used when not already cached)
async function fetchReportTotal(r){
  const key = r.legacy ? `legacy:${r.weekEnding}` : `${r.weekEnding}:${r.reportId}`;
  if (reportTotalsCache[key] !== undefined) return reportTotalsCache[key];
  try{
    const qs = new URLSearchParams({ sync: currentSync, weekEnding: r.weekEnding });
    if (r.reportId) qs.set('reportId', r.reportId);
    const out = await apiFetchJson(`${API.data}?${qs.toString()}`);
    const data = out.data;
    if (!data || !data.entries) { reportTotalsCache[key] = 0; return 0; }
    // Compute total from entries
    let total = 0;
    const entries = data.entries;
    const mileageKey = `${data.weekEnding}:mileage`; // not used; compute directly
    rows.forEach(rowDef => {
      if (!rowDef.row || rowDef.type !== 'currency' || rowDef.computed) return;
      dayCols.forEach(col => {
        const addr = `${col}${rowDef.row}`;
        const items = entries[`${addr}_items`];
        if (Array.isArray(items) && items.length > 0){
          total += items.reduce((s, it)=> s + (Number(it.amount)||0), 0);
        } else if (entries[addr] != null){
          total += Number(entries[addr]) || 0;
        }
      });
    });
    // Add mileage (row 29, computed = miles * rate)
    dayCols.forEach(col => {
      const milesAddr = `${col}10`;
      const miles = Number(entries[milesAddr]) || 0;
      if (miles > 0) total += miles * MILEAGE_RATE;
    });
    reportTotalsCache[key] = total;
    return total;
  } catch { reportTotalsCache[key] = 0; return 0; }
}

// Render the tracker table
async function renderTracker(){
  const body = el('trackerBody');
  const summary = el('trackerSummary');
  if (!currentSync){
    body.innerHTML = '<tr><td colspan="4" class="tr-empty">No sync set — go to Expense Entry tab first.</td></tr>';
    summary.innerHTML = '';
    return;
  }
  if (!reportsCache.length){
    body.innerHTML = '<tr><td colspan="4" class="tr-empty">No reports found.</td></tr>';
    summary.innerHTML = '';
    return;
  }

  body.innerHTML = '<tr><td colspan="4" class="tr-empty">Loading totals…</td></tr>';
  const trackerData = loadTrackerData();

  // Sort reports: newest week first, then by reportId within week
  const sorted = [...reportsCache].sort((a,b) => b.weekEnding.localeCompare(a.weekEnding));

  // Fetch all totals
  await Promise.all(sorted.map(r => fetchReportTotal(r)));

  body.innerHTML = '';
  let oweTotal = 0;
  let spentTotal = 0;
  const currentYear = new Date().getFullYear();

  for (const r of sorted){
    const rKey = r.legacy ? `legacy:${r.weekEnding}` : `${r.weekEnding}:${r.reportId}`;
    const td = trackerData[rKey] || {};
    const total = reportTotalsCache[rKey] || 0;
    const label = trackerReportLabel(r);
    const isPaid = !!td.paid;
    const isSent = !!td.sent;

    // Spent = any report for the current year
    const reportYear = parseInt((r.weekEnding || '').slice(0,4), 10);
    if (reportYear === currentYear) spentTotal += total;

    // Owe = sent but not paid
    if (isSent && !isPaid) oweTotal += total;

    const tr = document.createElement('tr');
    tr.className = isPaid ? 'tr-paid' : '';
    tr.dataset.rkey = rKey;
    tr.innerHTML = `
      <td class="tr-name-cell">${escHtml(label)}</td>
      <td class="tr-total-cell">$${total.toFixed(2)}</td>
      <td class="tr-date-cell"><input type="date" class="tracker-sent" value="${escHtml(td.sent||'')}" aria-label="Sent date for ${escHtml(label)}"></td>
      <td class="tr-date-cell"><input type="date" class="tracker-paid" value="${escHtml(td.paid||'')}" aria-label="Paid date for ${escHtml(label)}"></td>
    `;

    // Events for date inputs
    tr.querySelector('.tracker-sent').addEventListener('change', function(){
      saveTrackerDate(rKey, 'sent', this.value);
    });
    tr.querySelector('.tracker-paid').addEventListener('change', function(){
      saveTrackerDate(rKey, 'paid', this.value);
      // toggle strikethrough immediately
      if (this.value){
        tr.classList.add('tr-paid');
        tr.querySelector('.tr-name-cell').style.textDecoration='line-through';
      } else {
        tr.classList.remove('tr-paid');
        tr.querySelector('.tr-name-cell').style.textDecoration='';
      }
      recalcSummary();
    });

    body.appendChild(tr);
  }

  renderTrackerSummary(oweTotal, spentTotal, trackerData);
}

function escHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function saveTrackerDate(rKey, field, value){
  const data = loadTrackerData();
  if (!data[rKey]) data[rKey] = {};
  data[rKey][field] = value;
  saveTrackerData(data);
}

function renderTrackerSummary(oweTotal, spentTotal, trackerData){
  const prevYearKey = `__prevYear__${new Date().getFullYear()-1}`;
  const prevVal = trackerData[prevYearKey] || '';
  el('trackerSummary').innerHTML = `
    <div class="tracker-sum-row sum-owe">
      <span class="tracker-sum-label">Owe (sent, not yet paid)</span>
      <span class="tracker-sum-value">$${oweTotal.toFixed(2)}</span>
    </div>
    <div class="tracker-sum-row sum-spent">
      <span class="tracker-sum-label">Spent ${new Date().getFullYear()}</span>
      <span class="tracker-sum-value">$${spentTotal.toFixed(2)}</span>
    </div>
    <div class="tracker-sum-row">
      <span class="tracker-sum-label tracker-sum-prev-year">
        <span>${new Date().getFullYear()-1} Spend</span>
      </span>
      <input type="number" class="tracker-sum-prev-input" id="prevYearInput"
        value="${escHtml(prevVal)}" placeholder="0.00" step="0.01" min="0"
        aria-label="${new Date().getFullYear()-1} spend total">
    </div>
  `;
  el('prevYearInput').addEventListener('change', function(){
    const data = loadTrackerData();
    data[prevYearKey] = this.value;
    saveTrackerData(data);
  });
}

function recalcSummary(){
  // Re-read rows from DOM to recalc owe without full re-render
  const trackerData = loadTrackerData();
  let oweTotal = 0;
  let spentTotal = 0;
  const currentYear = new Date().getFullYear();
  document.querySelectorAll('#trackerBody tr[data-rkey]').forEach(tr => {
    const rKey = tr.dataset.rkey;
    const sentVal = tr.querySelector('.tracker-sent').value;
    const paidVal = tr.querySelector('.tracker-paid').value;
    const total = parseFloat((tr.querySelector('.tr-total-cell')||{}).textContent?.replace('$','')) || 0;
    // Determine year from rKey
    const weekEnding = rKey.startsWith('legacy:') ? rKey.slice(7) : rKey.split(':')[0];
    const reportYear = parseInt((weekEnding||'').slice(0,4), 10);
    if (reportYear === currentYear) spentTotal += total;
    if (sentVal && !paidVal) oweTotal += total;
  });
  renderTrackerSummary(oweTotal, spentTotal, trackerData);
}

// Copy unpaid reports as plain text for email
function copyUnpaidReports(){
  const lines = [];
  document.querySelectorAll('#trackerBody tr[data-rkey]').forEach(tr => {
    const sentVal = tr.querySelector('.tracker-sent').value;
    const paidVal = tr.querySelector('.tracker-paid').value;
    if (!sentVal || paidVal) return; // only sent-not-paid
    const name = (tr.querySelector('.tr-name-cell')||{}).textContent?.trim() || '';
    const totalText = (tr.querySelector('.tr-total-cell')||{}).textContent?.trim() || '';
    // Format sent date as M/D/YYYY
    const sentParts = sentVal.split('-');
    const sentFmt = sentParts.length === 3
      ? `${parseInt(sentParts[1])}/${parseInt(sentParts[2])}/${sentParts[0]}`
      : sentVal;
    lines.push(`${name} - ${totalText} - Sent ${sentFmt}`);
  });
  if (!lines.length){
    alert('No unpaid (sent, not paid) reports found.');
    return;
  }
  const text = lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(()=>{
      const btn = el('btnCopyUnpaid');
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(()=>{ btn.textContent = orig; }, 2000);
    }).catch(()=> fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}
function fallbackCopy(text){
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  const btn = el('btnCopyUnpaid');
  const orig = btn.textContent;
  btn.textContent = '✓ Copied!';
  setTimeout(()=>{ btn.textContent = orig; }, 2000);
}

// ==================== TAB SWITCHING ====================
let activeTab = 1;

function switchTab(n){
  activeTab = n;
  el('tab1Content').style.display = n === 1 ? '' : 'none';
  el('tab2Content').style.display = n === 2 ? '' : 'none';
  el('tabBtn1').classList.toggle('tab-active', n === 1);
  el('tabBtn2').classList.toggle('tab-active', n === 2);
  if (n === 2) renderTracker();
}
