import renderTable from "../components/table.js";
import renderPagination, { paginateData } from "../components/pagination.js";
import { fetchData, postData, updateData, PRODUCT_ADJUSTMENT_FIELDS } from "../services/api.js";
import { getModal } from "../components/modal.js";
import { escapeHtml, getProductDisplayName, debounce, isNotStockedProduct } from "../utils/helpers.js";
import { showToast } from "../components/toast.js";

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
  <button class="btn btn-outline-primary btn-sm px-3 text-nowrap" id="bulkAddBtn">
    <i class="bi bi-plus-square"></i> Bulk Add Stock
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
    .getElementById("bulkAddBtn")
    ?.addEventListener("click", handleBulkAdd);

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
      if (!pageSizeSelect) return;
      PAGE_SIZE = Number(pageSizeSelect.value);
      currentPage = 1;
      document.getElementById("stockAdjustmentsTableContainer").innerHTML =
        getTableHtml(lastFiltered);
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

function handleBulkAdd() {
  fetchData("products?fields=" + PRODUCT_ADJUSTMENT_FIELDS).then((allProducts) => {
    const prods = (Array.isArray(allProducts) ? allProducts : []).filter((p) => !isNotStockedProduct(p));
    if (!prods.length) {
      showToast("No products available for bulk stock add.", "warning");
      return;
    }

    const rows = prods.map((p) => {
      const variants = getProductVariants(p);
      const qty = variants.length ? getVariantsTotalQuantity(variants) : Number(p.quantity) || 0;
      return `
        <tr data-product-id="${p.id}" data-product-name="${escapeHtml(getProductDisplayName(p))}">
          <td class="fw-medium">${escapeHtml(getProductDisplayName(p))}</td>
          <td class="text-end text-muted">${qty}</td>
          <td class="text-center">
            <input type="number" min="0" step="1" class="form-control form-control-sm bulk-qty-input text-center" placeholder="0" style="width:80px;margin:0 auto;">
          </td>
        </tr>`;
    }).join("");

    const html = `
      <div class="modal fade" id="bulkAddModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header border-bottom-0">
              <h5 class="modal-title"><i class="bi bi-plus-square me-2"></i>Bulk Add Stock</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body pt-0">
              <p class="text-muted small mb-3">Enter quantities for products you want to add stock to. Products with 0 are skipped. Press <strong>Apply</strong> to save all at once.</p>
              <div class="input-group mb-3">
                <span class="input-group-text bg-white"><i class="bi bi-search"></i></span>
                <input type="text" class="form-control" id="bulkSearch" placeholder="Search products...">
              </div>
              <div class="border rounded" style="max-height:400px;overflow-y:auto;">
                <table class="table table-sm align-middle mb-0">
                  <thead class="sticky-top bg-light">
                    <tr><th>Product</th><th class="text-end">Current Stock</th><th class="text-center">Add Qty</th></tr>
                  </thead>
                  <tbody id="bulkTableBody">${rows}</tbody>
                </table>
              </div>
            </div>
            <div class="modal-footer">
              <span class="text-muted small me-auto" id="bulkCountLabel">0 products to update</span>
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-primary" id="bulkSaveBtn">
                <i class="bi bi-check-lg"></i> Apply
              </button>
            </div>
          </div>
        </div>
      </div>`;

    document.querySelector("#bulkAddModal")?.remove();
    document.body.insertAdjacentHTML("beforeend", html);
    const modalEl = document.getElementById("bulkAddModal");
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    const searchInput = document.getElementById("bulkSearch");
    searchInput?.addEventListener("input", () => {
      const term = searchInput.value.toLowerCase().trim();
      const rows = modalEl.querySelectorAll("#bulkTableBody tr");
      for (const row of rows) {
        const name = row.querySelector("td:first-child")?.textContent?.toLowerCase() || "";
        row.style.display = !term || name.includes(term) ? "" : "none";
      }
    });

    const updateCount = () => {
      const inputs = modalEl.querySelectorAll(".bulk-qty-input");
      let count = 0;
      for (const input of inputs) {
        if (Number(input.value || 0) > 0) count++;
      }
      const label = document.getElementById("bulkCountLabel");
      if (label) label.textContent = `${count} product${count === 1 ? "" : "s"} to update`;
    };
    modalEl.addEventListener("input", updateCount);

    document.getElementById("bulkSaveBtn").addEventListener("click", async () => {
      const inputs = modalEl.querySelectorAll(".bulk-qty-input");
      const tasks = [];
      for (const input of inputs) {
        const q = Math.trunc(Number(input.value || 0));
        if (q <= 0) continue;
        const row = input.closest("tr");
        const pid = row?.dataset?.productId;
        const pname = row?.dataset?.productName;
        tasks.push({ pid, pname, qty: q });
      }
      if (!tasks.length) {
        showToast("No quantities entered.", "warning");
        return;
      }
      const saveBtn = document.getElementById("bulkSaveBtn");
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving...';
      const now = new Date().toISOString();
      const promises = tasks.map(async (t) => {
        try {
          const prod = await fetchData(`products/${t.pid}`);
          const currentQty = Number(prod?.quantity) || 0;
          const newQty = currentQty + t.qty;
          await Promise.all([
            postData("stockAdjustments", {
              productId: t.pid,
              productName: t.pname,
              type: "increase",
              quantity: t.qty,
              date: now,
              oldQuantity: currentQty,
              newQuantity: newQty,
            }),
            updateData("products", t.pid, { quantity: newQty }),
          ]);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e?.message || "Failed" };
        }
      });
      const results = await Promise.all(promises);
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="bi bi-check-lg"></i> Apply';
      const failed = results.filter((r) => !r.ok).length;
      if (failed === 0) {
        showToast(`Added stock to ${tasks.length} product${tasks.length === 1 ? "" : "s"}.`, "success");
        modal.hide();
        await loadData();
        lastFiltered = [...adjustments];
        currentPage = 1;
        document.getElementById("stockAdjustmentsTableContainer").innerHTML = getTableHtml(lastFiltered);
      } else {
        showToast(`${tasks.length - failed} of ${tasks.length} succeeded; ${failed} failed.`, "warning");
      }
    });
  }).catch((err) => {
    showToast("Could not load products for bulk add.", "danger");
  });
}

function handleAddAdjustment() {
  getModal("stockAdjustments", "Add", "", async function () {
    await loadData();
    filterAdjustments();
  });
}