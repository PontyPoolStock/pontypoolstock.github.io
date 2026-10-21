import renderPagination, { paginateData } from "../components/pagination.js";
import { fetchData, postData, updateData, deleteData, hydrateEntityImages, PRODUCT_LIST_FIELDS } from "../services/api.js";
//* debounce is required by setupEventListeners below — forgetting it here
//* loaded the page and then threw ReferenceError, which the router showed as
//* "Shop Purchases could not be loaded". scripts/reseller-page.test.mjs now
//* executes this module in jsdom so that failure mode can't ship again.
import { escapeHtml, formatCurrency, GetCurrentDate, debounce, productThumbnailHtml } from "../utils/helpers.js";
import { showToast, confirmAction } from "../components/toast.js";
import { isStaffView } from "../utils/role.js";

let purchases = [];
let products = [];
let sales = [];
let lastFiltered = [];
let currentPage = 1;
let PAGE_SIZE = 5;
//* While a purchase row is being edited, its id is held here and the form at
//* the top doubles as the edit form — the submit handler PUTs instead of POSTs.
let editingId = null;

export async function loadResellerPurchases() {
  await loadData();
  lastFiltered = [...purchases];
  renderPage();
  setupEventListeners();
}

async function loadData(opts = {}) {
  const fresh = opts.fresh ? { fresh: true } : undefined;
  const pd = await fetchData("resellerPurchases", fresh);
  const pr = await fetchData("products?fields=" + PRODUCT_LIST_FIELDS);
  const sl = await fetchData("sales");
  purchases = Array.isArray(pd) ? [...pd] : [];
  purchases.sort((a, b) => new Date(b.purchasedAt || b.createdAt) - new Date(a.purchasedAt || a.createdAt));
  products = Array.isArray(pr) ? pr.filter((p) => isOnOrder(p)) : [];
  sales = Array.isArray(sl) ? sl : [];
}

function isOnOrder(p) {
  if (!p) return false;
  const v = p.notStocked !== undefined ? p.notStocked : p.not_stocked;
  return v === true || v === 1 || v === "1" || v === "t" || v === "true";
}

export function purchaseTotalCost(item) {
  const line = Number(item.totalCost !== undefined ? item.totalCost : item.total_cost);
  if (Number.isFinite(line) && line > 0) return line;
  const q = Number(item.quantity) || 0;
  const u = Number(item.unitCost !== undefined ? item.unitCost : item.unit_cost) || 0;
  return q * u;
}

function resellerKey(productId, variantIndex) {
  const v = variantIndex === null || variantIndex === undefined || variantIndex === "" ? "" : String(variantIndex);
  return String(productId || "") + "::" + v;
}

function stockMap() {
  const bought = {};
  const sold = {};
  for (const item of purchases) {
    const k = resellerKey(item.productId, item.variantIndex);
    bought[k] = (bought[k] || 0) + (Number(item.quantity) || 0);
  }
  for (const s of sales) {
    const k = resellerKey(s.productId, s.variantIndex);
    sold[k] = (sold[k] || 0) + (Number(s.quantity) || 0);
  }
  const left = {};
  for (const k of Object.keys(bought)) left[k] = bought[k] - (sold[k] || 0);
  return { bought, sold, left };
}

