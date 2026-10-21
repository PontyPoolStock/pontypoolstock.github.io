import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { staffBlocked } from "../hello.ts";

const dom = new JSDOM(
  '<!doctype html><html><body><div id="pageContent"></div></body></html>',
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
]) {
  globalThis[key] = window[key] ?? window;
}
globalThis.window = window;
sessionStorage.setItem("currentUser", JSON.stringify({ role: "staff" }));
globalThis.bootstrap = {
  Modal: class {
    constructor(element) {
      this.element = element;
    }
    show() {}
    hide() {}
  },
};

const products = [
  {
    id: 13,
    name: "Glass Panels",
    sku: "GLASS-5W",
    categoryId: 1,
    price: 75,
    quantity: 20,
    reorderLevel: 2,
    unit: "piece",
    variants: [],
    notStocked: true,
  },
];
const categories = [{ id: 1, name: "Lighting", description: "", parentId: null }];
const purchases = [
  {
    id: 1,
    productId: 13,
    productName: "Glass Panels",
    quantity: 4,
    unitCost: 60,
    totalCost: 240,
    purchasedAt: "2026-10-12T10:00:00Z",
  },
];
const purchaseWrites = [];

globalThis.fetch = window.fetch = async (url, opts = {}) => {
  const path = new URL(String(url)).pathname;
  const method = opts.method || "GET";
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  if (path === "/resellerPurchases" && method === "POST") {
    const body = JSON.parse(opts.body);
    purchaseWrites.push({ method, body });
    const purchase = { id: 2, ...body };
    purchases.push(purchase);
    return json(purchase, 201);
  }
  if (path === "/resellerPurchases/2" && method === "PUT") {
    const body = JSON.parse(opts.body);
    purchaseWrites.push({ method, body });
    const purchase = purchases.find((item) => String(item.id) === "2");
    Object.assign(purchase, body);
    return json(purchase);
  }
  if (path === "/products/13") return json({ imageUrl: "" });
  if (path === "/products") return json(products);
  if (path === "/categories") return json(categories);
  if (path === "/resellerPurchases") return json(purchases);
  if (path === "/sales") return json([]);
  return json({ error: `unmocked ${path}` });
};

const [
  { openProductPreview, openCategoryPreview },
  { loadProducts },
  { loadCategories },
  { loadResellerPurchases },
] =
  await Promise.all([
    import("../js/components/preview.js"),
    import("../js/pages/products.js"),
    import("../js/pages/categories.js"),
    import("../js/pages/reseller.js"),
  ]);

await loadProducts();
assert.equal(document.getElementById("addProductBtn"), null, "staff cannot add products");
assert.equal(document.getElementById("bulkAddProductsBtn"), null, "staff cannot bulk add products");
assert.equal(
  document.querySelector("#productsTableContainer .edit-btn, #productsTableContainer .delete-btn"),
  null,
  "staff product list has no edit or delete actions",
);
openProductPreview(products[0], { categories });
assert.equal(document.querySelector("#productPreviewModal [data-preview-edit]"), null,
  "staff product preview has no edit action");

document.getElementById("pageContent").innerHTML = "";
await loadCategories();
assert.equal(document.getElementById("addCategoryBtn"), null, "staff cannot add categories");
assert.equal(
  document.querySelector("#categoriesTableContainer .edit-btn, #categoriesTableContainer .delete-btn"),
  null,
  "staff category list has no edit or delete actions",
);
openCategoryPreview(categories[0], { categories, products });
assert.equal(document.querySelector("#categoryPreviewModal [data-preview-edit]"), null,
  "staff category preview has no edit action");
for (const method of ["POST", "PUT", "DELETE"]) {
  assert.equal(staffBlocked("staff", method, "categories", method === "POST" ? "" : "1").blocked, true,
    `staff cannot ${method === "POST" ? "create" : method === "PUT" ? "update" : "delete"} categories`);
}
assert.equal(staffBlocked("staff", "GET", "categories", "").blocked, false,
  "staff can still view categories");

document.getElementById("pageContent").innerHTML = "";
await loadResellerPurchases();
assert.ok(document.getElementById("resellerPurchaseForm"),
  "staff can add and edit shop purchases");
