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
const { isValidProductData, normalizeVariantGlass, normalizeVariantRating } =
  await import("../js/utils/helpers.js");

assert.equal(normalizeVariantRating(" 4 watts "), "4W");
assert.equal(normalizeVariantRating("4w"), "4W");
assert.equal(normalizeVariantRating("4"), "4W", "a bare rating number means Watts");
assert.equal(normalizeVariantRating("63 amps"), "63A");
assert.equal(normalizeVariantRating("63a"), "63A");
assert.equal(normalizeVariantRating("ST64 4 watts"), "ST64 4W");
assert.equal(normalizeVariantRating("Warm White"), "Warm White", "colours are untouched");
assert.equal(normalizeVariantGlass("clear"), "Clear");
assert.equal(normalizeVariantGlass("amber"), "Amber");

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
set(row, "glass", "clear");
set(row, "colour", "white");
set(row, "amps", "0.05");

assert.match(row.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 32A · Clear · White · 0\.05A/,
  "preview uses the canonical rating, glass, colour and amps");

row.querySelector("[data-duplicate-variant]").click();
assert.equal(rows().length, 2, "duplicate adds a second rating row");
const clone = rows()[1];
assert.equal(field(clone, "label").value.trim(), "32A", "duplicate keeps the rating");
assert.equal(field(clone, "price").value, "100", "duplicate keeps the price");
assert.equal(field(clone, "amps").value, "0.05", "duplicate keeps the amps");
assert.equal(field(clone, "reorderLevel").value, "1", "duplicate keeps the minimum");
assert.equal(field(clone, "glass").value, "Clear", "duplicate keeps the glass colour");
assert.equal(field(clone, "colour").value, "", "duplicate clears the colour");
assert.equal(field(clone, "quantity").value, "", "duplicate clears the quantity");
assert.match(clone.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 32A · Clear · 0\.05A/,
  "the duplicate is still identifiable by its rating and glass until a colour is typed");

set(clone, "colour", "warm white");
assert.match(clone.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 32A · Clear · Warm White/,
  "editing the duplicate updates its preview");

const collected = collectProductVariants();
assert.deepEqual(collected.map((variant) => [variant.label, variant.glass, variant.colour]), [
  ["32A", "Clear", "White"],
  ["32A", "Clear", "Warm White"],
], "collected rows are normalised before saving");
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", collected), true,
  "two different colours for one rating and glass are valid");

set(clone, "colour", "WHITE");
const duplicateRows = collectProductVariants();
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", duplicateRows), false,
  "the same rating, glass and colour twice is rejected");
assert.match(document.querySelector(".errorMes-variants").textContent,
  /Rating rows 1 and 2 repeat the same rating, glass and colour/,
  "the duplicate row numbers are shown");

set(clone, "glass", "amber");
const glassRows = collectProductVariants();
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", glassRows), true,
  "the same rating and colour with different glass is valid");

set(clone, "glass", "");
const mixedGlassRows = collectProductVariants();
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", mixedGlassRows), false,
  "a rating cannot mix rows with and without glass");
assert.match(document.querySelector(".errorMes-variants").textContent,
  /add a glass colour to row\(s\) 2 too/);

set(row, "label", "");
set(row, "glass", "");
set(row, "colour", "");
set(row, "amps", "32");
set(clone, "label", "");
set(clone, "glass", "");
set(clone, "colour", "");
set(clone, "amps", "63");
const ampsRows = collectProductVariants();
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", ampsRows), true,
  "rows identified only by amperage are valid");
assert.match(row.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 32A/,
  "amperage alone is previewed as the rating");

set(clone, "amps", "32");
const duplicateAmpsRows = collectProductVariants();
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", duplicateAmpsRows), false,
  "the same amperage twice is rejected");

set(row, "label", "4 watts");
set(row, "glass", "");
set(row, "colour", "");
set(row, "amps", "");
field(row, "label").dispatchEvent(new window.Event("focusout", { bubbles: true }));
assert.equal(field(row, "label").value, "4W", "leaving the rating field adds W");
assert.match(row.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 4W/);

set(clone, "label", "63 amps");
set(clone, "glass", "");
set(clone, "colour", "");
set(clone, "amps", "");
field(clone, "label").dispatchEvent(new window.Event("focusout", { bubbles: true }));
assert.equal(field(clone, "label").value, "63A", "leaving the rating field adds A");
assert.match(clone.querySelector("[data-variant-preview]").textContent,
  /Shown in Record Sale as: 63A/);

const symbolRows = collectProductVariants();
assert.deepEqual(symbolRows.map((variant) => variant.label), ["4W", "63A"],
  "saving also normalises ratings that were not blurred");
assert.equal(isValidProductData({ name: "Panel", categoryId: "" }, "", symbolRows), true);

console.log("OK — product variants: duplicate, previews, rating units, amperage-only rows, duplicate rejection");
