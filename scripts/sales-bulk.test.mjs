// Smoke test for the Record Sale category filter and the multi-line basket.
// It drives the real page module inside a DOM with fetch mocked and asserts
// the two things that were asked for: picking a category narrows the product
// list, and many products from different categories can be recorded at once.
//
// Needs jsdom (kept out of dependencies to match the rest of this folder):
//   npm install --no-save jsdom
// Run: node scripts/sales-bulk.test.mjs
import assert from "node:assert";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><html><body><h2 id="pageTitle">Dashboard</h2><div id="pageContent"></div></body></html>',
  { url: "https://pontypoolstock.github.io/index.html", pretendToBeVisual: true },
);
const { window } = dom;
for (const key of ["window", "document", "localStorage", "sessionStorage", "Event",
  "CustomEvent", "Element", "HTMLElement", "Node"]) {
  globalThis[key] = window[key] ?? window;
}
globalThis.window = window;

const categories = [
  { id: "c-bulbs", name: "Bulbs" },
  { id: "c-cable", name: "Cables" },
];
const products = [
  { id: "p1", name: "A60 Bulb", categoryId: "c-bulbs", price: 100, quantity: 10 },
  { id: "p2", name: "G95 Bulb", categoryId: "c-cable", price: 50, quantity: 7 },
  { id: "p3", name: "Loose wire", categoryId: "", price: 10, quantity: 4 },
];
let serverSales = [];
const posts = [];

globalThis.fetch = window.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || "GET";
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (method === "POST" && u.endsWith("/sales")) {
    const body = JSON.parse(opts.body);
    posts.push(body);
    const product = products.find((p) => p.id === body.productId);
    const sale = {
      id: posts.length,
      productId: body.productId,
      productName: product.name,
      quantity: body.quantity,
      unitPrice: body.unitPrice,
      total: body.quantity * body.unitPrice,
      soldAt: new Date().toISOString(),
    };
    serverSales = [sale, ...serverSales];
    return json(sale, 201);
  }
  if (u.includes("/sales")) return json(serverSales);
  if (u.includes("/products")) return json(products);
  if (u.includes("/categories")) return json(categories);
  return json({ error: `unmocked ${method} ${u}` }, 500);
};

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const optionLabels = (id) =>
  [...document.querySelectorAll(`#${id} option`)].map((o) => o.textContent.trim());
const productOptions = () => optionLabels("saleProductSelect");
const lines = () => document.querySelectorAll("#saleCartList .sale-cart-line");
const setField = (id, value) => {
  const el = document.getElementById(id);
  el.value = String(value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const pickProduct = (id) => {
  const select = document.getElementById("saleProductSelect");
  select.value = id;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const pickCategory = (value) => {
  const select = document.getElementById("saleCategorySelect");
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const submit = () =>
  document.getElementById("recordSaleForm").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true }),
  );

const { loadSales } = await import("../js/pages/sales.js");
await loadSales();

// 1. Every category is offered; the product list starts unfiltered.
assert.ok(document.getElementById("saleCategorySelect"), "category dropdown rendered");
assert.deepStrictEqual(
  optionLabels("saleCategorySelect"),
  ["All categories", "Bulbs", "Cables", "Uncategorized"],
  "all categories plus Uncategorized (a category-less product exists)",
);
assert.strictEqual(productOptions().length, 4, "all 3 products + placeholder shown");

// 2. Picking a category narrows the product dropdown to that category.
pickCategory("c-bulbs");
assert.deepStrictEqual(productOptions(), ["Select product", "A60 Bulb — 10 in stock"],
  "Bulbs category shows only the bulb");

pickCategory("c-cable");
assert.deepStrictEqual(productOptions(), ["Select product", "G95 Bulb — 7 in stock"],
  "Cables category shows only that product");

pickCategory("__none__");
assert.deepStrictEqual(productOptions(), ["Select product", "Loose wire — 4 in stock"],
  "Uncategorized shows the category-less product");

// 3. Stage a line from the Bulbs category.
pickCategory("c-bulbs");
pickProduct("p1");
setField("saleQuantity", 2);
setField("saleUnitPrice", 100);
document.getElementById("addSaleLineBtn").click();
assert.strictEqual(lines().length, 1, "first line staged");
assert.match(lines()[0].textContent, /A60 Bulb/, "basket shows the product");
assert.match(lines()[0].textContent, /Bulbs/, "basket shows the category");

// 4. Add a second line from a *different* category without recording anything.
pickCategory("c-cable");
pickProduct("p2");
setField("saleQuantity", 3);
setField("saleUnitPrice", 50);
document.getElementById("addSaleLineBtn").click();
assert.strictEqual(lines().length, 2, "second line staged");
assert.strictEqual(
  document.getElementById("recordSaleBtn").textContent.trim(),
  "Record 2 Sales",
  "record button counts the basket",
);
//* 2×100 + 3×50 — the figure must include staged lines, not just the form.
assert.strictEqual(
  document.getElementById("saleTotalPreview").textContent,
  "KSh 350",
  "combined total shown",
);

// 5. Stock checks count what is already staged: p2 has 7, 3 are in the basket.
setField("saleQuantity", 6);
document.getElementById("addSaleLineBtn").click();
assert.strictEqual(lines().length, 2, "oversized line rejected");
assert.match(
  document.querySelector(".errorMes-quantity")?.textContent || "",
  /already in this sale/,
  "validation explains the staged units",
);

// 6. Submitting records every staged line with one click. The rejected line
//    from step 5 is still sitting in the quantity box — clear it so only the
//    basket goes up (a valid-but-unstaged line would be added automatically).
setField("saleQuantity", "");
posts.length = 0;
submit();
await settle(120);
assert.strictEqual(posts.length, 2, "one POST per staged line");
assert.deepStrictEqual(
  posts.map((p) => p.productId),
  ["p1", "p2"],
  "both products recorded",
);
assert.strictEqual(serverSales.length, 2, "server holds both sales");
assert.strictEqual(lines().length, 0, "basket emptied after a clean record");
assert.match(
  document.getElementById("saleFormAlert")?.textContent || "",
  /2 sales recorded/,
  "summary shown on screen",
);

// 7. A refused line stays in the basket so it can be retried, and the
//    server's reason is shown.
posts.length = 0;
serverSales = [];
pickCategory("c-bulbs");
pickProduct("p1");
setField("saleQuantity", 1);
setField("saleUnitPrice", 100);
document.getElementById("addSaleLineBtn").click();
assert.strictEqual(lines().length, 1, "line staged for the partial-failure case");

const realFetch = globalThis.fetch;
globalThis.fetch = window.fetch = async (url, opts = {}) => {
  if ((opts.method || "GET") === "POST" && String(url).endsWith("/sales")) {
    posts.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ error: "Not enough stock" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return realFetch(url, opts);
};
submit();
await settle(120);
assert.strictEqual(lines().length, 1, "refused line kept in the basket");
assert.match(
  document.getElementById("saleFormAlert")?.textContent || "",
  /Not enough stock/,
  "server reason surfaced",
);

// 8. Removing a line updates the basket and the button label.
document.querySelector(".sale-line-remove").click();
assert.strictEqual(lines().length, 0, "line removed");
assert.strictEqual(
  document.getElementById("recordSaleBtn").textContent.trim(),
  "Record Sale",
  "button back to single-sale label",
);

console.log("OK — sales bulk: category filter, multi-category basket, bulk record, partial failure, line removal");