assert.equal(
  document.querySelector('label[for="resellerEmployeeName"]').textContent,
  "Employee",
  "staff Shop Purchases form labels the employee field clearly",
);
assert.equal(
  document.querySelectorAll("#resellerTableContainer .reseller-edit").length,
  1,
  "staff shop-purchase list has an edit action",
);
assert.equal(
  document.querySelector("#resellerTableContainer .reseller-delete"),
  null,
  "staff shop-purchase list has no delete action",
);
assert.equal(
  document.querySelectorAll("#resellerTableContainer tbody tr").length,
  1,
  "staff can still view shop-purchase rows",
);
document.getElementById("resellerProductSelect").value = "13";
document.getElementById("resellerQuantity").value = "2";
document.getElementById("resellerUnitCost").value = "50";
document.getElementById("resellerShopName").value = "Test Shop";
document.getElementById("resellerEmployeeName").value = "Staff Member";
document.getElementById("resellerPurchaseForm").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(purchaseWrites[0]?.method, "POST", "staff can submit a new shop purchase");
assert.equal(purchases.length, 2, "new staff shop purchase is stored");
document.querySelector("#resellerTableContainer .reseller-edit").click();
assert.equal(document.getElementById("resellerSaveBtn").textContent, "Save",
  "staff can open a purchase in edit mode");
document.getElementById("resellerQuantity").value = "3";
document.getElementById("resellerPurchaseForm").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await new Promise((resolve) => setTimeout(resolve, 50));
assert.equal(purchaseWrites[1]?.method, "PUT", "staff can submit purchase edits");
assert.equal(purchases.find((item) => String(item.id) === "2")?.quantity, 3,
  "staff purchase edit is applied");

assert.equal(staffBlocked("staff", "GET", "products", "").blocked, false,
  "staff can still read products");
for (const method of ["POST", "PUT", "DELETE"]) {
  assert.equal(
    staffBlocked("staff", method, "products", method === "POST" ? "" : "1").blocked,
    true,
    `staff cannot ${method === "POST" ? "create" : method === "PUT" ? "update" : "delete"} products`,
  );
}
assert.equal(staffBlocked("staff", "GET", "resellerPurchases", "").blocked, false,
  "staff can still read shop purchases");
assert.equal(staffBlocked("staff", "POST", "resellerPurchases", "").blocked, false,
  "staff can create shop purchases");
assert.equal(staffBlocked("staff", "PUT", "resellerPurchases", "1").blocked, false,
  "staff can update shop purchases");
assert.equal(staffBlocked("staff", "DELETE", "resellerPurchases", "1").blocked, true,
  "staff cannot delete shop purchases");
assert.equal(staffBlocked("staff", "POST", "sales", "").blocked, false,
  "staff can still record sales");
assert.equal(staffBlocked("admin", "POST", "products", "").blocked, false,
  "admins retain product management");
assert.equal(staffBlocked("admin", "POST", "resellerPurchases", "").blocked, false,
  "admins retain shop-purchase management");

sessionStorage.setItem("currentUser", JSON.stringify({ role: "admin" }));
await loadProducts();
assert.ok(document.getElementById("addProductBtn"), "admins retain the add product action");
assert.ok(document.getElementById("bulkAddProductsBtn"), "admins can bulk add products");
document.getElementById("bulkAddProductsBtn").click();
assert.ok(document.getElementById("bulkProductsModal"),
  "bulk-add action opens the product entry and preview modal");
document.getElementById("bulkProductsModal").remove();
assert.ok(
  document.querySelector("#productsTableContainer .edit-btn, #productsTableContainer .delete-btn"),
  "admins retain product row actions",
);
await loadResellerPurchases();
assert.ok(document.getElementById("resellerPurchaseForm"),
  "admins retain the shop-purchase form");
assert.equal(
  document.querySelector('label[for="resellerEmployeeName"]').textContent,
  "Who went",
  "admin Shop Purchases form retains its existing employee label",
);
assert.ok(
  document.querySelector("#resellerTableContainer .reseller-edit, #resellerTableContainer .reseller-delete"),
  "admins retain shop-purchase row actions",
);
await loadCategories();
assert.ok(document.getElementById("addCategoryBtn"), "admins retain the add category action");
assert.ok(
  document.querySelector("#categoriesTableContainer .edit-btn, #categoriesTableContainer .delete-btn"),
  "admins retain category row actions",
);
assert.equal(staffBlocked("admin", "POST", "categories", "").blocked, false,
  "admins retain category management");

console.log("Staff permissions test passed.");
