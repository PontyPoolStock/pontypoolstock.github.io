import {
  fetchData,
  hydrateEntityImages,
  PRODUCT_LIST_FIELDS,
  CATEGORY_LIST_FIELDS,
} from "../services/api.js";
import renderPagination, { paginateData } from "../components/pagination.js";
import { registerLowStockData } from "../components/lowstock.js";
import {
  escapeHtml,
  formatCurrency,
  getCategoryLabel,
  getLowStockProducts,
  getInventoryValueRowsSorted,
  getTotalInventoryValue,
  productThumbnailHtml,
} from "../utils/helpers.js";

let products = [];
let categories = [];

let lastLowStock = [];
let lowCurrentPage = 1;
let lowPAGE_SIZE = 5;

let lastValueRows = [];
let valueCurrentPage = 1;
let valuePAGE_SIZE = 5;

export async function loadReports() {
  //* Categories come along so every low-stock row can name where it belongs
  const [raw, categoryData] = await Promise.all([
    fetchData(`products?fields=${PRODUCT_LIST_FIELDS}`),
    fetchData(`categories?fields=${CATEGORY_LIST_FIELDS}`),
  ]);
  products = Array.isArray(raw) ? raw : [];
  categories = Array.isArray(categoryData) ? categoryData : [];
  lowCurrentPage = 1;
  valueCurrentPage = 1;
  renderReports();
  setupEventListeners();
  hydrateEntityImages(document.getElementById("pageContent"));
}

