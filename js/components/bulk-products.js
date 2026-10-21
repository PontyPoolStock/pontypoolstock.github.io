import { postData } from "../services/api.js";
import {
  buildStorableImageUrl,
  escapeHtml,
  getVariantPriceRange,
  getVariantsTotalQuantity,
} from "../utils/helpers.js";
import { isStaffView } from "../utils/role.js";

let nextRowId = 0;

export function openBulkProductsModal(categories, onSaved) {
  if (isStaffView()) return;
  document.getElementById("bulkProductsModal")?.remove();

  const categoryOptions = (categories || [])
    .map((category) => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`)
    .join("");
  document.body.insertAdjacentHTML("beforeend", `
    <div class="modal fade" id="bulkProductsModal" tabindex="-1" aria-labelledby="bulkProductsTitle" aria-hidden="true">
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h4 class="modal-title fs-5" id="bulkProductsTitle">Bulk add products</h4>
            <button type="button" class="btn-close" data-bulk-close aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="alert alert-light border small">
              Enter each product like the regular product form. Add a picture and optional ratings, then preview everything before saving.
            </div>
            <div data-bulk-entry>
              <div class="d-flex flex-column gap-3" data-bulk-rows></div>
              <button type="button" class="btn btn-outline-primary btn-sm mt-3" data-bulk-add-row>
                <i class="bi bi-plus-lg"></i> Add another product
              </button>
            </div>
            <div class="d-none" data-bulk-review></div>
            <div class="small mt-3" data-bulk-message role="status" aria-live="polite"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary d-none" data-bulk-back>Edit products</button>
            <button type="button" class="btn btn-primary" data-bulk-preview>Preview products</button>
            <button type="button" class="btn btn-primary d-none" data-bulk-save>Save products</button>
            <button type="button" class="btn btn-secondary" data-bulk-close>Close</button>
          </div>
        </div>
      </div>
    </div>`);

  const modalElement = document.getElementById("bulkProductsModal");
  const modal = new bootstrap.Modal(modalElement);
  const rows = modalElement.querySelector("[data-bulk-rows]");
  const entry = modalElement.querySelector("[data-bulk-entry]");
  const review = modalElement.querySelector("[data-bulk-review]");
  const message = modalElement.querySelector("[data-bulk-message]");
  const previewButton = modalElement.querySelector("[data-bulk-preview]");
  const backButton = modalElement.querySelector("[data-bulk-back]");
  const saveButton = modalElement.querySelector("[data-bulk-save]");
  const imageUrls = new WeakMap();
  let reviewItems = [];

  const appendRow = () => {
    const rowId = ++nextRowId;
    rows.insertAdjacentHTML("beforeend", productRowHtml(rowId, categoryOptions));
    refreshRemoveButtons(rows);
  };

  const setStage = (showReview) => {
    entry.classList.toggle("d-none", showReview);
    review.classList.toggle("d-none", !showReview);
    previewButton.classList.toggle("d-none", showReview);
    backButton.classList.toggle("d-none", !showReview);
    saveButton.classList.toggle("d-none", !showReview);
    message.textContent = "";
    message.className = "small mt-3";
  };

  appendRow();

  rows.addEventListener("click", (event) => {
    const removeRow = event.target.closest("[data-bulk-remove-row]");
    if (removeRow) {
      removeRow.closest("[data-bulk-row]")?.remove();
      refreshRemoveButtons(rows);
      return;
    }

    const addVariant = event.target.closest("[data-bulk-add-variant]");
    if (addVariant) {
      addVariant.closest("[data-bulk-row]")
        .querySelector("[data-bulk-variants]")
        .insertAdjacentHTML("beforeend", variantRowHtml());
      return;
    }

    const removeVariant = event.target.closest("[data-bulk-remove-variant]");
    if (removeVariant) removeVariant.closest("[data-bulk-variant]")?.remove();
  });

  rows.addEventListener("change", async (event) => {
    const row = event.target.closest("[data-bulk-row]");
    if (!row) return;
    if (event.target.matches("[data-bulk-not-stocked]")) {
      row.querySelector("[data-bulk-quantity]").readOnly = event.target.checked;
      if (event.target.checked) row.querySelector("[data-bulk-quantity]").value = "0";
      row.querySelector("[data-bulk-variants-section]").classList.toggle("d-none", event.target.checked);
      return;
    }

    if (!event.target.matches("[data-bulk-image]")) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const imageError = row.querySelector("[data-bulk-image-error]");
    imageError.textContent = "";
    if (!file.type.startsWith("image/")) {
      imageError.textContent = "Choose an image file.";
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      imageError.textContent = "Choose an image smaller than 2 MB.";
      event.target.value = "";
      return;
    }
    row.dataset.imagePending = "true";
    try {
      const imageUrl = await buildStorableImageUrl(file);
      if (!imageUrl) throw new Error("That image is too large to store. Choose a smaller image.");
      imageUrls.set(row, imageUrl);
      const image = row.querySelector("[data-bulk-image-preview]");
      image.src = imageUrl;
      image.classList.remove("d-none");
      row.querySelector("[data-bulk-image-empty]").classList.add("d-none");
    } catch (error) {
      imageError.textContent = error.message || "Unable to read that image.";
    } finally {
      delete row.dataset.imagePending;
    }
  });

  modalElement.querySelector("[data-bulk-add-row]").addEventListener("click", appendRow);
  modalElement.querySelectorAll("[data-bulk-close]").forEach((button) => {
    button.addEventListener("click", () => modal.hide());
  });
  modalElement.addEventListener("hidden.bs.modal", () => modalElement.remove());

  previewButton.addEventListener("click", () => {
    if (rows.querySelector('[data-bulk-row][data-image-pending="true"]')) {
      message.textContent = "Wait for the selected pictures to finish loading.";
      message.classList.add("text-danger");
      return;
    }
    const collected = [...rows.querySelectorAll("[data-bulk-row]")].map((row) =>
      readProductRow(row, imageUrls.get(row)),
    );
    const invalid = collected.find((item) => item.error);
    rows.querySelectorAll("[data-bulk-row-error]").forEach((element) => {
      element.textContent = "";
    });
    if (invalid) {
      invalid.row.querySelector("[data-bulk-row-error]").textContent = invalid.error;
      message.textContent = "Check the highlighted product details before continuing.";
      message.classList.add("text-danger");
      return;
    }

    reviewItems = collected.map(({ row, product }) => ({ row, product, saved: false, error: "" }));
    renderReview(review, reviewItems, categories);
    setStage(true);
  });

  backButton.addEventListener("click", () => setStage(false));

  saveButton.addEventListener("click", async () => {
    if (saveButton.disabled) return;
    saveButton.disabled = true;
    saveButton.innerHTML = '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Saving…';
    let savedAny = false;
    try {
      for (const item of reviewItems) {
        if (item.saved) continue;
        const result = await postData("products", item.product);
        if (result?.error || result?.id === undefined) {
          item.error = result?.error || "The server did not confirm this product.";
          continue;
        }
        item.saved = true;
        item.error = "";
        savedAny = true;
        void postData("activityLog", {
          action: "CREATE_PRODUCT",
          details: `New product added: ${item.product.name || "Unnamed product"}${item.product.sku ? ` (${item.product.sku})` : ""}${item.product.variants.length ? ` - ${item.product.variants.length} ratings` : ""}`,
          user: "admin",
          timestamp: new Date().toISOString(),
        });
      }

      renderReview(review, reviewItems, categories);
      if (reviewItems.some((item) => item.saved) && typeof onSaved === "function") {
        await onSaved();
      }
      const failed = reviewItems.filter((item) => !item.saved).length;
      if (!failed) {
        modal.hide();
      } else {
        message.textContent = `${reviewItems.length - failed} saved. ${failed} failed; fix the issue and retry.`;
        message.classList.add("text-danger");
        saveButton.textContent = "Retry failed products";
        if (savedAny) backButton.classList.add("d-none");
      }
    } catch (error) {
      message.textContent = `Products may have been saved, but the product list could not refresh: ${error.message || "Unknown error"}`;
      message.classList.add("text-danger");
    } finally {
      saveButton.disabled = false;
      if (!saveButton.textContent.includes("Retry")) saveButton.textContent = "Save products";
    }
  });

  modal.show();
}

function productRowHtml(rowId, categoryOptions) {
  return `
    <section class="card border bulk-product-row" data-bulk-row data-row-id="${rowId}">
      <div class="card-body">
        <div class="d-flex align-items-center justify-content-between mb-3">
          <h5 class="h6 mb-0">Product details</h5>
          <button type="button" class="btn btn-outline-danger btn-sm" data-bulk-remove-row aria-label="Remove product row">
            <i class="bi bi-trash"></i> Remove
          </button>
        </div>
        <div class="row g-2">
          <div class="col-12 col-md-6">
            <label class="form-label small">Product name</label>
            <input class="form-control form-control-sm" data-field="name" placeholder="Product name">
          </div>
          <div class="col-12 col-md-3">
            <label class="form-label small">Code (optional)</label>
            <input class="form-control form-control-sm" data-field="sku" placeholder="Product code">
          </div>
          <div class="col-12 col-md-3">
            <label class="form-label small">Category</label>
            <select class="form-select form-select-sm" data-field="categoryId">
              <option value="">No category</option>${categoryOptions}
            </select>
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label small">Price</label>
            <input type="number" min="0" step="0.01" class="form-control form-control-sm" data-field="price" placeholder="0.00">
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label small">Quantity</label>
            <input type="number" min="0" step="1" class="form-control form-control-sm" data-field="quantity" data-bulk-quantity placeholder="0">
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label small">Minimum stock</label>
            <input type="number" min="0" step="1" class="form-control form-control-sm" data-field="reorderLevel" placeholder="0">
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label small">Unit</label>
            <input class="form-control form-control-sm" data-field="unit" placeholder="pcs / box / roll">
          </div>
          <div class="col-12 col-md-4">
            <label class="form-label small">Product picture</label>
            <input type="file" class="form-control form-control-sm" data-bulk-image accept="image/*">
            <div class="small text-danger mt-1" data-bulk-image-error></div>
            <div class="mt-2 d-flex align-items-center gap-2">
              <img class="entity-thumbnail d-none" data-bulk-image-preview alt="Product picture preview">
              <span class="small text-muted" data-bulk-image-empty>No picture selected</span>
            </div>
          </div>
          <div class="col-12">
            <div class="form-check">
              <input type="checkbox" class="form-check-input" data-bulk-not-stocked>
              <label class="form-check-label small">Resale product (quantity is tracked through shop purchases)</label>
            </div>
          </div>
          <div class="col-12" data-bulk-variants-section>
            <details>
              <summary class="small fw-semibold">Ratings / variants (optional)</summary>
              <div class="d-flex flex-column gap-2 mt-2" data-bulk-variants></div>
              <button type="button" class="btn btn-outline-secondary btn-sm mt-2" data-bulk-add-variant>Add rating</button>
            </details>
          </div>
        </div>
        <div class="small text-danger mt-2" data-bulk-row-error></div>
      </div>
    </section>`;
}

function variantRowHtml() {
  return `
    <div class="border rounded p-2" data-bulk-variant>
      <div class="row g-2">
        <div class="col-6 col-md-2"><label class="form-label small">Rating</label><input class="form-control form-control-sm" data-variant-field="label" placeholder="e.g. 4W"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Price</label><input type="number" min="0" step="0.01" class="form-control form-control-sm" data-variant-field="price" placeholder="0.00"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Quantity</label><input type="number" min="0" step="1" class="form-control form-control-sm" data-variant-field="quantity" placeholder="0"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Minimum</label><input type="number" min="0" step="1" class="form-control form-control-sm" data-variant-field="reorderLevel" placeholder="0"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Colour</label><input class="form-control form-control-sm" data-variant-field="colour" placeholder="White"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Amps</label><input type="number" min="0" step="0.01" class="form-control form-control-sm" data-variant-field="amps" placeholder="0.05"></div>
        <div class="col-12"><button type="button" class="btn btn-link btn-sm text-danger p-0" data-bulk-remove-variant>Remove rating</button></div>
      </div>
    </div>`;
}

function readProductRow(row, imageUrl = "") {
  const field = (name) => row.querySelector(`[data-field="${name}"]`).value.trim();
  const name = field("name");
  const categoryId = field("categoryId");
  const number = (value, label) => {
    if (value === "") return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be zero or greater.`);
    return parsed;
  };

  try {
    if (!name && !categoryId) throw new Error("Enter a product name or choose a category.");
    const variants = [...row.querySelectorAll("[data-bulk-variant]")].map((variantRow) => {
      const value = (key) => variantRow.querySelector(`[data-variant-field="${key}"]`).value.trim();
      const ampsValue = value("amps");
      return {
        label: value("label"),
        price: number(value("price"), "Rating price"),
        quantity: number(value("quantity"), "Rating quantity"),
        reorderLevel: number(value("reorderLevel"), "Rating minimum stock"),
        colour: value("colour"),
        amps: ampsValue === "" ? "" : number(ampsValue, "Rating amps"),
      };
    }).filter((variant) =>
      variant.label || variant.colour || variant.amps !== "" || variant.price || variant.quantity || variant.reorderLevel,
    );
    const notStocked = row.querySelector("[data-bulk-not-stocked]").checked;
    const price = number(field("price"), "Price");
    const quantity = number(field("quantity"), "Quantity");
    const reorderLevel = number(field("reorderLevel"), "Minimum stock");
    const priceRange = getVariantPriceRange(variants);
    const product = {
      name,
      sku: field("sku") || null,
      categoryId: categoryId || null,
      price: priceRange ? priceRange.min : price,
      quantity: notStocked ? 0 : variants.length ? getVariantsTotalQuantity(variants) : quantity,
      reorderLevel: notStocked ? 0 : reorderLevel,
      unit: field("unit"),
      imageUrl,
      variants,
      notStocked,
    };
    return { row, product, error: "" };
  } catch (error) {
    return { row, product: null, error: error.message };
  }
}

