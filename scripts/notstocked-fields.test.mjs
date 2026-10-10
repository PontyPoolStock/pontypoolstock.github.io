//* Regression test for the "Only selling" revert:
//* PRODUCTS list uses ?fields=...,notStocked (camelCase) — the API's
//* camelToSnake map must resolve it to the not_stocked column, otherwise
//* the SELECT drops it, toCamel() defaults it to false and a restart
//* repaints an On-order product as In stock.
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../hello.ts", import.meta.url), "utf8");

// The map the GET ?fields= projection uses must contain the flag.
assert.match(
  source,
  /notStocked\s*:\s*["']not_stocked["']/,
  "hello.ts camelToSnake must map notStocked -> not_stocked or ?fields=notStocked is silently dropped",
);

// List + adjustment projections the UI actually requests must carry it too.
const api = fs.readFileSync(new URL("../js/services/api.js", import.meta.url), "utf8");
assert.match(
  api,
  /PRODUCT_LIST_FIELDS\s*=\s*["'][^"']*notStocked[^"']*["']/,
  "PRODUCT_LIST_FIELDS must include notStocked",
);
assert.match(
  api,
  /PRODUCT_ADJUSTMENT_FIELDS\s*=\s*["'][^"']*notStocked[^"']*["']/,
  "PRODUCT_ADJUSTMENT_FIELDS must include notStocked",
);

console.log("notStocked projection regression test passed.");