function displayName(p) {
  if (!p) return "";
  const n = String(p.name || "").trim();
  if (n) return n;
  return "Product";
}
function renderPage() {
  const maps = stockMap();
  let onHand = 0;
  const keys = Object.keys(maps.left);
  for (let i = 0; i < keys.length; i++) onHand += Number(maps.left[keys[i]]) || 0;
  let spent = 0;
  let boughtUnits = 0;
  for (let i = 0; i < purchases.length; i++) {
    spent += purchaseTotalCost(purchases[i]);
    boughtUnits += Number(purchases[i].quantity) || 0;
  }
  let options = '<option value="">Select product</option>';
  for (let i = 0; i < products.length; i++) {
    options += '<option value="' + products[i].id + '">' + escapeHtml(displayName(products[i])) + "</option>";
  }
  //* The dropdown only lists On-order products on purpose: Shop Purchases
  //* tracks bought-for-resale stock that is separate from products.quantity.
  //* Say so when the list is empty instead of showing a mysteriously blank
  //* select — the checkbox lives on the Products add/edit form.
  const emptyListHint = products.length
    ? ""
    : '<div class="form-text text-warning">No resale products have been marked yet. '
      + "Go to Products, add or edit a product, and select Resale product — it will then appear here.</div>";
  let html = "";
  html += '<section class="sale-hero"><div class="sale-hero-text">';
  html += '<span class="statistics-kicker">Bought for resale</span><h3>Shop purchases</h3>';
  html += "<p>Record what you bought from other shops to sell on. Separate from your own stock.</p></div>";
  html += '<div class="sale-hero-stats">';
  html += '<div class="sale-hero-stat"><span>Bought units</span><strong>' + boughtUnits.toLocaleString("en-US") + "</strong></div>";
  html += '<div class="sale-hero-stat"><span>Reseller stock left</span><strong>' + onHand.toLocaleString("en-US") + "</strong></div>";
  html += '<div class="sale-hero-stat"><span>Spent on stock</span><strong>' + formatCurrency(spent) + "</strong></div>";
  html += "</div></section>";
  html += '<div class="card border-0 shadow-sm mb-3"><div class="card-body">';
  html += '<form id="resellerPurchaseForm" novalidate><div class="row g-2 align-items-end">';
  html += '<div class="col-12 col-md-4"><label class="form-label small text-muted" for="resellerProductSelect">Resale product</label>';
  html += '<select id="resellerProductSelect" class="form-select">' + options + "</select>";
  html += emptyListHint;
  html += '<div class="text-danger small errorMes-product"></div>';
  //* Same "summary pic" as Record Sale — a thumbnail + name card under the
  //* dropdown so the right product is obvious before money changes hands.
  html += '<div id="resellerProductPreview" class="sale-product-preview d-none" aria-live="polite"></div></div>';
  html += '<div class="col-12 col-md-3 d-none" id="resellerVariantWrapper"><label class="form-label small text-muted" for="resellerVariantSelect">Rating</label>';
  html += '<select id="resellerVariantSelect" class="form-select"></select></div>';
  html += '<div class="col-6 col-md-2"><label class="form-label small text-muted" for="resellerQuantity">Qty bought</label>';
  html += '<input type="number" id="resellerQuantity" class="form-control" min="1" step="1" placeholder="0">';
  html += '<div class="text-danger small errorMes-quantity"></div></div>';
  html += '<div class="col-6 col-md-2"><label class="form-label small text-muted" for="resellerUnitCost">Buy price (each)</label>';
  html += '<input type="number" id="resellerUnitCost" class="form-control" min="0" step="0.01" placeholder="0.00">';
  html += '<div class="text-danger small errorMes-unitCost"></div></div>';
  html += '<div class="col-6 col-md-3"><label class="form-label small text-muted" for="resellerShopName">Shop bought from</label>';
  html += '<input type="text" id="resellerShopName" class="form-control">';
  html += '<div class="text-danger small errorMes-shopName"></div></div>';
  html += '<div class="col-6 col-md-3"><label class="form-label small text-muted" for="resellerEmployeeName">'
    + (isStaffView() ? "Employee" : "Who went") + "</label>";
  html += '<input type="text" id="resellerEmployeeName" class="form-control" placeholder="Employee name">';
  html += '<div class="text-danger small errorMes-employeeName"></div></div>';
  html += '<div class="col-12 col-md-1 d-grid"><button type="submit" class="btn btn-primary" id="resellerSaveBtn">Add</button>'
    + '<button type="button" class="btn btn-outline-secondary mt-1 d-none" id="resellerCancelEdit">Cancel</button></div>';
  html += '</div><div id="resellerFormAlert" class="mt-2"></div>';
  html += "</form></div></div>";
  html += '<div class="d-flex gap-2 mb-3 align-items-center flex-wrap p-3 bg-white rounded border page-filter-bar">';
  html += '<i class="bi bi-search text-muted d-none d-sm-block"></i>';
  html += '<input type="text" id="searchReseller" placeholder="Search purchases..." class="form-control form-control-sm border-0 shadow-none" style="flex:1; min-width:150px;">';
  html += '<div id="resellerTableContainer" class="w-100 mt-2">' + getTableHtml() + "</div></div>";
  html += '<div id="searchStats" class="mb-2 small text-muted"></div>';
  document.getElementById("pageContent").innerHTML = html;
  paintProductPreview();
}

