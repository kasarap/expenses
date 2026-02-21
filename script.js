// Travel Expense Report - template filler
const TEMPLATE_PATH = "Expenses Form.xlsx";
const LS_KEY = "expense_form_draft_v1";

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const COLS = ["C","D","E","F","G","H","I"]; // in the Excel template

// Map web categories to Excel rows (based on your uploaded template)
const CATEGORY_ROWS = [
  { group: "Company Paid", items: [
    { key: "airfare_company_paid", label: "Airfare Company Paid", row: 12 },
    { key: "auto_rental_company_paid", label: "Auto Rental Company Paid", row: 13 },
    { key: "lodging_company_paid", label: "Lodging Company Paid", row: 14 },
    { key: "gas_company_paid", label: "Gas Company Paid", row: 15 },
    { key: "other_company_paid", label: "**Other Company Paid", row: 16 },
  ]},
  { group: "Travel", items: [
    { key: "airfare", label: "Airfare", row: 18 },
    { key: "bus_limo_taxi", label: "Bus, Limo & Taxi", row: 19 },
    { key: "lodging_room_tax", label: "Lodging Room & Tax", row: 20 },
    { key: "parking_tolls", label: "Parking / Tolls", row: 21 },
    { key: "tips", label: "Tips", row: 22 },
    { key: "laundry", label: "Laundry", row: 23 },
  ]},
  { group: "Auto", items: [
    { key: "auto_rental", label: "Auto Rental", row: 25 },
    { key: "auto_rental_fuel", label: "Auto Rental Fuel", row: 26 },
    { key: "company_car_fuel", label: "Company Car Fuel", row: 27 },
    { key: "company_car_maintenance", label: "Company Car Maintenance", row: 28 },
    // Personal car mileage is formula-driven in row 29 based on miles in row 10 and rate in B10
  ]},
  { group: "Telephone", items: [
    { key: "lodging_phone_fax", label: "Loding Phone / Fax", row: 31 },
    { key: "home_phone_fax", label: "Home Phone / Fax", row: 32 },
    { key: "cell_phone", label: "Cell Phone", row: 33 },
    { key: "internet_email", label: "Internet - Email", row: 34 },
  ]},
  { group: "Other", items: [
    { key: "postage", label: "POSTAGE", row: 36 },
    { key: "office_supplies", label: "OFFICE SUPPLIES", row: 37 },
    { key: "perishable_tools", label: "PERISHABLE TOOLS", row: 38 },
    { key: "dues_subscriptions", label: "DUES & SUBSCRIPTIONS", row: 39 },
    { key: "other_misc", label: "**Other", row: 40 },
  ]},
  { group: "Meals", items: [
    { key: "breakfast", label: "Breakfast", row: 42 },
    { key: "lunch", label: "Lunch", row: 43 },
    { key: "dinner", label: "Dinner", row: 44 },
  ]},
  { group: "Entertainment", items: [
    { key: "ent_breakfast", label: "**Entertainment - Breakfast", row: 46 },
    { key: "ent_lunch", label: "**Entertainment - Lunch", row: 47 },
    { key: "ent_dinner", label: "**Entertainment - Dinner", row: 48 },
    { key: "ent_other", label: "**Entertainment - Other", row: 49 },
  ]},
];

function el(id){ return document.getElementById(id); }
function q(sel){ return document.querySelector(sel); }
function qa(sel){ return Array.from(document.querySelectorAll(sel)); }

function setStatus(msg){
  const s = el("status");
  s.textContent = msg || "";
}

