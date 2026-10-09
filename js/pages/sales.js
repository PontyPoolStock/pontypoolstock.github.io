import renderPagination, { paginateData } from "../components/pagination.js";
import {
  fetchData,
  postData,
  updateData,
  deleteData,
  PRODUCT_LIST_FIELDS,
  CATEGORY_LIST_FIELDS,
} from "../services/api.js";
import {
  escapeHtml,
  formatCurrency,
  getCategoryLabel,
  getProductVariants,
  getVariantsTotalQuantity,
  getVariantName,
  getVariantPrice,
  getProductDisplayName,
  describeApiError,
  debounce,
} from "../utils/helpers.js";
import { showToast, confirmAction } from "../components/toast.js";

let sales = [];
let products = [];
let categories = [];
let lastFiltered = [];
let currentPage = 1;
let PAGE_SIZE = 5;
let isSubmitting = false;
//* Staged sale lines: the form collects one line at a time, but everything in
//* here is recorded together on submit — so a till run can mix products from
//* as many categories as it likes without being recorded one by one.
let saleCart = [];
//* Category shown in the Product dropdown ("": every category). Module state so
//* the pick survives the full page repaints the history refreshes cause.
let saleCategoryFilter = "";

export async function loadSales() {
  await loadData();
  lastFiltered = [...sales];
  renderSalesPage();
}

//* Sales and stock are separate sources on purpose: a recorded sale writes a
//* sales row and moves stock in one transaction, so both pages agree.
//* `freshSales` bypasses the local cache — used when the list on screen has
//* just been proved wrong by the server, so we must ask it directly.
async function loadData({ freshSales = false, freshProducts = false } = {}) {
  const [saleData, productData, categoryData] = await Promise.all([
    fetchData("sales", freshSales ? { fresh: true } : undefined),
    fetchData(`products?fields=${PRODUCT_LIST_FIELDS}`, freshProducts ? { fresh: true } : undefined),
    //^ Slim projection — the Category dropdown only needs id + name, and the
    //^ shared cache key means it is already warm from Products/Categories.
    fetchData(`categories?fields=${CATEGORY_LIST_FIELDS}`),
  ]);
  sales = sortSales(Array.isArray(saleData) ? saleData : []);
  products = Array.isArray(productData) ? productData : [];
  categories = Array.isArray(categoryData) ? categoryData : [];
}

//* Newest first — shared with the background refresh so a repaint caused by
//* fresh data never reorders the table under the user's cursor.
function sortSales(list) {
  return [...list].sort(
    (a, b) => new Date(b.soldAt || b.createdAt) - new Date(a.soldAt || a.createdAt),
  );
}

