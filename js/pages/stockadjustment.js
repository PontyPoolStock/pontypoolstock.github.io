import renderTable from "../components/table.js";
import renderPagination, { paginateData } from "../components/pagination.js";
import { fetchData, PRODUCT_ADJUSTMENT_FIELDS } from "../services/api.js";
import { getModal } from "../components/modal.js";
import { escapeHtml, getProductDisplayName, debounce } from "../utils/helpers.js";

let adjustments = [];
let lastFiltered = [];
let currentPage = 1;
let PAGE_SIZE = 5;

export async function loadStockAdjustments() {
  await loadData();
  lastFiltered = [...adjustments];
  renderStockAdjustmentsPage();
  setupEventListeners();
}

async function loadData() {
  const [adjustmentData] = await Promise.all([
    fetchData("stockAdjustments"),
    // Warm the New Adjustment modal's product dropdown (same cache key the
    // form and save-validation use) so the modal body fills instantly.
    fetchData(`products?fields=${PRODUCT_ADJUSTMENT_FIELDS}`),
  ]);
  adjustments = Array.isArray(adjustmentData) ? adjustmentData : [];
  adjustments.sort((a, b) => new Date(b.date) - new Date(a.date));
}

function renderStockAdjustmentsPage() {
  const html = `
  <div class="d-flex gap-2 mb-3 align-items-center flex-wrap p-3 bg-white rounded border page-filter-bar">
  <i class="bi bi-search text-muted d-none d-sm-block"></i>
  <input type="text" id="searchAdj" placeholder="Search adjustments..."
    class="form-control form-control-sm border-0 shadow-none" style="flex:1; min-width:150px;">
  <select id="typeFilter" class="form-select form-select-sm border-0 shadow-none w-auto">
    <option value="">All Types</option>
    <option value="increase">Add Stock</option>
    <option value="decrease">Remove Stock</option>
  </select>
  <button class="btn btn-primary btn-sm px-3 ms-auto text-nowrap" id="addAdjustmentBtn">
    <i class="bi bi-sliders"></i> New Adjustment
  </button>
</div>

    <div id="searchStats" class="mb-2 small text-muted"></div>

    <div id="stockAdjustmentsTableContainer">
      ${getTableHtml()}
    </div>
  `;

  document.getElementById("pageContent").innerHTML = html;
}

function getTableHtml(filteredList = adjustments) {
  const paginated = paginateData(filteredList, currentPage, PAGE_SIZE);

  const tableData = paginated.map((a) => ({
    id: a.id,
    date: formatAdjustmentDate(a.date),
    product: escapeHtml(getProductDisplayName(a.productName)),
    type: typeBadgeHtml(a.type),
    quantity: a.quantity,
    reason: escapeHtml(a.reason || ""),
  }));

  const columns = ["date", "product", "type", "quantity", "reason"];

  return (
    renderTable(tableData, columns, false)
    + renderPagination(filteredList.length, currentPage, PAGE_SIZE)
  );
}

function formatAdjustmentDate(dateStr) {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-CA");
}

function typeBadgeHtml(type) {
  if (type === "increase") {
    return `<span class="badge rounded-pill adjustment-badge-increase">+ Add</span>`;
  }
  return `<span class="badge rounded-pill adjustment-badge-decrease">− Remove</span>`;
}

function setupEventListeners() {
  document
    .getElementById("searchAdj")
    ?.addEventListener("input", debounce(filterAdjustments, 120));

  document
    .getElementById("typeFilter")
    ?.addEventListener("change", filterAdjustments);

  document
    .getElementById("addAdjustmentBtn")
    ?.addEventListener("click", handleAddAdjustment);

  document
    .querySelector("#stockAdjustmentsTableContainer")
    .addEventListener("click", function (e) {
      const pageBtn = e.target.closest(".page-link");
      if (pageBtn) {
        const page = Number(pageBtn.dataset.page);
        const totalPages = Math.ceil(lastFiltered.length / PAGE_SIZE);
        if (page < 1 || page > totalPages) return;
        currentPage = page;
        document.getElementById("stockAdjustmentsTableContainer").innerHTML =
          getTableHtml(lastFiltered);
        return;
      }
    });

  document
    .querySelector("#stockAdjustmentsTableContainer")
    .addEventListener("change", function (e) {
      const pageSizeSelect = e.target.closest(".page-size-select");
      if (pageSizeSelect) {
        PAGE_SIZE = Number(pageSizeSelect.value);
        currentPage = 1;
        document.getElementById("stockAdjustmentsTableContainer").innerHTML =
          getTableHtml(lastFiltered);
      }
    });
}

function filterAdjustments() {
  let searchTerm = document.getElementById("searchAdj").value.toLowerCase();
  let typeFilter = document.getElementById("typeFilter").value;

  let filtered = adjustments.filter((a) => {
    if (searchTerm) {
      let matches =
        (a.productName || "").toLowerCase().includes(searchTerm)
        || (a.reason || "").toLowerCase().includes(searchTerm);
      if (!matches) return false;
    }

    if (typeFilter && a.type !== typeFilter) return false;

    return true;
  });

  lastFiltered = filtered;
  currentPage = 1;

  document.getElementById("stockAdjustmentsTableContainer").innerHTML =
    getTableHtml(filtered);

  updateStats(filtered.length, searchTerm, typeFilter);
}

function updateStats(count, searchTerm, typeFilter) {
  let statsDiv = document.getElementById("searchStats");
  if (!statsDiv) return;
  statsDiv.innerHTML =
    searchTerm || typeFilter
      ? `Found ${count} adjustment${count !== 1 ? "s" : ""}`
      : "";
}

function handleAddAdjustment() {
  getModal("stockAdjustments", "Add", "", async function () {
    await loadData();
    filterAdjustments();
  });
}
