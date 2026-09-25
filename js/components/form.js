import { fetchData } from "../services/api.js";
import {
  getProductVariants,
  getVariantsTotalQuantity,
  getVariantPriceRange,
  RATING_COLOURS,
} from "../utils/helpers.js";
export async function makeProductForm(id, categoryId = "") {
  let product = "";
  if (id) {
    product = await fetchData(`products/${id}`);
  }
  const categories = await fetchData("categories");
  const selectedCategoryId = id ? product.categoryId : categoryId;
  const ratingRows = getProductVariants(id ? product : "").map(variantRowHtml).join("");
  const categoryIsLocked = !id && categoryId !== "" && categoryId !== null && categoryId !== undefined;
  let html = `
  <form>
    <div class="row mb-3">
      <div class="col-6">
        <label class="text-secondary" class="form-label" for="name">Product Name *</label>
        <input type="text" class="form-control" name="name" placeholder="e.g Laptop Pro" value="${escAttr(id ? (product.name || "") : "")}">
        <div class="text-danger fw-bold errorMes errorMes-name"></div>
      </div>
      <div class="col-6">
        <label class="text-secondary" class="form-label" for="sku">Code</label>
        <input type="text" class="form-control" name='sku'  placeholder="Optional code, e.g. LP-001" value="${escAttr(id ? (product.sku || "") : "")}">
        <div class="text-danger fw-bold errorMes errorMes-sku"></div>
      </div>
    </div>

    <div class="row mb-3">
      <div class="col-6">
        <label class="text-secondary" class="form-label" for="categoryId">Category</label>
        ${categoryIsLocked ? `<input type="hidden" name="categoryId" value="${selectedCategoryId}">` : ""}
        ${displayProductsOptions("category", selectedCategoryId, categories, categories, categoryIsLocked)}
        <div class="text-danger fw-bold errorMes errorMes-categoryId"></div>
      </div>
      <div class="col-6">
        <label class="text-secondary" class="form-label" for="price">Price</label>
        <input type="number" class="form-control" name="price" placeholder="0.00" value="${escAttr(id ? product.price : "")}">
        <div class="text-danger fw-bold errorMes errorMes-price"></div>

      </div>
    </div>


    <div class="row mb-3">
      <div class="col-6">
        <label class="text-secondary" class="form-label" for="quantity">Quantity</label>
        <input type="number" class="form-control" name='quantity'  placeholder="0" value="${escAttr(id ? product.quantity : "")}">
        <div class="text-danger fw-bold errorMes errorMes-quantity"></div>

      </div>
      <div class="col-6">
        <label class="text-secondary" class="form-label" for="unit">Unit</label>
        <input type="text" class="form-control" name='unit'  placeholder="Pcs / kg / box" value="${escAttr(id ? (product.unit || "") : "")}">
        <div class="text-danger fw-bold errorMes errorMes-unit"></div>

      </div>
    </div>


    <div class="row mb-3">
      <div class="col-12">
        <div class="d-flex align-items-center justify-content-between flex-wrap gap-2">
          <label class="text-secondary form-label mb-0">Ratings / Variants</label>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="addVariantBtn">
            <i class="bi bi-plus-lg"></i> Add rating
          </button>
        </div>
        <div id="variantsList" class="d-flex flex-column gap-2 mt-2">${ratingRows}</div>
        <datalist id="ratingColourSuggestions">
          ${RATING_COLOURS.map((option) => `<option value="${option}">`).join("")}
        </datalist>
        <div class="text-danger fw-bold errorMes errorMes-variants"></div>
      </div>
    </div>

    <div class="row mb-3">
      <div class="col-12">
        <label class="text-secondary form-label" for="productImageFile">Product Image</label>
        <div class="product-image-dropzone" id="productImageDropzone" tabindex="0" role="button" aria-label="Choose a product image">
          <input type="file" id="productImageFile" accept="image/*" hidden>
          <img id="productImagePreview" class="product-image-preview${id && product.imageUrl ? "" : " d-none"}" src="${escAttr(id ? (product.imageUrl || "") : "")}" alt="Product preview">
          <div id="productImagePrompt" class="product-image-prompt${id && product.imageUrl ? " d-none" : ""}">
            <i class="bi bi-cloud-arrow-up"></i>
            <strong>Drop an image here</strong>
            <span>or click to browse from your device</span>
          </div>
        </div>
        <input type="hidden" name="imageUrl" id="productImageValue" value="${escAttr(id ? (product.imageUrl || "") : "")}">
        <div class="text-muted small mt-1">PNG, JPG, or WEBP up to 2 MB.</div>
      </div>
    </div>
  </form>`;
  return html;
}
function displayProductsOptions(type, id, data, allCategories, locked = false) {
  let selectInput = `<select ${locked ? "disabled" : ""} name='${locked ? "categoryDisplay" : "categoryId"}' class="form-select w-100">`;
  if (!data.length) {
    selectInput += `<option value="" selected disabled>No categories yet - add one in the Categories section</option>`;
  }
  if (data.length) {
    selectInput += `<option value="" ${id ? "" : "selected"}>No category</option>`;
  }
  data.forEach(function (item) {
    let selected = "";
    if (Number(item.id) === Number(id)) selected = "selected";
    selectInput += `<option value="${item.id}" ${selected}>${escAttr(getCategoryPath(item, allCategories))}</option>`;
  });
  selectInput += `</select>`;
  return selectInput;
}

