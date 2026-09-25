import renderPagination, { paginateData } from "../components/pagination.js";
import { fetchData, postData, updateData } from "../services/api.js";
import {
  escapeHtml,
  formatEGP,
  getProductVariants,
  getVariantsTotalQuantity,
  getVariantPrice,
} from "../utils/helpers.js";

let sales = [];
let products = [];
let lastFiltered = [];
let currentPage = 1;
let PAGE_SIZE = 5;
let isSubmitting = false;

export async function loadSales() {
  await loadData();
  lastFiltered = [...sales];
  renderSalesPage();
}

//* Sales and stock are separate sources on purpose: a recorded sale writes a
//* sales row and moves stock in one transaction, so both pages agree.
async function loadData() {
  const [saleData, productData] = await Promise.all([
    fetchData("sales"),
    fetchData("products"),
  ]);
  sales = (Array.isArray(saleData) ? saleData : [])
    .sort((a, b) => new Date(b.soldAt || b.createdAt) - new Date(a.soldAt || a.createdAt));
  products = Array.isArray(productData) ? productData : [];
}

function renderSalesPage() {
  const today = getSalesForLocalDay(sales);

  const productOptions = products
    .map((product) => {
      const variants = getProductVariants(product);
      const stock = variants.length
        ? getVariantsTotalQuantity(variants)
        : Number(product.quantity) || 0;
      const name = escapeHtml(product.name || "");
      return `<option value="${product.id}" ${stock <= 0 ? "disabled" : ""}>${name} — ${stock} in stock</option>`;
    })
    .join("");

  document.getElementById("pageContent").innerHTML = `
    <section class="sale-hero">
      <div class="sale-hero-text">
        <span class="statistics-kicker">Point of sale</span>
        <h3>Record a sale</h3>
        <p>Saves the sale, reduces that rating stock and updates Sales Today — all in one step.</p>
      </div>
      <div class="sale-hero-stats">
        <div class="sale-hero-stat">
          <span>Sales today</span>
          <strong>${formatEGP(getSalesTotal(today))}</strong>
        </div>
        <div class="sale-hero-stat">
          <span>Units today</span>
          <strong>${getSalesUnits(today).toLocaleString("en-US")}</strong>
        </div>
        <div class="sale-hero-stat">
          <span>All time</span>
          <strong>${formatEGP(getSalesTotal(sales))}</strong>
        </div>
      </div>
    </section>

    <section class="sale-form-card">
      <form id="recordSaleForm" novalidate>
        <div id="saleFormAlert" class="alert d-none mb-3" role="alert"></div>
        <div class="row g-3">
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleProductSelect">Product *</label>
            <select name="productId" id="saleProductSelect" class="form-select">
              <option value="">Select product</option>
              ${productOptions || "<option value=\"\" disabled>No products in stock</option>"}
            </select>
            <div class="text-danger fw-bold errorMes errorMes-productId"></div>
          </div>
          <div class="col-12 col-lg-6 d-none" id="saleVariantWrapper">
            <label class="form-label" for="saleVariantSelect">Rating *</label>
            <select name="variantIndex" id="saleVariantSelect" class="form-select"></select>
            <div class="text-danger fw-bold errorMes errorMes-variantIndex"></div>
          </div>
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleQuantity">Quantity *</label>
            <input type="number" name="quantity" id="saleQuantity" class="form-control" min="1" step="1" placeholder="1">
            <div class="text-danger fw-bold errorMes errorMes-quantity"></div>
          </div>
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleUnitPrice">Selling price (KSh) *</label>
            <input type="number" name="unitPrice" id="saleUnitPrice" class="form-control" min="0" step="0.01" placeholder="0.00">
            <div class="text-danger fw-bold errorMes errorMes-unitPrice"></div>
          </div>
        </div>

        <div class="sale-total-row">
          <div>
            <span class="sale-total-label">Sale total</span>
            <strong class="sale-total-value" id="saleTotalPreview">KSh 0</strong>
          </div>
          <button type="submit" class="btn btn-primary px-4" id="recordSaleBtn">
            <i class="bi bi-cash-coin"></i> Record Sale
          </button>
        </div>
        <div id="saleStockHint" class="small text-muted mt-2"></div>
      </form>
    </section>

    <div class="d-flex gap-2 mb-3 align-items-center flex-wrap p-3 bg-white rounded border page-filter-bar mt-3">
      <i class="bi bi-search text-muted d-none d-sm-block"></i>
      <input type="text" id="searchSales" placeholder="Search sales history..."
        class="form-control form-control-sm border-0 shadow-none" style="flex:1; min-width:150px;">
      <select id="salePeriodFilter" class="form-select form-select-sm border-0 shadow-none w-auto">
        <option value="">All Time</option>
        <option value="day">Today</option>
        <option value="week">Last 7 Days</option>
        <option value="month">Last 30 Days</option>
      </select>
    </div>

    <div id="salesHistoryStats" class="mb-2 small text-muted"></div>
    <div id="salesTableContainer">${getTableHtml(lastFiltered)}</div>
  `;

  setupEventListeners();
}

