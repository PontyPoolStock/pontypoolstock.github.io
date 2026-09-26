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
} from "../utils/helpers.js";

import { postData, updateData, fetchData, PRODUCT_ADJUSTMENT_FIELDS } from "../services/api.js";
import {getCurrentUser} from "../pages/login.js";

//* Background refill for Edit modals opened from the slim cached row: pull the
//* single full record (fields=…imageUrl) and patch the hidden image value +
//* preview only if the user hasn't already picked a new image. Fire-and-forget
//* so the modal stays instant; Save before it lands still keeps the old image
//* because the PUT only sends imageUrl when it changed (see saveBtnEvent).
function refreshEditImage(obj, id, opts, modalElement) {
  if (!id || !opts?.refreshFields) return;
  const resource = obj === "categories" ? "categories" : "products";
  const initial = obj === "categories" ? opts.initialCategory : opts.initialProduct;
  if (initial?.imageUrl) return; // already has bytes, nothing to refill
  fetchData(`${resource}/${id}?fields=${opts.refreshFields}`, { fresh: true })
    .then((full) => {
      if (!modalElement.isConnected || !full?.imageUrl) return;
      const value = modalElement.querySelector('input[type="hidden"][name="imageUrl"]');
      //^ user already chose a replacement — never overwrite their pick
      if (!value || value.value) return;
      value.value = full.imageUrl;
      const preview = modalElement.querySelector("img.product-image-preview");
      const prompt = modalElement.querySelector(".product-image-prompt");
      if (preview) {
        preview.src = full.imageUrl;
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
    //^ Rehydrate just this product's full record in the background so an
    //^ untouched image preview + Save keeps the original instead of wiping it.
    refreshEditImage(obj, id, opts, modalElement);
  }
  if (obj === "categories") {
    setupImageUploader("category");
    refreshEditImage(obj, id, opts, modalElement);
  }

  saveBtnEvent(obj, action, id, modal, modalElement, onAfterSave);
}


async function saveBtnEvent(obj, action, id, modal, modalElement, onAfterSave) {
  document
    .querySelector(".save-btn")
    .addEventListener("click", async function () {
      const form = document.querySelector("form");
      let data = Object.fromEntries(new FormData(form));

      const ratings = obj === "products" ? collectProductVariants() : [];

      let productsForAdjustment = null;
      if (obj === "stockAdjustments") {
        // Same projection the form dropdown uses — one warm cache key.
        productsForAdjustment = await fetchData(`products?fields=${PRODUCT_ADJUSTMENT_FIELDS}`);
      }

      let isValid = validateData(obj, data, id, productsForAdjustment, ratings);
      if (!isValid) return;

      if (obj === "products") {
        //^ the ratings drive price and stock, so the totals always stay in sync
        data.variants = ratings;
        if (ratings.length) {
          const range = getVariantPriceRange(ratings);
          data.price = range ? range.min : 0;
          data.quantity = getVariantsTotalQuantity(ratings);
        }

        //^ only a name or a category is needed — empty optional fields become defaults
        data.name = String(data.name ?? "").trim();
        data.sku = String(data.sku ?? "").trim() || null;
        data.unit = String(data.unit ?? "").trim();
        data.categoryId = String(data.categoryId ?? "").trim() || null;
        data.price = Math.max(0, Number(data.price) || 0);
        data.quantity = Math.max(0, Number(data.quantity) || 0);
        //^ Edit opened from the slim cached row has no image bytes yet. If the
        //^ background refill hasn't landed and the user didn't touch the image,
        //^ OMIT imageUrl from the PUT so the server keeps the stored original
        //^ instead of wiping it to "" — this is what made Save feel "slow then
        //^ lossy" before. A newly picked image still sends normally.
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
        if (!product) return;

        const qty = parseInt(data.quantity, 10);
        const type = data.type;
        const variants = getProductVariants(product);
        //* The rating dropdown stores the row index, so duplicated watts stay unique
        const ratingIndex = Number.parseInt(String(data.variantLabel ?? ""), 10);
        const rating = Number.isNaN(ratingIndex) ? undefined : variants[ratingIndex];
        if (variants.length && !rating) {
          document.querySelector(".errorMes-variantLabel").innerHTML =
            "Select the rating you are adjusting.";
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

      if (action === "Edit") {
        const result = await updateData(`${obj}`, id, data);
        if (!result || result.error) {
          alert(result?.error || "Unable to update this item.");
          return;
        }
      } else if (action === "Add") {
        const result = await postData(`${obj}`, data);
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
