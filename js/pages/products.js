import renderTable from "../components/table.js";
import renderPagination, { paginateData } from "../components/pagination.js";
import {
  fetchData,
  updateData,
  postData,
  deleteData,
  hydrateEntityImages,
  PRODUCT_LIST_FIELDS,
  CATEGORY_LIST_FIELDS,
} from "../services/api.js";
import { getModal } from "../components/modal.js";
import { openProductPreview } from "../components/preview.js";
import { showToast, confirmAction } from "../components/toast.js";
import {
  GetCurrentDate,
  escapeHtml,
  formatCurrency,
  getCategoryLabel,
  getProductStock,
  getProductVariants,
  getProductStatusCode,
  getVariantSuffix,
  getVariantPriceRange,
  isNotStockedProduct,
  productThumbnailHtml,
  sortData,
  getProductDisplayName,
  describeApiError,
  debounce,
} from "../utils/helpers.js";

let products = [];
let categories = [];
let lastFiltered = [];
let currentPage = 1;
let PAGE_SIZE = 5;

export async function loadProducts() {
  await loadData();
  lastFiltered = [...products];
  renderProducts();
  setupEventListeners();
  paintRows();
}

//* Hydrate the deferred thumbnails and mark every row/card as clickable — a
//* click anywhere on a product opens its preview card.
function paintRows(container = document.getElementById("productsTableContainer")) {
  if (!container) return;
  hydrateEntityImages(container);
  container
    .querySelectorAll("table tbody tr[data-id], .entity-card[data-id]")
    .forEach((row) => {
      const product = lastFiltered.find((p) => String(p.id) === row.dataset.id);
      row.classList.add("preview-row");
      //^ Keyboard users get the same card as a click: the row is focusable and
      //^ Enter/Space opens it (see the keydown handler below)
      row.setAttribute("tabindex", "0");
      row.setAttribute(
        "aria-label",
        `Preview ${product ? getProductDisplayName(product) : "product"}`,
      );
    });
}

async function loadData() {
  const [productData, categoryData] = await Promise.all([
    fetchData(`products?fields=${PRODUCT_LIST_FIELDS}`),
    fetchData(`categories?fields=${CATEGORY_LIST_FIELDS}`),
  ]);
  products = sortData(productData);
  categories = categoryData;
}

//* render the whole html of Products page
function renderProducts() {
  let categoryOptions = categories
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
    .join("");

  let html = `
      <div class="mb-3 p-3 bg-white rounded border">
      <div class="d-flex align-items-center gap-2 flex-wrap page-filter-bar">
        <i class="bi bi-search text-muted d-none d-sm-block"></i>
        <input type="text" id="searchProd" placeholder="Search products..."
          class="form-control form-control-sm border-0 shadow-none" style="flex:1; min-width:150px;">
        <select id="categoryFilter" class="form-select form-select-sm border-0 shadow-none w-auto">
          <option value="">All Categories</option>
          ${categoryOptions}
        </select>
        <select id="statusFilter" class="form-select form-select-sm border-0 shadow-none w-auto">
          <option value="">All Status</option>
          <option value="in">In Stock</option>
          <option value="low">Low Stock</option>
          <option value="out">Out of Stock</option>
        </select>
        <button class="btn btn-primary btn-sm px-3 ms-auto text-nowrap" id="addProductBtn">
          <i class="bi bi-plus-lg"></i> Add Product
        </button>
      </div>
    </div>

    <div id="searchStats" class="mb-2 small text-muted px-1"></div>
    <div id="productsTableContainer">
      ${getTableHtml()}
    </div>
  `;
  document.getElementById("pageContent").innerHTML = html;
}

//* to bring the table whatever there is a filter/ search/ all products
function getTableHtml(filteredProducts = products) {
  const paginated = paginateData(filteredProducts, currentPage, PAGE_SIZE);
  let tableData = paginated.map((p) => {
    const variants = getProductVariants(p);
    const priceRange = getVariantPriceRange(variants);
    const onOrder = isNotStockedProduct(p);
    return {
      id: p.id,
      image: productThumbnailHtml(p.imageUrl, getProductDisplayName(p), {
        productId: p.id,
      }),
      sku: p.sku ? `<span class="sku-badge">${escapeHtml(p.sku)}</span>` : "-",
      name: escapeHtml(getProductDisplayName(p)) + (onOrder ? ' <span class="sku-badge">On order</span>' : "") + getRatingsHtml(variants),
      category: escapeHtml(getCategoryLabel(categories, p.categoryId)),
      //^ A single price stays a number (renderTable formats it); a range is
      //^ already formatted, like the price shown on the preview card
      price: priceRange
        ? (priceRange.min === priceRange.max
          ? priceRange.min
          : `${formatCurrency(priceRange.min)} – ${formatCurrency(priceRange.max)}`)
        : p.price,
      quantity: onOrder ? "—" : getProductStock(p),
      unit: p.unit ? escapeHtml(p.unit) : "-",
      status: getProductStatus(p),
    };
  });
  let columns = [
    "image",
    "sku",
    "name",
    "category",
    "price",
    "quantity",
    "unit",
    "status",
  ];
  return (
    renderTable(tableData, columns)
    + renderPagination(filteredProducts.length, currentPage, PAGE_SIZE)
  );
}

