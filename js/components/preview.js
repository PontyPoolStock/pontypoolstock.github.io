import { fetchEntityImage, hydrateEntityImages } from "../services/api.js";
import renderTable from "./table.js";
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
  isNotStockedProduct,
  productThumbnailHtml,
} from "../utils/helpers.js";

//* The cards behind a click on a list row: a product card (picture + the numbers
//* a reorder decision needs + one line per rating) and a category card (what is
//* inside that category, summarised). List rows stay slim on purpose — no image
//* bytes — so pictures are refilled from the on-demand image fetch once a card is
//* already open.
const PRODUCT_CARD_ID = "productPreviewModal";
const CATEGORY_CARD_ID = "categoryPreviewModal";

let openCard = null;
//* Work handed over by a click inside a card (Edit, or opening a product from a
//* category) — it runs only once that card is fully gone, so two modals never
//* fight over the backdrop.
let queuedAction = null;

//* Insert a card, show it, and keep the shared state honest. The element is
//* removed by its own hidden.bs.modal handler — removing it sooner would leave
//* Bootstrap's backdrop behind.
function mountCard(modalId, html) {
  closePreviewCard();
  document.body.insertAdjacentHTML("beforeend", html);

  //^ A card that is still animating out is still in the DOM, so take the newest
  //^ element rather than the first match on the shared id.
  const elements = document.querySelectorAll(`#${modalId}`);
  const modalElement = elements[elements.length - 1];
  const modal = new bootstrap.Modal(modalElement);
  openCard = { modal, modalElement };

  modalElement.addEventListener("hidden.bs.modal", () => {
    modalElement.remove();
    //^ Only the card that is still current may clear the shared state: a closed
    //^ card can finish its exit animation after a fresh one has opened.
    if (openCard?.modalElement !== modalElement) return;
    openCard = null;
    const action = queuedAction;
    queuedAction = null;
    if (typeof action === "function") action();
  });

  modal.show();
  return modalElement;
}

//* Close the current card and run `action` once it is out of the way
function handOver(action) {
  queuedAction = typeof action === "function" ? action : null;
  openCard?.modal.hide();
}

//* Drop the open card, if any (opening a fresh one replaces it)
export function closePreviewCard() {
  if (!openCard) return;
  const { modal } = openCard;
  openCard = null;
  queuedAction = null;
  modal.hide();
}

export function openProductPreview(product, { categories = [], onEdit } = {}) {
  if (!product) return;

  const modalElement = mountCard(PRODUCT_CARD_ID, productCardHtml(product, categories));
  modalElement
    .querySelector("[data-preview-edit]")
    ?.addEventListener("click", () => handOver(() => onEdit?.(product.id)));

  loadPreviewImage(modalElement, "products", product.id);
}

//* What is inside one category: how many products, how much stock they hold, what
//* it is worth, and the products themselves (click one to open its own card).
export function openCategoryPreview(
  category,
  { categories = [], products = [], onEdit, onProductEdit } = {},
) {
  if (!category) return;

  const items = productsInCategory(products, category.id);
  const modalElement = mountCard(
    CATEGORY_CARD_ID,
    categoryCardHtml(category, items),
  );

  modalElement
    .querySelector("[data-preview-edit]")
    ?.addEventListener("click", () => handOver(() => onEdit?.(category.id)));

  const openFromRow = (row) => {
    const product = items.find((p) => String(p.id) === row.dataset.id);
    if (!product) return;
    //^ Swap one card for the next: the product's Edit button then edits the
    //^ product, not the category we came from
    handOver(() => openProductPreview(product, { categories, onEdit: onProductEdit }));
  };

  //^ The rows behave like list rows: a click, or Enter/Space on a focused row,
  //^ opens that product's own card — one card at a time, never stacked
  modalElement
    .querySelectorAll("table tbody tr[data-id], .entity-card[data-id]")
    .forEach((row) => {
      const product = items.find((p) => String(p.id) === row.dataset.id);
      row.classList.add("preview-row");
      row.setAttribute("tabindex", "0");
      row.setAttribute(
        "aria-label",
        `Preview ${product ? getProductDisplayName(product) : "product"}`,
      );
    });

  modalElement.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest("tr[data-id], .entity-card[data-id]");
    if (row) openFromRow(row);
  });

  modalElement.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest?.("button, a, input")) return;
    const row = event.target.closest?.(".preview-row");
    if (!row) return;
    event.preventDefault();
    openFromRow(row);
  });

  //^ Thumbnails inside the list arrive the same lazy way as everywhere else
  hydrateEntityImages(modalElement);
  loadPreviewImage(modalElement, "categories", category.id);
}

//* The products that sit in one category — the same match the list column counts
function productsInCategory(products, categoryId) {
  return (Array.isArray(products) ? products : []).filter(
    (product) => String(product.categoryId) === String(categoryId),
  );
}

