// Executes the Shop Purchases page module end-to-end in jsdom with fetch
// mocked. This exists because the first release shipped reseller.js without
// importing debounce: the module loaded, the page built, then
// setupEventListeners() threw a ReferenceError and the router showed
// "Shop Purchases could not be loaded." Source-regex tests cannot see a
// missing identifier, so this one actually runs the loader.
//
// Needs jsdom: npm install --no-save jsdom
// Run: node scripts/reseller-page.test.mjs
import assert from "node:assert";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><html><body><h2 id="pageTitle">Shop Purchases</h2><div id="pageContent"></div></body></html>',
  { url: "https://pontypoolstock.github.io/index.html", pretendToBeVisual: true },
);
const { window } = dom;
for (const key of ["window", "document", "localStorage", "sessionStorage", "Event",
  "CustomEvent", "Element", "HTMLElement", "Node"]) {
  globalThis[key] = window[key] ?? window;
}
globalThis.window = window;
sessionStorage.setItem("currentUser", JSON.stringify({ role: "admin" }));

//* On-order product (Glass Panels) + one recorded purchase, mirroring the
//* live production data the API was seeded with.
const serverPurchases = [
  { id: 1, productId: 13, productName: "Glass Panels", variantIndex: 0,
    quantity: 20, unitCost: 60, totalCost: 1200, purchasedAt: "2026-10-12T10:00:00Z" },
];
const serverProducts = [
  { id: 13, name: "Glass Panels", quantity: 200, notStocked: true,
    variants: [{ label: "5W", price: 75, quantity: 0 }] },
  { id: 14, name: "Regular Bulb", quantity: 50, notStocked: false },
  { id: 15, name: "Neon Sign", quantity: 0, notStocked: true, variants: [] },
];
let requests = [];
let postedPurchases = [];

globalThis.fetch = window.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || "GET";
  requests.push(`${method} ${u}`);
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (method === "POST" && u.includes("/resellerPurchases")) {
    const body = JSON.parse(opts.body);
    postedPurchases.push(body);
    const row = { id: serverPurchases.length + 1, ...body };
    serverPurchases.push(row);
    return json(row, 201);
  }
  if (u.includes("/resellerPurchases")) return json(serverPurchases);
  if (u.includes("/products")) return json(serverProducts);
  if (u.includes("/sales")) return json([]);
  return json({ error: `unmocked ${method} ${u}` }, 500);
};

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const hero = () => document.querySelector("#pageContent .sale-hero-stats")?.textContent ?? "";
const rows = () => document.querySelectorAll("#resellerTableContainer tbody tr").length;

//* The one assertion that would have caught the shipped bug: the loader must
//* run to completion, event listeners included.
const { loadResellerPurchases } = await import("../js/pages/reseller.js");
await loadResellerPurchases();

assert.match(hero(), /20/, "hero shows the 20 bought units");
assert.match(hero(), /1,200/, "hero shows the KSh 1,200 spent");
assert.strictEqual(rows(), 1, "the seeded purchase row rendered");

//* Only On-order products may appear in the product dropdown.
const options = [...document.querySelectorAll("#resellerProductSelect option")]
  .map((o) => o.textContent);
assert.ok(options.some((o) => o.includes("Glass Panels")), "On-order product offered");
assert.ok(options.some((o) => o.includes("Neon Sign")), "zero-purchase resale product offered");
assert.ok(!options.some((o) => o.includes("Regular Bulb")), "in-stock product excluded");

const resaleRows = [...document.querySelectorAll("#resaleProductsTable tbody tr")]
  .map((row) => row.textContent.replace(/\s+/g, " ").trim());
assert.strictEqual(resaleRows.length, 2, "all resale products are listed");
assert.ok(
  resaleRows.some((row) => row.includes("Neon Sign")),
  "zero-purchase resale product is visible in the resale list",
);

const employeeInput = document.getElementById("resellerEmployeeName");
assert.strictEqual(employeeInput.getAttribute("placeholder"), null, "Employee placeholder removed");
const employeePicks = [...document.querySelectorAll("[data-reseller-employee-name]")];
assert.deepStrictEqual(
  employeePicks.map((button) => button.textContent),
  ["Mwaura", "Edu", "Peter", "Jane", "Alvo", "Martha"],
  "Employee quick picks match Record Sale names",
);
employeePicks.find((button) => button.textContent === "Edu")
  .dispatchEvent(new window.Event("click", { bubbles: true }));
assert.strictEqual(employeeInput.value, "Edu", "Employee quick pick fills the field");
assert.strictEqual(
  employeePicks.find((button) => button.textContent === "Edu").getAttribute("aria-pressed"),
  "true",
  "Selected employee quick pick is highlighted",
);

//* Search runs through debounce — dispatch input and let it fire.
const search = document.getElementById("searchReseller");
assert.ok(search, "search box exists");
search.value = "glass";
search.dispatchEvent(new window.Event("input", { bubbles: true }));
await settle(200);
assert.strictEqual(rows(), 1, "matching search keeps the row");
search.value = "nope";
search.dispatchEvent(new window.Event("input", { bubbles: true }));
await settle(200);
assert.strictEqual(rows(), 0, "non-matching search empties the table");

//* Record a second purchase through the form (product select + variant fill
//* + submit) and confirm it POSTs and repaints.
search.value = "";
search.dispatchEvent(new window.Event("input", { bubbles: true }));
await settle(200);
document.getElementById("resellerProductSelect").value = "13";
document.getElementById("resellerProductSelect")
  .dispatchEvent(new window.Event("change", { bubbles: true }));

//* The "summary pic" — same sale-product-preview card Record Sale uses — must
//* appear once a product is picked, showing the product name and reseller stock.
const preview = document.getElementById("resellerProductPreview");
assert.ok(preview, "product preview box exists in the form");
assert.ok(!preview.classList.contains("d-none"), "preview shows once a product is selected");
assert.match(preview.textContent, /Glass Panels/, "preview names the selected product");
assert.match(preview.textContent, /20 bought/, "preview shows the reseller stock bought figure");

document.getElementById("resellerQuantity").value = "5";
document.getElementById("resellerUnitCost").value = "70";
document.getElementById("resellerPurchaseForm")
  .dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
await settle(200);

assert.ok(
  requests.some((r) => r.startsWith("POST") && r.includes("/resellerPurchases")),
  "purchase was POSTed",
);
assert.strictEqual(postedPurchases.at(-1)?.employeeName, "Edu", "quick-picked employee saved");
assert.strictEqual(rows(), 2, "second purchase appears after save");
assert.match(hero(), /25/, "hero now shows 25 bought units");
assert.match(hero(), /1,550/, "hero now shows KSh 1,550 spent");

console.log("reseller page smoke test passed.");