function getTableHtml(filteredList = lastFiltered) {
  const paginated = paginateData(filteredList, currentPage, PAGE_SIZE);

  if (!paginated.length) {
    return [
      '<div class="sale-history-empty">',
      '<i class="bi bi-receipt"></i>',
      '<div class="fw-semibold">No sales recorded yet</div>',
      '<small>Record your first sale above and it will appear here.</small>',
      '</div>',
    ].join("");
  }

  const rows = paginated
    .map((sale) => `
      <tr>
        <td class="text-nowrap">${escapeHtml(formatSaleDate(sale.soldAt || sale.createdAt))}</td>
        <td>${escapeHtml(sale.productName || "")}</td>
        <td class="text-end">${Number(sale.quantity) || 0}</td>
        <td class="text-end">${formatEGP(sale.unitPrice)}</td>
        <td class="text-end fw-semibold">${formatEGP(sale.total)}</td>
        <td class="text-end"><button class="action-btn sale-edit-btn" data-id="${sale.id}" title="Edit sale" aria-label="Edit sale"><i class="bi bi-pencil"></i></button></td>
      </tr>
    `)
    .join("");

  const cards = paginated
    .map((sale) => `
      <div class="bg-white border rounded p-3 shadow-sm sale-history-card">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="fw-semibold">${escapeHtml(sale.productName || "")}</div>
          <span class="badge rounded-pill sale-total-badge">${formatEGP(sale.total)}</span>
        </div>
        <small class="text-muted">${escapeHtml(formatSaleDate(sale.soldAt || sale.createdAt))}</small>
        <div class="d-flex gap-3 small mt-2">
          <span>${Number(sale.quantity) || 0} sold</span>
          <span class="text-muted">@${formatEGP(sale.unitPrice)} each</span>
        </div>
        <button class="btn btn-outline-secondary btn-sm mt-3 sale-edit-btn w-100" data-id="${sale.id}"><i class="bi bi-pencil"></i> Edit Sale</button>
      </div>
    `)
    .join("");

  return `
    <div class="table-responsive d-none d-md-block">
      <table class="table table-hover align-middle sale-history-table mb-0">
        <thead>
          <tr>
            <th>Date</th><th>Product</th><th class="text-end">Quantity</th>
            <th class="text-end">Price</th><th class="text-end">Total</th><th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="d-md-none d-flex flex-column gap-3 p-2">${cards}</div>
    ${renderPagination(filteredList.length, currentPage, PAGE_SIZE)}
  `;
}