function variantList(product) {
  if (!product) return [];
  try {
    const raw = product.variants;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string" && raw.trim()) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) { void e; }
  return [];
}

function variantLabel(product, index) {
  const list = variantList(product);
  const v = list[Number(index)];
  if (!v) return "";
  const bits = [];
  if (v.label) bits.push(String(v.label));
  if (v.colour || v.color) bits.push(String(v.colour || v.color));
  if (v.amps !== "" && v.amps !== null && v.amps !== undefined) bits.push(String(v.amps) + "A");
  const name = bits.join(" - ");
  return name || ("Rating " + (Number(index) + 1));
}

function getTableHtml(list) {
  const canDeletePurchases = !isStaffView();
  const rows = list || lastFiltered;
  const paged = paginateData(rows, currentPage, PAGE_SIZE);
  const maps = stockMap();
  let body = "";
  for (let i = 0; i < paged.length; i++) {
    const item = paged[i];
    const k = resellerKey(item.productId, item.variantIndex);
    const left = maps.left[k] !== undefined ? maps.left[k] : (Number(item.quantity) || 0);
    let product = null;
    for (let j = 0; j < products.length; j++) {
      if (String(products[j].id) === String(item.productId)) product = products[j];
    }
    const vLabel = product ? variantLabel(product, item.variantIndex) : "";
    const badge = left <= 0 ? "status-out" : "status-in";
    body += "<tr><td class='small text-muted'>" + escapeHtml(dateOnly(item.purchasedAt || item.createdAt)) + "</td>";
    body += "<td>" + escapeHtml(String(item.productName || "Product")) + (vLabel ? "<div class='small text-muted'>" + escapeHtml(vLabel) + "</div>" : "") + "</td>";
    body += "<td>" + (Number(item.quantity) || 0) + "</td>";
    body += "<td>" + formatCurrency(item.unitCost !== undefined ? item.unitCost : item.unit_cost) + "</td>";
    body += "<td class='text-end fw-semibold'>" + formatCurrency(purchaseTotalCost(item)) + "</td>";
    body += "<td>" + escapeHtml(String(item.shopName || item.shop_name || "—")) + "</td>";
    body += "<td>" + escapeHtml(String(item.employeeName || item.employee_name || "—")) + "</td>";
    body += "<td><span class='status-badge " + badge + "'>" + left + "</span></td>";
    body += "<td class='text-end'><div class='d-flex gap-1 justify-content-end'>"
      + "<button class='btn btn-sm btn-outline-primary reseller-edit' data-id='" + item.id + "'>Edit</button>"
      + (canDeletePurchases
        ? "<button class='btn btn-sm btn-outline-danger reseller-delete' data-id='" + item.id + "'>Delete</button>"
        : "")
      + "</div></td></tr>";
  }
  if (!body) {
    return '<div class="statistics-empty"><span>No shop purchases yet — record what you bought above.</span></div>'
      + renderPagination(0, 1, PAGE_SIZE);
  }
  let table = '<div class="table-responsive"><table class="table align-middle mb-0"><thead>';
  table += "<tr><th>Date</th><th>Product</th><th>Bought</th><th>Buy price</th><th class='text-end'>Total spent</th><th>Shop</th><th>Employee</th><th>Stock left</th>"
    + "<th></th></tr>";
  table += "</thead><tbody>" + body + "</tbody></table></div>";
  return table + renderPagination(rows.length, currentPage, PAGE_SIZE);
}

function dateOnly(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-CA");
}

//* Put a recorded purchase back into the form for editing. The same form adds
//* new purchases, so entering edit mode just swaps the button label and shows
//* Cancel — handleSave then PUTs the change instead of POSTing a new row.
function handleEdit(id) {
  let item = null;
  for (let i = 0; i < purchases.length; i++) {
    if (String(purchases[i].id) === String(id)) item = purchases[i];
  }
  if (!item) {
    showToast("That purchase is no longer in the list.", "warning");
    return;
  }
  //* The dropdown only lists On-order products, so an edit can only target a
  //* product still in it — otherwise the form would silently save a different
  //* product id than the row being edited.
  const pid = String(item.productId || "");
  let product = null;
  for (let i = 0; i < products.length; i++) {
    if (String(products[i].id) === pid) product = products[i];
  }
  if (!product) {
    showToast("This product is no longer marked as a resale product, so the purchase cannot be edited.", "warning");
    return;
  }
  editingId = item.id;
  const prodSel = document.getElementById("resellerProductSelect");
  if (prodSel) prodSel.value = pid;
  fillVariants();
  const varSel = document.getElementById("resellerVariantSelect");
  if (varSel && item.variantIndex !== null && item.variantIndex !== undefined) {
    for (let i = 0; i < varSel.options.length; i++) {
      if (varSel.options[i].value === String(item.variantIndex)) { varSel.selectedIndex = i; break; }
    }
  }
  const qtyInput = document.getElementById("resellerQuantity");
  if (qtyInput) qtyInput.value = String(item.quantity === undefined || item.quantity === null ? "" : item.quantity);
  const unitVal = item.unitCost !== undefined ? item.unitCost : item.unit_cost;
  const unitInput = document.getElementById("resellerUnitCost");
  if (unitInput) unitInput.value = unitVal === undefined || unitVal === null ? "" : String(unitVal);
  const shopInput = document.getElementById("resellerShopName");
  if (shopInput) shopInput.value = String(item.shopName || item.shop_name || "");
  const empInput = document.getElementById("resellerEmployeeName");
  if (empInput) empInput.value = String(item.employeeName || item.employee_name || "");
  const errs = document.querySelectorAll("#resellerPurchaseForm .errorMes-product, #resellerPurchaseForm .errorMes-quantity, #resellerPurchaseForm .errorMes-unitCost");
  for (let i = 0; i < errs.length; i++) errs[i].textContent = "";
  const btn = document.getElementById("resellerSaveBtn");
  if (btn) btn.textContent = "Save";
  const cancel = document.getElementById("resellerCancelEdit");
  if (cancel) cancel.classList.remove("d-none");
  paintProductPreview();
  const form = document.getElementById("resellerPurchaseForm");
  if (form && form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "center" });
  if (qtyInput) qtyInput.focus();
}

