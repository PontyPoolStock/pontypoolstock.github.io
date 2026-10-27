import renderPagination, { paginateData } from "../components/pagination.js";
import {
  fetchData,
  postData,
  updateData,
  deleteData,
  hydrateEntityImages,
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
  getVariantSuffix,
  getVariantPrice,
  getVariantLabels,
  getVariantGlasses,
  getVariantColours,
  getVariantRatingLabel,
  getResellerKey,
  getResellerStockMap,
  getProductDisplayName,
  isNotStockedProduct,
  normalizeVariantColour,
  normalizeVariantGlass,
  normalizeVariantRating,
  productThumbnailHtml,
  describeApiError,
  debounce,
  SELLER_SUGGESTIONS,
} from "../utils/helpers.js?v=20261027-8";
import { showToast, confirmAction } from "../components/toast.js";
import { isStaffView } from "../utils/role.js";
import { getCurrentUser } from "./login.js";
import { getSavedBranch, BRANCHES, saveBranch } from "../config.js";

let sales = [];
let products = [];
let categories = [];
let resellerPurchases = [];
//* Bought/sold/shop stock rebuilt once per data load instead of scanning both
//* ledgers for every product tile and stock hint.
let resellerStock = getResellerStockMap([], []);
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
//* Last successfully recorded sale — kept so the till can reprint its receipt
//* without recording a new sale (a failed print must not force a duplicate).
let lastRecordedSale = null;
//* id of the sale whose receipt was last opened for printing — blocks
//* double prints when Record Sale is clicked twice or a request is retried.
let lastPrintedSaleId = null;

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
  const [saleData, productData, categoryData, resellerData] = await Promise.all([
    fetchData("sales", freshSales ? { fresh: true } : undefined),
    fetchData(`products?fields=${PRODUCT_LIST_FIELDS}`, freshProducts ? { fresh: true } : undefined),
    //^ Slim projection — the Category dropdown only needs id + name, and the
    //^ shared cache key means it is already warm from Products/Categories.
    fetchData(`categories?fields=${CATEGORY_LIST_FIELDS}`),
    //^ Reseller ledger for the On-order stock hint — bought vs sold, never own stock.
    //^ The hint only reads quantities, so a staff session asks for exactly those
    //^ columns: the buy-cost ledger never lands in a staff browser.
    fetchData(isStaffView()
      ? "resellerPurchases?fields=id,productId,variantIndex,quantity"
      : "resellerPurchases"),
  ]);
  sales = sortSales(Array.isArray(saleData) ? saleData : []);
  products = Array.isArray(productData) ? productData : [];
  categories = Array.isArray(categoryData) ? categoryData : [];
  resellerPurchases = Array.isArray(resellerData) ? resellerData : [];
  rebuildResellerStock();
}