function setupEventListeners() {
  const productSelect = document.getElementById("saleProductSelect");
  const variantSelect = document.getElementById("saleVariantSelect");
  const quantityInput = document.getElementById("saleQuantity");
  const priceInput = document.getElementById("saleUnitPrice");

  productSelect?.addEventListener("change", () => {
    populateVariantSelect(variantSelect);
    updatePriceDefault(priceInput);
    updateSalePreview();
  });
  variantSelect?.addEventListener("change", () => {
    updatePriceDefault(priceInput);
    updateSalePreview();
  });
  quantityInput?.addEventListener("input", updateSalePreview);
  priceInput?.addEventListener("input", updateSalePreview);

  document.getElementById("recordSaleForm")?.addEventListener("submit", handleRecordSale);
  document.getElementById("searchSales")?.addEventListener("input", filterSales);
  document.getElementById("salePeriodFilter")?.addEventListener("change", filterSales);

  const container = document.getElementById("salesTableContainer");
  container?.addEventListener("click", (event) => {
    const editBtn = event.target.closest(".sale-edit-btn");
    if (editBtn) {
      const sale = sales.find((item) => String(item.id) === editBtn.dataset.id);
      if (sale) openEditSaleModal(sale);
      return;
    }
    const pageBtn = event.target.closest(".page-link");
    if (!pageBtn) return;
    const totalPages = Math.ceil(lastFiltered.length / PAGE_SIZE);
    const page = Number(pageBtn.dataset.page);
    if (!Number.isFinite(page) || page < 1 || page > totalPages) return;
    currentPage = page;
    container.innerHTML = getTableHtml(lastFiltered);
  });
  container?.addEventListener("change", (event) => {
    const pageSizeSelect = event.target.closest(".page-size-select");
    if (!pageSizeSelect) return;
    PAGE_SIZE = Number(pageSizeSelect.value);
    currentPage = 1;
    container.innerHTML = getTableHtml(lastFiltered);
  });

  populateVariantSelect(variantSelect);
  updateSalePreview();
}

function getSelectedProduct() {
  const select = document.getElementById("saleProductSelect");
  if (!select?.value) return null;
  return products.find((product) => String(product.id) === select.value) || null;
}

//* Only in-stock ratings are offered, so an out-of-stock row can never be picked
function populateVariantSelect(variantSelect) {
  if (!variantSelect) return;
  const wrapper = document.getElementById("saleVariantWrapper");
  const product = getSelectedProduct();
  const variants = getProductVariants(product);

  if (!product || !variants.length) {
    wrapper?.classList.add("d-none");
    variantSelect.innerHTML = "";
    updateStockHint("");
    return;
  }

  const sellable = variants
    .map((variant, index) => ({ variant, index }))
    .filter(({ variant }) => (Number(variant.quantity) || 0) > 0);

  if (!sellable.length) {
    wrapper?.classList.remove("d-none");
    variantSelect.innerHTML = '<option value="">Out of stock</option>';
    updateStockHint("Every rating for this product is out of stock.");
    return;
  }

  wrapper?.classList.remove("d-none");
  variantSelect.innerHTML = sellable
    .map(({ variant, index }) => {
      const bits = [variant.label || `Row ${index + 1}`, variant.colour || ""]
        .filter(Boolean)
        .join(" - ");
      const stock = Number(variant.quantity) || 0;
      return `<option value="${index}">${escapeHtml(bits)} - ${stock} in stock</option>`;
    })
    .join("");

  const first = sellable[0].variant;
  updateStockHint(
    `${Number(first.quantity) || 0} available in "${first.label || "this rating"}".`,
  );
}

function getSelectedStock() {
  const product = getSelectedProduct();
  if (!product) return 0;
  const variants = getProductVariants(product);
  if (!variants.length) return Number(product.quantity) || 0;
  const index = Number.parseInt(
    String(document.getElementById("saleVariantSelect")?.value ?? ""),
    10,
  );
  const variant = Number.isNaN(index) ? undefined : variants[index];
  return variant ? Number(variant.quantity) || 0 : 0;
}

function updateStockHint(text) {
  const hint = document.getElementById("saleStockHint");
  if (hint) hint.textContent = text;
}

//* Prefill the selling price from the selected rating, but let staff override it
function updatePriceDefault(priceInput) {
  if (!priceInput) return;
  const product = getSelectedProduct();
  if (!product) {
    priceInput.value = "";
    return;
  }
  const variants = getProductVariants(product);
  if (variants.length) {
    const index = Number.parseInt(
      String(document.getElementById("saleVariantSelect")?.value ?? ""),
      10,
    );
    const variant = Number.isNaN(index) ? undefined : variants[index];
    priceInput.value = variant ? String(getVariantPrice(variant)) : "";
  } else {
    priceInput.value = String(Number(product.price) || 0);
  }
  priceInput.dispatchEvent(new Event("input", { bubbles: true }));
}

