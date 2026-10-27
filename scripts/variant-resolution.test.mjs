// Unit tests for matching a saved sale back to the right variant row.
// Run: node --experimental-strip-types scripts/variant-resolution.test.mjs
import assert from "node:assert/strict";
import { parseVariantIndex, resolveOriginalVariantIndex } from "../hello.ts";

assert.equal(parseVariantIndex(null), null);
assert.equal(parseVariantIndex(""), null);
assert.equal(parseVariantIndex("1"), 1);
assert.equal(parseVariantIndex("1.0"), 1);
assert.equal(parseVariantIndex("1.5"), undefined);
assert.equal(parseVariantIndex("1abc"), undefined);
assert.equal(parseVariantIndex(-1), undefined);
assert.equal(parseVariantIndex(true), undefined);

const variants = [
  { label: "4W", glass: "Clear", colour: "Warm White", quantity: 10 },
  { label: "4W", glass: "Amber", colour: "Warm White", quantity: 10 },
  { label: "8W", glass: "Clear", colour: "Warm White", quantity: 5 },
];
const client = {
  async query() {
    return { rows: [{ name: "ST64", variants }] };
  },
};

const resolve = (sale) => resolveOriginalVariantIndex(client, {
  product_id: 1,
  ...sale,
});

assert.equal(
  await resolve({ variant_index: 0, product_name: "ST64 4W · Clear · Warm White" }),
  0,
  "stored index wins when its suffix still matches",
);
assert.equal(
  await resolve({ variant_index: 1, product_name: "ST64 4W · Clear · Warm White" }),
  0,
  "a reordered row is recovered by suffix instead of trusting the old index",
);
assert.equal(
  await resolve({ variant_index: 0, product_name: "ST64 4W · Amber · Warm White" }),
  1,
  "an edited sale gives stock back to the amber row",
);
assert.equal(
  await resolve({ variant_index: 0, product_name: "ST64 4W · White" }),
  null,
  "an ambiguous legacy name is refused rather than guessed",
);
assert.equal(
  await resolve({ variant_index: 8, product_name: "ST64 8W · Clear · Warm White" }),
  2,
  "an out-of-range stored index falls back to the unique suffix match",
);
assert.equal(
  await resolve({ variant_index: null, product_name: "ST64 8W · Clear · Warm White" }),
  2,
  "a legacy sale with no index can still be matched by suffix",
);

console.log("variant resolution test passed");
