// Vanilla JS Omniscope Viewer (Vite proxy-aware)
// - Table on the left, Filters on the right
// - Data loads immediately on OK
// - "Show fields" loads distincts; "Apply filters" applies checkbox selections

// ===== Config =====
const PAGE_SIZE = 100;
const DISTINCT_LIMIT = 200;
const MAX_FILTER_FIELDS = 5;

// ===== State =====
const state = {
  endpoint: "",
  schema: null,
  textFields: [],
  chosenFilterFields: [],
  stagedSelections: {},   // field -> Set(values)
  appliedSelections: {},  // field -> Set(values)
  pageStart: 0,
  pageSize: PAGE_SIZE,
  lastTableSchema: null,
  lastTotalRows: null
};

// ===== DOM =====
const el = {
  endpoint: document.getElementById("endpoint"),
  loadBtn: document.getElementById("loadBtn"),
  status: document.getElementById("status"),

  fieldSelect: document.getElementById("fieldSelect"),
  showFieldsBtn: document.getElementById("showFieldsBtn"),
  filterPanels: document.getElementById("filterPanels"),
  applyFiltersBtn: document.getElementById("applyFiltersBtn"),

  tableContainer: document.getElementById("tableContainer"),
  prevPageBtn: document.getElementById("prevPageBtn"),
  nextPageBtn: document.getElementById("nextPageBtn"),
  pageInfo: document.getElementById("pageInfo"),
};

// ===== Utils =====
function setStatus(msg) { el.status.textContent = msg || ""; }
function clearChildren(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function toArray(x) { return Array.isArray(x) ? x : (x == null ? [] : [x]); }

// Proxy-normalizer: accept full URL or just path; return `/proxy/<path>`
function toProxyBase(ep) {
  let input = (ep || "").trim();
  if (!input) throw new Error("Missing endpoint.");
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const u = new URL(input);
    if (!u.hostname.endsWith("public.omniscope.me")) {
      throw new Error("Dev proxy only supports public.omniscope.me");
    }
    input = u.pathname; // /Public/.../api/v1
  }
  if (!input.startsWith("/")) input = "/" + input;
  input = input.replace(/\/$/, "");
  return `/proxy${input}`;
}

function cloneSelections(sel) {
  const out = {};
  Object.keys(sel || {}).forEach(k => out[k] = new Set(sel[k]));
  return out;
}

// ===== API =====
async function apiFetchSchema() {
  const url = `${toProxyBase(state.endpoint)}/schema`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Schema error: ${res.status} ${res.statusText}`);
  return res.json();
}
async function apiPostTable(body) {
  const url = `${toProxyBase(state.endpoint)}/table`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Table error: ${res.status} ${res.statusText}`);
  return res.json();
}
async function apiPostBatch(queriesByKey) {
  const url = `${toProxyBase(state.endpoint)}/batch`;
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ queries: queriesByKey }) });
  if (!res.ok) throw new Error(`Batch error: ${res.status} ${res.statusText}`);
  return res.json();
}

// ===== Query Builders =====
function buildDistinctQuery(field) {
  return { groupings: [{ inputField: field, type: "UNIQUE_VALUES", name: field }], range: { start: 0, length: DISTINCT_LIMIT } };
}
function buildFilterClause(applied) {
  const filters = [];
  for (const [field, set] of Object.entries(applied || {})) {
    const vals = Array.from(set || []);
    if (!vals.length) continue;
    const mapped = vals.map(v => (v === "(blank)" ? null : v));
    filters.push({ type: "FIELD_VALUE", inputField: field, operator: "IN", value: mapped });
  }
  if (!filters.length) return null;
  return { type: "AND", filters };
}
function buildTableRowsQuery(fieldsToReturn, applied, start, length) {
  const q = { fields: fieldsToReturn, range: { start, length } };
  const filter = buildFilterClause(applied);
  if (filter) q.filter = filter;
  return q;
}

// ===== Renderers =====
function renderFieldsDropdown() {
  clearChildren(el.fieldSelect);
  state.textFields.forEach(name => {
    const opt = document.createElement("option");
    opt.value = name; opt.textContent = name;
    el.fieldSelect.appendChild(opt);
  });
}

