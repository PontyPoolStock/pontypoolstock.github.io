// Smoke test for the Record Sale delete flow. It drives the real page module
// inside a DOM with fetch mocked, and asserts the thing that was reported as
// broken: that every outcome of clicking Delete is actually visible.
//
// Needs jsdom (kept out of dependencies to match the rest of this folder):
//   npm install --no-save jsdom
// Run: node scripts/sales-delete.test.mjs
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

const seed = () => ([
  { id: 7, product_id: 1, product_name: "Mini 30W", productName: "Mini 30W", quantity: 2, unit_price: 10, unitPrice: 10, total: 20, sold_at: "2026-10-05T10:00:00Z" },
  { id: 8, product_id: 1, product_name: "Mini 50W", productName: "Mini 50W", quantity: 1, unit_price: 20, unitPrice: 20, total: 20, sold_at: "2026-10-04T10:00:00Z" },
]);

let serverSales = seed();
let requests = [];
let onDelete = (id) => {
  const before = serverSales.length;
  serverSales = serverSales.filter((s) => s.id !== id);
  return before === serverSales.length
    ? { status: 404, body: { error: "Not found" } }
    : { status: 200, body: { deleted: true, id } };
};

globalThis.fetch = window.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || "GET";
  requests.push(`${method} ${u}`);
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (method === "DELETE") {
    const id = Number(/\/sales\/(\d+)$/.exec(u)?.[1]);
    const out = onDelete(id);
    return json(out.body, out.status);
  }
  if (u.includes("/sales")) return json(serverSales);
  if (u.includes("/products")) return json([{ id: 1, name: "Mini 30W", quantity: 99 }]);
  return json({ error: `unmocked ${method} ${u}` }, 500);
};

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const rows = () => document.querySelectorAll("#salesTableContainer tbody tr").length;
const toastText = () => [...document.querySelectorAll(".app-toast")].map((t) => t.textContent).join(" | ");

const { loadSales } = await import("../js/pages/sales.js");
await loadSales();
assert.strictEqual(rows(), 2, "two sales rendered");

// 1. Cancel must never send a DELETE.
document.querySelector(".sale-delete-btn").click();
await settle();
assert.ok(document.querySelector(".confirm-overlay"), "confirm dialog opened");
document.querySelector(".confirm-cancel").click();
await settle();
assert.ok(!requests.some((r) => r.startsWith("DELETE")), "cancel sends no DELETE");
assert.strictEqual(rows(), 2, "cancel leaves the list alone");

// 2. Confirm deletes, repaints, and says so on screen.
document.querySelector(".sale-delete-btn").click();
await settle();
document.querySelector(".confirm-accept").click();
await settle();
assert.ok(requests.some((r) => r.startsWith("DELETE")), "DELETE was sent");
assert.strictEqual(rows(), 1, "deleted row is gone");
assert.match(toastText(), /Sale deleted/, "success toast shown");

// 3. A 404 means the row only existed in this browser's cache: it must still
//    disappear (fresh refetch) and the toast must explain why.
serverSales = [];
onDelete = () => ({ status: 404, body: { error: "Not found" } });
document.querySelector(".sale-delete-btn").click();
await settle();
document.querySelector(".confirm-accept").click();
await settle();
assert.strictEqual(rows(), 0, "stale row is dropped from the list");
assert.match(toastText(), /no longer on the server/, "stale row explained");

// 4. A real refusal keeps the row and surfaces the server's own words.
serverSales = seed();
document.dispatchEvent(new window.CustomEvent("pontypool:data", {
  detail: { endpoint: "sales", data: serverSales },
}));
await settle();
assert.strictEqual(rows(), 2, "seeded rows are back on screen");

onDelete = () => ({ status: 400, body: { error: "The rating sold for this sale no longer exists" } });
document.querySelector(".sale-delete-btn").click();
await settle();
document.querySelector(".confirm-accept").click();
await settle();
assert.strictEqual(rows(), 2, "refused delete keeps the row");
assert.match(toastText(), /rating sold for this sale no longer exists/, "server reason surfaced");

// 5. Fresh data arriving in the background repaints history and hero totals.
document.dispatchEvent(new window.CustomEvent("pontypool:data", {
  detail: { endpoint: "sales", data: [serverSales[0]] },
}));
await settle();
assert.strictEqual(rows(), 1, "background refresh repainted the table");
assert.ok(document.getElementById("salesTodayTotal"), "hero totals present");

// 6. The edit modal must wire up. Its three helpers used to be declared
//    *inside* the save callback, so opening it threw a ReferenceError and the
//    Save button was never bound — clicking it did nothing at all.
globalThis.bootstrap = window.bootstrap = {
  Modal: class {
    show() {}
    hide() {}
  },
};
document.querySelector(".sale-edit-btn").click();
await settle();
const saveBtn = document.getElementById("editSaleSaveBtn");
assert.ok(saveBtn, "edit modal opened and Save button exists");
document.getElementById("editSaleQuantity").value = "0";
saveBtn.click();
await settle();
assert.match(
  document.querySelector("#editSaleModal .errorMes-quantity")?.textContent || "",
  /whole number/,
  "Save handler ran its validation",
);

console.log("OK — sales delete: cancel, confirm, 404 self-heal, refusal, background refresh, edit modal");