function rebuildResellerStock() {
  resellerStock = getResellerStockMap(resellerPurchases, sales);
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
  //* Staff run the till but never see the money statistics: the owner-only
  //* hero figures (today / all time) and the filtered KSh total line are
  //* simply not rendered for them (see js/utils/role.js).
  const staffView = isStaffView();

  document.getElementById("pageContent").innerHTML = `
    <section class="sale-hero">
      <div class="sale-hero-text">
        <span class="statistics-kicker">Point of sale</span>
        <h3>Record a sale</h3>
        <p>Pick a category, choose products, add as many lines as you like — then record the whole basket in one step.</p>
      </div>
      ${staffView ? "" : `
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
      </div>`}
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
            <label class="form-label" for="saleProductSelect">Product</label>
            <select name="productId" id="saleProductSelect" class="form-select">
              <option value="">Select product</option>
              ${getProductOptionsHtml()}
            </select>
            <div class="text-danger fw-bold errorMes errorMes-productId"></div>
            <div id="saleProductPreview" class="sale-product-preview d-none" aria-live="polite"></div>
            <div id="saleProductGallery" class="sale-product-gallery" role="listbox" aria-label="Product photos"></div>
          </div>
          <div class="col-12 col-lg-6 d-none" id="saleVariantWrapper">
            <div class="d-grid gap-2">
              <div id="saleVariantRatingGroup" class="d-none">
                <label class="form-label" for="saleVariantSelect">Rating</label>
                <select name="variantIndex" id="saleVariantSelect" class="form-select"></select>
              </div>
              <div id="saleVariantGlassGroup" class="d-none">
                <label class="form-label" for="saleVariantGlass">Glass colour</label>
                <select name="variantGlass" id="saleVariantGlass" class="form-select"></select>
              </div>
              <div id="saleVariantColourGroup" class="d-none">
                <label class="form-label" for="saleVariantColour" id="saleVariantColourLabel">Colour</label>
                <select name="variantColour" id="saleVariantColour" class="form-select"></select>
              </div>
            </div>
            <div class="text-danger fw-bold errorMes errorMes-variantIndex"></div>
          </div>
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleQuantity">Quantity</label>
            <input type="number" name="quantity" id="saleQuantity" class="form-control" min="1" step="1" placeholder="1">
            <div class="text-danger fw-bold errorMes errorMes-quantity"></div>
          </div>
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleUnitPrice">Selling price (KSh)</label>
            <input type="number" name="unitPrice" id="saleUnitPrice" class="form-control" min="0" step="0.01" placeholder="0.00">
            <div class="text-danger fw-bold errorMes errorMes-unitPrice"></div>
          </div>
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleSoldBy">Sold by</label>
            <input type="text" name="soldBy" id="saleSoldBy" class="form-control" maxlength="100" required value="${escapeHtml(getCurrentUser()?.name || "")}">
            <div class="small text-muted mt-2 mb-1">Quick pick a name</div>
            <div class="d-flex flex-wrap gap-2" role="group" aria-label="Quick pick seller name">
              ${SELLER_SUGGESTIONS.map((name) => `<button type="button" class="btn btn-sm btn-outline-secondary" data-seller-name="${name}" aria-pressed="false">${name}</button>`).join("")}
            </div>
          </div>
          <div class="col-12 col-lg-6">
            <label class="form-label" for="saleDate">Sale date</label>
            <input type="date" id="saleDate" class="form-control">
          </div>
        </div>

        <div id="saleStockHint" class="small text-muted mt-2" aria-live="polite"></div>

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
          <button type="button" class="btn btn-outline-secondary btn-sm px-3" id="printLastReceiptBtn" title="Print last receipt" aria-label="Print last receipt">
            <i class="bi bi-printer"></i> Reprint
          </button>
        </div>
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
      <input type="date" id="saleDateFilter" class="form-control form-control-sm border-0 shadow-none w-auto" title="Filter by specific date">
    </div>

    <div id="salesHistoryStats" class="mb-2 small text-muted${staffView ? " d-none" : ""}"></div>
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
        <td>${escapeHtml(sale.soldBy || "—")}</td>
        <td class="text-end">
          <div class="d-inline-flex gap-1">
            ` + (isStaffView() ? "" : `<button class="action-btn sale-edit-btn" data-id="${sale.id}" title="Edit sale" aria-label="Edit sale"><i class="bi bi-pencil"></i></button>`) + `
            ` + (isStaffView() ? "" : `<button class="action-btn sale-delete-btn" data-id="${sale.id}" title="Delete sale" aria-label="Delete sale"><i class="bi bi-trash"></i></button>`) + `
            <button class="action-btn sale-print-btn" data-id="${sale.id}" title="Print receipt" aria-label="Print receipt"><i class="bi bi-printer"></i></button>
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
          ` + (isStaffView() ? "" : `<button class="btn btn-outline-secondary btn-sm sale-edit-btn flex-grow-1" data-id="${sale.id}"><i class="bi bi-pencil"></i> Edit</button>`) + `
          ` + (isStaffView() ? "" : `<button class="btn btn-outline-secondary btn-sm sale-delete-btn flex-grow-1" data-id="${sale.id}"><i class="bi bi-trash"></i> Delete</button>`) + `
          <button class="btn btn-outline-secondary btn-sm sale-print-btn flex-grow-1" data-id="${sale.id}"><i class="bi bi-printer"></i> Receipt</button>
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
            <th class="text-end">Price</th><th class="text-end">Total</th><th>Sold By</th><th></th>
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
  const allOption = `<option value="" ${saleCategoryFilter === "" ? "selected" : ""}>All Categories</option>`;
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

//* Product photos for the picker — names alone cannot tell two pendants
//* apart, so the selected product gets a large preview and the filtered
//* category gets a tap-to-select thumbnail strip. Order-based products show
//* reseller stock (bought minus sold) instead of an own-stock count.
function resellerLeftFor(productId, variantIndex = "") {
  return { left: resellerStock.stock.get(getResellerKey(productId, variantIndex)) || 0 };
}

function resellerProductLeft(product) {
  if (!isNotStockedProduct(product)) return null;
  const variants = getProductVariants(product);
  if (!variants.length) return resellerLeftFor(product.id, "").left;
  let left = 0;
  for (let index = 0; index < variants.length; index++) {
    left += resellerLeftFor(product.id, index).left;
  }
  return left;
}

function getSaleProductPreviewHtml(product = null) {
  if (!product) return "";
  const onOrder = isNotStockedProduct(product);
  const variants = getProductVariants(product);
  const stock = variants.length
    ? getVariantsTotalQuantity(variants)
    : Number(product.quantity) || 0;
  const category = getCategoryLabel(categories, product.categoryId);
  const meta = [category, onOrder ? `Resale product — ${resellerProductLeft(product)} left` : `${stock} in stock`].filter(Boolean).join(" · ");
  return `
    ${productThumbnailHtml(product.imageUrl, getProductDisplayName(product), { productId: product.id })}
    <span class="sale-product-preview-info">
      <strong>${escapeHtml(getProductDisplayName(product))}</strong>
      ${meta ? `<small>${escapeHtml(meta)}</small>` : ""}
    </span>`;
}

function getSaleProductGalleryHtml(selectedId = "") {
  const filtered = getFilteredProducts().slice(0, 24);
  if (!filtered.length) return "";
  return filtered
    .map((product) => {
      const onOrder = isNotStockedProduct(product);
      const variants = getProductVariants(product);
      const stock = variants.length
        ? getVariantsTotalQuantity(variants)
        : Number(product.quantity) || 0;
      const out = !onOrder && stock <= 0;
      const name = getProductDisplayName(product);
      const isSelected = String(product.id) === String(selectedId);
      return `
        <button type="button" class="sale-photo-card${isSelected ? " is-selected" : ""}${out ? " is-out" : ""}" data-product-id="${escapeHtml(String(product.id))}" role="option" aria-selected="${isSelected ? "true" : "false"}" title="${escapeHtml(name)}" ${out ? "disabled" : ""}>
          ${productThumbnailHtml(product.imageUrl, name, { productId: product.id, sizeClass: "entity-thumbnail-sm" })}
          <span class="sale-photo-name">${escapeHtml(name)}</span>
          <span class="sale-photo-stock">${onOrder ? `Resale · ${resellerProductLeft(product)} left` : stock <= 0 ? "Out" : `${stock} left`}</span>
        </button>`;
    })
    .join("");
}

function paintSaleProductVisuals(selectedId = "") {
  const preview = document.getElementById("saleProductPreview");
  if (preview) {
    const product = selectedId
      ? products.find((item) => String(item.id) === String(selectedId))
      : getSelectedProduct();
    const html = getSaleProductPreviewHtml(product || null);
    preview.innerHTML = html;
    preview.classList.toggle("d-none", !html);
  }
  const gallery = document.getElementById("saleProductGallery");
  if (gallery) {
    const current = selectedId || document.getElementById("saleProductSelect")?.value || "";
    gallery.innerHTML = getSaleProductGalleryHtml(current);
  }
  hydrateEntityImages(document.getElementById("recordSaleForm"));
}

//* Product dropdown — filtered down to the chosen category, out-of-stock rows
//* still disabled so nothing unsellable can be staged. The rating/colour
//* pickers below resolve the exact stock row, so one product is one option.
function getProductOptionsHtml(selectedId = "") {
  const filtered = getFilteredProducts();
  if (!filtered.length) {
    return `<option value="" disabled>${saleCategoryFilter !== "" ? "No products in this category" : "No products in stock"}</option>`;
  }
  return filtered
    .map((product) => {
      const variants = getProductVariants(product);
      const name = escapeHtml(getProductDisplayName(product));
      const onOrder = isNotStockedProduct(product);
      const stock = variants.length
        ? getVariantsTotalQuantity(variants)
        : Number(product.quantity) || 0;
      const out = !onOrder && stock <= 0;
      const isSelected = String(product.id) === String(selectedId);
      const label = onOrder
        ? `${name} — Resale · ${resellerProductLeft(product)} left`
        : `${name} — ${stock} in stock`;
      return `<option value="${escapeHtml(String(product.id))}" ${isSelected ? "selected" : ""} ${out ? "disabled" : ""}>${label}</option>`;
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
          ${productThumbnailHtml(product?.imageUrl, name, { productId: line.productId, sizeClass: "entity-thumbnail-sm" })}
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
  hydrateEntityImages(document.getElementById("recordSaleForm"));
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
  paintSaleProductVisuals(productSelect.value);
  updateSalePreview();
}

//* Stage the line the form is pointing at into the basket. The form then keeps
//* the product/price but clears the quantity, so the next item goes straight in.
function handleAddToCart() {
  if (isSubmitting) return false;

  const productId = document.getElementById("saleProductSelect")?.value || "";
  const quantity = Number(document.getElementById("saleQuantity")?.value);
  const unitPrice = Number(document.getElementById("saleUnitPrice")?.value);
  const product = getSelectedProduct();
  const variants = getProductVariants(product);
  const hasVariants = variants.length > 0;
  const selection = hasVariants
    ? getVariantSelectionState()
    : { index: null, error: "" };

  if (!isValidSaleData({ productId, quantity, unitPrice, hasVariants, selection })) {
    return false;
  }

  const resolvedVariantIndex = hasVariants ? selection.index : null;
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
  const sellerInput = document.getElementById("saleSoldBy");

  const updateSellerQuickPicks = () => {
    document.querySelectorAll("[data-seller-name]").forEach((button) => {
      const selected = button.dataset.sellerName === sellerInput?.value;
      button.classList.toggle("btn-primary", selected);
      button.classList.toggle("btn-outline-secondary", !selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  };

  sellerInput?.addEventListener("input", updateSellerQuickPicks);
  document.querySelector('[aria-label="Quick pick seller name"]')?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-seller-name]");
    if (!button || !sellerInput) return;
    sellerInput.value = button.dataset.sellerName;
    sellerInput.dispatchEvent(new Event("input", { bubbles: true }));
    sellerInput.focus();
  });
  updateSellerQuickPicks();

  document
    .getElementById("saleCategorySelect")
    ?.addEventListener("change", handleCategoryChange);

  productSelect?.addEventListener("change", () => {
    populateVariantSelect(variantSelect);
    updatePriceDefault(priceInput);
    paintSaleProductVisuals(productSelect.value);
    paintStockHint();
    updateSalePreview();
  });
  //* Tapping a photo picks the same product as the dropdown — both stay in
  //* sync so the correct pendant is always what gets recorded.
  document.getElementById("saleProductGallery")?.addEventListener("click", (event) => {
    const card = event.target.closest("[data-product-id]");
    if (!card || card.disabled) return;
    const select = document.getElementById("saleProductSelect");
    if (!select) return;
    select.value = card.dataset.productId;
    select.dispatchEvent(new Event("change", { bubbles: true }));
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
  document.getElementById("printLastReceiptBtn")?.addEventListener("click", reprintLastReceipt);
  document.getElementById("searchSales")?.addEventListener("input", debounce(filterSales, 120));
  document.getElementById("salePeriodFilter")?.addEventListener("change", filterSales);
  document.getElementById("saleDateFilter")?.addEventListener("change", filterSales);
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
    const printBtn = event.target.closest(".sale-print-btn");
    if (printBtn) {
      const sale = sales.find((item) => String(item.id) === printBtn.dataset.id);
      if (sale) {
        //* Old history rows are single lines — wrap into the combined receipt shape.
        lastRecordedSale = toCombinedReceipt([sale]);
        lastPrintedSaleId = null; //* manual reprint from the row always works
        printReceipt(lastRecordedSale).catch(() => {
          showToast("Receipt print failed — try again from this row.", "warning", { title: "Print failed" });
        });
      }
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
  paintSaleProductVisuals(productSelect?.value || "");
  updateSalePreview();
  //* Paint the basket state (count, button label, Clear all) on every render —
  //* failed lines survive a re-render and must show up right away.
  updateCartSummary();
}

function getSelectedProduct() {
  const select = document.getElementById("saleProductSelect");
  if (!select?.value) return null;
  const productId = String(select.value).split("::")[0];
  return products.find((product) => String(product.id) === productId) || null;
}

//* Rating/colour pickers are derived from the product's variants. Any rating
//* or colour is shown, even when there is only one, so the sold row is always
//* visible; only the placeholder is skipped when there is nothing to choose.
//* The pair resolves exactly one stock row, so the line never depends on a
//* hidden variant index.
function populateVariantSelect(variantSelect, preferred = {}) {
  const wrapper = document.getElementById("saleVariantWrapper");
  const ratingGroup = document.getElementById("saleVariantRatingGroup");
  const glassGroup = document.getElementById("saleVariantGlassGroup");
  const glassSelect = document.getElementById("saleVariantGlass");
  const colourGroup = document.getElementById("saleVariantColourGroup");
  const colourSelect = document.getElementById("saleVariantColour");
  if (!variantSelect || !colourSelect || !glassSelect) return;

  const product = getSelectedProduct();
  const variants = getProductVariants(product);

  if (!product || !variants.length) {
    wrapper?.classList.add("d-none");
    ratingGroup?.classList.add("d-none");
    glassGroup?.classList.add("d-none");
    colourGroup?.classList.add("d-none");
    variantSelect.innerHTML = "";
    glassSelect.innerHTML = "";
    colourSelect.innerHTML = "";
    paintStockHint();
    return;
  }

  const labels = getVariantLabels(variants);
  const hasRating = labels.length > 0;
  const hasRatingChoice = labels.length > 1;
  const preferredRating = normalizeVariantRating(preferred.rating);
  const preferredGlass = normalizeVariantGlass(preferred.glass);
  const preferredColour = normalizeVariantColour(preferred.colour);

  ratingGroup?.classList.toggle("d-none", !hasRating);
  variantSelect.innerHTML = "";
  if (hasRating) {
    if (hasRatingChoice) {
      variantSelect.innerHTML = '<option value="">Select rating</option>' + labels
        .map((label) => `<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`)
        .join("");
      variantSelect.value = labels.includes(preferredRating) ? preferredRating : "";
    } else {
      variantSelect.innerHTML =
        `<option value="${escapeHtml(labels[0])}">${escapeHtml(labels[0])}</option>`;
      variantSelect.value = labels[0];
    }
  }

  const paintGlassAndColours = (wantedGlass = "", wantedColour = "") => {
    const rating = hasRatingChoice
      ? String(variantSelect.value || "")
      : (labels[0] || "");
    let candidates = hasRating
      ? variants.filter((variant) => getVariantRatingLabel(variant) === rating)
      : variants;

    const glasses = getVariantGlasses(candidates);
    const wantedG = normalizeVariantGlass(wantedGlass);
    glassSelect.innerHTML = "";
    if (glasses.length > 1) {
      glassSelect.innerHTML = '<option value="">Select glass colour</option>' + glasses
        .map((glass) => `<option value="${escapeHtml(glass)}">${escapeHtml(glass)}</option>`)
        .join("");
      glassSelect.value = glasses.includes(wantedG) ? wantedG : "";
    } else if (glasses.length === 1) {
      glassSelect.innerHTML =
        `<option value="${escapeHtml(glasses[0])}">${escapeHtml(glasses[0])}</option>`;
      glassSelect.value = glasses[0];
    }
    glassGroup?.classList.toggle("d-none", glasses.length === 0);

    const glass = glasses.length > 1
      ? String(glassSelect.value || "")
      : (glasses[0] || "");
    candidates = glasses.length
      ? candidates.filter((variant) => normalizeVariantGlass(variant.glass) === glass)
      : candidates;
    if (glasses.length && !glass) candidates = [];

    const colours = getVariantColours(candidates);
    const wanted = normalizeVariantColour(wantedColour);
    colourSelect.innerHTML = "";
    if (colours.length > 1) {
      colourSelect.innerHTML = '<option value="">Select colour</option>' + colours
        .map((colour) => `<option value="${escapeHtml(colour)}">${escapeHtml(colour)}</option>`)
        .join("");
      colourSelect.value = colours.includes(wanted) ? wanted : "";
    } else if (colours.length === 1) {
      colourSelect.innerHTML =
        `<option value="${escapeHtml(colours[0])}">${escapeHtml(colours[0])}</option>`;
      colourSelect.value = colours[0];
    }

    colourGroup?.classList.toggle("d-none", colours.length === 0);
    wrapper?.classList.toggle(
      "d-none",
      !hasRating && glasses.length === 0 && colours.length === 0,
    );
  };

  paintGlassAndColours(preferredGlass, preferredColour);

  const refreshSelection = () => {
    updatePriceDefault(document.getElementById("saleUnitPrice"));
    paintStockHint();
    updateSalePreview();
  };

  variantSelect.onchange = () => {
    paintGlassAndColours();
    refreshSelection();
  };
  glassSelect.onchange = () => {
    paintGlassAndColours(glassSelect.value);
    refreshSelection();
  };
  colourSelect.onchange = refreshSelection;
  paintStockHint();
}

//* Resolve the current picker values to one stock row. The returned `error`
//* tells callers whether the rating or the colour is the missing choice.
function getVariantSelectionState() {
  const product = getSelectedProduct();
  const variants = getProductVariants(product);
  if (!variants.length) {
    return { variants, index: null, rating: "", glass: "", colour: "", error: "" };
  }

  const labels = getVariantLabels(variants);
  const showRating = labels.length > 1;
  const rating = showRating
    ? normalizeVariantRating(document.getElementById("saleVariantSelect")?.value)
    : (labels[0] || "");

  if (labels.length && !rating) {
    return { variants, index: null, rating, glass: "", colour: "", error: "rating" };
  }

  let candidates = labels.length
    ? variants.filter((variant) => getVariantRatingLabel(variant) === rating)
    : variants;

  let glass = normalizeVariantGlass(document.getElementById("saleVariantGlass")?.value);
  const glasses = getVariantGlasses(candidates);
  if (glasses.length) {
    if (glasses.length > 1 && !glass) {
      return { variants, index: null, rating, glass, colour: "", error: "glass" };
    }
    glass = glass || glasses[0];
    candidates = candidates.filter(
      (variant) => normalizeVariantGlass(variant.glass) === glass,
    );
  }

  let colour = normalizeVariantColour(document.getElementById("saleVariantColour")?.value);
  const colours = getVariantColours(candidates);

  if (colours.length) {
    if (colours.length > 1 && !colour) {
      return { variants, index: null, rating, glass, colour, error: "colour" };
    }
    colour = colour || colours[0];
    candidates = candidates.filter(
      (variant) => normalizeVariantColour(variant.colour) === colour,
    );
  }

  if (!candidates.length) {
    return { variants, index: null, rating, glass, colour, error: "rating" };
  }

  return {
    variants,
    index: variants.indexOf(candidates[0]),
    rating,
    glass,
    colour,
    error: "",
  };
}

function getSelectedStock() {
  const product = getSelectedProduct();
  if (!product) return 0;
  const variants = getProductVariants(product);
  if (!variants.length) return Number(product.quantity) || 0;
  const state = getVariantSelectionState();
  return state.index === null ? 0 : Number(variants[state.index]?.quantity) || 0;
}

//* On-order hint backed by the reseller ledger: bought minus sold per
//* product/variant, always separate from products.quantity own-stock.
function resellerHintFor(productId, variantIndex) {
  const key = getResellerKey(productId, variantIndex);
  const bought = resellerStock.bought.get(key) || 0;
  const sold = resellerStock.sold.get(key) || 0;
  const left = bought - sold;
  if (!bought) {
    //* Both roles can open Shop Purchases (see STAFF_PAGES in js/utils/role.js),
    //* so both get pointed there.
    return "Resale product — no shop purchases recorded yet. Add them under Shop Purchases.";
  }
  return `Resale product — shop-purchase stock: ${left} left (${bought} bought − ${sold} sold).`;
}

function paintStockHint() {
  const hint = document.getElementById("saleStockHint");
  if (!hint) return;
  const product = getSelectedProduct();
  if (!product) {
    hint.textContent = "";
    return;
  }

  const variants = getProductVariants(product);
  const onOrder = isNotStockedProduct(product);
  let variantIndex = null;
  let base = "";

  if (variants.length) {
    const state = getVariantSelectionState();
    variantIndex = state.index;
    if (variantIndex === null) {
      hint.textContent = state.error === "glass"
        ? "Choose a glass colour to see the available stock."
        : state.error === "colour"
          ? "Choose a colour to see the available stock."
          : "Choose a rating to see the available stock.";
      return;
    }
    const variant = variants[variantIndex];
    const label = [state.rating, state.glass, state.colour].filter(Boolean).join(" · ");
    base = onOrder
      ? resellerHintFor(product.id, variantIndex)
      : `${label ? `${label} — ` : ""}Stock: ${Number(variant.quantity) || 0}`;
  } else {
    base = onOrder
      ? resellerHintFor(product.id, null)
      : `${Number(product.quantity) || 0} in stock`;
  }

  //* Tell the picker how many units of this exact line are already staged, so
  //* "Only 3 left to add" in the validation never comes out of nowhere.
  const staged = getCartQuantityFor(product.id, variantIndex);
  const stagedNote = staged > 0
    ? ` ${staged} unit${staged === 1 ? "" : "s"} already added to this sale.`
    : "";
  hint.textContent = `${base}${stagedNote}`;
}

//* Prefill the selling price from the selected rating/colour, but let staff override it
function updatePriceDefault(priceInput) {
  if (!priceInput) return;
  const product = getSelectedProduct();
  if (!product) {
    priceInput.value = "";
    return;
  }
  const variants = getProductVariants(product);
  if (variants.length) {
    const state = getVariantSelectionState();
    const variant = state.index === null ? undefined : variants[state.index];
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

//* Wrap recorded sale rows into one combined receipt object the printer expects.
//* Used for the fresh basket AND for reprinting old single-line history rows.
function toCombinedReceipt(recorded) {
  const list = Array.isArray(recorded) ? recorded : [recorded];
  const last = list[list.length - 1] || {};
  const total = list.reduce((s, sale) => s + (Number(sale.total) || 0), 0);
  return {
    id: last.id,
    receiptNo: String(last.id),
    branch: last.branch,
    soldBy: last.soldBy || last.sold_by || "",
    soldAt: last.soldAt || last.createdAt || new Date().toISOString(),
    total,
    lines: list.map((sale) => ({
      name: sale.productName || "Product",
      qty: Number(sale.quantity) || 0,
      unitPrice: Number(sale.unitPrice) || 0,
      lineTotal: Number(sale.total) || 0,
    })),
  };
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

  const soldBy = String(document.getElementById("saleSoldBy")?.value || "").trim();
  if (!soldBy) {
    showSaleFormMessage("Enter the name of the person making this sale.", "warning");
    document.getElementById("saleSoldBy")?.focus();
    return;
  }

  const branch = getSavedBranch();
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
      branch,
      soldBy,
      soldAt: document.getElementById("saleDate")?.value
        ? new Date(document.getElementById("saleDate").value + "T12:00:00").toISOString()
        : undefined,
    }, { revalidate: false });
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

  const recordedTotal = recorded.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0);
  if (recorded.length) {
    lastRecordedSale = toCombinedReceipt(recorded);
    lastPrintedSaleId = null;
    printReceipt(lastRecordedSale).catch((error) => {
      showToast(`Sale recorded — ${describePrintFailure(error)} Press Reprint to try again.`, "warning", { title: "Print check" });
    });
  }

  //* Re-fetch so the history, the KSh totals and stock all reflect the sales —
  //* products too: every recorded line just moved stock on the server.
  await loadData({ freshSales: true, freshProducts: true });
  lastFiltered = [...sales];
  currentPage = 1;
  renderSalesPage();

  if (!failed.length) {
    //* One receipt for the whole basket — all lines + one total + one barcode.
    //* One combined receipt is printed after all lines are recorded.
    const message =
      recorded.length === 1
        ? `Sale recorded: ${recorded[0].quantity} × ${recorded[0].productName || "product"} — ${formatCurrency(recordedTotal)}`
        : `${recorded.length} sales recorded — ${formatCurrency(recordedTotal)}`;
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

//* ── Receipt printing ────────────────────────────────────────────────────────

//* Build the line-item list for a recorded sale, using the snapshot stored
//* alongside the sale so reprints match exactly what was sold.
function saleCartSnapshot(sale) {
  //* The recorded sale row carries productId, quantity, unitPrice, etc.
  //* Reconstruct a single-line snapshot from the sale row itself.
  return [
    {
      name: sale.productName || "Product",
      qty: Number(sale.quantity) || 0,
      unitPrice: Number(sale.unitPrice) || 0,
      lineTotal: Number(sale.total) || 0,
    },
  ];
}

//* Render the supplied branch receipt and open the browser's print dialog.
function renderReceiptHtml(sale, branch) {
  const soldAt = new Date(sale.soldAt || sale.createdAt || Date.now());
  const dateStr = soldAt.toLocaleDateString("en-KE", { day: "2-digit", month: "short", year: "numeric" });
  const timeStr = soldAt.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit", hour12: true });
  const isDuruma = branch === "Duruma Road";
  const phone = isDuruma ? "0712255416" : "0790225572";
  const barcodeHeight = isDuruma ? "17mm" : "12mm";
  const lines = Array.isArray(sale.lines) && sale.lines.length ? sale.lines : saleCartSnapshot(sale);
  const total = Number(sale.total) || lines.reduce((sum, line) => sum + (Number(line.lineTotal) || 0), 0);
  const formattedTotal = total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const soldBy = String(sale.soldBy || sale.sold_by || "").trim();
  const itemRows = lines.map((line) => {
    const quantity = Number(line.qty) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    const lineTotal = Number(line.lineTotal) || quantity * unitPrice;
    return `<tr>
      <td class="receipt-item-name">${escapeHtml(line.name || "Product")}<small>KSH ${unitPrice.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} each</small></td>
      <td class="receipt-item-qty">${quantity}</td>
      <td class="receipt-item-amount">KSH ${lineTotal.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>`;
  }).join("");

  return `<div class="receipt-print">
    <svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" class="receipt-art">
      <defs>
        <pattern id="receipt-bars" width="91" height="100" patternUnits="userSpaceOnUse">
          <path d="M2 0V100 M17 0V100 M38 0V100 M53 0V100 M78 0V100" stroke="black" stroke-width="2"/>
          <path d="M9 0V100 M29 0V100 M65 0V100 M87 0V100" stroke="black" stroke-width="5"/>
        </pattern>
        <symbol id="receipt-barcode" viewBox="0 0 364 100">
          <rect width="364" height="100" fill="url(#receipt-bars)"/>
        </symbol>
      </defs>
    </svg>
    <article class="receipt-paper">
      <img src="./pontylogo-receipt.png" alt="PontyPool Electricals and Lighting" class="receipt-logo">
      <div class="receipt-title">SALES RECEIPT</div>
      <div class="receipt-tagline">Dealers in Electrical Accessories, Lighting Fixtures &amp; Solar Accessories</div>
      <div class="receipt-company">
        <div class="receipt-company-name">PontyPool Enterprises Limited</div>
        <div>${escapeHtml(branch)} &middot; ${phone}</div>
      </div>
      <div class="receipt-meta">
        <div><span>Date</span><strong>${dateStr}, ${timeStr}</strong></div>
        ${soldBy ? `<div><span>Served by</span><strong>${escapeHtml(soldBy)}</strong></div>` : ""}
      </div>
      <table class="receipt-items">
        <thead><tr><th>ITEM</th><th>QTY</th><th>AMOUNT</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="receipt-total"><span>TOTAL</span><span>KSH ${formattedTotal}</span></div>
      <div class="receipt-barcode">
        <svg role="img" aria-label="Decorative barcode" class="receipt-barcode-image" style="height:${barcodeHeight}"><use href="#receipt-barcode"/></svg>
      </div>
      <div class="receipt-thank-you">We Light Up Your World !</div>
    </article>
  </div>`;
}

async function printReceipt(sale) {
  const branch = sale.branch || getSavedBranch();
  const key = String(sale.receiptNo != null ? sale.receiptNo : sale.id);
  if (lastPrintedSaleId === key) {
    return { ok: true, branch, saleId: sale.id, target: "skipped-duplicate" };
  }
  const container = document.getElementById("receipt-print-container");
  if (!container) throw new Error("Receipt print area is missing from the page.");
  if (typeof window.print !== "function") throw new Error("This browser does not support printing.");
  container.innerHTML = renderReceiptHtml(sale, branch);
  const cleanup = () => {
    container.innerHTML = "";
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup, { once: true });
  try {
    const logo = container.querySelector(".receipt-logo");
    if (logo && typeof logo.decode === "function") await logo.decode();
    window.print();
  } catch (error) {
    cleanup();
    throw error;
  }
  lastPrintedSaleId = key;
  return { ok: true, branch, saleId: sale.id, target: "browser" };
}
//* Turn a print failure into a plain reason for the sale confirmation.
function describePrintFailure(error) {
  const text = String((error && error.message) || error || "");
  return text || "browser print dialog could not be opened.";
}

//* Reprint the receipt for the last recorded sale — standalone retry that does
//* not record a new sale or deduct stock again.
async function reprintLastReceipt() {
  if (!lastRecordedSale) {
    showToast("No recent sale to reprint.", "warning");
    return;
  }
  lastPrintedSaleId = null; //* allow a genuine reprint of the last sale
  try {
    await printReceipt(lastRecordedSale);
    showToast("Receipt reprinted.", "success");
  } catch (error) {
    showToast(String(error.message || error), "danger", { title: "Print failed" });
  }
}

function isValidSaleData({ productId, quantity, unitPrice, hasVariants, selection }) {
  document.querySelectorAll(".errorMes").forEach((item) => { item.textContent = ""; });
  let valid = true;
  //* Order-based products skip every stock cap — any quantity can be sold.
  const onOrder = isNotStockedProduct(getSelectedProduct());
  const selectionReady = !hasVariants || (selection?.index ?? null) !== null;

  if (!productId) {
    setSaleError("productId", "Product is required");
    valid = false;
  }
  if (!selectionReady) {
    setSaleError(
      "variantIndex",
      selection?.error === "colour"
        ? "Select the colour being sold"
        : "Select the rating being sold",
    );
    valid = false;
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    setSaleError("quantity", "Quantity must be a whole number greater than 0");
    valid = false;
  } else if (!onOrder && selectionReady) {
    const available = getSelectedStock();
    //* Units already waiting in the basket are spoken for — without this the
    //* form would happily stage more than the shelf holds.
    const staged = getCartQuantityFor(
      productId,
      hasVariants ? selection.index : null,
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
  //* A colour/rating that has not been picked yet leaves the price blank on
  //* purpose — don't stack "price required" on top of the missing selection.
  if (selectionReady) {
    const priceRaw = String(document.getElementById("saleUnitPrice")?.value ?? "").trim();
    if (priceRaw === "") {
      setSaleError("unitPrice", "Selling price is required");
      valid = false;
    } else if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setSaleError("unitPrice", "Selling price must be 0 or more");
      valid = false;
    }
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
    rating: document.getElementById("saleVariantSelect")?.value || "",
    glass: document.getElementById("saleVariantGlass")?.value || "",
    colour: document.getElementById("saleVariantColour")?.value || "",
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
  //* filter changed elsewhere) — fall back to "All Categories" so a half-filled
  //* form is never silently emptied by a repaint.
  if (state.productId && productSelect.value !== state.productId) {
    saleCategoryFilter = "";
    const categorySelect = document.getElementById("saleCategorySelect");
    if (categorySelect) categorySelect.value = "";
    productSelect.innerHTML = `<option value="">Select product</option>${getProductOptionsHtml(state.productId)}`;
    productSelect.value = state.productId;
  }

  populateVariantSelect(document.getElementById("saleVariantSelect"), {
    rating: state.rating,
    glass: state.glass,
    colour: state.colour,
  });

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
                <label class="form-label" for="editSaleVariantSelect">Rating / glass / colour *</label>
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
      //* The suffix carries rating, glass, colour and amps, so two rows that
      //* share a rating can never collapse into the same dropdown label.
      const bits = getVariantSuffix(variant) || `Row ${index + 1}`;
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
  const dateFilter = document.getElementById("saleDateFilter")?.value || "";

  lastFiltered = sales.filter((sale) => {
    if (term) {
      const matches = String(sale.productName || "").toLowerCase().includes(term)
        || String(sale.quantity || "").includes(term)
        || String(sale.total || "").includes(term);
      if (!matches) return false;
    }
    if (period && !isWithinPeriod(sale.soldAt || sale.createdAt, period)) return false;
    if (dateFilter) {
      const saleDate = new Date(sale.soldAt || sale.createdAt);
      const y = saleDate.getFullYear();
      const m = String(saleDate.getMonth() + 1).padStart(2, "0");
      const d = String(saleDate.getDate()).padStart(2, "0");
      if (`${y}-${m}-${d}` !== dateFilter) return false;
    }
    return true;
  });
  currentPage = 1;
  document.getElementById("salesTableContainer").innerHTML = getTableHtml(lastFiltered);
  //* The running-totals line is owner-only: it never carries a figure for
  //* staff (the element hides with d-none in renderSalesPage).
  const historyStats = document.getElementById("salesHistoryStats");
  if (historyStats && !isStaffView()) {
    historyStats.textContent =
      term || period
        ? `${lastFiltered.length} sale${lastFiltered.length === 1 ? "" : "s"} — ${formatCurrency(getSalesTotal(lastFiltered))}`
        : "";
  }
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
    .map((sale) =>
      `${sale.id}:${sale.productId}:${sale.variantIndex}:${sale.productName}:`
      + `${sale.quantity}:${sale.unitPrice}:${sale.total}:${sale.soldAt}:${sale.branch}:${sale.soldBy}`,
    )
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
  rebuildResellerStock();
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