//* One editable rating row inside the product form
function variantRowHtml(variant = {}) {
  return `
    <div class="variant-row border rounded p-2" data-variant-row>
      <div class="row g-2 align-items-end">
        <div class="col-6 col-md-4">
          <label class="form-label small text-secondary mb-1">Watts</label>
          <input type="text" class="form-control form-control-sm" data-field="label"
            value="${escAttr(variant.label || "")}" placeholder="e.g. 4W">
        </div>
        <div class="col-6 col-md-3">
          <label class="form-label small text-secondary mb-1">Price</label>
          <input type="number" class="form-control form-control-sm" data-field="price"
            value="${escAttr(variant.price ?? "")}" placeholder="0">
        </div>
        <div class="col-4 col-md-2">
          <label class="form-label small text-secondary mb-1">Qty</label>
          <input type="number" class="form-control form-control-sm" data-field="quantity"
            value="${escAttr(variant.quantity ?? "")}" placeholder="0">
        </div>
        <div class="col-4 col-md-2">
          <label class="form-label small text-secondary mb-1">Min</label>
          <input type="number" class="form-control form-control-sm" data-field="reorderLevel"
            value="${escAttr(variant.reorderLevel ?? "")}" placeholder="0">
        </div>
        <div class="col-4 col-md-1">
          <button type="button" class="btn btn-sm btn-outline-danger w-100" data-remove-variant
            title="Remove rating">&times;</button>
        </div>
      </div>
      <div class="row g-2 mt-1 align-items-end">
        <div class="col-6 col-md-3">
          <label class="form-label small text-secondary mb-1">Colour</label>
          <input type="text" class="form-control form-control-sm" data-field="colour"
            list="ratingColourSuggestions" value="${escAttr(variant.colour || "")}"
            placeholder="White / Warm White / RGB / any">
        </div>
        <div class="col-6 col-md-3">
          <label class="form-label small text-secondary mb-1">Amperes (A)</label>
          <input type="number" class="form-control form-control-sm" data-field="amps"
            value="${escAttr(variant.amps ?? "")}" min="0" step="0.01" placeholder="e.g. 0.05">
        </div>
      </div>
    </div>
  `;
}

//* Wire the ratings repeater: add / remove rows, keep Quantity and Price in sync
export function setupProductVariants() {
  const list = document.getElementById("variantsList");
  const addBtn = document.getElementById("addVariantBtn");
  if (!list || !addBtn) return;

  const syncDerivedFields = () => {
    const totalInput = document.querySelector("input[name='quantity']");
    const priceInput = document.querySelector("input[name='price']");
    if (!totalInput) return;

    const variants = collectProductVariants();
    if (!variants.length) {
      totalInput.readOnly = false;
      if (priceInput) priceInput.readOnly = false;
      return;
    }

    totalInput.readOnly = true;
    totalInput.value = getVariantsTotalQuantity(variants);
    if (priceInput) {
      const range = getVariantPriceRange(variants);
      priceInput.readOnly = true;
      priceInput.value = range ? range.min : "";
    }
  };

  addBtn.addEventListener("click", () => {
    list.insertAdjacentHTML("beforeend", variantRowHtml());
    syncDerivedFields();
  });

  list.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-remove-variant]");
    if (!removeBtn) return;
    removeBtn.closest("[data-variant-row]")?.remove();
    syncDerivedFields();
  });

  list.addEventListener("input", syncDerivedFields);
  syncDerivedFields();
}

//* Read the ratings out of the form (no name attributes, so FormData stays clean)
export function collectProductVariants() {
  const list = document.getElementById("variantsList");
  if (!list) return [];

  return [...list.querySelectorAll("[data-variant-row]")]
    .map((row) => {
      const valueOf = (field) => row.querySelector(`[data-field="${field}"]`)?.value.trim() || "";
      const ampsRaw = valueOf("amps");
      return {
        label: valueOf("label"),
        price: Number(valueOf("price")) || 0,
        quantity: Number(valueOf("quantity")) || 0,
        reorderLevel: Number(valueOf("reorderLevel")) || 0,
        colour: valueOf("colour"),
        amps: ampsRaw === "" ? "" : Number(ampsRaw),
      };
    })
    .filter(
      (variant) =>
        variant.label
        || variant.colour
        || variant.amps !== ""
        || variant.price
        || variant.quantity
        || variant.reorderLevel,
    );
}

