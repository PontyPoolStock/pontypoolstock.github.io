//* Validation Functions for Products
//* A product needs a name *or* a category — an unnamed item only makes sense
//* when it is filed under a category, and it is saved under that category's name.
export function isValidProductData(data, id, variants = []) {
  document
    .querySelectorAll(".errorMes")
    .forEach((item) => (item.innerHTML = ""));
  normalizeProductUnit(data);

  const ratingRows = Array.isArray(variants) ? variants : [];
  return isValidProductIdentity(data) && isValidVariantRows(ratingRows);
}

//* Suggested colours for a rating — the field also accepts any colour typed in
export const RATING_COLOURS = ["White", "Warm White", "RGB"];

//* Rating rows are freely combinable (watts + colour + amperes) and optional:
//* nothing blocks the save — values are only trimmed and clamped to safe numbers.
function isValidVariantRows(variants) {
  const errorBox = document.querySelector(".errorMes-variants");
  if (errorBox) errorBox.innerHTML = "";

  for (const variant of variants) {
    variant.label = String(variant.label ?? "").trim();
    variant.sku = String(variant.sku ?? "").trim();
    variant.colour = String(variant.colour ?? "").trim();
    variant.price = Math.max(0, Number(variant.price) || 0);
    variant.quantity = Math.max(0, Number(variant.quantity) || 0);
    variant.reorderLevel = Math.max(0, Number(variant.reorderLevel) || 0);
    variant.amps =
      variant.amps === "" || variant.amps === null || variant.amps === undefined
        ? ""
        : Math.max(0, Number(variant.amps) || 0);
  }
  return true;
}
//* A product's identity: a real name, or a category to fall back on.
export function isValidProductIdentity(data) {
  if (String(data?.name ?? "").trim().length > 0) return true;
  if (String(data?.categoryId ?? "").trim().length > 0) return true;

  const nameError = document.querySelector(".errorMes-name");
  if (nameError) nameError.innerHTML = "Add a product name, or choose a category.";
  return false;
}

//* Debounce helper to keep real-time search typing silky smooth without dropped frames
export function debounce(fn, wait = 150) {
  let timeoutId = null;
  return function debounced(...args) {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn.apply(this, args);
    }, wait);
  };
}


//* Categories need a real name — a product may leave every
//* other field empty as long as it keeps a name or a category.
function isValidName(name) {
  if (String(name ?? "").trim().length === 0) {
    document.querySelector(".errorMes-name").innerHTML = `Name is required`;
    return false;
  }
  return true;
}

//* Suggested units for the unit field — anything else typed in is still accepted
export const UNIT_SUGGESTIONS = ["pcs", "box", "bundle", "kg"];

//* Units are free text, but the common ones are canonicalised so badges, tables
//* and stock text stay tidy: "Boxes" -> "box", "2 bundles" -> quantity 2 + "bundle"
function normalizeProductUnit(data) {
  const value = String(data.unit || "").trim().toLowerCase();
  const combined = value.match(/^(\d+(?:\.\d+)?)\s*(boxes?|bundles?|pieces?|pcs?|kgs?)$/);
  if (combined) {
    if (!data.quantity) data.quantity = combined[1];
    data.unit = combined[2];
  }

  const aliases = {
    boxes: "box", box: "box",
    bundles: "bundle", bundle: "bundle",
    pieces: "pcs", piece: "pcs", pcs: "pcs",
    kg: "kg", kgs: "kg",
  };
  data.unit = aliases[String(data.unit || "").trim().toLowerCase()] || data.unit;
}

export function isValidCategoryData(data) {
  document
    .querySelectorAll(".errorMes")
    .forEach((item) => (item.innerHTML = ""));

  const parentId = data.parentId ?? data.parent_id ?? "";
  if (parentId && String(parentId) === String(data.id || "")) {
    document.querySelector(".errorMes-name").innerHTML = "A category cannot be its own parent.";
    return false;
  }

  return isValidName(data.name);
}