function moneyToNumber(v){
  if(v === null || v === undefined) return null;
  const t = String(v).trim();
  if(!t) return null;
  // allow commas and $ and spaces
  const cleaned = t.replace(/[$,]/g,"").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function buildExpenseTable(){
  const tbody = el("expenseBody");
  tbody.innerHTML = "";
  for(const group of CATEGORY_ROWS){
    // group row
    const trG = document.createElement("tr");
    trG.className = "group";
    const td0 = document.createElement("td");
    td0.textContent = group.group;
    td0.style.color = "#a7adbb";
    td0.style.fontWeight = "700";
    td0.colSpan = 8;
    trG.appendChild(td0);
    tbody.appendChild(trG);

    for(const item of group.items){
      const tr = document.createElement("tr");
      const tdLabel = document.createElement("td");
      tdLabel.textContent = item.label;
      tr.appendChild(tdLabel);

      for(let d=0; d<7; d++){
        const td = document.createElement("td");
        const inp = document.createElement("input");
        inp.setAttribute("inputmode","decimal");
        inp.placeholder = "0.00";
        inp.dataset.key = item.key;
        inp.dataset.day = String(d);
        inp.addEventListener("input", saveDraftDebounced);
        td.appendChild(inp);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
}

function getDraft(){
  const obj = {
    name: el("name").value || "",
    weekEnding: el("weekEnding").value || "",
    purpose: el("purpose").value || "",
    daily: {
      date: Array(7).fill(""),
      from: Array(7).fill(""),
      to: Array(7).fill(""),
      miles: Array(7).fill(""),
    },
    expenses: {} // key -> [7 strings]
  };

  // daily details
  for(const kind of ["date","from","to","miles"]){
    for(let d=0; d<7; d++){
      const inp = document.querySelector(`[data-cell="${kind}-${d}"]`);
      obj.daily[kind][d] = inp ? (inp.value || "") : "";
    }
  }

  // expenses
  for(const group of CATEGORY_ROWS){
    for(const item of group.items){
      const arr = Array(7).fill("");
      for(let d=0; d<7; d++){
        const inp = document.querySelector(`input[data-key="${item.key}"][data-day="${d}"]`);
        arr[d] = inp ? (inp.value || "") : "";
      }
      obj.expenses[item.key] = arr;
    }
  }
  return obj;
}

function applyDraft(obj){
  el("name").value = obj?.name ?? "";
  el("weekEnding").value = obj?.weekEnding ?? "";
  el("purpose").value = obj?.purpose ?? "";

  // daily
  for(const kind of ["date","from","to","miles"]){
    for(let d=0; d<7; d++){
      const inp = document.querySelector(`[data-cell="${kind}-${d}"]`);
      if(inp) inp.value = obj?.daily?.[kind]?.[d] ?? "";
    }
  }

  // expenses
  for(const group of CATEGORY_ROWS){
    for(const item of group.items){
      for(let d=0; d<7; d++){
        const inp = document.querySelector(`input[data-key="${item.key}"][data-day="${d}"]`);
        if(inp) inp.value = obj?.expenses?.[item.key]?.[d] ?? "";
      }
    }
  }
}

let saveTimer = null;
function saveDraftDebounced(){
  if(saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try{
      const draft = getDraft();
      localStorage.setItem(LS_KEY, JSON.stringify(draft));
      setStatus("Saved locally.");
      window.setTimeout(()=>setStatus(""), 1200);
    }catch(e){
      console.warn(e);
    }
  }, 250);
}

function clearAll(){
  if(!confirm("Clear all fields?")) return;
  localStorage.removeItem(LS_KEY);
  applyDraft({});
  setStatus("Cleared.");
  window.setTimeout(()=>setStatus(""), 1200);
}

// Write to a sheet cell safely
function setCell(ws, addr, value){
  // Keep formulas intact by only writing numeric/string values
  if(value === null || value === undefined || value === "") return;
  ws[addr] = ws[addr] || {};
  ws[addr].v = value;
  // basic types
  if(typeof value === "number"){
    ws[addr].t = "n";
  }else{
    ws[addr].t = "s";
  }
}

async function generateExcel(){
  setStatus("Generating…");

  // Load template
  const res = await fetch(TEMPLATE_PATH, { cache: "no-store" });
  if(!res.ok) throw new Error("Template not found. Make sure 'Expenses Form.xlsx' is deployed with the site.");
  const buf = await res.arrayBuffer();

  const wb = XLSX.read(buf, { type: "array", cellStyles: true });
  const ws = wb.Sheets["Page 1"];
  if(!ws) throw new Error("Sheet 'Page 1' not found in template.");

  const draft = getDraft();

  // Header fields
  if(draft.name) setCell(ws, "A5", draft.name);

  if(draft.weekEnding){
    // D4:E4 is merged in the template; store in D4
    setCell(ws, "D4", `Week Ending: ${draft.weekEnding}`);
  }
  if(draft.purpose){
    // F4:J4 is merged in the template; store in F4
    setCell(ws, "F4", `Business Purpose of Expenses: ${draft.purpose}`);
  }

  // Daily (rows 7-10) across C-I
  for(let d=0; d<7; d++){
    setCell(ws, `${COLS[d]}7`, draft.daily.date[d] || "");
    setCell(ws, `${COLS[d]}8`, draft.daily.from[d] || "");
    setCell(ws, `${COLS[d]}9`, draft.daily.to[d] || "");

    const milesNum = moneyToNumber(draft.daily.miles[d]);
    if(milesNum !== null) setCell(ws, `${COLS[d]}10`, milesNum);
  }

  // Expenses
  for(const group of CATEGORY_ROWS){
    for(const item of group.items){
      const arr = draft.expenses[item.key] || [];
      for(let d=0; d<7; d++){
        const num = moneyToNumber(arr[d]);
        if(num !== null) setCell(ws, `${COLS[d]}${item.row}`, num);
      }
    }
  }

  // Output
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  const fileNameSafeWeek = (draft.weekEnding || "week").replace(/[^\w\-]+/g, "_");
  const fileNameSafeName = (draft.name || "employee").replace(/[^\w\-]+/g, "_");
  const fileName = `Travel_Expense_${fileNameSafeName}_${fileNameSafeWeek}.xlsx`;

  const url = URL.createObjectURL(blob);
  const a = el("downloadLink");
  a.href = url;
  a.download = fileName;
  a.classList.remove("hidden");
  a.click();

  // cleanup url later
  setTimeout(()=>URL.revokeObjectURL(url), 30_000);

  setStatus("Downloaded.");
  window.setTimeout(()=>setStatus(""), 1500);
}

function init(){
  buildExpenseTable();

  // Restore draft if present
  const raw = localStorage.getItem(LS_KEY);
  if(raw){
    try{ applyDraft(JSON.parse(raw)); }catch(e){ /* ignore */ }
  }

  // Wire up auto-save for header + daily table
  ["name","weekEnding","purpose"].forEach(id => el(id).addEventListener("input", saveDraftDebounced));
  qa("#dailyTable input").forEach(inp => inp.addEventListener("input", saveDraftDebounced));

  el("clearAll").addEventListener("click", clearAll);
  el("download").addEventListener("click", async () => {
    try{ await generateExcel(); }
    catch(e){
      console.error(e);
      alert(e.message || String(e));
      setStatus("");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
