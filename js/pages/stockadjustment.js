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
  <button class="btn btn-outline-primary btn-sm px-3 text-nowrap" id="bulkOpsBtn">
    <i class="bi bi-pencil-square"></i> Bulk Operations
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
    .getElementById("bulkOpsBtn")
    ?.addEventListener("click", handleBulkOps);

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

function handleBulkOps() {
  fetchData("products?fields=" + PRODUCT_ADJUSTMENT_FIELDS).then((allProducts) => {
    const prods = (Array.isArray(allProducts) ? allProducts : []).filter((p) => !isNotStockedProduct(p));
    if (!prods.length) {
      showToast("No products available for bulk operations.", "warning");
      return;
    }

    const rows = prods.map((p) => {
      const variants = getProductVariants(p);
      const qty = variants.length ? getVariantsTotalQuantity(variants) : Number(p.quantity) || 0;
      return `
        <tr data-product-id="${p.id}" data-product-name="${escapeHtml(getProductDisplayName(p))}" data-original-qty="${qty}" data-original-price="${Number(p.price) || 0}">
          <td class="fw-medium">${escapeHtml(getProductDisplayName(p))}</td>
          <td class="text-end text-muted current-qty">${qty}</td>
          <td class="text-center">
            <input type="number" min="0" step="1" class="form-control form-control-sm bulk-add-qty text-center" placeholder="0" style="width:70px;margin:0 auto;">
          </td>
          <td class="text-center">
            <input type="number" min="0" step="1" class="form-control form-control-sm bulk-remove-qty text-center" placeholder="0" style="width:70px;margin:0 auto;">
          </td>
          <td class="text-end">
            <input type="number" min="0" step="0.01" class="form-control form-control-sm bulk-price text-end" value="${Number(p.price) || 0}" style="width:80px;margin:0 auto;">
          </td>
        </tr>`;
    }).join("");

    const html = `
      <div class="modal fade" id="bulkOpsModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-xl modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header border-bottom-0">
              <h5 class="modal-title"><i class="bi bi-pencil-square me-2"></i>Bulk Operations</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body pt-0">
              <p class="text-muted small mb-3">
                Change multiple products at once. Set quantities to add/remove, or edit prices. Products with no changes are skipped.
                Press <strong>Review Changes</strong> to see a summary before applying.
              </p>
              <div class="input-group mb-3">
                <span class="input-group-text bg-white"><i class="bi bi-search"></i></span>
                <input type="text" class="form-control" id="bulkSearch" placeholder="Search products...">
              </div>
              <div class="border rounded" style="max-height:350px;overflow-y:auto;">
                <table class="table table-sm align-middle mb-0">
                  <thead class="sticky-top bg-light">
                    <tr><th>Product</th><th class="text-end">Current Stock</th><th class="text-center">Add Qty</th><th class="text-center">Remove Qty</th><th class="text-end">Price</th></tr>
                  </thead>
                  <tbody id="bulkTableBody">${rows}</tbody>
                </table>
              </div>
              <div id="bulkSummary" class="mt-3 d-none">
                <h6 class="fw-bold mb-2"><i class="bi bi-list-check me-1"></i>Changes to Apply:</h6>
                <ul class="list-group small" id="bulkSummaryList"></ul>
              </div>
            </div>
            <div class="modal-footer">
              <span class="text-muted small me-auto" id="bulkCountLabel">0 changes pending</span>
              <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-secondary" id="bulkReviewBtn">
                <i class="bi bi-eye"></i> Review Changes
              </button>
              <button type="button" class="btn btn-primary d-none" id="bulkApplyBtn">
                <i class="bi bi-check-lg"></i> Apply All Changes
              </button>
            </div>
          </div>
        </div>
      </div>`;

    document.querySelector("#bulkOpsModal")?.remove();
    document.body.insertAdjacentHTML("beforeend", html);
    const modalEl = document.getElementById("bulkOpsModal");
    const modal = new bootstrap.Modal(modalEl);
    modal.show();

    // Live search filter
    const searchInput = document.getElementById("bulkSearch");
    searchInput?.addEventListener("input", () => {
      const term = searchInput.value.toLowerCase().trim();
      const rows = modalEl.querySelectorAll("#bulkTableBody tr");
      for (const row of rows) {
        const name = row.querySelector("td:first-child")?.textContent?.toLowerCase() || "";
        row.style.display = !term || name.includes(term) ? "" : "none";
      }
    });

    // Update count label
    const updateCount = () => {
      const addInputs = modalEl.querySelectorAll(".bulk-add-qty");
      const removeInputs = modalEl.querySelectorAll(".bulk-remove-qty");
      const priceInputs = modalEl.querySelectorAll(".bulk-price");
      let changes = 0;
      for (const input of addInputs) {
        if (Number(input.value || 0) > 0) changes++;
      }
      for (const input of removeInputs) {
        if (Number(input.value || 0) > 0) changes++;
      }
      for (const input of priceInputs) {
        const row = input.closest("tr");
        const original = Number(row?.dataset?.originalPrice || 0);
        if (Number(input.value || 0) !== original) changes++;
      }
      const label = document.getElementById("bulkCountLabel");
      if (label) label.textContent = `${changes} change${changes === 1 ? "" : "s"} pending`;
    };
    modalEl.addEventListener("input", updateCount);

    // Review changes
    document.getElementById("bulkReviewBtn").addEventListener("click", () => {
      const rows = modalEl.querySelectorAll("#bulkTableBody tr");
      const changes = [];
      for (const row of rows) {
        const name = row.dataset.productName || row.querySelector("td:first-child")?.textContent || "";
        const pid = row.dataset.productId;
        const currentQty = Number(row.dataset.originalQty || 0);
        const addQty = Number(row.querySelector(".bulk-add-qty")?.value || 0);
        const removeQty = Number(row.querySelector(".bulk-remove-qty")?.value || 0);
        const newPrice = Number(row.querySelector(".bulk-price")?.value || 0);
        const originalPrice = Number(row.dataset.originalPrice || 0);
        if (addQty > 0) changes.push({ name, pid, action: "Add", detail: `+${addQty} stock (new total: ${currentQty + addQty})` });
        if (removeQty > 0) changes.push({ name, pid, action: "Remove", detail: `-${removeQty} stock (new total: ${Math.max(0, currentQty - removeQty)})` });
        if (newPrice !== originalPrice) changes.push({ name, pid, action: "Price", detail: `${formatCurrency(originalPrice)} → ${formatCurrency(newPrice)}` });
      }

      const summaryEl = document.getElementById("bulkSummary");
      const summaryList = document.getElementById("bulkSummaryList");
      if (!changes.length) {
        showToast("No changes to apply.", "warning");
        if (summaryEl) summaryEl.classList.add("d-none");
        return;
      }
      if (summaryEl && summaryList) {
        summaryEl.classList.remove("d-none");
        summaryList.innerHTML = changes.map((c) => `
          <li class="list-group-item d-flex justify-content-between align-items-center py-1">
            <span><strong>${escapeHtml(c.name)}</strong></span>
            <span class="badge ${c.action === "Add" ? "bg-success" : c.action === "Remove" ? "bg-danger" : "bg-warning text-dark"}">${c.action}: ${c.detail}</span>
          </li>`).join("");
      }
      // Show apply button
      document.getElementById("bulkApplyBtn")?.classList.remove("d-none");
    });

    // Apply all changes
    document.getElementById("bulkApplyBtn").addEventListener("click", async () => {
      const rows = modalEl.querySelectorAll("#bulkTableBody tr");
      const tasks = [];
      for (const row of rows) {
        const pid = row.dataset.productId;
        const pname = row.dataset.productName;
        const currentQty = Number(row.dataset.originalQty || 0);
        const addQty = Math.trunc(Number(row.querySelector(".bulk-add-qty")?.value || 0));
        const removeQty = Math.trunc(Number(row.querySelector(".bulk-remove-qty")?.value || 0));
        const newPrice = Number(row.querySelector(".bulk-price")?.value || 0);
        const originalPrice = Number(row.dataset.originalPrice || 0);
        if (addQty <= 0 && removeQty <= 0 && newPrice === originalPrice) continue;
        tasks.push({ pid, pname, currentQty, addQty, removeQty, newPrice, originalPrice });
      }
      if (!tasks.length) {
        showToast("No changes to apply.", "warning");
        return;
      }
      const applyBtn = document.getElementById("bulkApplyBtn");
      applyBtn.disabled = true;
      applyBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Applying...';
      const now = new Date().toISOString();
      const promises = tasks.map(async (t) => {
        try {
          const prod = await fetchData(`products/${t.pid}`);
          const currentQty = Number(prod?.quantity) || t.currentQty;
          const netChange = t.addQty - t.removeQty;
          const newQty = Math.max(0, currentQty + netChange);
          const updates = [];
          // Stock adjustments
          if (t.addQty > 0) {
            updates.push(postData("stockAdjustments", {
              productId: t.pid,
              productName: t.pname,
              type: "increase",
              quantity: t.addQty,
              date: now,
              oldQuantity: currentQty,
              newQuantity: currentQty + t.addQty,
            }));
          }
          if (t.removeQty > 0) {
            updates.push(postData("stockAdjustments", {
              productId: t.pid,
              productName: t.pname,
              type: "decrease",
              quantity: t.removeQty,
              date: now,
              oldQuantity: currentQty,
              newQuantity: Math.max(0, currentQty - t.removeQty),
            }));
          }
          // Product update
          const productUpdate = {};
          if (netChange !== 0) productUpdate.quantity = newQty;
          if (t.newPrice !== t.originalPrice) productUpdate.price = t.newPrice;
          if (Object.keys(productUpdate).length) {
            updates.push(updateData("products", t.pid, productUpdate));
          }
          await Promise.all(updates);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e?.message || "Failed" };
        }
      });
      const results = await Promise.all(promises);
      applyBtn.disabled = false;
      applyBtn.innerHTML = '<i class="bi bi-check-lg"></i> Apply All Changes';
      const failed = results.filter((r) => !r.ok).length;
      if (failed === 0) {
        showToast(`Applied ${tasks.length} change${tasks.length === 1 ? "" : "s"} successfully.`, "success");
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
    showToast("Could not load products for bulk operations.", "danger");
  });
}

function handleAddAdjustment() {
  getModal("stockAdjustments", "Add", "", async function () {
    await loadData();
    filterAdjustments();
  });
}