//* Validation — stock adjustments
export function isValidStockAdjustmentData(data, products) {
  document
    .querySelectorAll(".errorMes")
    .forEach((item) => (item.innerHTML = ""));
  const v1 = isValidAdjustmentProductId(data.productId);
  const v2 = isValidAdjustmentType(data.type);
  const v3 = isValidAdjustmentQuantity(
    data.quantity,
    data.type,
    data.productId,
    products,
    data.variantLabel,
  );
  return v1 && v2 && v3;
}
function isValidAdjustmentProductId(productId) {
  if (!productId || String(productId).trim() === "") {
    document.querySelector(".errorMes-productId").innerHTML =
      "Product is required";
    return false;
  }
  return true;
}
function isValidAdjustmentType(type) {
  if (type !== "increase" && type !== "decrease") {
    document.querySelector(".errorMes-type").innerHTML =
      "Select a valid adjustment type";
    return false;
  }
  return true;
}
function isValidAdjustmentQuantity(quantityStr, type, productId, products, variantLabel = "") {
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
    //* The rating dropdown stores the row index, so duplicated watts stay unique
    const variantIndex = Number.parseInt(String(variantLabel ?? ""), 10);
    const variant = getProductVariants(product)[
      Number.isNaN(variantIndex) ? -1 : variantIndex
    ];
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
//* Products may be saved with no name when they sit in a category, so every list
//* shows a dash for a blank name — exactly like an empty Code (SKU) does.
export function getProductDisplayName(productOrName) {
  const name = typeof productOrName === "string" ? productOrName : productOrName?.name;
  return String(name ?? "").trim() || "-";
}
//* "St64 4W · White · 0.05A" — used by alerts, reports, adjustments and the log
export function getVariantName(product, variant) {
  const name = String(product?.name || "").trim();
  if (!variant) return name;
  const ampsRaw = variant.amps;
  const amps =
    ampsRaw !== "" && ampsRaw !== null && ampsRaw !== undefined && Number.isFinite(Number(ampsRaw))
      ? `${Number(ampsRaw)}A`
      : "";
  const suffix = [variant.label, variant.colour, amps]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  if (!suffix) return name;
  //^ a nameless product keeps just its rating text ("4W") instead of " 4W"
  return name ? `${name} ${suffix}` : suffix;
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
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
//* Category name of a stock line — a product may sit outside every category
export function getCategoryLabel(categories, id) {
  if (id === "" || id === null || id === undefined) return "-";
  const list = Array.isArray(categories) ? categories : [];
  const category = list.find((item) => item.id == id);
  return category ? category.name : "-";
}
//* Product thumbnail — shared by the Products table, the low-stock list and reports
//* Supports lazy hydration when imageUrl is deferred: supply productId to enable background load
export function productThumbnailHtml(
  imageUrl,
  name,
  { icon = "bi-box-seam", sizeClass = "", productId = "", categoryId = "" } = {},
) {
  const classes = ["entity-thumbnail", String(sizeClass).trim()].filter(Boolean).join(" ");
  if (imageUrl) {
    return `<img class="${classes}" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(name)} image" loading="lazy" decoding="async" onerror="this.remove();" />`;
  }
  const entityAttr = productId
    ? ` data-product-img-id="${escapeHtml(String(productId))}"`
    : categoryId
    ? ` data-category-img-id="${escapeHtml(String(categoryId))}"`
    : "";
  return `<span class="${classes} entity-thumbnail-empty"${entityAttr} aria-label="No image"><i class="bi ${icon}"></i></span>`;
}
export function formatCurrency(amount) {
  const num = Math.round((Number(amount) || 0) * 100) / 100;
  return `KSh ${num.toLocaleString("en-US")}`;
}
//* Shared by the Products status badge and the status filter so they always agree
export function getProductStatusCode(product) {
  const variants = getProductVariants(product);
  if (!variants.length) {
    const quantity = Number(product?.quantity) || 0;
    const reorderLevel = Number(product?.reorderLevel) || 0;
    if (quantity <= 0) return "out";
    return quantity <= reorderLevel ? "low" : "in";
  }
  if (getVariantsTotalQuantity(variants) <= 0) return "out";
  const anyRatingLow = variants.some(
    (variant) => getVariantQuantity(variant) <= getVariantReorderLevel(variant),
  );
  return anyRatingLow ? "low" : "in";
}
export function getLowStockProducts(products) {
  return expandProductsToStockLines(products)
    .filter((p) => Number(p.quantity) <= Number(p.reorderLevel))
    .sort((a, b) => Number(a.quantity) - Number(b.quantity))
    //^ display-ready names, so a nameless product reads "-" like an empty SKU
    .map((p) => ({ ...p, name: getProductDisplayName(p.name) }));
}
export function getInventoryValueRowsSorted(products, limit) {
  const rows = expandProductsToStockLines(products).map((p) => ({
    id: p.id,
    name: getProductDisplayName(p.name),
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

  if (safeAction.includes("SALE_EDITED"))
    return { color: "warning", label: "edit sale" };
  if (safeAction.includes("SALE_DELETED"))
    return { color: "danger", label: "delete sale" };
  if (safeAction.includes("SALE_RECORDED"))
    return { color: "success", label: "sale" };
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
  const date = escapeHtml(formatActivityTimestamp(normalizedActivity.timestamp));
  return `
    <div class="d-flex align-items-center justify-content-between py-3 border-bottom">
      <div class="d-flex align-items-start gap-3">
        <span class="mt-1 rounded-circle bg-${color} activity-dot"></span>
        <div>
          <div class="fw-medium">${escapeHtml(normalizedActivity.details)}</div>
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
    return dateB - dateA; // newest first
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
