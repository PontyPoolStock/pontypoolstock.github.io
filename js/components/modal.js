import {
  makeProductForm,
  makeCategoryForm,
  makeStockAdjustmentForm,
  setupProductVariants,
  collectProductVariants,
} from "./form.js";

import {
  isValidProductData,
  isValidCategoryData,
  isValidStockAdjustmentData,
  GetCurrentDate,         
  buildStorableImageUrl,
  escapeHtml,
  getProductVariants,
  getVariantsTotalQuantity,
  getVariantPriceRange,
  getVariantName,
  getProductDisplayName,
  describeApiError,
} from "../utils/helpers.js";
import { showToast } from "./toast.js";

import { postData, updateData, fetchData, fetchEntityImage, PRODUCT_ADJUSTMENT_FIELDS } from "../services/api.js";
import {getCurrentUser} from "../pages/login.js";

//* Image refill for an Edit modal opened from the slim cached row (which has
//* no image bytes): fill the preview from the image cache — the row's own
//* thumbnail already warmed it, so this is usually a memory hit and never a
//* blocking fetch. Fire-and-forget, so the modal stays instant.
//* The hidden imageUrl field is deliberately left EMPTY: an untouched image is
//* then left out of the PUT entirely (see saveBtnEvent), the server keeps its
//* stored copy, and a save no longer uploads ~90 KB of base64 for nothing.
function refreshEditImage(obj, id, opts, modalElement) {
  if (!id) return;
  const resource = obj === "categories" ? "categories" : "products";
  const initial = obj === "categories" ? opts.initialCategory : opts.initialProduct;
  if (initial?.imageUrl) return; // already has bytes, nothing to refill
  fetchEntityImage(resource, id)
    .then((url) => {
      if (!url || !modalElement.isConnected) return;
      const preview = modalElement.querySelector("img.product-image-preview");
      const prompt = modalElement.querySelector(".product-image-prompt");
      if (preview) {
        preview.src = url;
        preview.classList.remove("d-none");
      }
      prompt?.classList.add("d-none");
    })
    .catch(() => {});
}

export async function getModal(obj, action, id, onAfterSave, opts = {}) {
  const objModalName = `${obj}Modal`;
  document.querySelector(`#${objModalName}`)?.remove();
  //^ Friendly titles — the raw entity names would read "Add products" / "Edit categories"
  const entityLabel = { products: "Product", categories: "Category" }[obj] || "Stock Adjustment";
  const modalTitle = `${action} ${entityLabel}`;

  //^ Show the shell INSTANTLY so the click feels immediate, then fill the
  //^ body when the (now parallel + cached) form data lands.
  let shellHtml = `
  <div class="modal fade" id="${objModalName}" tabindex="-1" aria-labelledby="${objModalName}Title" aria-hidden="true">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h4 class="modal-title fs-5" id="${objModalName}Title">${modalTitle}</h4>
          <button type="button" class="btn-close" aria-label="Close"></button>
        </div>
        <div class="modal-body">
          <div class="d-flex align-items-center gap-2 py-4 justify-content-center text-muted">
            <span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>
            <span>Loading…</span>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary save-btn" disabled>Save</button>
          <button type="button" class="btn btn-secondary close-btn">Close</button>
        </div>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML("beforeend", shellHtml);
  const modalElement = document.querySelector(`#${objModalName}`);
  const modal = new bootstrap.Modal(modalElement);
  modal.show();

  //^ Wire close immediately so even a slow fetch can be dismissed.
  closeBtnEvent(modalElement, modal);
  deleteModal(modalElement);

  try {
    let bodyHtml = "";
    if (obj === "products") bodyHtml = await makeProductForm(id, opts.categoryId || "", opts);
    else if (obj === "categories") bodyHtml = await makeCategoryForm(id, opts.parentCategoryId || "", opts);
    else if (obj === "stockAdjustments") bodyHtml = await makeStockAdjustmentForm(opts);
    if (!modalElement.isConnected) return;
    const bodyEl = modalElement.querySelector(".modal-body");
    if (bodyEl) bodyEl.innerHTML = bodyHtml;
    modalElement.querySelector(".save-btn")?.removeAttribute("disabled");
  } catch (error) {
    console.error("Failed to load form:", error);
    if (!modalElement.isConnected) return;
    const bodyEl = modalElement.querySelector(".modal-body");
    if (bodyEl) bodyEl.innerHTML = `<div class="alert alert-danger mb-0">Could not load the form. Check your connection and try again.</div>`;
    return;
  }

  if (obj === "stockAdjustments") setupStockAdjustmentListeners();
  if (obj === "products") {
    setupImageUploader("product");
    setupProductVariants();
    //^ The cached list row has no image bytes (that's what makes it fast).
    //^ Pull the preview from the image cache instead — usually zero network,
    //^ and Save leaves an untouched image alone (the PUT omits it).
    refreshEditImage(obj, id, opts, modalElement);
  }
  if (obj === "categories") {
    setupImageUploader("category");
    refreshEditImage(obj, id, opts, modalElement);
  }

  saveBtnEvent(obj, action, id, modal, modalElement, onAfterSave);
}