function renderReview(container, items, categories) {
  container.innerHTML = `
    <h5 class="h6 mb-3">Review ${items.length} product${items.length === 1 ? "" : "s"}</h5>
    <div class="d-flex flex-column gap-2">
      ${items.map(({ product, saved, error }) => `
        <div class="border rounded p-2 d-flex align-items-center gap-3">
          ${product.imageUrl
            ? `<img src="${escapeHtml(product.imageUrl)}" alt="" class="entity-thumbnail">`
            : '<span class="entity-thumbnail entity-thumbnail-empty"><i class="bi bi-image"></i></span>'}
          <div class="min-w-0 flex-grow-1">
            <strong>${escapeHtml(product.name || "Unnamed product")}</strong>
            <div class="small text-muted">
              ${escapeHtml(product.sku || "No code")} · ${escapeHtml(categories.find((category) => String(category.id) === String(product.categoryId))?.name || "No category")}
              · Price ${escapeHtml(product.price)} · Qty ${escapeHtml(product.quantity)}
                · Minimum ${escapeHtml(product.reorderLevel)} · ${escapeHtml(product.unit || "No unit")}
                ${product.notStocked ? " · Resale product" : ""}
            </div>
              ${product.variants.length
                ? `<div class="small text-muted mt-1">Ratings: ${product.variants.map((variant) => {
                  const label = variant.label || variant.colour || (variant.amps !== "" ? `${variant.amps}A` : "Rating");
                  return `${escapeHtml(label)} — ${escapeHtml(variant.price)} / Qty ${escapeHtml(variant.quantity)} / Min ${escapeHtml(variant.reorderLevel)}`;
                }).join("; ")}</div>`
                : ""}
              ${saved ? '<span class="small text-success">Saved</span>' : ""}
            ${error ? `<span class="small text-danger">${escapeHtml(error)}</span>` : ""}
          </div>
        </div>`).join("")}
    </div>`;
}

function refreshRemoveButtons(container) {
  const rowElements = [...container.querySelectorAll("[data-bulk-row]")];
  rowElements.forEach((row, index) => {
    row.querySelector("h5").textContent = `Product ${index + 1}`;
    row.querySelector("[data-bulk-remove-row]").disabled = rowElements.length === 1;
  });
}