function updateSalePreview() {
  const quantity = Math.max(0, Number(document.getElementById("saleQuantity")?.value) || 0);
  const unitPrice = Math.max(0, Number(document.getElementById("saleUnitPrice")?.value) || 0);
  const preview = document.getElementById("saleTotalPreview");
  if (!preview) return;
  const next = formatEGP(quantity * unitPrice);
  if (preview.textContent === next) return;
  preview.textContent = next;
  //* A quick pop when the total changes makes the KSh figure feel live
  preview.classList.remove("bump");
  void preview.offsetWidth;
  preview.classList.add("bump");
}

async function handleRecordSale(event) {
  event.preventDefault();
  if (isSubmitting) return;

  const productId = document.getElementById("saleProductSelect")?.value || "";
  const quantity = Number(document.getElementById("saleQuantity")?.value);
  const unitPrice = Number(document.getElementById("saleUnitPrice")?.value);
  const variantSelect = document.getElementById("saleVariantSelect");
  const hasVariants = getProductVariants(getSelectedProduct()).length > 0;
  const variantIndex = hasVariants ? String(variantSelect?.value ?? "") : "";

  if (!isVaildSaleData({ productId, quantity, unitPrice, variantIndex, hasVariants })) return;

  const button = document.getElementById("recordSaleBtn");
  isSubmitting = true;
  if (button) {
    button.disabled = true;
    button.innerHTML =
      '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Saving...';
  }

  const result = await postData("sales", {
    productId,
    variantIndex: hasVariants ? Number(variantIndex) : null,
    quantity,
    unitPrice,
  });
  isSubmitting = false;

  if (!result || result.error) {
    showSaleFormMessage(result?.error || "Unable to record this sale. Please try again.", "danger");
    if (button) {
      button.disabled = false;
      button.innerHTML = '<i class="bi bi-cash-coin"></i> Record Sale';
    }
    return;
  }

  //* Re-fetch so the history, the KSh totals and stock all reflect the sale
  await loadData();
  lastFiltered = [...sales];
  currentPage = 1;
  renderSalesPage();
  showSaleFormMessage(
    `Sale recorded: ${quantity} x ${result.productName || "product"} - ${formatEGP(result.total)}`,
    "success",
  );
}

function isVaildSaleData({ productId, quantity, unitPrice, variantIndex, hasVariants }) {
  document.querySelectorAll(".errorMes").forEach((item) => { item.textContent = ""; });
  let valid = true;

  if (!productId) {
    setSaleError("productId", "Product is required");
    valid = false;
  }
  if (hasVariants && variantIndex === "") {
    setSaleError("variantIndex", "Select the rating being sold");
    valid = false;
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    setSaleError("quantity", "Quantity must be a whole number greater than 0");
    valid = false;
  } else {
    const available = getSelectedStock();
    if (quantity > available) {
      setSaleError("quantity", `Only ${available} in stock`);
      valid = false;
    }
  }
  const priceRaw = String(document.getElementById("saleUnitPrice")?.value ?? "").trim();
  if (priceRaw === "") {
    setSaleError("unitPrice", "Selling price is required");
    valid = false;
  } else if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    setSaleError("unitPrice", "Selling price must be 0 or more");
    valid = false;
  }
  return valid;
}

function setSaleError(field, message) {
  const target = document.querySelector(`.errorMes-${field}`);
  if (target) target.textContent = message;
}

function showSaleFormMessage(message, tone) {
  const alert = document.getElementById("saleFormAlert");
  if (!alert) return;
  const icon = tone === "success" ? "check-circle-fill" : "exclamation-triangle-fill";
  alert.className = `alert alert-${tone} sale-form-alert`;
  alert.innerHTML = `<i class="bi bi-${icon} me-2"></i>${escapeHtml(message)}`;
}