//* Flip the Save button into (and out of) a spinner for the writes that really
//* do wait on the server — a button that answers instantly never reads as dead.
function setSaveBusy(saveButton, busy) {
  if (!saveButton) return;
  if (busy) {
    saveButton.dataset.idleHtml = saveButton.innerHTML;
    saveButton.disabled = true;
    saveButton.innerHTML =
      '<span class="spinner-border spinner-border-sm me-1" aria-hidden="true"></span>Saving…';
  } else {
    saveButton.disabled = false;
    saveButton.innerHTML = saveButton.dataset.idleHtml || "Save";
  }
}

async function saveBtnEvent(obj, action, id, modal, modalElement, onAfterSave) {
  const saveButton = modalElement.querySelector(".save-btn");
  saveButton
    ?.addEventListener("click", async function () {
      //^ Take the button out of action on the first click: a double tap (or a
      //^ re-click while a cold fetch is still in flight) must never save twice.
      //^ Every path that leaves the modal open puts it back.
      if (saveButton.disabled) return;
      saveButton.disabled = true;
      const form = modalElement.querySelector("form");
      let data = Object.fromEntries(new FormData(form));

      const ratings = obj === "products" ? collectProductVariants() : [];

      let productsForAdjustment = null;
      if (obj === "stockAdjustments") {
        // Same projection the form dropdown uses — one warm cache key.
        productsForAdjustment = await fetchData(`products?fields=${PRODUCT_ADJUSTMENT_FIELDS}`);
      }

      let isValid = validateData(obj, data, id, productsForAdjustment, ratings);
      if (!isValid) {
        saveButton.disabled = false;
        return;
      }

      if (obj === "products") {
        //^ the ratings drive price and stock, so the totals always stay in sync
        data.variants = ratings;
        if (ratings.length) {
          const range = getVariantPriceRange(ratings);
          data.price = range ? range.min : 0;
          data.quantity = getVariantsTotalQuantity(ratings);
        }

        //^ Order-based products (e.g. LED strips): no quantity on hand, still a
        //^ permanent product under a category + still sellable in Record Sale.
        data.notStocked = form.querySelector("#notStockedCheck")?.checked ? true : false;
        if (data.notStocked) {
          data.quantity = 0;
          data.reorderLevel = 0;
        }

        //^ only a name or a category is needed — empty optional fields become defaults
        data.name = String(data.name ?? "").trim();
        data.sku = String(data.sku ?? "").trim() || null;
        data.unit = String(data.unit ?? "").trim();
        data.categoryId = String(data.categoryId ?? "").trim() || null;
        data.price = Math.max(0, Number(data.price) || 0);
        data.quantity = Math.max(0, Number(data.quantity) || 0);
        //^ The hidden imageUrl field only holds bytes the user just picked —
        //^ refreshEditImage fills the PREVIEW from the image cache but never
        //^ the field. So an untouched image is OMITTED from the PUT, the server
        //^ keeps the stored original, and Save doesn't upload ~90 KB of base64
        //^ for nothing. A newly picked image still sends normally.
        if (action === "Edit" && !String(data.imageUrl || "").trim()) {
          delete data.imageUrl;
        }
        //^ a blank name stays blank — tables and lists show "-" for it, like an empty Code
      } else if (obj === "categories") {
        data.name = String(data.name ?? "").trim();
        data.parentId = String(data.parentId ?? "").trim() || null;
        if (action === "Edit" && !String(data.imageUrl || "").trim()) {
          delete data.imageUrl;
        }
      }

      if (obj === "stockAdjustments") {
        const product = productsForAdjustment.find((p) => p.id == data.productId);
        if (!product) {
          saveButton.disabled = false;
          return;
        }

        const qty = parseInt(data.quantity, 10);
        const type = data.type;
        const variants = getProductVariants(product);
        //* The rating dropdown stores the row index, so duplicated watts stay unique
        const ratingIndex = Number.parseInt(String(data.variantLabel ?? ""), 10);
        const rating = Number.isNaN(ratingIndex) ? undefined : variants[ratingIndex];
        if (variants.length && !rating) {
          document.querySelector(".errorMes-variantLabel").innerHTML =
            "Select the rating you are adjusting.";
          saveButton.disabled = false;
          return;
        }

        const oldQty = rating
          ? Number(rating.quantity) || 0
          : Number(product.quantity) || 0;
        const newQty = type === "increase" ? oldQty + qty : oldQty - qty;
        const nowIso = GetCurrentDate(); 

        const nextVariants = rating
          ? variants.map((item, index) => (
            index === ratingIndex
              ? { ...item, quantity: newQty }
              : item
          ))
          : null;

        //* The adjustment row and the stock write are independent — run them
        //* together so the modal closes after ONE round trip instead of two.
        setSaveBusy(saveButton, true);
        await Promise.all([
          postData("stockAdjustments", {
            productId: product.id,
            productName: getVariantName(product, rating),
            type,
            quantity: qty,
            date: nowIso,
            oldQuantity: oldQty,
            newQuantity: newQty,
          }),
          updateData("products", product.id, nextVariants
            ? {
              ...product,
              variants: nextVariants,
              quantity: getVariantsTotalQuantity(nextVariants),
            }
            : { ...product, quantity: newQty }),
        ]);
        setSaveBusy(saveButton, false);

        const sign = type === "increase" ? "+" : "−";
        //* The log entry is cosmetic — never hold the modal open for it.
        void postData("activityLog", {
          action: "STOCK_ADJUSTMENT",
          details: `Stock adjustment: ${sign}${qty} ${getVariantName(product, rating)}`,
          user: "admin",
          timestamp: nowIso,
        });

        modal.hide();
        if (typeof onAfterSave === "function") await onAfterSave();
        return;
      }

      let pendingEdit = null;
      if (action === "Edit") {
        //^ Optimistic edit: patch the caches and start the PUT right here.
        //^ The modal closes and the list repaints below without waiting on the
        //^ round trip; a rejected write drops the patched copy inside
        //^ updateData, and the repaint after it reverts to the server's row.
        pendingEdit = updateData(`${obj}`, id, data, { optimistic: true });
      } else if (action === "Add") {
        //^ Add must wait for the new id, so the button shows a spinner rather
        //^ than sitting there looking dead.
        setSaveBusy(saveButton, true);
        let result;
        try {
          result = await postData(`${obj}`, data);
        } finally {
          setSaveBusy(saveButton, false);
        }
        if (!result || result.error) {
          alert(result?.error || "Unable to save this item.");
          return;
        }
      }

      if (obj === "products" && action === "Add") {
        void postData("activityLog", {
          action: "CREATE_PRODUCT",
          details: `New product added: ${getProductDisplayName(data.name)}${data.sku ? ` (${data.sku})` : ""}${ratings.length ? ` - ${ratings.length} rating${ratings.length === 1 ? "" : "s"}` : ""}`,
          user: "admin",
          timestamp: GetCurrentDate(),
        });
      } else if (obj === "products" && action === "Edit") {
        void postData("activityLog", {                         
          action: "UPDATE_PRODUCT",
          details: `Product updated: ${getProductDisplayName(data.name)}${data.sku ? ` (${data.sku})` : ""}${ratings.length ? ` - ${ratings.length} rating${ratings.length === 1 ? "" : "s"}` : ""}`,
          user: "admin",
          timestamp: GetCurrentDate(),
        });
      }


      modal.hide();
      if (typeof onAfterSave === "function") {
        await onAfterSave();
      }

      //^ The optimistic edit settles after the modal is already gone. A
      //^ failure is toasted (an alert behind a closed modal reads as nothing)
      //^ and the list repaints from server truth.
      if (pendingEdit) {
        const result = await pendingEdit;
        if (!result || result.error) {
          showToast(
            describeApiError(result?.error, "Your change could not be saved."),
            "danger",
            { title: "Save failed" },
          );
          if (typeof onAfterSave === "function") await onAfterSave();
        }
      }
    });
}

