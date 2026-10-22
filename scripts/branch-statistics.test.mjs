import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
assert.match(schema, /branch TEXT CHECK \(branch IN \('Ambala Road', 'Duruma Road'\)\)/,
  "sales branch must accept only the two configured locations while allowing old rows to remain null");
assert.match(schema, /sales_branch_sold_at_idx/,
  "branch and date lookups should have a supporting index");

const api = fs.readFileSync(new URL("../hello.ts", import.meta.url), "utf8");
assert.match(api, /const SALE_BRANCHES = \["Ambala Road", "Duruma Road"\]/,
  "the API must define valid sale branches");
assert.match(api, /typeof branch !== "string" \|\| !SALE_BRANCHES\.some/,
  "the API must validate the branch instead of trusting client input");
assert.match(api, /Select a valid branch for this sale/,
  "the API must reject sales without a valid branch");
assert.match(api, /INSERT INTO sales \([^)]*branch/,
  "the sale transaction must store the selected branch");

const salesPage = fs.readFileSync(new URL("../js/pages/sales.js", import.meta.url), "utf8");
assert.match(salesPage, /branch,\s*soldBy,/,
  "the sales page must send the selected branch with each recorded line");

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

const expiry = Date.now() + 60 * 60 * 1000;
const tokenPayload = Buffer.from(JSON.stringify({ e: expiry })).toString("base64url");
window.localStorage.setItem("pontypool_token", `${tokenPayload}.test-signature`);

const now = new Date().toISOString();
const sales = [
  { id: 1, branch: "Ambala Road", quantity: 2, total: 200, soldAt: now },
  { id: 2, branch: "Duruma Road", quantity: 1, total: 350, soldAt: now },
  { id: 3, quantity: 3, total: 450, soldAt: now },
];
const responses = {
  "/products": [],
  "/categories": [],
  "/stockAdjustments": [],
  "/sales": sales,
  "/resellerPurchases": [],
};

globalThis.fetch = window.fetch = async (url) => {
  const path = new URL(String(url)).pathname;
  const data = responses[path];
  if (!data) {
    return new Response(JSON.stringify({ error: `unmocked ${path}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const { loadStatistics } = await import("../js/pages/statistics.js");
await loadStatistics();

const rows = [...document.querySelectorAll("#branchSalesTable tbody tr")];
assert.equal(rows.length, 3, "statistics show both branches and an overall totals row");
assert.match(rows[0].textContent, /Ambala Road/, "Ambala Road appears as a separate row");
assert.match(rows[0].cells[1].textContent, /200/, "Ambala revenue is calculated independently");
assert.equal(rows[0].cells[2].textContent.trim(), "1", "Ambala transactions are counted");
assert.equal(rows[0].cells[3].textContent.trim(), "2", "Ambala units are counted");
assert.match(rows[1].textContent, /Duruma Road/, "Duruma Road appears as a separate row");
assert.match(rows[1].cells[1].textContent, /350/, "Duruma revenue is calculated independently");
assert.equal(rows[1].cells[2].textContent.trim(), "1", "Duruma transactions are counted");
assert.equal(rows[1].cells[3].textContent.trim(), "1", "Duruma units are counted");
assert.equal(rows[2].cells[0].textContent.trim(), "Totals",
  "the combined row is labeled Totals");
assert.match(rows[2].cells[1].textContent, /1,000/,
  "totals revenue includes both branches and older sales without branch metadata");
assert.equal(rows[2].cells[2].textContent.trim(), "3",
  "totals transaction count includes all sales");
assert.equal(rows[2].cells[3].textContent.trim(), "6",
  "totals units include all sales");
assert.match(document.getElementById("pageContent").textContent, /1,000/,
  "existing overall sales totals continue to include unassigned history");
assert.doesNotMatch(document.getElementById("pageContent").textContent, /Unassigned \(legacy\)|Older sales without a saved branch/,
  "statistics do not show the legacy explanation");

const roles = fs.readFileSync(new URL("../js/utils/role.js", import.meta.url), "utf8");
assert.match(roles, /"Statistics"/, "Statistics remains an admin page");
assert.match(roles, /STAFF_PAGES = \["Products", "Categories", "Record Sale", "Shop Purchases"\]/,
  "staff still cannot access Statistics");

console.log("branch statistics regression test passed");
