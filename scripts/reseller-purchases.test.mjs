//* Regression test for bought-for-resale tracking ("Shop Purchases"):
//* - reseller_purchases table exists in schema.sql with shop_name and employee_name columns
//* - hello.ts maps the resellerPurchases resource (table + fields + camelCase)
//* - js/utils/helpers.js derives reseller stock (bought minus sold) separately
//* - Statistics loads resellerPurchases and renders the Shop purchases section
//* - main.js routes the Shop Purchases nav page + index.html has the nav row
import assert from "node:assert/strict";
import fs from "node:fs";

const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
assert.match(schema, /CREATE TABLE IF NOT EXISTS reseller_purchases/, "schema.sql must create reseller_purchases");
assert.match(schema, /shop_name/, "reseller_purchases must have a shop_name column");
assert.match(schema, /employee_name/, "reseller_purchases must have an employee_name column");
assert.match(schema, /unit_cost/, "reseller_purchases must track buy price");
assert.match(schema, /reseller_purchases_product_id_idx/, "reseller_purchases needs a product index");

const api = fs.readFileSync(new URL("../hello.ts", import.meta.url), "utf8");
assert.match(api, /resellerPurchases:\s*["']reseller_purchases["']/, "hello.ts tableNames must map resellerPurchases");
assert.match(api, /resellerPurchases:\s*\[/, "hello.ts fieldMap must list resellerPurchases fields");
assert.match(api, /unitCost:\s*["']unit_cost["']/, "hello.ts camelToSnake must map unitCost");
assert.match(api, /purchasedAt:\s*["']purchased_at["']/, "hello.ts camelToSnake must map purchasedAt");
assert.match(api, /shopName:\s*["']shop_name["']/, "hello.ts camelToSnake must map shopName");
assert.match(api, /employeeName:\s*["']employee_name["']/, "hello.ts camelToSnake must map employeeName");

const helpers = fs.readFileSync(new URL("../js/utils/helpers.js", import.meta.url), "utf8");
assert.match(helpers, /getResellerTotals/, "helpers must export getResellerTotals");
assert.match(helpers, /getResellerStockMap/, "helpers must export getResellerStockMap");

const stats = fs.readFileSync(new URL("../js/pages/statistics.js", import.meta.url), "utf8");
assert.match(stats, /fetchData\("resellerPurchases"\)/, "Statistics must load resellerPurchases");
assert.match(stats, /Shop purchases/, "Statistics must render the Shop purchases section");
assert.match(stats, /Reseller profit/, "Statistics must show reseller profit");

const main = fs.readFileSync(new URL("../js/main.js", import.meta.url), "utf8");
assert.match(main, /Shop Purchases/, "main.js must route the Shop Purchases page");
assert.match(main, /loadResellerPurchases/, "main.js must import loadResellerPurchases");

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
assert.match(index, /data-page="Shop Purchases"/, "index.html must have the Shop Purchases nav row");

const db = JSON.parse(fs.readFileSync(new URL("../data/db.json", import.meta.url), "utf8"));
assert.ok(Array.isArray(db.resellerPurchases), "data/db.json must have a resellerPurchases array");

console.log("reseller purchases regression test passed.");