function openEditSaleModal(sale) {
  document.getElementById("editSaleModal")?.remove();

  const productOptions = products
    .map((product) => {
      const variants = getProductVariants(product);
      const stock = variants.length
        ? getVariantsTotalQuantity(variants)
        : Number(product.quantity) || 0;
      const sold = String(product.id) === String(sale.productId);
      return `<option value="${product.id}" ${stock <= 0 && !sold ? "disabled" : ""}>${escapeHtml(product.name || "")} - ${stock} in stock</option>`;
    })
    .join("");

  const html = `
    <div class="modal fade" id="editSaleModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h4>Edit Sale</h4></div>
          <div class="modal-body">
            <form id="editSaleForm" novalidate>
              <div id="editSaleAlert" class="alert d-none mb-3" role="alert"></div>
              <div class="mb-3">
                <label class="form-label" for="editSaleProductSelect">Product *</label>
                <select name="productId" id="editSaleProductSelect" class="form-select">
                  <option value="">Select product</option>
                  ${productOptions}
                </select>
                <div class="text-danger fw-bold errorMes errorMes-productId"></div>
              </div>
              <div class="mb-3 d-none" id="editSaleVariantWrapper">
                <label class="form-label" for="editSaleVariantSelect">Rating *</label>
                <select name="variantIndex" id="editSaleVariantSelect" class="form-select"></select>
                <div class="text-danger fw-bold errorMes errorMes-variantIndex"></div>
              </div>

              <div class="row mb-3">
                <div class="col-6">
                  <label class="form-label" for="editSaleQuantity">Quantity *</label>
                  <input type="number" min="1" step="1" id="editSaleQuantity" class="form-control" value="${Number(sale.quantity) || 1}">
                  <div class="text-danger fw-bold errorMes errorMes-quantity"></div>
                </div>
                <div class="col-6">
                  <label class="form-label" for="editSaleUnitPrice">Selling price (KSh) *</label>
                  <input type="number" min="0" step="0.01" id="editSaleUnitPrice" class="form-control" value="${Number(sale.unitPrice) || 0}">
                  <div class="text-danger fw-bold errorMes errorMes-unitPrice"></div>
                </div>
              </div>
              <div class="small text-muted">
                <i class="bi bi-info-circle"></i>
                Saving returns the original stock and takes the corrected amount.
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" id="editSaleSaveBtn"><i class="bi bi-check-lg"></i> Save Changes</button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML("beforeend", html);
  const modalEl = document.getElementById("editSaleModal");
  const modal = new bootstrap.Modal(modalEl);
  modal.show();
  modalEl.addEventListener("hidden.bs.modal", () => modalEl.remove());

  const productSelect = document.getElementById("editSaleProductSelect");
  const variantSelect = document.getElementById("editSaleVariantSelect");
  const priceInput = document.getElementById("editSaleUnitPrice");

  //* Preselect exactly what was sold
  productSelect.value = String(sale.productId ?? "");
  populateEditVariantSelect(variantSelect, sale.variantIndex);
  if (!priceInput.value) priceInput.value = String(Number(sale.unitPrice) || 0);

  const applyRatingPrice = () => {
    const product = products.find((item) => String(item.id) === productSelect.value);
    const variants = getProductVariants(product);
    if (variants.length) {
      const picked = variants[Number(variantSelect.value) || 0];
      priceInput.value = String(Number(picked?.price) || 0);
    } else {
      priceInput.value = String(Number(product?.price) || 0);
    }
  };
  productSelect.addEventListener("change", () => {
    populateEditVariantSelect(variantSelect, null);
    applyRatingPrice();
  });
  variantSelect.addEventListener("change", applyRatingPrice);


  document.getElementById("editSaleSaveBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const productId = productSelect.value;
    const quantity = Number(document.getElementById("editSaleQuantity").value);
    const unitPrice = Number(priceInput.value);
    const product = products.find((item) => String(item.id) === productId);
    const hasVariants = getProductVariants(product).length > 0;
    const variantIndex = hasVariants ? String(variantSelect.value ?? "") : "";

    document.querySelectorAll("#editSaleModal .errorMes").forEach((item) => { item.textContent = ""; });
    let valid = true;
    if (!productId) { setEditError("productId", "Product is required"); valid = false; }
    if (hasVariants && variantIndex === "") { setEditError("variantIndex", "Select the rating being sold"); valid = false; }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setEditError("quantity", "Quantity must be a whole number greater than 0");
      valid = false;
    }
    const priceRaw = String(priceInput.value).trim();
    if (priceRaw === "" || !Number.isFinite(unitPrice) || unitPrice < 0) {
      setEditError("unitPrice", "Selling price must be 0 or more");
      valid = false;
    }
    if (!valid) return;

    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Saving...';

    const result = await updateData(`sales/${sale.id}`, sale.id, {
      productId,
      variantIndex: hasVariants ? Number(variantIndex) : null,
      quantity,
      unitPrice,
    });

    if (!result || result.error) {
      button.disabled = false;
      button.innerHTML = '<i class="bi bi-check-lg"></i> Save Changes';
      showEditSaleMessage(result?.error || "Unable to update this sale.", "danger");
      return;
    }

//* Editing must be able to re-pick the original rating even when it is now sold
//* out, otherwise a sale could never be corrected back to what it was.
function populateEditVariantSelect(variantSelect, preferredIndex) {
  const wrapper = document.getElementById("editSaleVariantWrapper");
  const product = products.find(
    (item) => String(item.id) === document.getElementById("editSaleProductSelect")?.value,
  );
  const variants = getProductVariants(product);

  if (!product || !variants.length) {
    wrapper?.classList.add("d-none");
    variantSelect.innerHTML = "";
    return;
  }

  wrapper?.classList.remove("d-none");
  variantSelect.innerHTML = variants
    .map((variant, index) => {
      const bits = [variant.label || `Row ${index + 1}`, variant.colour || ""].filter(Boolean).join(" - ");
      const stock = Number(variant.quantity) || 0;
      const out = stock <= 0 ? " (out of stock)" : ` - ${stock} in stock`;
      return `<option value="${index}">${escapeHtml(bits)}${out}</option>`;
    })
    .join("");

  const wanted = Number.parseInt(String(preferredIndex ?? ""), 10);
  variantSelect.value = Number.isNaN(wanted) ? "" : String(wanted);
  if (variantSelect.value === "" && variants.length) variantSelect.value = "0";
}

function setEditError(field, message) {
  const target = document.querySelector(`#editSaleModal .errorMes-${field}`);
  if (target) target.textContent = message;
}