function validateData(obj, data, id, products, ratings = []) {
  let result = true;
  if (obj === "products") result = isValidProductData(data, id, ratings);
  else if (obj === "categories") result = isValidCategoryData(data);
  else if (obj === "stockAdjustments") result = isValidStockAdjustmentData(data, products);
  return result;
}

//^ Both the header "x" and the footer Close button ask before discarding, so an
//^ accidental tap can never silently drop a half-filled form.
function closeBtnEvent(modalElement, modal) {
  modalElement
    .querySelectorAll(".close-btn, .btn-close")
    .forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        if (confirm("Are you sure you want to discard changes?")) {
          modal.hide();
        }
      });
    });
}

function deleteModal(modalElement) {
  modalElement.addEventListener("hidden.bs.modal", function () {
    modalElement.remove();
  });
}

function setupStockAdjustmentListeners() {
  const select = document.getElementById("stockAdjProductSelect");
  if (!select) return;
  select.addEventListener("change", updateStockAdjustmentCurrentDisplay);
  document
    .getElementById("stockAdjVariantSelect")
    ?.addEventListener("change", updateStockAdjustmentCurrentDisplay);
  updateStockAdjustmentCurrentDisplay();
}

function setupImageUploader(prefix) {
  const dropzone = document.getElementById(`${prefix}ImageDropzone`);
  const input = document.getElementById(`${prefix}ImageFile`);
  const preview = document.getElementById(`${prefix}ImagePreview`);
  const prompt = document.getElementById(`${prefix}ImagePrompt`);
  const value = document.getElementById(`${prefix}ImageValue`);
  if (!dropzone || !input || !preview || !prompt || !value) return;

  const showImage = async (file) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (file.size > 2 * 1024 * 1024) {
      alert("Please choose an image smaller than 2 MB.");
      return;
    }

    try {
      const dataUrl = await buildStorableImageUrl(file);
      if (!dataUrl) {
        alert("That image is too large to store. Please choose a smaller image.");
        return;
      }
      value.value = dataUrl;
      preview.src = dataUrl;
      preview.classList.remove("d-none");
      prompt.classList.add("d-none");
      dropzone.classList.add("has-image");
    } catch (error) {
      alert(error.message || "Unable to read that image.");
    }
  };

  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") input.click();
  });
  input.addEventListener("change", () => showImage(input.files[0]));
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
    showImage(event.dataTransfer.files[0]);
  });
}