//* Handles All event listeners of page
function setupEventListeners() {
  //& Search (debounced for buttery smooth typing)
  document
    .getElementById("searchProd")
    ?.addEventListener("input", debounce(filterProducts, 120));
  //& Category Filter
  document
    .getElementById("categoryFilter")
    ?.addEventListener("change", filterProducts);
  //& Status Filter
  document
    .getElementById("statusFilter")
    ?.addEventListener("change", filterProducts);

  document
    .querySelector("#productsTableContainer")
    .addEventListener("click", function (e) {
      //& pagination
      const pageBtn = e.target.closest(".page-link");
      if (pageBtn) {
        const page = Number(pageBtn.dataset.page);
        const totalPages = Math.ceil(lastFiltered.length / PAGE_SIZE);
        if (page < 1 || page > totalPages) return;
        currentPage = page;
        const container = document.getElementById("productsTableContainer");
        container.innerHTML = getTableHtml(lastFiltered);
        paintRows(container);
        return;
      }
      const editBtn = e.target.closest(".edit-btn");
      const deleteBtn = e.target.closest(".delete-btn");
      if (editBtn) {
        handleEdit(editBtn.dataset.id);
        return;
      }
      if (deleteBtn) {
        handleDelete(deleteBtn.dataset.id);
        return;
      }

      //& A click anywhere else on the row (picture, name, price…) opens the preview
      if (e.target.closest(".action-btn")) return;
      previewRow(e.target.closest("tr[data-id], .entity-card[data-id]"));
    });

  //& Enter/Space on a focused row opens the same preview card
  document
    .querySelector("#productsTableContainer")
    .addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest?.("button, a, input")) return;
      const row = e.target.closest?.(".preview-row");
      if (!row) return;
      e.preventDefault();
      previewRow(row);
    });

  //& Limit
  document
    .querySelector("#productsTableContainer")
    .addEventListener("change", (e) => {
      const pageSizeSelect = e.target.closest(".page-size-select");
      if (pageSizeSelect) {
        PAGE_SIZE = Number(pageSizeSelect.value);
        currentPage = 1;
        const container = document.getElementById("productsTableContainer");
        container.innerHTML = getTableHtml(lastFiltered);
        paintRows(container);
      }
    });
  //& Add product
  document
    .querySelector("#addProductBtn")
    .addEventListener("click", () => handleAdd());
}

//* Filter function for search and filters
function filterProducts() {
  let searchTerm = document.getElementById("searchProd").value.toLowerCase();
  let categoryId = document.getElementById("categoryFilter").value;
  let statusFilter = document.getElementById("statusFilter").value;

  let filtered = products.filter((p) => {
    //^ Search by name, sku, or category name
    if (searchTerm) {
      const ratingsText = getProductVariants(p)
        .map((variant) => `${variant.label || ""} ${variant.sku || ""} ${variant.colour || ""} ${variant.amps ?? ""}`)
        .join(" ")
        .toLowerCase();
      let matches =
        String(p.name || "").toLowerCase().includes(searchTerm)
        || String(p.sku || "").toLowerCase().includes(searchTerm)
        || getCategoryLabel(categories, p.categoryId).toLowerCase().includes(searchTerm)
        || ratingsText.includes(searchTerm);
      if (!matches) return false;
    }
    //^ Filter by category
    if (categoryId && p.categoryId != categoryId) return false;
    //^ Filter by status — same variant-aware logic as the status badge
    if (statusFilter && getProductStatusCode(p) !== statusFilter) return false;
    return true;
  });

  lastFiltered = filtered;
  currentPage = 1;
  const container = document.getElementById("productsTableContainer");
  container.innerHTML = getTableHtml(filtered);
  paintRows(container);
  updateStats(filtered.length, searchTerm, categoryId, statusFilter);
}