function renderFilterPanels(distinctsByField) {
  clearChildren(el.filterPanels);
  state.chosenFilterFields.forEach(field => {
    const wrap = document.createElement("div"); wrap.className = "group";
    const title = document.createElement("div"); title.textContent = field; title.style.fontWeight = "bold"; title.style.marginBottom = "4px";
    wrap.appendChild(title);

    const box = document.createElement("div"); box.className = "values";
    const values = toArray(distinctsByField[field]);
    if (!values.length) {
      const empty = document.createElement("div"); empty.textContent = "(no values)"; empty.style.color = "#666";
      box.appendChild(empty);
    } else {
      values.forEach(val => {
        const label = document.createElement("label"); label.className = "option";
        const input = document.createElement("input"); input.type = "checkbox"; input.value = String(val);
        input.checked = !!state.stagedSelections[field]?.has(String(val));
        input.addEventListener("change", () => {
          if (!state.stagedSelections[field]) state.stagedSelections[field] = new Set();
          if (input.checked) state.stagedSelections[field].add(String(val));
          else state.stagedSelections[field].delete(String(val));
        });
        const text = document.createElement("span"); text.textContent = (val === null ? "(blank)" : String(val));
        label.appendChild(input); label.appendChild(text); box.appendChild(label);
      });
    }
    wrap.appendChild(box);
    el.filterPanels.appendChild(wrap);
  });
}