function showEditSaleMessage(message, tone) {
  const alert = document.getElementById("editSaleAlert");
  if (!alert) return;
  const icon = tone === "success" ? "check-circle-fill" : "exclamation-triangle-fill";
  alert.className = `alert alert-${tone} sale-form-alert`;
  alert.innerHTML = `<i class="bi bi-${icon} me-2"></i>${escapeHtml(message)}`;
}


    modal.hide();
    //* Re-fetch so history, KSh totals and stock all reflect the edit
    await loadData();
    lastFiltered = [...sales];
    renderSalesPage();
  });
}

function filterSales() {
  const term = document.getElementById("searchSales").value.trim().toLowerCase();
  const period = document.getElementById("salePeriodFilter").value;

  lastFiltered = sales.filter((sale) => {
    if (term) {
      const matches = String(sale.productName || "").toLowerCase().includes(term)
        || String(sale.quantity || "").includes(term)
        || String(sale.total || "").includes(term);
      if (!matches) return false;
    }
    if (period && !isWithinPeriod(sale.soldAt || sale.createdAt, period)) return false;
    return true;
  });
  currentPage = 1;
  document.getElementById("salesTableContainer").innerHTML = getTableHtml(lastFiltered);
  document.getElementById("salesHistoryStats").textContent =
    term || period
      ? `${lastFiltered.length} sale${lastFiltered.length === 1 ? "" : "s"} - ${formatEGP(getSalesTotal(lastFiltered))}`
      : "";
}

function isWithinPeriod(dateValue, period) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return false;
  if (period === "day") {
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }
  const days = period === "week" ? 7 : 30;
  return date.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function getSalesForLocalDay(list) {
  return list.filter((sale) => isWithinPeriod(sale.soldAt || sale.createdAt, "day"));
}

function getSalesTotal(list) {
  return list.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
}

function getSalesUnits(list) {
  return list.reduce((sum, sale) => sum + (Number(sale.quantity) || 0), 0);
}

function formatSaleDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
