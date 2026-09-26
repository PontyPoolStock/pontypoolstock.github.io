// Smoke test for the optimistic cache patch + background revalidation in
// js/services/api.js. Intercepts global fetch so nothing touches the real DB.
// Run: node scripts/api-cache.test.mjs
import assert from "node:assert";
import {
  fetchData,
  postData,
  updateData,
  deleteData,
} from "../js/services/api.js";

const KEY = "products?fields=id,name,price,quantity";
let rows = [
  { id: 1, name: "A", price: 10, quantity: 5 },
  { id: 2, name: "B", price: 20, quantity: 7 },
];
let fetchCount = 0;

globalThis.fetch = async (url, opts = {}) => {
  fetchCount += 1;
  const u = String(url);
  const method = opts.method || "GET";
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  if (method === "GET" && u.includes("products?fields=")) return json(rows);
  if (method === "PUT" && /\/products\/1$/.test(u)) {
    const body = JSON.parse(opts.body);
    rows[0] = { ...rows[0], ...body, id: 1 };
    return json(rows[0]);
  }
  if (method === "POST" && /\/products$/.test(u)) {
    const body = JSON.parse(opts.body);
    const created = { id: 3, name: body.name, price: 30, quantity: 1 };
    rows.push(created);
    return json(created, 201);
  }
  if (method === "DELETE" && /\/products\/3$/.test(u)) {
    rows = rows.filter((r) => r.id !== 3);
    return new Response(null, { status: 204 });
  }
  return json({ error: `unmocked ${method} ${u}` }, 500);
};

const settle = () => new Promise((r) => setTimeout(r, 100));

// 1. Warm the list cache
const list1 = await fetchData(KEY);
assert.strictEqual(list1.length, 2, "initial list");

// 2. PUT — next read must show the new price from cache
await updateData("products", 1, { price: 99 });
const afterPut = await fetchData(KEY);
assert.strictEqual(afterPut[0].price, 99, "PUT patched into cache instantly");

// 3. POST — new row appears at the front
const created = await postData("products", { name: "C" });
assert.ok(created.id === 3, "POST returned an id");
const afterPost = await fetchData(KEY);
assert.strictEqual(afterPost.length, 3, "POST added row to cache");
assert.strictEqual(afterPost[0].id, 3, "new row is first (newest-first order)");

// 4. DELETE — row disappears from cache
const del = await deleteData("products", 3);
assert.strictEqual(del.ok, true, "delete succeeded");
const afterDel = await fetchData(KEY);
assert.strictEqual(afterDel.length, 2, "DELETE removed row from cache");
assert.ok(!afterDel.some((r) => r.id === 3), "row 3 is gone");

// 5. Background revalidation settles with server truth (no throw, cache sane)
await settle();
const final = await fetchData(KEY);
assert.strictEqual(final[0].price, 99, "final state keeps the patched price");
assert.strictEqual(final.length, 2, "final row count stable");

console.log(`OK — fetches observed: ${fetchCount}`);