function updateStockAdjustmentCurrentDisplay() {
  const box = document.getElementById("adjCurrentStock");
  const select = document.getElementById("stockAdjProductSelect");
  const variantWrapper = document.getElementById("adjVariantWrapper");
  const variantSelect = document.getElementById("stockAdjVariantSelect");
  const variantError = document.querySelector(".errorMes-variantLabel");
  if (!box || !select) return;

  const opt = select.options[select.selectedIndex];
  if (!select.value || !opt) {
    box.classList.add("d-none");
    box.innerHTML = "";
    variantWrapper?.classList.add("d-none");
    if (variantSelect) variantSelect.innerHTML = "";
    return;
  }

  let variants = [];
  try {
    const parsed = JSON.parse(opt.dataset.variants || "[]");
    if (Array.isArray(parsed)) variants = parsed;
  } catch (error) {
    variants = [];
  }

  //^ ratings of the chosen product become the second dropdown (keyed by row index)
  if (variantSelect) {
    variantSelect.innerHTML = "";
    variants.forEach((variant, index) => {
      const option = document.createElement("option");
      option.value = String(index);
      const bits = [
        variant.label || `Row ${index + 1}`,
        variant.colour || "",
        variant.amps !== "" && variant.amps !== null && variant.amps !== undefined
          && Number.isFinite(Number(variant.amps))
          ? `${Number(variant.amps)}A`
          : "",
      ].filter(Boolean);
      option.textContent = `${bits.join(" · ")} (Qty: ${Number(variant.quantity) || 0})`;
      variantSelect.appendChild(option);
    });
  }
  variantWrapper?.classList.toggle("d-none", !variants.length);
  if (variantError) variantError.innerHTML = "";

  const chosenIndex = Number.parseInt(String(variantSelect?.value ?? ""), 10);
  const chosen = Number.isNaN(chosenIndex) ? undefined : variants[chosenIndex];
  const qty = chosen
    ? Number(chosen.quantity) || 0
    : opt.dataset.qty !== undefined
      ? Number(opt.dataset.qty)
      : 0;
  const unit = opt.dataset.unit || "";
  const reorderRaw = chosen ? chosen.reorderLevel : opt.dataset.reorder;
  const reorder = reorderRaw !== undefined && reorderRaw !== "" ? Number(reorderRaw) : "—";

  box.classList.remove("d-none");
  let text = `Current stock: <strong>${qty}</strong>`;
  if (unit) text += ` ${escapeHtml(unit)}`;
  if (reorder !== "—") text += ` &nbsp;|&nbsp; Reorder level: <strong>${reorder}</strong>`;
  box.innerHTML = text;
}
