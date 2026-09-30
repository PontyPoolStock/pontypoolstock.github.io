import { fetchEntityImage } from "../services/api.js";
import {
  escapeHtml,
  formatCurrency,
  getCategoryLabel,
  getProductDisplayName,
  getProductStock,
  getProductStockValue,
  getProductStatusCode,
  getProductVariants,
  getVariantPriceRange,
  getVariantSuffix,
} from "../utils/helpers.js";

//* The product card behind a click on any product row: picture on the left, the
//* numbers a reorder decision needs on the right, and one line per rating.
//* List rows stay slim on purpose (no image bytes), so the picture is refilled
//* from the on-demand image fetch once the card is already open.
const MODAL_ID = "productPreviewModal";

let openPreview = null;
//* Work handed over by a click inside the card (Edit) — it runs only once the
//* card is fully gone, so two modals never fight over the backdrop.
let queuedAction = null;

export function openProductPreview(product, { categories = [], onEdit } = {}) {
  if (!product) return;
  closeProductPreview();

  document.body.insertAdjacentHTML("beforeend", previewHtml(product, categories));
  //^ A card that is still animating out is still in the DOM, so take the newest
  //^ element rather than the first match on the shared id.
  const modalElements = document.querySelectorAll(`#${MODAL_ID}`);
  const modalElement = modalElements[modalElements.length - 1];
  const modal = new bootstrap.Modal(modalElement);
  openPreview = { modal, modalElement };

  modalElement.addEventListener("hidden.bs.modal", () => {
    modalElement.remove();
    //^ Only the card that is still current may clear the shared state: a closed
    //^ card can finish its exit animation after a fresh one has opened.
    if (openPreview?.modalElement !== modalElement) return;
    openPreview = null;
    const action = queuedAction;
    queuedAction = null;
    if (typeof action === "function") action();
  });

  modalElement.querySelector("[data-preview-edit]")?.addEventListener("click", () => {
    if (typeof onEdit === "function") queuedAction = () => onEdit(product.id);
    modal.hide();
  });

  modal.show();
  loadPreviewImage(modalElement, product.id);
}

//* Drop the open card, if any (opening a fresh one replaces it). The element is
//* removed by the card's own hidden.bs.modal handler — removing it sooner would
//* leave Bootstrap's backdrop behind.
export function closeProductPreview() {
  if (!openPreview) return;
  const { modal } = openPreview;
  openPreview = null;
  queuedAction = null;
  modal.hide();
}

//* The picture lands after the card is on screen, so the layout never waits on
//* the network — a cached image is there in the same frame.
async function loadPreviewImage(modalElement, productId) {
  const media = modalElement.querySelector("[data-preview-media]");
  if (!media) return;

  const showEmpty = (message, icon) => {
    media.innerHTML = `
      <div class="product-preview-empty">
        <i class="bi ${icon}"></i>
        <span>${message}</span>
      </div>`;
  };

  const imageUrl = await fetchEntityImage("products", productId);
  if (!modalElement.isConnected || !media.isConnected) return;

  if (!imageUrl) {
    showEmpty("No image yet", "bi-image");
    return;
  }

  media.innerHTML = `<img class="product-preview-image" src="${escapeHtml(imageUrl)}" alt="Product image" loading="lazy" decoding="async" />`;
  const image = media.querySelector("img");
  if (image) image.onerror = () => showEmpty("Image unavailable", "bi-image");
}