//* The picture lands after the card is on screen, so the layout never waits on
//* the network — a cached image is there in the same frame.
async function loadPreviewImage(modalElement, resource, id) {
  const media = modalElement.querySelector("[data-preview-media]");
  if (!media) return;

  const showEmpty = (message, icon) => {
    media.innerHTML = `
      <div class="product-preview-empty">
        <i class="bi ${icon}"></i>
        <span>${message}</span>
      </div>`;
  };

  const imageUrl = await fetchEntityImage(resource, id);
  if (!modalElement.isConnected || !media.isConnected) return;

  if (!imageUrl) {
    showEmpty("No image yet", "bi-image");
    return;
  }

  media.innerHTML = `<img class="product-preview-image" src="${escapeHtml(imageUrl)}" alt="Image" loading="lazy" decoding="async" />`;
  const image = media.querySelector("img");
  if (image) image.onerror = () => showEmpty("Image unavailable", "bi-image");
}

function productCardHtml(product, categories) {
  const variants = getProductVariants(product);
  const name = getProductDisplayName(product);
  const unit = String(product.unit || "").trim();
  const onOrder = isNotStockedProduct(product);
  const quantity = onOrder ? "—" : getProductStock(product);
  const priceRange = getVariantPriceRange(variants);
  const price = priceRange
    ? priceRange.min === priceRange.max
      ? formatCurrency(priceRange.min)
      : `${formatCurrency(priceRange.min)} – ${formatCurrency(priceRange.max)}`
    : formatCurrency(product.price);

  return cardShell(
    PRODUCT_CARD_ID,
    "bi-eye",
    "Product preview",
    "Edit",
    `
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
            ${onOrder ? `<span class="sku-badge">On order</span>` : ""}
          </div>
          <div class="preview-detail-grid">
            ${detailHtml("bi-tags", "Category", escapeHtml(getCategoryLabel(categories, product.categoryId)))}
            ${detailHtml("bi-rulers", "Unit", unit ? escapeHtml(unit) : "—")}
            ${detailHtml("bi-box-seam", "In stock", onOrder ? "On order — not stocked" : `${quantity}${unit ? ` ${escapeHtml(unit)}` : ""}`)}
            ${detailHtml("bi-cash-stack", "Price", price)}
            ${detailHtml("bi-graph-up-arrow", "Stock value", onOrder ? "—" : formatCurrency(getProductStockValue(product)))}
            ${detailHtml("bi-list-ol", "Ratings", String(variants.length))}
          </div>
        </div>
      </div>

      <div class="mt-3">${ratingsHtml(product, variants, unit)}</div>
    `,
  );
}

//* One line per rating: what it is, what it costs, how much is left and whether
//* that is enough — the same status logic the Products table and filter use.
//* The shared modal shell for both cards
function cardShell(modalId, icon, title, actionLabel, bodyHtml) {
  return `
    <div class="modal fade" id="${modalId}" tabindex="-1" aria-labelledby="${modalId}Title" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title fs-5" id="${modalId}Title">
              <i class="bi ${icon} text-warning"></i> ${title}
            </h4>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-footer">
            <button type="button" class="btn btn-primary" data-preview-edit>
              <i class="bi bi-pencil"></i> ${actionLabel}
            </button>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>`;
}

//* The category card: the picture, then how much of the catalogue sits inside it,
//* then the products themselves — one glance instead of opening every product.
function categoryCardHtml(category, items) {
  const units = items.reduce((sum, product) => sum + getProductStock(product), 0);
  const value = items.reduce((sum, product) => sum + getProductStockValue(product), 0);
  const low = items.filter((product) => getProductStatusCode(product) === "low").length;
  const out = items.filter((product) => getProductStatusCode(product) === "out").length;
  const healthy = items.length - low - out;
  const range = categoryPriceRange(items);

  return cardShell(
    CATEGORY_CARD_ID,
    "bi-tags",
    "Category summary",
    "Edit category",
    `
      <div class="product-preview">
        <div class="product-preview-media" data-preview-media>
          <div class="product-preview-empty">
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            <span>Loading image…</span>
          </div>
        </div>

        <div>
          <h5 class="product-preview-name">${escapeHtml(getProductDisplayName(category))}</h5>
          <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
            <span class="status-badge status-in">
              ${items.length} product${items.length === 1 ? "" : "s"}
            </span>
            ${healthy ? `<span class="status-badge status-in">${healthy} in stock</span>` : ""}
            ${low ? `<span class="status-badge status-low">${low} low</span>` : ""}
            ${out ? `<span class="status-badge status-out">${out} out</span>` : ""}
          </div>
          <div class="preview-detail-grid">
            ${detailHtml("bi-box-seam", "Total stock", `${units} unit${units === 1 ? "" : "s"}`)}
            ${detailHtml("bi-graph-up-arrow", "Stock value", formatCurrency(value))}
            ${detailHtml("bi-arrow-repeat", "Needs reorder", `${low + out}`)}
            ${
              range
                ? detailHtml(
                    "bi-tag",
                    "Price range",
                    range.min === range.max
                      ? formatCurrency(range.min)
                      : `${formatCurrency(range.min)} – ${formatCurrency(range.max)}`,
                  )
                : ""
            }
          </div>
          ${
            category.description
              ? `<p class="preview-category-note">${escapeHtml(category.description)}</p>`
              : ""
          }
        </div>
      </div>

      <div class="mt-3">${categoryProductsHtml(category, items)}</div>
    `,
  );
}

