//* Validation Functions for Products
export function isVaildProductData(data, id, variants = []) {
  document
    .querySelectorAll(".errorMes")
    .forEach((item) => (item.innerHTML = ""));
  normalizeProductUnit(data);

  const ratingRows = Array.isArray(variants) ? variants : [];
  const hasRatings = ratingRows.length > 0;

  //^ price and quantity are derived from the ratings when the product has any
  const v1 = isVaildName(data.name);
  const v2 = isVaildSku(data.sku, id);
  const v3 = hasRatings || isVaildNumber(data.price, "price");
  const v4 = hasRatings || isVaildNumber(data.quantity, "quantity");
  const v5 = isVaildUnit(data.unit);
  const v6 = isVaildCategoryId(data.categoryId);
  const v7 = isVaildVariantRows(ratingRows);
  return v1 && v2 && v3 && v4 && v5 && v6 && v7;
}

//* The colours a rating can be sold in — must match the Colour dropdown in the product form
export const RATING_COLOURS = ["White", "Warm White", "RGB"];

//* Every rating needs its own name and price, and a quantity of 0 or more
function isVaildVariantRows(variants) {
  if (!variants.length) return true;

  const errorBox = document.querySelector(".errorMes-variants");
  const seen = new Set();

  for (const variant of variants) {
    const label = String(variant.label || "").trim();
    const price = Number(variant.price);
    const quantity = Number(variant.quantity);
    const colour = String(variant.colour || "").trim().toLowerCase();
    const amps = variant.amps;
    let message = "";

    if (!label) message = "Every rating needs a name (e.g. 4W).";
    else if (seen.has(label.toLowerCase())) message = `Rating "${label}" is used twice.`;
    else if (!RATING_COLOURS.some((option) => option.toLowerCase() === colour))
      message = `Rating "${label}" needs a colour: White, Warm White, or RGB.`;
    else if (!Number.isFinite(price) || price <= 0) message = `Rating "${label}" needs a price above 0.`;
    else if (!Number.isFinite(quantity) || quantity < 0) message = `Rating "${label}" needs a quantity of 0 or more.`;
    else if (amps !== "" && amps !== null && amps !== undefined && (!Number.isFinite(Number(amps)) || Number(amps) < 0))
      message = `Rating "${label}" needs amperes of 0 or more.`;

    if (message) {
      if (errorBox) errorBox.innerHTML = message;
      return false;
    }
    seen.add(label.toLowerCase());
  }
  return true;
}
function isVaildCategoryId(categoryId) {
  if (categoryId) return true;
  document.querySelector(".errorMes-categoryId").innerHTML =
    "Please select a category for this product.";
  return false;
}
function isVaildName(name) {
  if (name.length === 0) {
    document.querySelector(".errorMes-name").innerHTML =
      `Product Name is required`;
    return false;
  }
  if (name.length <= 3 || name.length > 25) {
    document.querySelector(".errorMes-name").innerHTML =
      `Product Name should be bigger than 3 characters and less than 25`;
    return false;
  }
  return true;
}
function isVaildSku(sku) {
  if (!sku || sku.trim().length === 0) return true;
  const skuRegex = /^[A-Z]+-\d{3}$/;
  if (!skuRegex.test(sku)) {
    document.querySelector(".errorMes-sku").innerHTML =
      "Invalid code format. Please use 'LETTERS-000'.";
    return false;
  }
  return true;
}
function isVaildNumber(num, type) {
  if (num.length === 0) {
    document.querySelector(`.errorMes-${type}`).innerHTML =
      `Product ${type} is required`;
    return false;
  }
  num = Number(num);
  if (num <= 0) {
    document.querySelector(`.errorMes-${type}`).innerHTML =
      `Product ${type} should be bigger than zero`;
    return false;
  }
  return true;
}
function isVaildUnit(unit) {
  if (unit.length === 0) {
    document.querySelector(`.errorMes-unit`).innerHTML =
      `Product unit is required`;
    return false;
  }
  let units = ["pcs", "kg", "box"];
  unit = unit.toLowerCase().trim();
  if (!units.includes(unit)) {
    document.querySelector(`.errorMes-unit`).innerHTML =
      `Product unit should be pcs, kg, or box`;
    return false;
  }
  return true;
}