function previewHtml(product, categories) {
  const variants = getProductVariants(product);
  const name = getProductDisplayName(product);
  const unit = String(product.unit || "").trim();
  const quantity = getProductStock(product);
  const priceRange = getVariantPriceRange(variants);
  const price = priceRange
    ? priceRange.min === priceRange.max
      ? formatCurrency(priceRange.min)
      : `${formatCurrency(priceRange.min)} – ${formatCurrency(priceRange.max)}`
    : formatCurrency(product.price);

  return `
    <div class="modal fade" id="${MODAL_ID}" tabindex="-1" aria-labelledby="${MODAL_ID}Title" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title fs-5" id="${MODAL_ID}Title">
              <i class="bi bi-eye text-warning"></i> Product preview
            </h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="product-preview">
              <div class="product-preview-media" data-preview-media>
                <div class="product-preview-empty">
                  <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
                  <span>Loading image…</span>
                </div>
              </div>

              <div>
                <h5 class="product-preview-name">${escapeHtml(name)}</h5>
                <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                  ${statusBadge(product)}
                  ${product.sku ? `<span class="sku-badge">${escapeHtml(product.sku)}</span>` : ""}
                </div>
                <div class="preview-detail-grid">
                  ${detailHtml("bi-tags", "Category", escapeHtml(getCategoryLabel(categories, product.categoryId)))}
                  ${detailHtml("bi-rulers", "Unit", unit ? escapeHtml(unit) : "—")}
                  ${detailHtml("bi-box-seam", "In stock", `${quantity}${unit ? ` ${escapeHtml(unit)}` : ""}`)}
                  ${detailHtml("bi-cash-stack", "Price", price)}
                  ${detailHtml("bi-graph-up-arrow", "Stock value", formatCurrency(getProductStockValue(product)))}
                  ${detailHtml("bi-list-ol", "Ratings", String(variants.length))}
                </div>
              </div>
            </div>

            <div class="mt-3">${ratingsHtml(product, variants, unit)}</div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-preview-edit>
              <i class="bi bi-pencil"></i> Edit
            </button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;
}

//* One line per rating: what it is, what it costs, how much is left and whether
//* that is enough — the same status logic the Products table and filter use.
function ratingsHtml(product, variants, unit) {
  if (!variants.length) {
    return `
      <div class="preview-ratings-empty">
        <i class="bi bi-info-circle"></i>
        <span>No ratings — this product is stocked as a single item.</span>
      </div>`;
  }

  const rows = variants
    .map((variant, index) => {
      const quantity = Number(variant.quantity) || 0;
      const min = Number(variant.reorderLevel) || 0;
      const tone = quantity <= 0 ? "status-out" : quantity <= min ? "status-low" : "";
      const label = getVariantSuffix(variant) || `Rating ${index + 1}`;
      const price = Number(variant.price) || 0;
      return `
        <tr>
          <td><span class="variant-chip ${tone}">${escapeHtml(label)}</span></td>
          <td class="text-end">${price > 0 ? formatCurrency(price) : "—"}</td>
          <td class="text-end">${quantity}${unit ? ` ${escapeHtml(unit)}` : ""}</td>
          <td class="text-end">${min}</td>
          <td>${ratingStatusBadge(quantity, min)}</td>
        </tr>`;
    })
    .join("");

  return `
    <div class="preview-section-title">
      <i class="bi bi-list-check"></i>
      <span>${variants.length} rating${variants.length === 1 ? "" : "s"} of ${escapeHtml(getProductDisplayName(product))}</span>
    </div>
    <div class="table-responsive">
      <table class="table table-sm align-middle product-preview-ratings mb-0">
        <thead>
          <tr>
            <th scope="col">Rating</th>
            <th scope="col" class="text-end">Price</th>
            <th scope="col" class="text-end">Stock</th>
            <th scope="col" class="text-end">Min</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function detailHtml(icon, label, value) {
  return `
    <div class="preview-detail">
      <span class="preview-detail-label"><i class="bi ${icon}"></i> ${label}</span>
      <span class="preview-detail-value">${value}</span>
    </div>`;
}

function statusBadge(product) {
  const code = getProductStatusCode(product);
  if (code === "out") return `<span class="status-badge status-out">Out of stock</span>`;
  if (code === "low") return `<span class="status-badge status-low">Low stock</span>`;
  return `<span class="status-badge status-in">In stock</span>`;
}

function ratingStatusBadge(quantity, min) {
  if (quantity <= 0) return `<span class="status-badge status-out">Out of stock</span>`;
  if (quantity <= min) return `<span class="status-badge status-low">Low stock</span>`;
  return `<span class="status-badge status-in">In stock</span>`;
}