function renderReports() {
  lastLowStock = getLowStockProducts(products);
  lastValueRows = getInventoryValueRowsSorted(products);
  const totalValue = getTotalInventoryValue(products);
  registerLowStockData(lastLowStock, categories);

  const summaryHtml = `
    <div class="row g-3">
      <div class="col-md-4">
        <div class="card border-primary shadow-sm h-100">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-box text-primary"></i>
              <div class="fw-semibold">Total Products</div>
            </div>
            <div class="fs-4 fw-bold mt-2">${products.length}</div>
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="card border-warning shadow-sm h-100 report-card-action" role="button" tabindex="0"
          data-low-stock-open aria-label="View low stock products">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-exclamation-triangle text-warning"></i>
              <div class="fw-semibold">Low Stock Items</div>
            </div>
            <div class="fs-4 fw-bold mt-2">${lastLowStock.length}</div>
            <div class="small dashboard-stat-hint mt-1">
              View list <i class="bi bi-chevron-right"></i>
            </div>
          </div>
        </div>
      </div>

      <div class="col-md-4">
        <div class="card border-success shadow-sm h-100">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2">
              <i class="bi bi-currency-dollar text-success"></i>
              <div class="fw-semibold">Total Inventory Value</div>
            </div>
            <div class="fs-4 fw-bold mt-2">${formatCurrency(totalValue)}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const html = `
    <div id="reportsPage">
    <div class="row g-3 mb-4">
      <div class="col-lg-6">
        <div class="card shadow-sm h-100">
          <div class="card-body">
            <div class="d-flex align-items-center justify-content-between gap-2 mb-2">
              <div class="d-flex align-items-center gap-2">
                <i class="bi bi-exclamation-circle text-warning"></i>
                <div class="fw-semibold">Low Stock Report</div>
              </div>
              <button type="button" class="panel-view-all" data-low-stock-open>
                View list <i class="bi bi-chevron-right"></i>
              </button>
            </div>
            <div class="text-muted small mb-3">Products at or below reorder level</div>
            <div id="reportsLowStockContainer">
              ${getLowStockSectionHtml(lastLowStock)}
            </div>
          </div>
        </div>
      </div>

      <div class="col-lg-6">
        <div class="card shadow-sm h-100">
          <div class="card-body">
            <div class="d-flex align-items-center gap-2 mb-2">
              <i class="bi bi-currency-dollar text-success"></i>
              <div class="fw-semibold">Inventory Value Report</div>
            </div>
            <div class="text-muted small mb-3">Total value per product</div>
            <div id="reportsValueContainer">
              ${getValueSectionHtml(lastValueRows)}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="card shadow-sm">
      <div class="card-body">
        <div class="fw-semibold mb-3">Summary</div>
        ${summaryHtml}
      </div>
    </div>
    </div>
  `;

  document.getElementById("pageContent").innerHTML = html;
}

//* table + pagination for low stock
function getLowStockSectionHtml(filteredLowStock = lastLowStock) {
  const paginated = paginateData(
    filteredLowStock,
    lowCurrentPage,
    lowPAGE_SIZE,
  );

  const tablePart = filteredLowStock.length
    ? renderLowStockTable(paginated)
    : `<div class="text-muted">No low-stock products.</div>`;

  const paginationPart =
    filteredLowStock.length > 0
      ? renderPagination(
        filteredLowStock.length,
        lowCurrentPage,
        lowPAGE_SIZE,
      )
      : "";

  return tablePart + paginationPart;
}

//* table + pagination for value report
function getValueSectionHtml(filteredValueRows = lastValueRows) {
  const paginated = paginateData(
    filteredValueRows,
    valueCurrentPage,
    valuePAGE_SIZE,
  );

  const tablePart = filteredValueRows.length
    ? renderValueTable(paginated)
    : `<div class="text-muted">No inventory value data.</div>`;

  const paginationPart =
    filteredValueRows.length > 0
      ? renderPagination(
        filteredValueRows.length,
        valueCurrentPage,
        valuePAGE_SIZE,
      )
      : "";

  return tablePart + paginationPart;
}

//* for all event listeners
function setupEventListeners() {
  document
    .querySelector("#reportsLowStockContainer")
    .addEventListener("click", function (e) {
      //& pagination
      const pageBtn = e.target.closest(".page-link");
      if (pageBtn) {
        const page = Number(pageBtn.dataset.page);
        const totalPages = Math.ceil(lastLowStock.length / lowPAGE_SIZE);
        if (page < 1 || page > totalPages) return;
        lowCurrentPage = page;
        document.getElementById("reportsLowStockContainer").innerHTML =
          getLowStockSectionHtml(lastLowStock);
        return;
      }
    });

  //& Limit
  document
    .querySelector("#reportsLowStockContainer")
    .addEventListener("change", (e) => {
      const pageSizeSelect = e.target.closest(".page-size-select");
      if (pageSizeSelect) {
        lowPAGE_SIZE = Number(pageSizeSelect.value);
        lowCurrentPage = 1;
        document.getElementById("reportsLowStockContainer").innerHTML =
          getLowStockSectionHtml(lastLowStock);
        return;
      }
    });

  document
    .querySelector("#reportsValueContainer")
    .addEventListener("click", function (e) {
      //& pagination
      const pageBtn = e.target.closest(".page-link");
      if (pageBtn) {
        const page = Number(pageBtn.dataset.page);
        const totalPages = Math.ceil(lastValueRows.length / valuePAGE_SIZE);
        if (page < 1 || page > totalPages) return;
        valueCurrentPage = page;
        document.getElementById("reportsValueContainer").innerHTML =
          getValueSectionHtml(lastValueRows);
        return;
      }
    });

  //& Limit
  document
    .querySelector("#reportsValueContainer")
    .addEventListener("change", (e) => {
      const pageSizeSelect = e.target.closest(".page-size-select");
      if (pageSizeSelect) {
        valuePAGE_SIZE = Number(pageSizeSelect.value);
        valueCurrentPage = 1;
        document.getElementById("reportsValueContainer").innerHTML =
          getValueSectionHtml(lastValueRows);
        return;
      }
    });
}

function renderLowStockTable(lowStockSlice) {
  let rowsHtml = "";

  for (let i = 0; i < lowStockSlice.length; i++) {
    let p = lowStockSlice[i];
    let qty = Number(p.quantity);

    let qtyClass = qty <= 0 ? "status-out" : "status-low";

    //* Picture, code, name and category, so a reorder never needs another page
    rowsHtml += `
      <tr>
        <td>
          <div class="d-flex align-items-center gap-2">
            ${productThumbnailHtml(p.imageUrl, p.name, { sizeClass: "entity-thumbnail-sm", productId: p.id })}
            <div>
              <div class="fw-semibold">${escapeHtml(p.name)}</div>
              <div class="small text-muted">
                ${p.sku ? `<span class="sku-badge">${escapeHtml(p.sku)}</span>` : "-"}
              </div>
            </div>
          </div>
        </td>
        <td class="text-muted">${escapeHtml(getCategoryLabel(categories, p.categoryId))}</td>
        <td>
          <span class="status-badge ${qtyClass}">${qty}</span>
        </td>
        <td class="text-muted">${p.reorderLevel}</td>
      </tr>
    `;
  }

  return `
    <div class="table-responsive">
      <table class="table table-hover align-middle mb-0">
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th>Qty</th>
            <th>Min</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}

function renderValueTable(valueRowsSlice) {
  let rowsHtml = "";

  for (let i = 0; i < valueRowsSlice.length; i++) {
    let r = valueRowsSlice[i];

    rowsHtml += `
      <tr>
        <td class="fw-semibold">${escapeHtml(r.name)}</td>
        <td class="fw-bold text-end">${formatCurrency(r.value)}</td>
      </tr>
    `;
  }

  return `
    <div class="table-responsive">
      <table class="table table-hover align-middle mb-0">
        <thead>
          <tr>
            <th>Product</th>
            <th class="text-end">Value</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
  `;
}