function normalizeProductUnit(data) {
  const value = String(data.unit || "").trim().toLowerCase();
  const combined = value.match(/^(\d+(?:\.\d+)?)\s*(boxes?|pieces?|pcs?|kgs?)$/);
  if (combined) {
    if (!data.quantity) data.quantity = combined[1];
    data.unit = combined[2];
  }

  const aliases = { boxes: "box", box: "box", pieces: "pcs", piece: "pcs", pcs: "pcs", kg: "kg", kgs: "kg" };
  data.unit = aliases[String(data.unit || "").trim().toLowerCase()] || data.unit;
}

export function isVaildCategoryData(data) {
  document
    .querySelectorAll(".errorMes")
    .forEach((item) => (item.innerHTML = ""));

  const parentId = data.parentId ?? data.parent_id ?? "";
  if (parentId && String(parentId) === String(data.id || "")) {
    document.querySelector(".errorMes-name").innerHTML = "A category cannot be its own parent.";
    return false;
  }

  return isVaildName(data.name);
}

//* Validation — stock adjustments
export function isVaildStockAdjustmentData(data, products) {
  document
    .querySelectorAll(".errorMes")
    .forEach((item) => (item.innerHTML = ""));
  const v1 = isVaildAdjustmentProductId(data.productId);
  const v2 = isVaildAdjustmentType(data.type);
  const v3 = isVaildAdjustmentQuantity(
    data.quantity,
    data.type,
    data.productId,
    products,
    data.variantLabel,
  );
  return v1 && v2 && v3;
}
function isVaildAdjustmentProductId(productId) {
  if (!productId || String(productId).trim() === "") {
    document.querySelector(".errorMes-productId").innerHTML =
      "Product is required";
    return false;
  }
  return true;
}
function isVaildAdjustmentType(type) {
  if (type !== "increase" && type !== "decrease") {
    document.querySelector(".errorMes-type").innerHTML =
      "Select a valid adjustment type";
    return false;
  }
  return true;
}
function isVaildAdjustmentQuantity(quantityStr, type, productId, products, variantLabel = "") {
  if (
    quantityStr === undefined
    || quantityStr === null
    || String(quantityStr).trim() === ""
  ) {
    document.querySelector(".errorMes-quantity").innerHTML =
      "Quantity is required";
    return false;
  }
  const num = parseInt(String(quantityStr), 10);
  if (Number.isNaN(num) || num <= 0) {
    document.querySelector(".errorMes-quantity").innerHTML =
      "Quantity must be greater than 0";
    return false;
  }
  if (type === "decrease" && Array.isArray(products)) {
    const product = products.find((p) => p.id == productId);
    if (!product) {
      document.querySelector(".errorMes-quantity").innerHTML =
        "Product not found";
      return false;
    }
    const variant = getProductVariants(product).find(
      (item) => String(item.label) === String(variantLabel || ""),
    );
    const oldQty = variant
      ? getVariantQuantity(variant)
      : Number(product.quantity) || 0;
    if (oldQty - num < 0) {
      document.querySelector(".errorMes-quantity").innerHTML =
        "Cannot reduce below 0. Current stock: " + oldQty + ".";
      return false;
    }
  }
  return true;
}

