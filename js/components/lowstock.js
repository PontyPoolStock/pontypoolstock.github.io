import renderTable from "./table.js";
import {
  escapeHtml,
  getCategoryLabel,
  productThumbnailHtml,
} from "../utils/helpers.js";

//* One shared Low Stock list for the whole app: the Dashboard card and alert,
//* the Statistics card and the Reports summary all open this modal, so the
//* figure on screen and the list behind it always describe the same stock.
const MODAL_ID = "lowStockModal";
const TRIGGER_SELECTOR = "[data-low-stock-open]";
const COLUMNS = ["image", "sku", "name", "category", "quantity", "min", "status"];

//* Latest snapshot, refreshed by whichever page is on screen
let lowStockLines = [];
let categories = [];
let openModal = null;

//* Pages call this right before rendering, with the very rows behind their number
export function registerLowStockData(lines, categoryList = []) {
  lowStockLines = Array.isArray(lines) ? lines : [];
  categories = Array.isArray(categoryList) ? categoryList : [];
}

export function openLowStockList() {
  //* One list at a time — rebuilding a shown modal would strand its backdrop
  if (openModal) return;

  const rows = lowStockLines.map(toRow);
  const listHtml = rows.length
    ? renderTable(rows, COLUMNS, false)
    : `<p class="text-muted mb-0"><i class="bi bi-check2-circle text-success"></i> All products are sufficiently stocked.</p>`;

  const html = `
    <div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-labelledby="${MODAL_ID}Title" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title fs-5" id="${MODAL_ID}Title">
              <i class="bi bi-exclamation-triangle text-warning"></i> Low Stock Products
            </h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="text-muted small mb-3">
              ${rows.length} item${rows.length === 1 ? "" : "s"} at or below reorder level.
            </p>
            ${listHtml}
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;

  document.body.insertAdjacentHTML("beforeend", html);
  const modalElement = document.getElementById(MODAL_ID);
  openModal = new bootstrap.Modal(modalElement);
  modalElement.addEventListener("hidden.bs.modal", () => {
    modalElement.remove();
    openModal = null;
  });
  openModal.show();
}

//* One row per rating ("St64 12W"), carrying what a reorder decision needs:
//* picture, code, name, category, how much is left and where it should sit
function toRow(line) {
  const quantity = Number(line.quantity) || 0;
  const tone = quantity <= 0 ? "status-out" : "status-low";
  return {
    id: line.id,
    image: productThumbnailHtml(line.imageUrl, line.name, { sizeClass: "entity-thumbnail-sm" }),
    sku: line.sku ? `<span class="sku-badge">${escapeHtml(line.sku)}</span>` : "-",
    name: `<span class="fw-semibold">${escapeHtml(line.name)}</span>`,
    category: escapeHtml(getCategoryLabel(categories, line.categoryId)),
    quantity: `${quantity}${line.unit ? ` ${escapeHtml(line.unit)}` : ""}`,
    min: Number(line.reorderLevel) || 0,
    status: `<span class="status-badge ${tone}">${quantity <= 0 ? "Out of stock" : "Low stock"}</span>`,
  };
}

//* Delegated triggers: pages rebuild their DOM on every render (a Statistics
//* period change, reports pagination), so a single document-level handler keeps
//* the buttons working without ever stacking duplicate listeners.
document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest(TRIGGER_SELECTOR)) openLowStockList();
});

//* Cards standing in for buttons need the keyboard path spelled out; real
//* buttons already dispatch a click for Enter and Space.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!(event.target instanceof Element)) return;
  const trigger = event.target.closest(TRIGGER_SELECTOR);
  if (!trigger || trigger.tagName === "BUTTON") return;
  event.preventDefault();
  openLowStockList();
});
