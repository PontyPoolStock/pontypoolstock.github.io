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
    notStocked: false,
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

globalThis.fetch = window.fetch = async (url) => {
  const path = new URL(String(url)).pathname;
  const json = (body) => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
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
assert.equal(document.getElementById("resellerPurchaseForm"), null,
  "staff cannot create or edit shop purchases");
assert.equal(
  document.querySelector("#resellerTableContainer .reseller-edit, #resellerTableContainer .reseller-delete"),
  null,
  "staff shop-purchase list has no edit or delete actions",
);
assert.equal(
  document.querySelectorAll("#resellerTableContainer tbody tr").length,
  1,
  "staff can still view shop-purchase rows",
);

for (const resource of ["products", "resellerPurchases"]) {
  assert.equal(staffBlocked("staff", "GET", resource, "").blocked, false,
    `staff can still read ${resource}`);
  assert.equal(staffBlocked("staff", "POST", resource, "").blocked, true,
    `staff cannot create ${resource}`);
  assert.equal(staffBlocked("staff", "PUT", resource, "1").blocked, true,
    `staff cannot update ${resource}`);
  assert.equal(staffBlocked("staff", "DELETE", resource, "1").blocked, true,
    `staff cannot delete ${resource}`);
}
assert.equal(staffBlocked("staff", "POST", "sales", "").blocked, false,
  "staff can still record sales");
assert.equal(staffBlocked("admin", "POST", "products", "").blocked, false,
  "admins retain product management");
assert.equal(staffBlocked("admin", "POST", "resellerPurchases", "").blocked, false,
  "admins retain shop-purchase management");

sessionStorage.setItem("currentUser", JSON.stringify({ role: "admin" }));
await loadProducts();
assert.ok(document.getElementById("addProductBtn"), "admins retain the add product action");
assert.ok(
  document.querySelector("#productsTableContainer .edit-btn, #productsTableContainer .delete-btn"),
  "admins retain product row actions",
);
await loadResellerPurchases();
assert.ok(document.getElementById("resellerPurchaseForm"),
  "admins retain the shop-purchase form");
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