//* ADD
function handleAdd() {
  getModal("products", "Add", "", async () => {
    await loadData();
    lastFiltered = [...products];
    filterProducts();
  }, { categories });
}

//* PREVIEW — the card a click on a row opens. Edit inside the card hands over to
//* the ordinary edit modal (it opens once the card has closed).
function previewRow(row) {
  if (!row) return;
  const product = lastFiltered.find((p) => String(p.id) === row.dataset.id);
  if (!product) return;
  openProductPreview(product, { categories, onEdit: handleEdit });
}

//* UPDATE — reuse the cached row for an instant modal; the preview image fills
//* from the image cache and the save itself goes out optimistically.
function handleEdit(id) {
  const cached = products.find((e) => String(e.id) === String(id));
  getModal("products", "Edit", id, async () => {
    await loadData();
    lastFiltered = [...products];
    filterProducts();
  }, { initialProduct: cached, categories });
}

//* DELETE — repaint first so the row vanishes on the click, then verify in
//* the background; a rejected delete quietly restores the list. The outcome is
//* toasted either way: a failure with no visible feedback reads as a dead
//* button, which is how "delete does nothing" bugs go unnoticed.
async function handleDelete(id) {
  let p = products.find((e) => e.id == id);
  if (!p) return;

  const name = getProductDisplayName(p);
  const ok = await confirmAction({
    title: "Delete this product?",
    message: `${name}${p.sku ? ` (${p.sku})` : ""} will be removed from the catalogue.`,
    confirmLabel: "Delete product",
    cancelLabel: "Keep it",
    tone: "danger",
  });
  if (!ok) return;

  products = products.filter((e) => e.id != id);
  lastFiltered = [...products];
  currentPage = 1;
  filterProducts();

  const result = await deleteData("products", id);
  if (!result.ok) {
    console.warn("Product delete was rejected:", result.error);
    const stale = result.status === 404;
    showToast(
      stale
        ? `"${name}" is no longer on the server — the list has been refreshed.`
        : describeApiError(result.error, "Unable to delete this product."),
      stale ? "warning" : "danger",
      { title: "Delete failed" },
    );
    await loadData();
    lastFiltered = [...products];
    filterProducts();
    return;
  }

  showToast(`"${name}" deleted.`, "success");

  //* The audit trail is cosmetic — never hold the UI open for it.
  void postData("activityLog", {
    action: "DELETE_PRODUCT",
    details: `Product deleted: ${name}${p.sku ? ` (${p.sku})` : ""}`,
    user: "admin",
    timestamp: GetCurrentDate(),
  });
}

function updateStats(count, searchTerm, categoryId, statusFilter) {
  let statsDiv = document.getElementById("searchStats");
  if (!statsDiv) return;
  statsDiv.innerHTML =
    searchTerm || categoryId || statusFilter
      ? `Found ${count} product${count !== 1 ? "s" : ""}`
      : "";
}

//* Shows every rating of a product inside its own row ("4W · White · 0.05A: 20")
function getRatingsHtml(variants) {
  if (!variants.length) return "";

  const chips = variants
    .map((variant) => {
      const qty = Number(variant.quantity) || 0;
      const min = Number(variant.reorderLevel) || 0;
      const tone = qty <= 0 ? "status-out" : qty <= min ? "status-low" : "";
      //^ Same rating text as the preview card and the alerts ("4W · White · 0.05A")
      const details = getVariantSuffix(variant) || "-";
      return `<span class="variant-chip ${tone}">${escapeHtml(details)}: ${qty}</span>`;
    })
    .join("");

  return `
    <div class="d-flex flex-wrap gap-1 mt-1">${chips}</div>
    <div class="small text-muted">${variants.length} rating${variants.length === 1 ? "" : "s"}</div>
  `;
}

//* A product is low/out when any of its ratings reaches its own minimum —
//* the badge and the status filter share getProductStatusCode so they agree.
//* Order-based products show On order instead of any stock badge.
function getProductStatus(product) {
  if (isNotStockedProduct(product)) return `<span class="status-badge status-in">On order</span>`;
  const code = getProductStatusCode(product);
  if (code === "out") return `<span class="status-badge status-out">Out of stock</span>`;
  if (code === "low") return `<span class="status-badge status-low">Low stock</span>`;
  return `<span class="status-badge status-in">In stock</span>`;
}