//* Leave edit mode without touching the server — the form resets to its
//* add-a-purchase state (label back to Add, Cancel hidden).
function resetEditState() {
  editingId = null;
  const form = document.getElementById("resellerPurchaseForm");
  if (form) form.reset();
  const btn = document.getElementById("resellerSaveBtn");
  if (btn) btn.textContent = "Add";
  const cancel = document.getElementById("resellerCancelEdit");
  if (cancel) cancel.classList.add("d-none");
  const alertBox = document.getElementById("resellerFormAlert");
  if (alertBox) alertBox.innerHTML = "";
  fillVariants();
  paintProductPreview();
}

function setupEventListeners() {
  const search = document.getElementById("searchReseller");
  if (search) search.addEventListener("input", debounce(filterPurchases, 120));
  const prodSel = document.getElementById("resellerProductSelect");
  if (prodSel) prodSel.addEventListener("change", function () { fillVariants(); paintProductPreview(); });
  const varSel = document.getElementById("resellerVariantSelect");
  if (varSel) varSel.addEventListener("change", paintProductPreview);
  const form = document.getElementById("resellerPurchaseForm");
  if (form) form.addEventListener("submit", handleSave);
  const cancel = document.getElementById("resellerCancelEdit");
  if (cancel) cancel.addEventListener("click", resetEditState);
  const box = document.getElementById("resellerTableContainer");
  if (box) {
    box.addEventListener("click", function (event) {
      const pageBtn = event.target.closest ? event.target.closest(".page-link") : null;
      if (pageBtn) {
        const page = Number(pageBtn.dataset.page);
        const total = Math.ceil(lastFiltered.length / PAGE_SIZE);
        if (page >= 1 && page <= total) {
          currentPage = page;
          document.getElementById("resellerTableContainer").innerHTML = getTableHtml(lastFiltered);
        }
        return;
      }
      const edit = event.target.closest ? event.target.closest(".reseller-edit") : null;
      if (edit) { handleEdit(edit.dataset.id); return; }
      const del = event.target.closest ? event.target.closest(".reseller-delete") : null;
      if (del) handleDelete(del.dataset.id);
    });
    box.addEventListener("change", function (event) {
      const sel = event.target.closest ? event.target.closest(".page-size-select") : null;
      if (!sel) return;
      PAGE_SIZE = Number(sel.value);
      currentPage = 1;
      document.getElementById("resellerTableContainer").innerHTML = getTableHtml(lastFiltered);
    });
  }
}