//* Product ratings (variants) — e.g. St64 sold in 4W / 8W / 12W
export function getProductVariants(product) {
  return Array.isArray(product?.variants) ? product.variants : [];
}
export function getVariantQuantity(variant) {
  return Number(variant?.quantity) || 0;
}
export function getVariantReorderLevel(variant) {
  return Number(variant?.reorderLevel) || 0;
}
export function getVariantPrice(variant) {
  return Number(variant?.price) || 0;
}
export function getVariantsTotalQuantity(variants) {
  return (Array.isArray(variants) ? variants : []).reduce(
    (sum, variant) => sum + getVariantQuantity(variant),
    0,
  );
}
//* Lowest / highest rating price — null when there are no ratings
export function getVariantPriceRange(variants) {
  const prices = (Array.isArray(variants) ? variants : [])
    .map(getVariantPrice)
    .filter((price) => price > 0);
  if (!prices.length) return null;
  return { min: Math.min(...prices), max: Math.max(...prices) };
}
//* "St64 12W" — used by alerts, reports, adjustments and the activity log
export function getVariantName(product, variant) {
  const name = String(product?.name || "");
  return variant?.label ? `${name} ${variant.label}`.trim() : name;
}
//* Total stock of one product (sum of its ratings, or its own quantity)
export function getProductStock(product) {
  const variants = getProductVariants(product);
  if (!variants.length) return Number(product?.quantity) || 0;
  return getVariantsTotalQuantity(variants);
}
//* Stock value of one product (sum over its ratings, or quantity * price)
export function getProductStockValue(product) {
  const variants = getProductVariants(product);
  if (!variants.length) {
    return (Number(product?.price) || 0) * (Number(product?.quantity) || 0);
  }
  return variants.reduce(
    (sum, variant) => sum + getVariantPrice(variant) * getVariantQuantity(variant),
    0,
  );
}
//* One stock line per rating ("St64 12W") so alerts and reports stay exact
export function expandProductsToStockLines(products) {
  if (!Array.isArray(products)) return [];
  const lines = [];
  for (const product of products) {
    const variants = getProductVariants(product);
    if (!variants.length) {
      lines.push({ ...product, variantLabel: "" });
      continue;
    }
    for (const variant of variants) {
      lines.push({
        ...product,
        variantLabel: variant.label || "",
        name: getVariantName(product, variant),
        sku: variant.sku || product.sku || "",
        price: getVariantPrice(variant),
        quantity: getVariantQuantity(variant),
        reorderLevel: getVariantReorderLevel(variant),
      });
    }
  }
  return lines;
}

//* Dashboard & Reports — shared inventory helpers
export function formatEGP(amount) {
  let num = Number(amount || 0);
  return `KSh ${num.toLocaleString("en-US")}`;
}
export function getLowStockProducts(products) {
  return expandProductsToStockLines(products)
    .filter((p) => Number(p.quantity) <= Number(p.reorderLevel))
    .sort((a, b) => Number(a.quantity) - Number(b.quantity));
}
export function getInventoryValueRowsSorted(products, limit) {
  const rows = expandProductsToStockLines(products).map((p) => ({
    id: p.id,
    name: p.name,
    value: (Number(p.price) || 0) * (Number(p.quantity) || 0),
  }));
  rows.sort((a, b) => b.value - a.value);
  if (typeof limit === "number") return rows.slice(0, limit);
  return rows;
}
export function getTotalInventoryValue(products) {
  if (!Array.isArray(products)) return 0;
  return products.reduce((total, product) => total + getProductStockValue(product), 0);
}
//* Activity log — shared with Activity page and Dashboard
export function normalizeActivity(activity = {}) {
  const details = cleanActivityDetails(activity.details || activity.message || "Activity recorded");
  const fallbackText = String(
    details,
  );
  const lowerFallback = fallbackText.toLowerCase();

  let action = activity.action || "INFO";
  if (!activity.action) {
    if (lowerFallback.includes("logged in")) action = "LOG_IN";
    else if (lowerFallback.includes("logged out")) action = "LOG_OUT";
  }

  return {
    ...activity,
    action,
    details,
    timestamp:
      activity.timestamp
      || activity.createdAt
      || activity.updatedAt
      || activity.time
      || new Date().toISOString(),
  };
}

function cleanActivityDetails(value) {
  return String(value)
    .replace(/\s*\((?:null|undefined)?\)\s*$/i, "")
    .replace(/\s+(?:null|undefined)\s*$/i, "")
    .trim();
}

