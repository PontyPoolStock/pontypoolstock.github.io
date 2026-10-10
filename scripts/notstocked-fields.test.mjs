//* Regression test for the "Only selling" revert:
//* PRODUCTS list uses ?fields=...,notStocked (camelCase) — the API's
//* camelToSnake map must resolve it to the not_stocked column, otherwise
//* the SELECT drops it, toCamel() defaults it to false and a restart
//* repaints an On-order product as In stock.
//* The frontend additionally treats an OMITTED flag as "unknown" (sticky
//* true) so a not-yet-redeployed API can never clear a saved flag.
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

// Sticky-flag guards: omitted !== false.
assert.match(
  api,
  /omitted flag is "unknown"/,
  "revalidateCollection must keep a known-true notStocked when the payload omits it",
);
assert.match(
  api,
  /omits notStocked/,
  "revalidateInBackground must keep a known-true notStocked when the payload omits it",
);

console.log("notStocked projection regression test passed.");