export async function makeCategoryForm(id, parentCategoryId = "") {
  let category = "";
  const categories = await fetchData("categories");

  if (id) {
    category = await fetchData(`categories/${id}`);
  }

  const selectedParentId = id ? (category.parentId ?? category.parent_id ?? "") : parentCategoryId;
  const parentIsLocked = !id && parentCategoryId !== "" && parentCategoryId !== null && parentCategoryId !== undefined;
  const parentOptions = categories
    .filter((item) => String(item.id) !== String(id || ""))
    .map((item) => {
      const isSelected = String(item.id) === String(selectedParentId);
      return `<option value="${item.id}" ${isSelected ? "selected" : ""}>${escAttr(getCategoryPath(item, categories))}</option>`;
    })
    .join("");

  let html = `
  <form>
    <div class="row mb-3">
      <div class="col-12">
        <label class="text-secondary" class="form-label" for="name">Category Name *</label>
        <input type="text" class="form-control" name="name" placeholder="e.g Electronics" value="${escAttr(id ? (category.name || "") : "")}">
        <div class="text-danger fw-bold errorMes errorMes-name"></div>
      </div>
    </div>

    <div class="row mb-3">
      <div class="col-12">
        <label class="text-secondary form-label" for="parentId">Parent Category</label>
        ${parentIsLocked ? `<input type="hidden" name="parentId" value="${selectedParentId}">` : ""}
        <select ${parentIsLocked ? "disabled" : ""} name="${parentIsLocked ? "parentCategoryDisplay" : "parentId"}" class="form-select">
          <option value="">Top level category</option>
          ${parentOptions}
        </select>
      </div>
    </div>

    <div class="row mb-3">
      <div class="col-12">
        <label class="text-secondary form-label" for="categoryImageFile">Category Image</label>
        <div class="product-image-dropzone" id="categoryImageDropzone" tabindex="0" role="button" aria-label="Choose a category image">
          <input type="file" id="categoryImageFile" accept="image/*" hidden>
          <img id="categoryImagePreview" class="product-image-preview${id && category.imageUrl ? "" : " d-none"}" src="${escAttr(id ? (category.imageUrl || "") : "")}" alt="Category preview">
          <div id="categoryImagePrompt" class="product-image-prompt${id && category.imageUrl ? " d-none" : ""}">
            <i class="bi bi-cloud-arrow-up"></i>
            <strong>Drop an image here</strong>
            <span>or click to browse from your device</span>
          </div>
        </div>
        <input type="hidden" name="imageUrl" id="categoryImageValue" value="${escAttr(id ? (category.imageUrl || "") : "")}">
        <div class="text-muted small mt-1">PNG, JPG, or WEBP up to 2 MB.</div>
      </div>
    </div>
  </form>`;
  return html;
}

function getCategoryPath(category, categories, visited = new Set()) {
  if (!category || visited.has(String(category.id))) return category?.name || "";
  const nextVisited = new Set(visited).add(String(category.id));
  const parentId = category.parentId ?? category.parent_id ?? "";
  const parent = categories.find((item) => String(item.id) === String(parentId));
  return parent ? `${getCategoryPath(parent, categories, nextVisited)} / ${category.name}` : category.name;
}

function escAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

export async function makeStockAdjustmentForm() {
  const products = await fetchData("products");
  const productOptions = products
    .map((p) => {
      const variants = getProductVariants(p);
      const qty = variants.length ? getVariantsTotalQuantity(variants) : Number(p.quantity) || 0;
      const unit = escAttr(p.unit || "");
      const reorder =
        p.reorderLevel !== undefined && p.reorderLevel !== ""
          ? escAttr(String(p.reorderLevel))
          : "";
      const ratingInfo = variants.length
        ? ` - ${variants.length} rating${variants.length === 1 ? "" : "s"}`
        : "";
      return `<option value="${p.id}" data-qty="${qty}" data-unit="${unit}" data-reorder="${reorder}" data-variants="${escAttr(JSON.stringify(variants))}">${escAttr(p.name || "")} (Qty: ${qty})${ratingInfo}</option>`;
    })
    .join("");

  return `
    <form id="stockAdjustmentForm">
      <div class="mb-3">
        <label class="text-secondary form-label" for="productId">Product *</label>
        <select name="productId" id="stockAdjProductSelect" class="form-select">
          <option value="">Select product</option>
          ${productOptions}
        </select>
        <div class="text-danger fw-bold errorMes errorMes-productId"></div>
      </div>
      <div class="mb-3 d-none" id="adjVariantWrapper">
        <label class="text-secondary form-label" for="stockAdjVariantSelect">Rating *</label>
        <select name="variantLabel" id="stockAdjVariantSelect" class="form-select"></select>
        <div class="text-danger fw-bold errorMes errorMes-variantLabel"></div>
      </div>
      <div id="adjCurrentStock" class="adjustment-current-stock d-none small mb-3"></div>
      <div class="row mb-3">
        <div class="col-6">
          <label class="text-secondary form-label" for="type">Type *</label>
          <select name="type" id="stockAdjTypeSelect" class="form-select">
            <option value="increase">Add stock (+)</option>
            <option value="decrease">Remove stock (−)</option>
          </select>
          <div class="text-danger fw-bold errorMes errorMes-type"></div>
        </div>
        <div class="col-6">
          <label class="text-secondary form-label" for="quantity">Quantity *</label>
          <input type="number" name="quantity" id="stockAdjQtyInput" class="form-control" min="1" placeholder="0">
          <div class="text-danger fw-bold errorMes errorMes-quantity"></div>
        </div>
      </div>
    </form>
  `;
}
