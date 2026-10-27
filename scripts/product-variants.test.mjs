// Smoke test for the product form's rating rows: duplicate keeps the shared
// rating details but clears colour/quantity, previews show the exact Record
// Sale label, and duplicate rating+colour pairs are rejected on save.
//
// Needs jsdom (kept out of dependencies to match the rest of this folder):
//   npm install --no-save jsdom
// Run: node scripts/product-variants.test.mjs
import assert from "node:assert";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://pontypoolstock.github.io/index.html",
  pretendToBeVisual: true,
});
const { window } = dom;
for (const key of ["window", "document", "localStorage", "sessionStorage", "Event",
  "CustomEvent", "Element", "HTMLElement", "Node"]) {
  globalThis[key] = window[key] ?? window;
}
globalThis.window = window;

const { makeProductForm, setupProductVariants, collectProductVariants } =
  await import("../js/components/form.js");
const { isValidProductData } = await import("../js/utils/helpers.js");

document.body.innerHTML = await makeProductForm("", "", { categories: [] });
setupProductVariants();

const rows = () => [...document.querySelectorAll("[data-variant-row]")];
const field = (row, name) => row.querySelector(`[data-field="${name}"]`);
const set = (row, name, value) => {
  field(row, name).value = value;
  field(row, name).dispatchEvent(new window.Event("input", { bubbles: true }));
};

document.getElementById("addVariantBtn").click();
let [row] = rows();
set(row, "label", " 32A ");
set(row, "price", "100");
set(row, "quantity", "4");
set(row, "reorderLevel", "1");
set(row, "colour", "white");
set(row, "amps", "0.05");

assert.match(row.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 32A · White · 0\.05A/,
  "preview uses the canonical rating, colour and amps");

row.querySelector("[data-duplicate-variant]").click();
assert.equal(rows().length, 2, "duplicate adds a second rating row");
const clone = rows()[1];
assert.equal(field(clone, "label").value.trim(), "32A", "duplicate keeps the rating");
assert.equal(field(clone, "price").value, "100", "duplicate keeps the price");
assert.equal(field(clone, "amps").value, "0.05", "duplicate keeps the amps");
assert.equal(field(clone, "reorderLevel").value, "1", "duplicate keeps the minimum");
assert.equal(field(clone, "colour").value, "", "duplicate clears the colour");
assert.equal(field(clone, "quantity").value, "", "duplicate clears the quantity");
assert.match(clone.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 32A · 0\.05A/,
  "the duplicate is still identifiable by its rating until a colour is typed");

set(clone, "colour", "warm white");
assert.match(clone.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 32A · Warm White/,
  "editing the duplicate updates its preview");

const collected = collectProductVariants();
assert.deepEqual(collected.map((variant) => [variant.label, variant.colour]), [
  ["32A", "White"],
  ["32A", "Warm White"],
], "collected rows are normalised before saving");
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", collected), true,
  "two different colours for one rating are valid");

set(clone, "colour", "WHITE");
const duplicateRows = collectProductVariants();
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", duplicateRows), false,
  "the same rating + colour twice is rejected");
assert.match(document.querySelector(".errorMes-variants").textContent,
  /Rating rows 1 and 2 repeat the same rating and colour/,
  "the duplicate row numbers are shown");

console.log("OK — product variants: duplicate, previews, canonical colours, duplicate-pair rejection");
