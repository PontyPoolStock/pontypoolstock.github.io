import {
  makeProductForm,
  makeCategoryForm,
  makeStockAdjustmentForm,
  setupProductVariants,
  collectProductVariants,
} from "./form.js";

import {
  isVaildProductData,
  isVaildCategoryData,
  isVaildStockAdjustmentData,
  GetCurrentDate,         
  buildStorableImageUrl,
  escapeHtml,
  getProductVariants,
  getVariantsTotalQuantity,
  getVariantPriceRange,
  getVariantName,
} from "../utils/helpers.js";

import { postData, updateData, fetchData } from "../services/api.js";
import {getCurrentUser} from "../pages/login.js";

export async function getModal(obj, action, id, onAfterSave) {
  const objModalName = `${obj}Modal`;
  document.querySelector(`#${objModalName}`)?.remove();
  let modalTitle = `${action} ${obj}`;
  if (obj === "stockAdjustments") modalTitle = `${action} Stock Adjustment`;

  let html = `
  <div class="modal fade" id="${objModalName}" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <div class="modal-header">
          <h4>${modalTitle}</h4>
        </div>
        <div class="modal-body">`;

  if (obj === "products") html += await makeProductForm(id);
  else if (obj === "categories") html += await makeCategoryForm(id);
  else if (obj === "stockAdjustments") html += await makeStockAdjustmentForm();

  html += `</div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary save-btn">Save</button>
          <button type="button" class="btn btn-secondary close-btn" data-dismiss="modal">Close</button>
        </div>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML("beforeend", html);
  const modalElement = document.querySelector(`#${objModalName}`);
  const modal = new bootstrap.Modal(modalElement);
  modal.show();

  if (obj === "stockAdjustments") setupStockAdjustmentListeners();
  if (obj === "products") {
    setupImageUploader("product");
    setupProductVariants();
  }
  if (obj === "categories") setupImageUploader("category");

  saveBtnEvent(obj, action, id, modal, modalElement, onAfterSave);
  closeBtnEvent(modalElement, modal);
  deleteModal(modalElement);
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
        productsForAdjustment = await fetchData("products");
      }

      let isVaild = vaildData(obj, data, id, productsForAdjustment, ratings);
      if (!isVaild) return;

      if (obj === "products") {
        //^ the ratings drive price and stock, so the totals always stay in sync
        data.variants = ratings;
        if (ratings.length) {
          const range = getVariantPriceRange(ratings);
          data.price = range ? range.min : 0;
          data.quantity = getVariantsTotalQuantity(ratings);
        }

        //^ nothing is required but the name — empty optional fields become defaults
        data.name = String(data.name ?? "").trim();
        data.sku = String(data.sku ?? "").trim() || null;
        data.unit = String(data.unit ?? "").trim();
        data.categoryId = String(data.categoryId ?? "").trim() || null;
        data.price = Math.max(0, Number(data.price) || 0);
        data.quantity = Math.max(0, Number(data.quantity) || 0);
      } else if (obj === "categories") {
        data.name = String(data.name ?? "").trim();
        data.parentId = String(data.parentId ?? "").trim() || null;
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

        await postData("stockAdjustments", {
          productId: product.id,
          productName: getVariantName(product, rating),
          type,
          quantity: qty,
          date: nowIso,
          oldQuantity: oldQty,
          newQuantity: newQty,
        });

        if (rating) {
          const nextVariants = variants.map((item, index) => (
            index === ratingIndex
              ? { ...item, quantity: newQty }
              : item
          ));
          await updateData("products", product.id, {
            ...product,
            variants: nextVariants,
            quantity: getVariantsTotalQuantity(nextVariants),
          });
        } else {
          await updateData("products", product.id, { ...product, quantity: newQty });
        }

        const sign = type === "increase" ? "+" : "−";
        await postData("activityLog", {
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
        await postData("activityLog", {
          action: "CREATE_PRODUCT",
          details: `New product added: ${data.name}${data.sku ? ` (${data.sku})` : ""}${ratings.length ? ` - ${ratings.length} rating${ratings.length === 1 ? "" : "s"}` : ""}`,
          user: "admin",
          timestamp: GetCurrentDate(),
        });
      } else if (obj === "products" && action === "Edit") {
        await postData("activityLog", {                         
          action: "UPDATE_PRODUCT",
          details: `Product updated: ${data.name}${data.sku ? ` (${data.sku})` : ""}${ratings.length ? ` - ${ratings.length} rating${ratings.length === 1 ? "" : "s"}` : ""}`,
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

function vaildData(obj, data, id, products, ratings = []) {
  let result = true;
  if (obj === "products") result = isVaildProductData(data, id, ratings);
  else if (obj === "categories") result = isVaildCategoryData(data);
  else if (obj === "stockAdjustments") result = isVaildStockAdjustmentData(data, products);
  return result;
}

function closeBtnEvent(modalElement, modal) {
  modalElement
    .querySelector(".close-btn")
    .addEventListener("click", function () {
      if (confirm("Are you sure you want to discard changes?")) {
        modal.hide();
      }
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