function fillVariants() {
  const prodSel = document.getElementById("resellerProductSelect");
  const wrap = document.getElementById("resellerVariantWrapper");
  const sel = document.getElementById("resellerVariantSelect");
  if (!prodSel || !wrap || !sel) return;
  let product = null;
  for (let i = 0; i < products.length; i++) {
    if (String(products[i].id) === String(prodSel.value)) product = products[i];
  }
  const list = variantList(product);
  if (!list.length) { wrap.classList.add("d-none"); sel.innerHTML = ""; return; }
  wrap.classList.remove("d-none");
  let html = "";
  for (let i = 0; i < list.length; i++) html += '<option value="' + i + '">' + escapeHtml(variantLabel(product, i)) + "</option>";
  sel.innerHTML = html;
}

//* The "summary pic" under the product dropdown — the same sale-product-preview
//* card Record Sale shows, so both pages identify products the same way. The
//* slim product list carries no imageUrl, so productThumbnailHtml emits a lazy
//* placeholder that hydrateEntityImages fills from the server in the background.
function paintProductPreview() {
  const box = document.getElementById("resellerProductPreview");
  if (!box) return;
  const pid = document.getElementById("resellerProductSelect")
    ? document.getElementById("resellerProductSelect").value : "";
  let product = null;
  for (let i = 0; i < products.length; i++) {
    if (String(products[i].id) === String(pid)) product = products[i];
  }
  if (!product) {
    box.innerHTML = "";
    box.classList.add("d-none");
    return;
  }
  const varSel = document.getElementById("resellerVariantSelect");
  const list = variantList(product);
  const vIdx = list.length && varSel && varSel.value !== "" ? varSel.value : "";
  const maps = stockMap();
  const k = resellerKey(pid, vIdx);
  const bits = [];
  if (list.length && vIdx !== "") bits.push(variantLabel(product, vIdx));
  bits.push((maps.bought[k] || 0) + " bought − " + (maps.sold[k] || 0) + " sold = " + (maps.left[k] || 0) + " left");
  box.innerHTML =
    productThumbnailHtml(product.imageUrl, displayName(product), { productId: product.id }) +
    '<span class="sale-product-preview-info"><strong>' + escapeHtml(displayName(product)) +
    "</strong><small>" + escapeHtml(bits.join(" · ")) + "</small></span>";
  box.classList.remove("d-none");
  hydrateEntityImages(box);
}