//* The products of one category, in the same table-on-desktop / cards-on-phones
//* shape the rest of the app uses. Clicking a row opens that product's own card.
function categoryProductsHtml(category, items) {
  if (!items.length) {
    return `
      <div class="preview-ratings-empty">
        <i class="bi bi-info-circle"></i>
        <span>No products in this category yet.</span>
      </div>`;
  }

  const rows = items.map((product) => ({
    id: product.id,
    image: productThumbnailHtml("", getProductDisplayName(product), {
      productId: product.id,
      sizeClass: "entity-thumbnail-sm",
    }),
    name: `<span class="fw-semibold">${escapeHtml(getProductDisplayName(product))}</span>${
      product.sku ? `<div class="mt-1"><span class="sku-badge">${escapeHtml(product.sku)}</span></div>` : ""
    }`,
    quantity: stockText(product),
    price: priceText(product),
    status: compactStatusBadge(product),
  }));

  return `
    <div class="preview-section-title">
      <i class="bi bi-box-seam"></i>
      <span>Products in ${escapeHtml(getProductDisplayName(category))}</span>
      <span class="preview-section-count">${items.length}</span>
    </div>
    ${renderTable(rows, ["image", "name", "quantity", "price", "status"], false)}
  `;
}

//* "12 box" — the stock of one product, in its own unit
function stockText(product) {
  const unit = String(product.unit || "").trim();
  return `${getProductStock(product)}${unit ? ` ${escapeHtml(unit)}` : ""}`;
}

//* The price of one product (a range when its ratings differ), already in KSh —
//* renderTable shows pre-formatted strings as they are
function priceText(product) {
  const range = getVariantPriceRange(getProductVariants(product));
  if (!range) return formatCurrency(product.price);
  return range.min === range.max
    ? formatCurrency(range.min)
    : `${formatCurrency(range.min)} – ${formatCurrency(range.max)}`;
}

//* Cheapest and dearest price anywhere in a category — each product's rating
//* range when it has one, its own price when it does not. Null when nothing
//* inside the category carries a price at all.
function categoryPriceRange(items) {
  let min = Infinity;
  let max = -Infinity;
  for (const product of items) {
    const range = getVariantPriceRange(getProductVariants(product));
    const prices = range ? [range.min, range.max] : [Number(product.price) || 0];
    for (const price of prices) {
      if (!(price > 0)) continue;
      if (price < min) min = price;
      if (price > max) max = price;
    }
  }
  return min === Infinity ? null : { min, max };
}

//* Short "Low"/"Out" wording, for the tight list column
function compactStatusBadge(product) {
  const code = getProductStatusCode(product);
  if (code === "out") return `<span class="status-badge status-out">Out</span>`;
  if (code === "low") return `<span class="status-badge status-low">Low</span>`;
  return `<span class="status-badge status-in">In stock</span>`;
}

//* One line per rating: what it is, what it costs, how much is left and whether
//* that is enough — the same status logic the Products table and filter use.
//* Order-based products show On order instead of stock figures.
function ratingsHtml(product, variants, unit) {
  if (!variants.length) {
    return `
      <div class="preview-ratings-empty">
        <i class="bi bi-info-circle"></i>
        <span>${isNotStockedProduct(product) ? "On order — not stocked, sell any quantity." : "No ratings — this product is stocked as a single item."}</span>
      </div>`;
  }

  const onOrder = isNotStockedProduct(product);
  const rows = variants
    .map((variant, index) => {
      const quantity = Number(variant.quantity) || 0;
      const min = Number(variant.reorderLevel) || 0;
      const tone = onOrder ? "" : quantity <= 0 ? "status-out" : quantity <= min ? "status-low" : "";
      const label = getVariantSuffix(variant) || `Rating ${index + 1}`;
      const price = Number(variant.price) || 0;
      return `
        <tr>
          <td><span class="variant-chip ${tone}">${escapeHtml(label)}</span></td>
          <td class="text-end">${price > 0 ? formatCurrency(price) : "—"}</td>
          <td class="text-end">${onOrder ? "—" : `${quantity}${unit ? ` ${escapeHtml(unit)}` : ""}`}</td>
          <td class="text-end">${onOrder ? "—" : min}</td>
          <td>${onOrder ? `<span class="status-badge status-in">On order</span>` : ratingStatusBadge(quantity, min)}</td>
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
  if (isNotStockedProduct(product)) return `<span class="status-badge status-in">On order</span>`;
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