function renderSalesPage() {
  const today = getSalesForLocalDay(sales);

  document.getElementById("pageContent").innerHTML = `
    <section class="sale-hero">
      <div class="sale-hero-text">
        <span class="statistics-kicker">Point of sale</span>
        <h3>Record a sale</h3>
        <p>Pick a category, choose products, add as many lines as you like — then record the whole basket in one step.</p>
      </div>
      <div class="sale-hero-stats">
        <div class="sale-hero-stat">
          <span>Sales today</span>
          <strong id="salesTodayTotal">${formatCurrency(getSalesTotal(today))}</strong>
        </div>
        <div class="sale-hero-stat">
          <span>Units today</span>
          <strong id="salesTodayUnits">${getSalesUnits(today).toLocaleString("en-US")}</strong>
        </div>
        <div class="sale-hero-stat">
          <span>All time</span>
          <strong id="salesAllTimeTotal">${formatCurrency(getSalesTotal(sales))}</strong>
        </div>
      </div>
    </section>

    <section class="sale-form-card">
      <form id="recordSaleForm" novalidate>
        <div id="saleFormAlert" class="alert d-none mb-3" role="alert"></div>
        <div class="row g-3">
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleCategorySelect">Category</label>
            <select id="saleCategorySelect" class="form-select">
              ${getCategoryOptionsHtml()}
            </select>
            <div class="small text-muted mt-1">Narrow the product list to one category.</div>
          </div>
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleProductSelect">Product *</label>
            <select name="productId" id="saleProductSelect" class="form-select">
              <option value="">Select product</option>
              ${getProductOptionsHtml()}
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

        <div class="d-flex gap-2 mt-3 align-items-center flex-wrap">
          <button type="button" class="btn btn-outline-primary px-4" id="addSaleLineBtn">
            <i class="bi bi-plus-lg"></i> Add to sale
          </button>
          <span class="small text-muted">Add products from as many categories as you need, then record them together below.</span>
        </div>

        <div class="sale-cart mt-3">
          <div class="sale-cart-head">
            <span class="sale-cart-title">Sale items <span id="saleCartCount"></span></span>
            <button type="button" class="btn btn-link btn-sm p-0 sale-cart-clear d-none" id="clearSaleCartBtn">Clear all</button>
          </div>
          <div id="saleCartList">${getCartHtml()}</div>
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
        <td>${escapeHtml(getProductDisplayName(sale.productName))}</td>
        <td class="text-end">${Number(sale.quantity) || 0}</td>
        <td class="text-end">${formatCurrency(sale.unitPrice)}</td>
        <td class="text-end fw-semibold">${formatCurrency(sale.total)}</td>
        <td class="text-end">
          <div class="d-inline-flex gap-1">
            <button class="action-btn sale-edit-btn" data-id="${sale.id}" title="Edit sale" aria-label="Edit sale"><i class="bi bi-pencil"></i></button>
            <button class="action-btn sale-delete-btn" data-id="${sale.id}" title="Delete sale" aria-label="Delete sale"><i class="bi bi-trash"></i></button>
          </div>
        </td>
      </tr>
    `)
    .join("");

  const cards = paginated
    .map((sale) => `
      <div class="bg-white border rounded p-3 shadow-sm sale-history-card">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="fw-semibold">${escapeHtml(getProductDisplayName(sale.productName))}</div>
          <span class="badge rounded-pill sale-total-badge">${formatCurrency(sale.total)}</span>
        </div>
        <small class="text-muted">${escapeHtml(formatSaleDate(sale.soldAt || sale.createdAt))}</small>
        <div class="d-flex gap-3 small mt-2">
          <span>${Number(sale.quantity) || 0} sold</span>
          <span class="text-muted">@${formatCurrency(sale.unitPrice)} each</span>
        </div>
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-outline-secondary btn-sm sale-edit-btn flex-grow-1" data-id="${sale.id}"><i class="bi bi-pencil"></i> Edit</button>
          <button class="btn btn-outline-danger btn-sm sale-delete-btn flex-grow-1" data-id="${sale.id}"><i class="bi bi-trash"></i> Delete</button>
        </div>
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

//* ===== Category → Product narrowing + multi-line sale basket =====

//* Sentinel for products filed under no category at all.
const UNCATEGORIZED_FILTER = "__none__";

//* Does this product fall under the category currently chosen in the form?
function categoryMatchesFilter(categoryId) {
  const hasCategory = categoryId !== "" && categoryId !== null && categoryId !== undefined;
  if (saleCategoryFilter === "") return true;
  if (saleCategoryFilter === UNCATEGORIZED_FILTER) return !hasCategory;
  return String(categoryId ?? "") === String(saleCategoryFilter);
}

function getFilteredProducts() {
  return products.filter((product) => categoryMatchesFilter(product.categoryId));
}

//* Category dropdown: everything, every category, plus "Uncategorized" only
//* when such products actually exist — an empty dead-end option helps nobody.
function getCategoryOptionsHtml() {
  const allOption = `<option value="" ${saleCategoryFilter === "" ? "selected" : ""}>All categories</option>`;
  const categoryOptions = categories
    .map(
      (category) =>
        `<option value="${escapeHtml(String(category.id))}" ${String(saleCategoryFilter) === String(category.id) ? "selected" : ""}>${escapeHtml(category.name)}</option>`,
    )
    .join("");
  const hasUncategorized = products.some((product) => !product.categoryId);
  const uncatOption =
    hasUncategorized
      ? `<option value="${UNCATEGORIZED_FILTER}" ${saleCategoryFilter === UNCATEGORIZED_FILTER ? "selected" : ""}>Uncategorized</option>`
      : "";
  return `${allOption}${categoryOptions}${uncatOption}`;
}

//* Product dropdown — filtered down to the chosen category, out-of-stock rows
//* still disabled so nothing unsellable can be staged.
function getProductOptionsHtml(selectedId = "") {
  const filtered = getFilteredProducts();
  if (!filtered.length) {
    return `<option value="" disabled>${saleCategoryFilter !== "" ? "No products in this category" : "No products in stock"}</option>`;
  }
  return filtered
    .map((product) => {
      const variants = getProductVariants(product);
      const stock = variants.length
        ? getVariantsTotalQuantity(variants)
        : Number(product.quantity) || 0;
      const name = escapeHtml(getProductDisplayName(product));
      const isSelected = String(product.id) === String(selectedId);
      return `<option value="${product.id}" ${isSelected ? "selected" : ""} ${stock <= 0 ? "disabled" : ""}>${name} — ${stock} in stock</option>`;
    })
    .join("");
}

//* Units of this product/rating already waiting in the basket — stock checks
//* must count them, or ten clicks of "Add" would each think they can sell all.
function getCartQuantityFor(productId, variantIndex) {
  return saleCart.reduce(
    (sum, line) =>
      String(line.productId) === String(productId)
      && (line.variantIndex ?? null) === (variantIndex ?? null)
        ? sum + line.quantity
        : sum,
    0,
  );
}

function getCartTotal() {
  return saleCart.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
}

function getCartHtml() {
  if (!saleCart.length) {
    return '<div class="sale-cart-empty">Nothing added yet — choose a category and product, set the quantity, then press <strong>Add to sale</strong>.</div>';
  }
  return saleCart
    .map((line, index) => {
      const product = products.find((item) => String(item.id) === String(line.productId));
      const variants = getProductVariants(product);
      const variant =
        line.variantIndex === null || line.variantIndex === undefined
          ? undefined
          : variants[line.variantIndex];
      const name = product
        ? getVariantName(product, variant)
        : String(line.productName || line.productId);
      const category = product ? getCategoryLabel(categories, product.categoryId) : "";
      const meta = [category, `${line.quantity} × ${formatCurrency(line.unitPrice)}`]
        .filter(Boolean)
        .join(" · ");
      return `
        <div class="sale-cart-line">
          <div class="sale-cart-line-info">
            <span class="sale-cart-line-name">${escapeHtml(name)}</span>
            <small class="sale-cart-line-meta">${escapeHtml(meta)}</small>
          </div>
          <span class="sale-cart-line-total">${formatCurrency(line.quantity * line.unitPrice)}</span>
          <button type="button" class="sale-line-remove" data-index="${index}" aria-label="Remove ${escapeHtml(name)} from this sale">
            <i class="bi bi-x-lg"></i>
          </button>
        </div>`;
    })
    .join("");
}

function renderCart() {
  const list = document.getElementById("saleCartList");
  if (list) list.innerHTML = getCartHtml();
  updateCartSummary();
}

//* Basket size, "Clear all" visibility and the Record button's label all move
//* together so the UI never claims a different number of sales than it will post.
function updateCartSummary() {
  const count = document.getElementById("saleCartCount");
  if (count) {
    count.textContent = saleCart.length
      ? `· ${saleCart.length} item${saleCart.length === 1 ? "" : "s"}`
      : "";
  }
  document
    .getElementById("clearSaleCartBtn")
    ?.classList.toggle("d-none", saleCart.length === 0);

  const button = document.getElementById("recordSaleBtn");
  if (button && !isSubmitting) {
    button.innerHTML = `<i class="bi bi-cash-coin"></i> ${
      saleCart.length > 1 ? `Record ${saleCart.length} Sales` : "Record Sale"
    }`;
  }
}

function handleCategoryChange() {
  const categorySelect = document.getElementById("saleCategorySelect");
  saleCategoryFilter = categorySelect?.value || "";

  const productSelect = document.getElementById("saleProductSelect");
  if (!productSelect) return;

  //* Keep the current product when it still lives under the new category —
  //* switching the filter must not throw away work already done.
  const previous = productSelect.value;
  productSelect.innerHTML = `<option value="">Select product</option>${getProductOptionsHtml(previous)}`;
  const stillVisible = Array.from(productSelect.options).some(
    (option) => option.value === previous,
  );

  if (!stillVisible) {
    productSelect.value = "";
    populateVariantSelect(document.getElementById("saleVariantSelect"));
    updatePriceDefault(document.getElementById("saleUnitPrice"));
  }
  updateSalePreview();
}

//* Stage the line the form is pointing at into the basket. The form then keeps
//* the product/price but clears the quantity, so the next item goes straight in.
function handleAddToCart() {
  if (isSubmitting) return false;

  const productId = document.getElementById("saleProductSelect")?.value || "";
  const quantity = Number(document.getElementById("saleQuantity")?.value);
  const unitPrice = Number(document.getElementById("saleUnitPrice")?.value);
  const variantSelect = document.getElementById("saleVariantSelect");
  const product = getSelectedProduct();
  const variants = getProductVariants(product);
  const hasVariants = variants.length > 0;
  const variantIndex = hasVariants ? String(variantSelect?.value ?? "") : "";

  if (!isValidSaleData({ productId, quantity, unitPrice, variantIndex, hasVariants })) {
    return false;
  }

  const resolvedVariantIndex = hasVariants ? Number(variantIndex) : null;
  saleCart.push({
    productId,
    variantIndex: resolvedVariantIndex,
    productName: getVariantName(
      product,
      resolvedVariantIndex === null ? undefined : variants[resolvedVariantIndex],
    ),
    quantity,
    unitPrice,
  });

  const quantityInput = document.getElementById("saleQuantity");
  if (quantityInput) quantityInput.value = "";
  document
    .querySelectorAll("#recordSaleForm .errorMes")
    .forEach((item) => { item.textContent = ""; });

  renderCart();
  updateSalePreview();
  paintStockHint();
  quantityInput?.focus();
  return true;
}

function setupEventListeners() {
  const productSelect = document.getElementById("saleProductSelect");
  const variantSelect = document.getElementById("saleVariantSelect");
  const quantityInput = document.getElementById("saleQuantity");
  const priceInput = document.getElementById("saleUnitPrice");

  document
    .getElementById("saleCategorySelect")
    ?.addEventListener("change", handleCategoryChange);

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

  document.getElementById("addSaleLineBtn")?.addEventListener("click", handleAddToCart);

  //* Basket edits are handled here instead of per-render: the list is rebuilt
  //* wholesale on every change, so only the container listener survives.
  document.getElementById("saleCartList")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest(".sale-line-remove");
    if (!removeBtn || isSubmitting) return;
    const index = Number(removeBtn.dataset.index);
    if (!Number.isInteger(index) || !saleCart[index]) return;
    saleCart.splice(index, 1);
    renderCart();
    updateSalePreview();
    paintStockHint();
  });
  document.getElementById("clearSaleCartBtn")?.addEventListener("click", () => {
    if (isSubmitting || !saleCart.length) return;
    saleCart = [];
    renderCart();
    updateSalePreview();
    paintStockHint();
    showToast("Sale items cleared.", "info");
  });

  document.getElementById("recordSaleForm")?.addEventListener("submit", handleRecordSale);
  document.getElementById("searchSales")?.addEventListener("input", debounce(filterSales, 120));
  document.getElementById("salePeriodFilter")?.addEventListener("change", filterSales);

  const container = document.getElementById("salesTableContainer");
  container?.addEventListener("click", (event) => {
    const editBtn = event.target.closest(".sale-edit-btn");
    if (editBtn) {
      const sale = sales.find((item) => String(item.id) === editBtn.dataset.id);
      if (sale) openEditSaleModal(sale);
      return;
    }
    const deleteBtn = event.target.closest(".sale-delete-btn");
    if (deleteBtn) {
      handleDeleteSale(deleteBtn.dataset.id);
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
  //* Paint the basket state (count, button label, Clear all) on every render —
  //* failed lines survive a re-render and must show up right away.
  updateCartSummary();
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

//* Base hint text (stock for the current selection) kept separately from the
//* staged-units note so the note can be re-painted after every basket change
//* without re-deriving the whole sentence.
let stockHintBase = "";

function updateStockHint(text) {
  stockHintBase = String(text ?? "");
  paintStockHint();
}

function paintStockHint() {
  const hint = document.getElementById("saleStockHint");
  if (!hint) return;
  //* Tell the picker how many units of this exact line are already staged, so
  //* "Only 3 left to add" in the validation never comes out of nowhere.
  let stagedNote = "";
  const product = getSelectedProduct();
  if (product) {
    const variants = getProductVariants(product);
    let variantIndex = null;
    if (variants.length) {
      const parsed = Number.parseInt(
        String(document.getElementById("saleVariantSelect")?.value ?? ""),
        10,
      );
      variantIndex = Number.isNaN(parsed) ? null : parsed;
    }
    const staged = getCartQuantityFor(product.id, variantIndex);
    if (staged > 0) stagedNote = ` ${staged} unit${staged === 1 ? "" : "s"} already added to this sale.`;
  }
  hint.textContent = `${stockHintBase}${stagedNote}`;
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
  //* Staged lines plus whatever the form is pointing at right now, so the
  //* figure never lies about what Record would actually charge.
  const next = formatCurrency(getCartTotal() + quantity * unitPrice);
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

  //* A filled-in but un-staged line still counts on submit: pressing Record
  //* with a quantity typed must behave exactly like Add, then Record.
  const quantityRaw = String(document.getElementById("saleQuantity")?.value ?? "").trim();
  if (quantityRaw !== "" && !handleAddToCart()) return;

  if (!saleCart.length) {
    showSaleFormMessage("Add at least one product to the sale first.", "warning");
    return;
  }

  const lines = [...saleCart];
  const button = document.getElementById("recordSaleBtn");
  isSubmitting = true;
  if (button) button.disabled = true;

  const recorded = [];
  const failed = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (button) {
      button.innerHTML =
        `<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>` +
        `Recording ${index + 1} of ${lines.length}...`;
    }
    const line = lines[index];
    const result = await postData("sales", {
      productId: line.productId,
      variantIndex: line.variantIndex,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    });
    if (!result || result.error) {
      failed.push({ line, error: result?.error || "Unable to record this sale." });
    } else {
      recorded.push(result);
    }
  }
  isSubmitting = false;

  //* Lines the server accepted are gone; the refused ones stay staged so a
  //* stock clash or typo can be corrected and retried instead of retyped.
  saleCart = failed.map((item) => item.line);

  //* Re-fetch so the history, the KSh totals and stock all reflect the sales —
  //* products too: every recorded line just moved stock on the server.
  await loadData({ freshSales: true, freshProducts: true });
  lastFiltered = [...sales];
  currentPage = 1;
  renderSalesPage();

  const recordedTotal = recorded.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  if (!failed.length) {
    const message =
      recorded.length === 1
        ? `Sale recorded: ${recorded[0].quantity} × ${recorded[0].productName || "product"} - ${formatCurrency(recordedTotal)}`
        : `${recorded.length} sales recorded - ${formatCurrency(recordedTotal)}`;
    showSaleFormMessage(message, "success");
    showToast(message, "success");
    return;
  }

  const reason = describeApiError(failed[0].error, "Unable to record this sale.");
  const message = recorded.length
    ? `Recorded ${recorded.length} of ${lines.length} sales (${formatCurrency(recordedTotal)}). ${failed.length} could not be recorded and ${failed.length === 1 ? "is" : "are"} still in the basket: ${reason}`
    : `No sales were recorded: ${reason}`;
  showSaleFormMessage(message, "danger");
  showToast(message, "danger", { title: "Sale not recorded" });
}

function isValidSaleData({ productId, quantity, unitPrice, variantIndex, hasVariants }) {
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
    //* Units already waiting in the basket are spoken for — without this the
    //* form would happily stage more than the shelf holds.
    const staged = getCartQuantityFor(
      productId,
      hasVariants && variantIndex !== "" ? Number(variantIndex) : null,
    );
    const remaining = Math.max(0, available - staged);
    if (quantity > remaining) {
      setSaleError(
        "quantity",
        staged > 0
          ? `Only ${remaining} left to add (${available} in stock, ${staged} already in this sale)`
          : `Only ${available} in stock`,
      );
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

//* The history refreshes rebuild the whole page, which would throw away a
//* half-filled Record Sale form. Deleting an old sale is unrelated to what is
//* currently being typed, so the form is carried across the re-render.
function captureSaleFormState() {
  return {
    productId: document.getElementById("saleProductSelect")?.value || "",
    variantIndex: document.getElementById("saleVariantSelect")?.value ?? "",
    quantity: document.getElementById("saleQuantity")?.value ?? "",
    unitPrice: document.getElementById("saleUnitPrice")?.value ?? "",
  };
}

function restoreSaleFormState(state) {
  if (!state) return;
  const productSelect = document.getElementById("saleProductSelect");
  if (!productSelect) return;

  productSelect.value = state.productId;
  //* The staged product may sit outside the active category filter (e.g. the
  //* filter changed elsewhere) — fall back to "All categories" so a half-filled
  //* form is never silently emptied by a repaint.
  if (state.productId && productSelect.value !== state.productId) {
    saleCategoryFilter = "";
    const categorySelect = document.getElementById("saleCategorySelect");
    if (categorySelect) categorySelect.value = "";
    productSelect.innerHTML = `<option value="">Select product</option>${getProductOptionsHtml(state.productId)}`;
    productSelect.value = state.productId;
  }

  populateVariantSelect(document.getElementById("saleVariantSelect"));
  const variantSelect = document.getElementById("saleVariantSelect");
  if (variantSelect && state.variantIndex) variantSelect.value = state.variantIndex;

  const quantityInput = document.getElementById("saleQuantity");
  const priceInput = document.getElementById("saleUnitPrice");
  if (quantityInput) quantityInput.value = state.quantity;
  if (priceInput) priceInput.value = state.unitPrice;
  updateSalePreview();
  paintStockHint();
}

//* Voiding a sale returns the units it took to stock on the server, inside the
//* same transaction that removes the row, so the two can never drift apart.
//* Every outcome is reported on screen: a delete whose failure only appeared
//* in a form at the far top of the page read as "I clicked and nothing
//* happened", which is exactly how this feature got reported as broken.
async function handleDeleteSale(id) {
  const sale = sales.find((item) => String(item.id) === String(id));
  if (!sale) {
    //* Already gone from the loaded list (a background refresh dropped it).
    //* Still say so — a silent return looks like a dead button.
    showToast("That sale is no longer in the list.", "warning");
    await refreshSaleHistory({ fresh: true });
    return;
  }

  const quantity = Number(sale.quantity) || 0;
  const label = sale.productName || "this product";
  const units = `${quantity} unit${quantity === 1 ? "" : "s"}`;
  const ok = await confirmAction({
    title: "Delete this sale?",
    message: `${quantity} × ${label} — ${formatCurrency(sale.total)}\n\n${units} will be returned to stock.`,
    confirmLabel: "Delete sale",
    cancelLabel: "Keep it",
    tone: "danger",
  });
  if (!ok) return;

  const formState = captureSaleFormState();
  const result = await deleteData("sales", sale.id);

  if (!result.ok) {
    //* 404 is the stale-cache case: this browser was still listing a sale the
    //* server has never heard of (or one deleted elsewhere / wiped by a
    //* migration). Repaint from the server so the phantom row disappears —
    //* leaving it on screen is what made the click look like it did nothing.
    if (result.status === 404) {
      showToast("That sale is no longer on the server — the list has been refreshed.", "warning");
      await refreshSaleHistory({ formState, fresh: true });
      return;
    }
    //* Otherwise the API refused for a real reason (a rating that has since
    //* been removed, say): show exactly what it said, where the user is looking.
    const reason = describeApiError(result.error, "Unable to delete this sale.");
    showSaleFormMessage(reason, "danger");
    showToast(reason, "danger", { title: "Delete failed" });
    return;
  }

  const message = `Sale deleted: ${quantity} × ${label} — ${units} returned to stock.`;
  await refreshSaleHistory({ formState });
  showSaleFormMessage(message, "success");
  showToast(message, "success");
}

//* Reload the history, repaint it, and put back whatever was being typed into
//* the Record Sale form. Every path lands on exactly the same screen state.
async function refreshSaleHistory({ formState, fresh = false } = {}) {
  await loadData({ freshSales: fresh });
  lastFiltered = [...sales];
  //* Removing the last row of the final page would otherwise strand the user
  //* on an empty page, so step back one page when that happens.
  const totalPages = Math.max(1, Math.ceil(lastFiltered.length / PAGE_SIZE));
  if (currentPage > totalPages) currentPage = totalPages;

  renderSalesPage();
  restoreSaleFormState(formState);
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
      return `<option value="${product.id}" ${stock <= 0 && !sold ? "disabled" : ""}>${escapeHtml(getProductDisplayName(product))} - ${stock} in stock</option>`;
    })
    .join("");

  const html = `
    <div class="modal fade" id="editSaleModal" tabindex="-1" aria-labelledby="editSaleModalTitle" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title fs-5" id="editSaleModalTitle">Edit Sale</h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
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

    const result = await updateData("sales", sale.id, {
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

    modal.hide();
    //* Re-fetch so history, KSh totals and stock all reflect the edit
    await loadData();
    lastFiltered = [...sales];
    renderSalesPage();
  });
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
      ? `${lastFiltered.length} sale${lastFiltered.length === 1 ? "" : "s"} - ${formatCurrency(getSalesTotal(lastFiltered))}`
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

//* A sale can disappear while this page shows a cached copy of it — deleted
//* on another device, or wiped by a migration. When the background refresh
//* lands with different rows, repaint the history and the hero totals in
//* place; the Record Sale form, which may be half-filled, is left alone.
function salesSignature(list) {
  return list
    .map((sale) => `${sale.id}:${sale.quantity}:${sale.unitPrice}:${sale.total}`)
    .sort()
    .join("|");
}

function updateHeroStats() {
  const today = getSalesForLocalDay(sales);
  setHeroStat("salesTodayTotal", formatCurrency(getSalesTotal(today)));
  setHeroStat("salesTodayUnits", getSalesUnits(today).toLocaleString("en-US"));
  setHeroStat("salesAllTimeTotal", formatCurrency(getSalesTotal(sales)));
}

function setHeroStat(id, text) {
  const el = document.getElementById(id);
  if (!el || el.textContent === text) return;
  el.textContent = text;
  //* Re-trigger the pop so a figure that just changed draws the eye.
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function applyFreshSales(rows) {
  //* Another page is on screen — nothing here to repaint.
  if (!document.getElementById("salesTableContainer")) return;
  const list = Array.isArray(rows) ? rows : [];
  if (salesSignature(list) === salesSignature(sales)) return;

  sales = sortSales(list);
  const search = document.getElementById("searchSales");
  const period = document.getElementById("salePeriodFilter");
  if (search && period) {
    //* Re-derives lastFiltered from the new `sales` and repaints the table,
    //* keeping whatever search/period the user has set.
    filterSales();
  } else {
    lastFiltered = [...sales];
    document.getElementById("salesTableContainer").innerHTML = getTableHtml(lastFiltered);
  }
  updateHeroStats();
}

//* Registered once for the life of the module: pages rebuild their DOM on
//* every render, so a per-render listener would stack duplicates.
if (typeof document !== "undefined") {
  document.addEventListener("pontypool:data", (event) => {
    if (event?.detail?.endpoint !== "sales") return;
    applyFreshSales(event.detail.data);
  });
}
