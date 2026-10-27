import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><html><body></body></html>',
  { url: "https://pontypoolstock.github.io/index.html", pretendToBeVisual: true },
);
const { window } = dom;
for (const key of [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "Event",
  "CustomEvent",
  "Element",
  "HTMLElement",
  "Node",
  "File",
  "FileReader",
]) {
  globalThis[key] = window[key] ?? window;
}
sessionStorage.setItem("currentUser", JSON.stringify({ role: "admin" }));

let savedProducts = [];
let modalHidden = false;
let retryProductOnce = true;
globalThis.bootstrap = {
  Modal: class {
    constructor(element) {
      this.element = element;
    }
    show() {}
    hide() {
      modalHidden = true;
      this.element.dispatchEvent(new window.Event("hidden.bs.modal"));
    }
  },
};

globalThis.fetch = async (url, options = {}) => {
  const endpoint = String(url).split("/").pop();
  const body = options.body ? JSON.parse(options.body) : null;
  const json = (value, status = 200) => new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  if (options.method === "POST" && endpoint === "products") {
    if (body.name === "Retry light" && retryProductOnce) {
      retryProductOnce = false;
      return json({ error: "Temporary save failure" }, 500);
    }
    const created = { ...body, id: savedProducts.length + 1 };
    savedProducts.push(created);
    return json(created, 201);
  }
  if (options.method === "POST" && endpoint === "activityLog") {
    return json({ ...body, id: 1 }, 201);
  }
  return json({ error: `Unexpected request to ${endpoint}` }, 500);
};

const { openBulkProductsModal } = await import("../js/components/bulk-products.js");
let refreshed = 0;
openBulkProductsModal(
  [{ id: 7, name: "Lighting" }],
  async () => { refreshed += 1; },
);

const modal = document.getElementById("bulkProductsModal");
const rows = modal.querySelector("[data-bulk-rows]");
const setField = (row, field, value) => {
  row.querySelector(`[data-field="${field}"]`).value = value;
};

let productRows = rows.querySelectorAll("[data-bulk-row]");
setField(productRows[0], "name", "Panel Light");
setField(productRows[0], "sku", "PL-01");
setField(productRows[0], "categoryId", "7");
setField(productRows[0], "price", "125.50");
setField(productRows[0], "quantity", "12");
setField(productRows[0], "reorderLevel", "3");
setField(productRows[0], "unit", "piece");
const imageInput = productRows[0].querySelector("[data-bulk-image]");
Object.defineProperty(imageInput, "files", {
  configurable: true,
  value: [new window.File(["small test image"], "panel.png", { type: "image/png" })],
});
imageInput.dispatchEvent(new window.Event("change", { bubbles: true }));
for (let attempt = 0; attempt < 50 && productRows[0].dataset.imagePending; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.ok(productRows[0].querySelector("[data-bulk-image-preview]").src.startsWith("data:image/png"),
  "selected product picture appears in the entry preview");

modal.querySelector("[data-bulk-add-row]").click();
productRows = rows.querySelectorAll("[data-bulk-row]");
setField(productRows[1], "name", "LED Bulb");
setField(productRows[1], "price", "80");
setField(productRows[1], "quantity", "99");
setField(productRows[1], "unit", "pcs");
productRows[1].querySelector("[data-bulk-add-variant]").click();
const variant = productRows[1].querySelector("[data-bulk-variant]");
variant.querySelector('[data-variant-field="label"]').value = "9W";
variant.querySelector('[data-variant-field="price"]').value = "85";
variant.querySelector('[data-variant-field="quantity"]').value = "5";
variant.querySelector('[data-variant-field="reorderLevel"]').value = "1";

modal.querySelector("[data-bulk-preview]").click();
assert.equal(modal.querySelectorAll("[data-bulk-review] .bulk-review-card").length, 2,
  "review shows one preview card for each product");
assert.match(modal.querySelector("[data-bulk-review]").textContent, /Panel Light/);
assert.match(modal.querySelector("[data-bulk-review]").textContent, /Price\s*125\.5/);
assert.match(modal.querySelector("[data-bulk-review]").textContent, /Quantity\s*12/);
assert.match(modal.querySelector("[data-bulk-review]").textContent, /Minimum\s*3/);
assert.match(modal.querySelector("[data-bulk-review]").textContent, /Ratings\s*9W\s*85\s*·\s*Qty 5\s*·\s*Min 1/);
assert.equal(modal.querySelectorAll("[data-bulk-review] img").length, 1,
  "review shows the selected picture and omits empty-image placeholders");

modal.querySelector("[data-bulk-save]").click();
for (let attempt = 0; attempt < 50 && !modalHidden; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

assert.equal(modalHidden, true, "modal closes after every product saves");
assert.equal(savedProducts.length, 2, "each reviewed product is saved once");
assert.equal(savedProducts[0].price, 125.5);
assert.equal(savedProducts[0].quantity, 12);
assert.equal(savedProducts[0].reorderLevel, 3);
assert.equal(savedProducts[0].categoryId, "7");
assert.ok(savedProducts[0].imageUrl.startsWith("data:image/png"),
  "selected picture is included with the product save");
assert.equal(savedProducts[1].price, 85, "rating prices set the product price");
assert.equal(savedProducts[1].quantity, 5, "rating quantities set the product stock");
assert.equal(savedProducts[1].variants[0].label, "9W");
assert.equal(refreshed, 1, "product list refreshes after a successful bulk add");

modalHidden = false;
openBulkProductsModal([{ id: 7, name: "Lighting" }], async () => { refreshed += 1; });
const retryModal = document.getElementById("bulkProductsModal");
const retryRow = retryModal.querySelector("[data-bulk-row]");
retryRow.querySelector('[data-field="name"]').value = "Retry light";
retryRow.querySelector('[data-field="price"]').value = "20";
retryRow.querySelector('[data-field="quantity"]').value = "2";
retryModal.querySelector("[data-bulk-preview]").click();
retryModal.querySelector("[data-bulk-save]").click();
for (let attempt = 0; attempt < 50 && retryModal.querySelector("[data-bulk-save]").disabled; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(modalHidden, false, "failed products remain available for retry");
assert.equal(retryModal.querySelector("[data-bulk-save]").textContent, "Retry failed products");
assert.equal(savedProducts.length, 2, "failed product was not reported as saved");
retryModal.querySelector("[data-bulk-save]").click();
for (let attempt = 0; attempt < 50 && !modalHidden; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal(savedProducts.filter((product) => product.name === "Retry light").length, 1,
  "retry saves the failed product once");
assert.equal(refreshed, 2, "product list refreshes after retry success");

console.log("Bulk product entry and review test passed.");