async function handleSave(event) {
  event.preventDefault();
  const errs = document.querySelectorAll("#resellerPurchaseForm .errorMes-product, #resellerPurchaseForm .errorMes-quantity, #resellerPurchaseForm .errorMes-unitCost");
  for (let i = 0; i < errs.length; i++) errs[i].textContent = "";
  const alertBox = document.getElementById("resellerFormAlert");
  if (alertBox) alertBox.innerHTML = "";
  const pid = document.getElementById("resellerProductSelect") ? document.getElementById("resellerProductSelect").value : "";
  const qty = Math.trunc(Number(document.getElementById("resellerQuantity") ? document.getElementById("resellerQuantity").value : ""));
  const unit = Number(document.getElementById("resellerUnitCost") ? document.getElementById("resellerUnitCost").value : "");
  let ok = true;
  if (!pid) { document.querySelector("#resellerPurchaseForm .errorMes-product").textContent = "Choose a product."; ok = false; }
  if (!Number.isFinite(qty) || qty <= 0) { document.querySelector("#resellerPurchaseForm .errorMes-quantity").textContent = "Enter how many you bought."; ok = false; }
  if (!Number.isFinite(unit) || unit < 0) { document.querySelector("#resellerPurchaseForm .errorMes-unitCost").textContent = "Enter the buy price (0 is fine)."; ok = false; }
  if (!ok) return;
  let product = null;
  for (let i = 0; i < products.length; i++) {
    if (String(products[i].id) === String(pid)) product = products[i];
  }
  if (!product) {
    document.querySelector("#resellerPurchaseForm .errorMes-product").textContent = "Choose a product.";
    return;
  }
  const list = variantList(product);
  const varSel = document.getElementById("resellerVariantSelect");
  const vIdx = list.length ? Number(varSel ? varSel.value : 0) : null;
  const total = Math.round(qty * (unit || 0) * 100) / 100;
  const shopName = String(document.getElementById("resellerShopName")?.value || "").trim();
  const employeeName = String(document.getElementById("resellerEmployeeName")?.value || "").trim();
  const body = {
    productId: product.id,
    productName: String(product.name || "Product"),
    variantIndex: list.length ? vIdx : null,
    quantity: qty, unitCost: unit || 0, totalCost: total,
    shopName, employeeName,
  };
  //* Editing sends only the fields the form shows — the original purchase
  //* date stays as recorded; adding stamps today's date on the new row.
  const wasEditing = editingId !== null && editingId !== undefined;
  const btn = document.getElementById("resellerSaveBtn");
  if (btn) btn.disabled = true;
  const result = wasEditing
    ? await updateData("resellerPurchases", editingId, body)
    : await postData("resellerPurchases", { ...body, purchasedAt: GetCurrentDate() });
  if (btn) btn.disabled = false;
  if (!result || result.error || result.id === undefined) {
    const reason = String((result && result.error) || (wasEditing
      ? "Unable to save the changes to this purchase."
      : "Unable to record this purchase."));
    if (alertBox) alertBox.innerHTML = '<div class="alert alert-danger py-2 mb-0">' + escapeHtml(reason) + "</div>";
    showToast(reason, "danger");
    return;
  }
  editingId = null;
  await loadData({ fresh: true });
  lastFiltered = [...purchases];
  currentPage = 1;
  renderPage();
  setupEventListeners();
  showToast((wasEditing ? "Purchase updated: " : "Purchase recorded: ")
    + qty + " x " + displayName(product) + " — " + formatCurrency(total) + " spent.", "success");
}

function filterPurchases() {
  const input = document.getElementById("searchReseller");
  const term = input ? String(input.value || "").toLowerCase() : "";
  const out = [];
  for (let i = 0; i < purchases.length; i++) {
    if (!term) { out.push(purchases[i]); continue; }
    const name = String(purchases[i].productName || "").toLowerCase();
    if (name.indexOf(term) !== -1) out.push(purchases[i]);
  }
  lastFiltered = out;
  currentPage = 1;
  const box = document.getElementById("resellerTableContainer");
  if (box) box.innerHTML = getTableHtml(out);
  const stats = document.getElementById("searchStats");
  if (stats) stats.textContent = term ? ("Found " + out.length + " purchase" + (out.length === 1 ? "" : "s")) : "";
}

async function handleDelete(id) {
  if (isStaffView()) return;
  let item = null;
  for (let i = 0; i < purchases.length; i++) {
    if (String(purchases[i].id) === String(id)) item = purchases[i];
  }
  if (!item) {
    showToast("That purchase is no longer in the list.", "warning");
    await loadData({ fresh: true });
    lastFiltered = [...purchases];
    const box = document.getElementById("resellerTableContainer");
    if (box) box.innerHTML = getTableHtml(lastFiltered);
    return;
  }
  const label = String(item.productName || "this purchase");
  const confirmed = await confirmAction({
    title: "Delete this purchase?",
    message: (Number(item.quantity) || 0) + " x " + label + " — " + formatCurrency(purchaseTotalCost(item)) + ". Sales stay as recorded.",
    confirmLabel: "Delete purchase", cancelLabel: "Keep it", tone: "danger",
  });
  if (!confirmed) return;
  const result = await deleteData("resellerPurchases", item.id);
  if (!result.ok) {
    if (result.status === 404) {
      showToast("That purchase is no longer on the server — the list has been refreshed.", "warning");
      await loadData({ fresh: true });
      lastFiltered = [...purchases];
      const box = document.getElementById("resellerTableContainer");
      if (box) box.innerHTML = getTableHtml(lastFiltered);
      return;
    }
    showToast(String(result.error || "Unable to delete this purchase."), "danger");
    return;
  }
  await loadData({ fresh: true });
  lastFiltered = [...purchases];
  renderPage();
  setupEventListeners();
  showToast("Purchase deleted — reseller stock updated.", "success");
}