function renderTable(schema, records, total) {
  clearChildren(el.tableContainer);
  const tbl = document.createElement("table");

  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  const fields = (schema?.fields || []).map(f => f.name);
  fields.forEach(n => { const th = document.createElement("th"); th.textContent = n; hr.appendChild(th); });
  thead.appendChild(hr); tbl.appendChild(thead);

  const tbody = document.createElement("tbody");
  (records || []).forEach(row => {
    const tr = document.createElement("tr");
    row.forEach(cell => {
      const td = document.createElement("td");
      td.textContent = (cell == null ? "" : String(cell));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  if (!records || !records.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = Math.max(1, fields.length); td.style.color = "#666"; td.textContent = "No rows.";
    tr.appendChild(td); tbody.appendChild(tr);
  }
  tbl.appendChild(tbody);
  el.tableContainer.appendChild(tbl);

  const start = state.pageStart;
  const length = state.pageSize;
  const countKnown = (typeof total === "number" && total >= 0) ? total : null;
  const shownFrom = records && records.length ? (start + 1) : 0;
  const shownTo = start + (records ? records.length : 0);
  if (countKnown != null) {
    el.pageInfo.textContent = `Rows ${shownFrom}–${shownTo} of ${countKnown}`;
    el.nextPageBtn.disabled = (start + length) >= countKnown;
  } else {
    el.pageInfo.textContent = `Rows ${shownFrom}–${shownTo}`;
    el.nextPageBtn.disabled = !records || records.length < length;
  }
  el.prevPageBtn.disabled = start <= 0;
}

// ===== High-level actions =====
async function loadSchema() {
  setStatus("Loading schema…");
  const json = await apiFetchSchema();
  state.schema = json;

  // Determine fields eligible for filters (prefer TEXT-like)
  const fields = (json?.fields || json?.schema?.fields || []);
  const textNames = [];
  fields.forEach(f => {
    const name = f?.name ?? f;
    const type = (f?.type || "").toString().toUpperCase();
    if (!name) return;
    if (!type || ["TEXT", "STRING", "VARCHAR"].includes(type)) textNames.push(name);
  });
  state.textFields = textNames.length ? textNames : fields.map(f => f?.name ?? f);

  // Reset selections
  state.chosenFilterFields = [];
  state.stagedSelections = {};
  state.appliedSelections = {};
  state.pageStart = 0;
  state.lastTableSchema = null;
  state.lastTotalRows = null;

  renderFieldsDropdown();
  clearChildren(el.filterPanels);
  setStatus("Schema loaded. Data loaded below.");
}

async function fetchDistinctsForChosenFields() {
  if (!state.chosenFilterFields.length) { clearChildren(el.filterPanels); return; }
  setStatus("Loading distinct values…");

  const batch = {};
  state.chosenFilterFields.forEach(f => batch[f] = buildDistinctQuery(f));

  let distincts = {};
  try {
    const res = await apiPostBatch(batch);
    const results = res?.results || res || {};
    state.chosenFilterFields.forEach(f => {
      const r = results[f];
      const vals = (r?.records || []).map(rec => rec?.[0] ?? rec);
      distincts[f] = vals.map(v => v === null ? "(blank)" : v);
    });
  } catch (e) {
    // Fallback sequential
    distincts = {};
    for (const f of state.chosenFilterFields) {
      try {
        const r = await apiPostTable(buildDistinctQuery(f));
        const vals = (r?.records || []).map(rec => rec?.[0] ?? rec);
        distincts[f] = vals.map(v => v === null ? "(blank)" : v);
      } catch { distincts[f] = []; }
    }
  }

  // keep staged selections that still exist
  const nextStaged = {};
  state.chosenFilterFields.forEach(f => {
    const allowed = new Set((distincts[f] || []).map(String));
    const old = state.stagedSelections[f] || new Set();
    nextStaged[f] = new Set(Array.from(old).filter(v => allowed.has(String(v))));
  });
  state.stagedSelections = nextStaged;

  renderFilterPanels(distincts);
  setStatus("Values loaded. Tick checkboxes then Apply filters.");
}

async function fetchAndRenderTable() {
  // decide display fields from schema
  const fields = (state.schema?.fields || state.schema?.schema?.fields || []).map(f => f?.name ?? f);
  const body = buildTableRowsQuery(fields, state.appliedSelections, state.pageStart, state.pageSize);

  setStatus("Loading data…");
  const data = await apiPostTable(body);

  const schema = data?.schema || data?.table?.schema || { fields: (data?.fields || []).map(n => ({ name: n })) };
  const records = data?.records || data?.table?.records || [];
  const total = data?.total ?? data?.totalRecords ?? data?.count ?? (typeof data?.range?.total === "number" ? data.range.total : null);

  state.lastTableSchema = schema;
  state.lastTotalRows = (typeof total === "number" ? total : null);

  renderTable(schema, records, state.lastTotalRows);
  setStatus("");
}

// ===== Events =====
el.loadBtn.addEventListener("click", async () => {
  const ep = (el.endpoint.value || "").trim();
  if (!ep) { setStatus("Please enter an endpoint."); return; }

  // Full reset
  state.endpoint = ep;
  state.schema = null;
  state.textFields = [];
  state.chosenFilterFields = [];
  state.stagedSelections = {};
  state.appliedSelections = {};
  state.pageStart = 0;
  state.lastTableSchema = null;
  state.lastTotalRows = null;

  clearChildren(el.fieldSelect);
  clearChildren(el.filterPanels);
  clearChildren(el.tableContainer);
  el.pageInfo.textContent = "";
  el.prevPageBtn.disabled = true; el.nextPageBtn.disabled = true;

  try {
    await loadSchema();         // load fields
    await fetchAndRenderTable(); // ⬅ show table immediately (no filters)
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e.message || e}`);
  }
});

// Show fields → fetch distincts (no data fetch yet)
el.showFieldsBtn.addEventListener("click", async () => {
  const selected = Array.from(el.fieldSelect.selectedOptions).map(o => o.value);
  if (selected.length > MAX_FILTER_FIELDS) {
    setStatus(`Please select up to ${MAX_FILTER_FIELDS} fields.`); return;
  }
  state.chosenFilterFields = selected;

  // prune staged/applied to selected fields
  const nextStaged = {}; selected.forEach(f => { nextStaged[f] = state.stagedSelections[f] || new Set(); });
  state.stagedSelections = nextStaged;

  // do not auto-apply filter selections; user will click "Apply filters"
  try {
    await fetchDistinctsForChosenFields();
  } catch (e) {
    console.error(e);
    setStatus(`Error loading values: ${e.message || e}`);
  }
});

// Apply filters → table refresh
el.applyFiltersBtn.addEventListener("click", async () => {
  state.appliedSelections = cloneSelections(state.stagedSelections);
  state.pageStart = 0;
  try {
    await fetchAndRenderTable();
  } catch (e) {
    console.error(e);
    setStatus(`Error loading data: ${e.message || e}`);
  }
});

// Paging
el.prevPageBtn.addEventListener("click", async () => {
  state.pageStart = Math.max(0, state.pageStart - state.pageSize);
  try { await fetchAndRenderTable(); } catch (e) { setStatus(`Error: ${e.message || e}`); }
});
el.nextPageBtn.addEventListener("click", async () => {
  state.pageStart += state.pageSize;
  try { await fetchAndRenderTable(); } catch (e) { setStatus(`Error: ${e.message || e}`); }
});

// Enter key convenience
el.endpoint.addEventListener("keydown", e => { if (e.key === "Enter") el.loadBtn.click(); });
