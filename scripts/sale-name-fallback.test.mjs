// A product saved with no name must still print something sensible on a
// receipt: its category, singularised ("Pendants" → "Pendant"). When the
// category names two things ("Switches & Sockets") the cashier picks one.
// Covers the pure helpers, the server resolver, and the Record Sale picker.
//
// Run: node --experimental-strip-types scripts/sale-name-fallback.test.mjs
import assert from "node:assert/strict";
import {
  singularizeCategoryName,
  getCategoryNameOptions,
  getSaleItemName,
} from "../js/utils/helpers.js";
import { resolveSaleProductName } from "../hello.ts";

//* ── singularise the category ───────────────────────────────────────────────
assert.equal(singularizeCategoryName("Pendants"), "Pendant");
assert.equal(singularizeCategoryName("Chandeliers"), "Chandelier");
assert.equal(singularizeCategoryName("Wall Brackets"), "Wall Bracket");
assert.equal(singularizeCategoryName("Ceiling Lights"), "Ceiling Light");
assert.equal(singularizeCategoryName("Burners & Regulators"), "Burners & Regulator",
  "only the last word is plural");
assert.equal(singularizeCategoryName("Panels & Downlighters"), "Panels & Downlighter");
assert.equal(singularizeCategoryName("Switches & Sockets"), "Switches & Socket");
assert.equal(singularizeCategoryName("Bulbs"), "Bulb");
assert.equal(singularizeCategoryName("MCBS"), "MCB");
assert.equal(singularizeCategoryName("Snakelights"), "Snakelight");
assert.equal(singularizeCategoryName("Wires"), "Wire");
assert.equal(singularizeCategoryName("Outdoor"), "Outdoor", "already singular is left alone");
assert.equal(singularizeCategoryName("Single Phase"), "Single Phase");
assert.equal(singularizeCategoryName("Mirror Lights"), "Mirror Light");
assert.equal(singularizeCategoryName("Solar Flood Lights"), "Solar Flood Light");
assert.equal(singularizeCategoryName("Garden Lights"), "Garden Light");
assert.equal(singularizeCategoryName("Gate Lights"), "Gate Light");
assert.equal(singularizeCategoryName("Mini Flood Lights"), "Mini Flood Light");
assert.equal(singularizeCategoryName("Accessories"), "Accessory", "-ies → -y");
assert.equal(singularizeCategoryName("Switches"), "Switch", "-ches → -ch");
assert.equal(singularizeCategoryName("  Pendants  "), "Pendant", "whitespace trimmed");
assert.equal(singularizeCategoryName(""), "");
assert.equal(singularizeCategoryName(null), "");
assert.equal(singularizeCategoryName(undefined), "");

//* ── every part of a compound category is offered as a choice ───────────────
const categories = [
  { id: "8", name: "Pendants" },
  { id: "11", name: "Chandeliers" },
  { id: "9", name: "Wall Brackets" },
  { id: "4", name: "Panels & Downlighters" },
  { id: "5", name: "Switches & Sockets" },
  { id: "", name: "No Id" },
];

assert.deepEqual(getCategoryNameOptions(categories, "8"), ["Pendant"]);
assert.deepEqual(getCategoryNameOptions(categories, "11"), ["Chandelier"]);
assert.deepEqual(getCategoryNameOptions(categories, "9"), ["Wall Bracket"]);
assert.deepEqual(getCategoryNameOptions(categories, "4"), ["Panel", "Downlighter"],
  "both halves of a compound category are pickable");
assert.deepEqual(getCategoryNameOptions(categories, "5"), ["Switch", "Socket"]);
assert.deepEqual(getCategoryNameOptions(categories, "missing"), [],
  "unknown category offers nothing");
assert.deepEqual(getCategoryNameOptions(categories, ""), [],
  "no category offers nothing");
assert.deepEqual(getCategoryNameOptions([], "8"), [],
  "empty category list offers nothing");

//* ── what a receipt should call it ──────────────────────────────────────────
assert.equal(getSaleItemName({ name: "Panel Light" }, categories), "Panel Light",
  "a named product keeps its own name");
assert.equal(getSaleItemName({ name: "  ", categoryId: "8" }, categories, "Product"), "Pendant",
  "blank name falls back to the category");
assert.equal(getSaleItemName({ name: "", categoryId: "11" }, categories, "Product"), "Chandelier");
assert.equal(getSaleItemName({ name: "", categoryId: "9" }, categories, "Product"), "Wall Bracket");
assert.equal(getSaleItemName({ name: "", categoryId: "4" }, categories, "Product"), "Panel",
  "compound category defaults to its first half");
assert.equal(getSaleItemName({ name: "", categoryId: "5" }, categories, "Product"), "Switch");
assert.equal(getSaleItemName({ name: "" }, categories, "Product"), "Product",
  "no category at all keeps the caller's fallback");
assert.equal(getSaleItemName({ name: "", categoryId: "" }, categories, "Product"), "Product");
assert.equal(getSaleItemName(null, categories, "Product"), "Product");
assert.equal(getSaleItemName({ name: "Pendant", categoryId: "8" }, categories), "Pendant",
  "the product's own name always wins");

//* ── the server resolves the same way ───────────────────────────────────────
assert.equal(resolveSaleProductName("Panel Light", "Pendants", "Socket"), "Panel Light",
  "a named product ignores the label entirely");
assert.equal(resolveSaleProductName("", "Pendants", "Socket"), "Socket",
  "the cashier's pick wins for a nameless product");
assert.equal(resolveSaleProductName("", "Switches & Sockets"), "Switch",
  "compound category falls back to its first half");
assert.equal(resolveSaleProductName("", "Pendants"), "Pendant");
assert.equal(resolveSaleProductName("  ", "Chandeliers"), "Chandelier",
  "whitespace-only name counts as nameless");
assert.equal(resolveSaleProductName("", "", "Wall Bracket"), "Wall Bracket",
  "label still works with no category");
assert.equal(resolveSaleProductName("", "", ""), "",
  "nothing to go on stays empty (UI shows its own placeholder)");
assert.equal(resolveSaleProductName(null, null, undefined), "");
assert.equal(resolveSaleProductName("", "Pendants", "  Socket  "), "Socket",
  "label is trimmed");
assert.equal(resolveSaleProductName("", "Pendants", "x".repeat(200)).length, 60,
  "label is length-capped so a receipt line cannot be flooded");
assert.equal(resolveSaleProductName("", "Pendants", "  \n\t "), "Pendant",
  "a whitespace label is ignored, not stored");

console.log("OK — sale name fallback: singularisation, compound picks, server resolver");