export function getActionStyle(action = "") {
  const safeAction = String(action);

  if (safeAction.includes("STOCK_ADJUSTMENT"))
    return { color: "warning", label: "adjust" };
  if (safeAction.includes("RECEIVE_ORDER"))
    return { color: "primary", label: "order" };
  if (safeAction.includes("CREATE_PURCHASE_ORDER"))
    return { color: "primary", label: "order" };
  if (safeAction.includes("CREATE_PRODUCT"))
    return { color: "success", label: "add" };
  if (safeAction.includes("UPDATE_PRODUCT"))
    return { color: "success", label: "update" };
  if (safeAction.includes("DELETE_PRODUCT"))
    return { color: "danger", label: "delete" };
  if (safeAction.includes("DELETE_CATEGORY"))
    return { color: "danger", label: "delete" };
  if (safeAction.includes("DELETE_SUPPLIER"))
    return { color: "danger", label: "delete" };
  if (safeAction.includes("LOW_STOCK_ALERT"))
    return { color: "danger", label: "alert" };
  if (safeAction.includes("LOG_IN"))
    return { color: "info", label: "login" };
  if (safeAction.includes("LOG_OUT"))
    return { color: "secondary", label: "logout" };
  return { color: "secondary", label: "info" };
}
export function formatActivityTimestamp(timestamp) {
  if (!timestamp) return "Unknown time";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return String(timestamp);
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
export function activityRowHtml(activity) {
  const normalizedActivity = normalizeActivity(activity);
  const { color, label } = getActionStyle(normalizedActivity.action);
  const date = formatActivityTimestamp(normalizedActivity.timestamp);
  return `
    <div class="d-flex align-items-center justify-content-between py-3 border-bottom">
      <div class="d-flex align-items-start gap-3">
        <span class="mt-1 rounded-circle bg-${color} activity-dot"></span>
        <div>
          <div class="fw-medium">${normalizedActivity.details}</div>
          <small class="text-muted">${date}</small>
        </div>
      </div>
      <span class="badge rounded-pill bg-${color} bg-opacity-25 
        text-${color} ms-3 text-capitalize fw-normal px-3">
        ${label}
      </span>
    </div>
  `;
}

export function GetCurrentDate() {
  return new Date().toISOString();
}

export function sortData(data) {
  return [...data].sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAt);
    const dateB = new Date(b.updatedAt || b.createdAt);
    return dateB - dateA; // الأحدث أولاً
  });
}

//* Image helpers
//! JSON Server (v1) parses request bodies with a 100 KiB limit, so image data
//! URLs must stay small or POST/PUT requests fail with HTTP 500.
const MAX_IMAGE_DATA_URL_LENGTH = 90000;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () =>
      reject(new Error("Unable to read that image.")),
    );
    reader.readAsDataURL(file);
  });
}

function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () =>
      reject(new Error("Unable to read that image.")),
    );
    image.src = dataUrl;
  });
}

//* Downscale and re-encode the image until it fits the allowed data URL length
function shrinkImage(image, maxLength) {
  const maxSides = [1024, 768, 512, 384, 256];
  const qualities = [0.85, 0.7, 0.55, 0.4, 0.3];
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) return "";

  let smallest = "";
  for (const maxSide of maxSides) {
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of qualities) {
      const candidate = canvas.toDataURL("image/jpeg", quality);
      if (!smallest || candidate.length < smallest.length) smallest = candidate;
      if (candidate.length <= maxLength) return candidate;
    }
  }

  return smallest.length <= maxLength ? smallest : "";
}

//* Read a picked image and return a data URL small enough to be stored
export async function buildStorableImageUrl(file, maxLength = MAX_IMAGE_DATA_URL_LENGTH) {
  const original = await readFileAsDataUrl(file);
  if (original.length <= maxLength) return original;

  const image = await loadImageElement(original);
  return shrinkImage(image, maxLength);
}
