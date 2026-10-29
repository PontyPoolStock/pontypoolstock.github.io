import { postData } from "../services/api.js";
import {
  buildStorableImageUrl,
  escapeHtml,
  getVariantPriceRange,
  getVariantSuffix,
  getVariantsTotalQuantity,
  normalizeVariantColour,
  normalizeVariantGlass,
  normalizeVariantRating,
} from "../utils/helpers.js?v=20261028-1";
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
      <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable bulk-products-dialog">
        <div class="modal-content bulk-products-modal">
          <div class="modal-header">
            <div>
              <h4 class="modal-title fs-5" id="bulkProductsTitle">Bulk add products</h4>
              <p class="small text-muted mb-0 mt-1">Add products together, check the details, then save.</p>
            </div>
            <button type="button" class="btn-close" data-bulk-close aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <div class="bulk-products-steps" aria-label="Bulk add steps">
              <span class="bulk-products-step is-active" data-bulk-step="entry"><span>1</span> Add details</span>
              <span class="bulk-products-step-divider"></span>
              <span class="bulk-products-step" data-bulk-step="review"><span>2</span> Review &amp; save</span>
            </div>
            <div data-bulk-entry>
              <div class="d-flex flex-column gap-3" data-bulk-rows></div>
              <button type="button" class="btn btn-outline-primary bulk-add-row-button mt-3" data-bulk-add-row>
                <i class="bi bi-plus-lg"></i><span>Add another product</span>
              </button>
            </div>
            <div class="d-none" data-bulk-review></div>
            <div class="small mt-3" data-bulk-message role="status" aria-live="polite"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary d-none" data-bulk-back><i class="bi bi-arrow-left me-1"></i>Edit products</button>
            <button type="button" class="btn btn-primary" data-bulk-preview>Review products<i class="bi bi-arrow-right ms-2"></i></button>
            <button type="button" class="btn btn-primary d-none" data-bulk-save><i class="bi bi-check2 me-1"></i>Save products</button>
            <button type="button" class="btn btn-light border" data-bulk-close>Cancel</button>
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
  const entryStep = modalElement.querySelector('[data-bulk-step="entry"]');
  const reviewStep = modalElement.querySelector('[data-bulk-step="review"]');
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
    entryStep.classList.toggle("is-active", !showReview);
    reviewStep.classList.toggle("is-active", showReview);
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

  //* Drag-and-drop / paste support for product pictures.
  const handleImageFile = async (row, file) => {
    if (!file || !file.type.startsWith("image/")) return;
    const imageError = row.querySelector("[data-bulk-image-error]");
    imageError.textContent = "";
    if (file.size > 2 * 1024 * 1024) {
      imageError.textContent = "Choose an image smaller than 2 MB.";
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
      row.querySelector("[data-bulk-image-change]").classList.remove("d-none");
    } catch (error) {
      imageError.textContent = error.message || "Unable to read that image.";
    } finally {
      delete row.dataset.imagePending;
    }
  };

  rows.addEventListener("dragover", (event) => {
    const picker = event.target.closest(".bulk-image-picker");
    if (!picker) return;
    event.preventDefault();
    picker.classList.add("is-dragover");
  });
  rows.addEventListener("dragleave", (event) => {
    const picker = event.target.closest(".bulk-image-picker");
    if (!picker) return;
    picker.classList.remove("is-dragover");
  });
  rows.addEventListener("drop", async (event) => {
    const picker = event.target.closest(".bulk-image-picker");
    if (!picker) return;
    event.preventDefault();
    picker.classList.remove("is-dragover");
    const row = picker.closest("[data-bulk-row]");
    const file = event.dataTransfer?.files?.[0];
    if (file) await handleImageFile(row, file);
  });

  modalElement.addEventListener("paste", async (event) => {
    const active = document.activeElement;
    const row = active?.closest?.("[data-bulk-row]");
    if (!row) return;
    const items = event.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) { await handleImageFile(row, file); break; }
      }
    }
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
      row.querySelector("[data-bulk-image-change]").classList.remove("d-none");
    } catch (error) {
      imageError.textContent = error.message || "Unable to read that image.";
    } finally {
      delete row.dataset.imagePending;
    }
  });

  rows.addEventListener("focusout", (event) => {
    const input = event.target.closest?.("[data-variant-field]");
    if (!input) return;
    const field = input.dataset.variantField;
    let normalized = input.value;
    if (field === "label") normalized = normalizeVariantRating(input.value);
    else if (field === "glass") normalized = normalizeVariantGlass(input.value);
    else if (field === "colour") normalized = normalizeVariantColour(input.value);
    else return;
    if (normalized !== input.value) input.value = normalized;
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
    <section class="bulk-product-row" data-bulk-row data-row-id="${rowId}">
      <div class="bulk-product-row-header">
        <div class="d-flex align-items-center gap-2">
          <span class="bulk-product-number" data-bulk-number>1</span>
          <div>
            <h5 class="h6 mb-0">Product 1</h5>
            <span class="small text-muted">Product information</span>
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-light text-danger bulk-remove-product" data-bulk-remove-row aria-label="Remove product row" title="Remove product">
          <i class="bi bi-trash"></i><span>Remove</span>
        </button>
      </div>
      <div class="bulk-product-row-body">
        <div class="bulk-product-fields">
          <div class="row g-3">
            <div class="col-12 col-md-6">
              <label class="form-label" data-label-for="name">Product name</label>
              <input class="form-control" data-field="name" placeholder="e.g. LED ceiling light">
            </div>
            <div class="col-12 col-md-3">
              <label class="form-label">Code <span class="text-muted fw-normal">(optional)</span></label>
              <input class="form-control" data-field="sku" placeholder="e.g. LED-001">
            </div>
            <div class="col-12 col-md-3">
              <label class="form-label">Category</label>
              <select class="form-select" data-field="categoryId">
                <option value="">No category</option>${categoryOptions}
              </select>
            </div>
          </div>
          <div class="bulk-product-subheading"><i class="bi bi-box-seam"></i> Price and stock</div>
          <div class="row g-3">
            <div class="col-6 col-md-3">
              <label class="form-label">Price</label>
              <input type="number" min="0" step="0.01" class="form-control" data-field="price" placeholder="0.00">
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label">Quantity</label>
              <input type="number" min="0" step="1" class="form-control" data-field="quantity" data-bulk-quantity placeholder="0">
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label">Minimum stock</label>
              <input type="number" min="0" step="1" class="form-control" data-field="reorderLevel" placeholder="0">
            </div>
            <div class="col-6 col-md-3">
              <label class="form-label">Unit</label>
              <input class="form-control" data-field="unit" placeholder="e.g. pcs">
            </div>
          </div>
          <label class="bulk-resale-option">
            <input type="checkbox" class="form-check-input" data-bulk-not-stocked>
            <span><strong>Resale product</strong><small>Quantity is tracked through shop purchases.</small></span>
          </label>
          <div class="bulk-variants-section" data-bulk-variants-section>
            <details>
              <summary><span><i class="bi bi-list-check me-2"></i>Ratings / variants</span><span class="small text-muted">Optional</span></summary>
              <div class="d-flex flex-column gap-2 mt-3" data-bulk-variants></div>
              <button type="button" class="btn btn-sm btn-outline-secondary mt-3" data-bulk-add-variant>
                <i class="bi bi-plus-lg me-1"></i>Add rating
              </button>
            </details>
          </div>
        </div>
        <div class="bulk-product-image-column">
          <div class="bulk-product-subheading"><i class="bi bi-image"></i> Product picture</div>
          <label class="bulk-image-picker">
            <input type="file" data-bulk-image accept="image/*" aria-label="Choose product picture">
            <img class="d-none" data-bulk-image-preview alt="Product picture preview">
            <span data-bulk-image-empty>
              <i class="bi bi-cloud-arrow-up"></i>
              <strong>Choose or drop a picture</strong>
              <small>PNG, JPG or WEBP · max 2 MB · paste supported</small>
            </span>
            <span class="bulk-image-change d-none" data-bulk-image-change><i class="bi bi-arrow-repeat"></i> Change picture</span>
          </label>
          <div class="small text-danger mt-2" data-bulk-image-error></div>
        </div>
      </div>
      <div class="small text-danger mt-2" data-bulk-row-error></div>
    </section>`;
}

function variantRowHtml() {
  return `
    <div class="bulk-variant-row" data-bulk-variant>
      <div class="row g-2 align-items-end">
        <div class="col-6 col-md-2"><label class="form-label small">Rating</label><input class="form-control form-control-sm" data-variant-field="label" placeholder="e.g. 4 watts or 63A"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Price</label><input type="number" min="0" step="0.01" class="form-control form-control-sm" data-variant-field="price" placeholder="0.00"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Quantity</label><input type="number" min="0" step="1" class="form-control form-control-sm" data-variant-field="quantity" placeholder="0"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Minimum</label><input type="number" min="0" step="1" class="form-control form-control-sm" data-variant-field="reorderLevel" placeholder="0"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Glass</label><input class="form-control form-control-sm" data-variant-field="glass" placeholder="Clear"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Colour</label><input class="form-control form-control-sm" data-variant-field="colour" placeholder="White"></div>
        <div class="col-6 col-md-2"><label class="form-label small">Amps</label><div class="input-group input-group-sm"><input type="number" min="0" step="0.01" class="form-control form-control-sm" data-variant-field="amps" placeholder="0.05"><span class="input-group-text">A</span></div></div>
      </div>
      <div class="d-flex justify-content-end mt-2">
        <button type="button" class="btn btn-sm btn-light text-danger" data-bulk-remove-variant><i class="bi bi-trash me-1"></i>Remove rating</button>
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
        label: normalizeVariantRating(value("label")),
        price: number(value("price"), "Rating price"),
        quantity: number(value("quantity"), "Rating quantity"),
        reorderLevel: number(value("reorderLevel"), "Rating minimum stock"),
        glass: normalizeVariantGlass(value("glass")),
        colour: normalizeVariantColour(value("colour")),
        amps: ampsValue === "" ? "" : number(ampsValue, "Rating amps"),
      };
    }).filter((variant) =>
      variant.label
      || variant.glass
      || variant.colour
      || variant.amps !== ""
      || variant.price
      || variant.quantity
      || variant.reorderLevel,
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
        <article class="bulk-review-card${saved ? " is-saved" : ""}${error ? " has-error" : ""}">
          ${product.imageUrl
            ? `<img src="${escapeHtml(product.imageUrl)}" alt="" class="bulk-review-image">`
            : '<span class="bulk-review-image bulk-review-image-empty"><i class="bi bi-image"></i></span>'}
          <div class="bulk-review-content">
            <div class="d-flex align-items-start justify-content-between gap-2">
              <div class="min-w-0">
                <h6 class="bulk-review-name">${escapeHtml(product.name || "Unnamed product")}</h6>
                <div class="small text-muted">${escapeHtml(product.sku || "No code")} <span class="mx-1">·</span> ${escapeHtml(categories.find((category) => String(category.id) === String(product.categoryId))?.name || "No category")}</div>
              </div>
              ${saved ? '<span class="bulk-review-status"><i class="bi bi-check-circle-fill"></i> Saved</span>' : ""}
            </div>
            <div class="bulk-review-details">
              <span><small>Price</small><strong>${escapeHtml(product.price)}</strong></span>
              <span><small>Quantity</small><strong>${escapeHtml(product.quantity)} ${escapeHtml(product.unit || "")}</strong></span>
              <span><small>Minimum</small><strong>${escapeHtml(product.reorderLevel)}</strong></span>
              ${product.notStocked ? '<span class="bulk-review-resale"><i class="bi bi-arrow-repeat"></i> Resale product</span>' : ""}
            </div>
            ${product.variants.length
              ? `<div class="bulk-review-variants"><strong>Ratings</strong>${product.variants.map((variant) => {
                const label = getVariantSuffix(variant) || "Rating";
                return `<span>${escapeHtml(label)} <b>${escapeHtml(variant.price)}</b> <small>· Qty ${escapeHtml(variant.quantity)} · Min ${escapeHtml(variant.reorderLevel)}</small></span>`;
              }).join("")}</div>`
              : ""}
            ${error ? `<div class="small text-danger mt-2"><i class="bi bi-exclamation-circle me-1"></i>${escapeHtml(error)}</div>` : ""}
          </div>
        </article>`).join("")}
    </div>`;
}

function refreshRemoveButtons(container) {
  const rowElements = [...container.querySelectorAll("[data-bulk-row]")];
  rowElements.forEach((row, index) => {
    row.querySelector("h5").textContent = `Product ${index + 1}`;
    row.querySelector("[data-bulk-number]").textContent = String(index + 1);
    row.querySelector("[data-bulk-remove-row]").disabled = rowElements.length === 1;
  });
}
