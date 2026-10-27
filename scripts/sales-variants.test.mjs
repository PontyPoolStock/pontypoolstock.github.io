// Smoke test for the Record Sale rating/colour pickers. It drives the real page
// module inside a DOM with fetch mocked and asserts the reported bug is gone:
// the sale must resolve the exact variant row from the visible label + colour,
// never from a hidden option index.
//
// Needs jsdom (kept out of dependencies to match the rest of this folder):
//   npm install --no-save jsdom
// Run: node scripts/sales-variants.test.mjs
import assert from "node:assert";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  '<!doctype html><html><body><h2 id="pageTitle">Dashboard</h2><div id="pageContent"></div><div id="receipt-print-container"></div></body></html>',
  { url: "https://pontypoolstock.github.io/index.html", pretendToBeVisual: true },
);
const { window } = dom;
for (const key of ["window", "document", "localStorage", "sessionStorage", "Event",
  "CustomEvent", "Element", "HTMLElement", "Node"]) {
  globalThis[key] = window[key] ?? window;
}
globalThis.window = window;
window.print = () => {};
const tokenExpiry = Date.now() + 60 * 60 * 1000;
const tokenPayload = Buffer.from(JSON.stringify({ e: tokenExpiry })).toString("base64url");
window.localStorage.setItem("pontypool_token", `${tokenPayload}.test-signature`);
window.localStorage.setItem("currentUser", JSON.stringify({
  name: "Till Operator",
  role: "staff",
  expiresAt: tokenExpiry,
}));
window.localStorage.setItem("pontypool_branch", "Duruma Road");

const products = [
  {
    id: "p1",
    name: "Panel Light",
    categoryId: "c1",
    price: 100,
    quantity: 0,
    variants: [
      { label: "32A", colour: "White", price: 120, quantity: 5 },
      { label: "32A", colour: "Warm White", price: 125, quantity: 3 },
      { label: "50A", colour: "White", price: 150, quantity: 2 },
    ],
  },
  {
    id: "p2",
    name: "Colour Bulb",
    categoryId: "c1",
    price: 0,
    quantity: 0,
    variants: [
      { label: "", colour: "White", price: 60, quantity: 2 },
      { label: "", colour: "RGB", price: 70, quantity: 2 },
    ],
  },
  { id: "p3", name: "Simple", categoryId: "c1", price: 40, quantity: 9 },
  {
    id: "p4",
    name: "Single Rating",
    categoryId: "c1",
    price: 0,
    quantity: 0,
    variants: [{ label: "32A", colour: "White", price: 300, quantity: 4 }],
  },
  {
    id: "p5",
    name: "Rating Only",
    categoryId: "c1",
    price: 0,
    quantity: 0,
    variants: [{ label: "9 watts", price: 90, quantity: 2 }],
  },
  {
    id: "p6",
    name: "Amp Only",
    categoryId: "c1",
    price: 0,
    quantity: 0,
    variants: [
      { label: "", colour: "", amps: 10, price: 70, quantity: 4 },
      { label: "", colour: "", amps: 20, price: 80, quantity: 2 },
      { label: "", colour: "", amps: 32, price: 90, quantity: 3 },
      { label: "", colour: "", amps: 63, price: 100, quantity: 1 },
    ],
  },
  {
    id: "p7",
    name: "Glass Bulb",
    categoryId: "c1",
    price: 0,
    quantity: 0,
    variants: [
      { label: "4W", glass: "Clear", colour: "Warm White", price: 110, quantity: 4 },
      { label: "4W", glass: "Clear", colour: "Cool White", price: 115, quantity: 2 },
      { label: "4W", glass: "Amber", colour: "Warm White", price: 120, quantity: 3 },
      { label: "8W", glass: "Clear", colour: "Warm White", price: 130, quantity: 1 },
    ],
  },
];
const posts = [];
let serverSales = [];

globalThis.fetch = window.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || "GET";
  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (method === "POST" && u.endsWith("/sales")) {
    const body = JSON.parse(opts.body);
    posts.push(body);
    const sale = {
      id: posts.length,
      ...body,
      total: body.quantity * body.unitPrice,
      soldAt: new Date().toISOString(),
    };
    serverSales = [sale, ...serverSales];
    return json(sale, 201);
  }
  if (u.includes("/sales")) return json(serverSales);
  if (u.includes("/resellerPurchases")) return json([]);
  if (u.includes("/products")) return json(products);
  if (u.includes("/categories")) return json([{ id: "c1", name: "Bulbs" }]);
  return json({ error: `unmocked ${method} ${u}` }, 500);
};

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const optionLabels = (id) =>
  [...document.querySelectorAll(`#${id} option`)].map((o) => o.textContent.trim());
const lines = () => document.querySelectorAll("#saleCartList .sale-cart-line");
const hidden = (id) => document.getElementById(id).classList.contains("d-none");
const pickProduct = (id) => {
  const select = document.getElementById("saleProductSelect");
  select.value = id;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const pick = (id, value) => {
  const select = document.getElementById(id);
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const setField = (id, value) => {
  const el = document.getElementById(id);
  el.value = String(value);
  el.dispatchEvent(new window.Event("input", { bubbles: true }));
};

const { loadSales } = await import("../js/pages/sales.js");
await loadSales();

// 1. One option per product (the old dropdown duplicated every variant row).
const productOptions = optionLabels("saleProductSelect");
assert.equal(productOptions.length, 8, "placeholder + one option per product");
assert.match(productOptions[1], /Panel Light — 10 in stock/);
assert.match(productOptions[2], /Colour Bulb — 4 in stock/);
assert.match(productOptions[3], /Simple — 9 in stock/);
assert.match(productOptions[4], /Single Rating — 4 in stock/);
assert.match(productOptions[5], /Rating Only — 2 in stock/);
assert.match(productOptions[6], /Amp Only — 10 in stock/);
assert.match(productOptions[7], /Glass Bulb — 10 in stock/);
assert.ok(
  [...document.querySelectorAll("#saleProductSelect option")]
    .every((option) => !option.value.includes("::")),
  "product option values are plain product ids",
);

// 2. A rating+colour product shows the rating picker first, price stays blank
//    until the pair is unambiguous.
pickProduct("p1");
assert.ok(!hidden("saleVariantWrapper"), "variant picker shown for a variant product");
assert.ok(!hidden("saleVariantRatingGroup"), "rating picker shown when several ratings exist");
assert.ok(hidden("saleVariantColourGroup"), "colour picker waits for a rating");
assert.deepEqual(optionLabels("saleVariantSelect"), ["Select rating", "32A", "50A"],
  "ratings are deduplicated and sorted");
assert.equal(document.getElementById("saleUnitPrice").value, "",
  "no price guessed before a rating is chosen");
assert.match(document.getElementById("saleStockHint").textContent, /Choose a rating/);

pick("saleVariantSelect", "32A");
assert.ok(!hidden("saleVariantColourGroup"), "colour picker appears for the chosen rating");
assert.deepEqual(optionLabels("saleVariantColour"), ["Select glow colour", "Warm White", "White"],
  "only glow colours of that rating are offered, sorted");
assert.equal(document.getElementById("saleUnitPrice").value, "",
  "no price guessed before a glow colour is chosen");
assert.match(document.getElementById("saleStockHint").textContent, /Choose a glow colour/);

pick("saleVariantColour", "Warm White");
assert.equal(document.getElementById("saleUnitPrice").value, "125",
  "the selected variant price is prefilled");
assert.match(document.getElementById("saleStockHint").textContent,
  /32A · Warm White — Stock: 3/, "stock hint names the exact variant");

// 3. Staged units count against only that exact variant.
setField("saleQuantity", 2);
document.getElementById("addSaleLineBtn").click();
assert.equal(lines().length, 1, "first variant line staged");
assert.match(lines()[0].textContent, /Panel Light 32A · Warm White/,
  "basket names the exact rating and colour");
assert.match(document.getElementById("saleStockHint").textContent, /2 units already added/);

setField("saleQuantity", 2);
document.getElementById("addSaleLineBtn").click();
assert.equal(lines().length, 1, "cannot stage more than the chosen variant holds");
assert.match(document.querySelector(".errorMes-quantity")?.textContent || "",
  /Only 1 left to add \(3 in stock, 2 already in this sale\)/);

// 4. Switching colour switches the resolved stock row and price independently.
pick("saleVariantColour", "White");
assert.equal(document.getElementById("saleUnitPrice").value, "120");
assert.match(document.getElementById("saleStockHint").textContent, /32A · White — Stock: 5/);
setField("saleQuantity", 1);
document.getElementById("addSaleLineBtn").click();
assert.equal(lines().length, 2, "second colour staged");

// 5. A colour-only product hides the rating picker and labels colour alone.
pickProduct("p2");
assert.ok(hidden("saleVariantRatingGroup"), "no rating picker for a colour-only product");
assert.ok(!hidden("saleVariantColourGroup"), "colour picker shown");
assert.equal(document.getElementById("saleVariantColourLabel").textContent, "Glow colour");
assert.deepEqual(optionLabels("saleVariantColour"), ["Select glow colour", "RGB", "White"]);
pick("saleVariantColour", "White");
assert.equal(document.getElementById("saleUnitPrice").value, "60");
assert.match(document.getElementById("saleStockHint").textContent, /White — Stock: 2/);
setField("saleQuantity", 1);
document.getElementById("addSaleLineBtn").click();
assert.equal(lines().length, 3, "colour-only line staged");

// 6. A simple product hides the whole picker and keeps its own price/stock.
pickProduct("p3");
assert.ok(hidden("saleVariantWrapper"), "no variant picker for a simple product");
assert.equal(document.getElementById("saleUnitPrice").value, "40");
assert.match(document.getElementById("saleStockHint").textContent, /9 in stock/);

// 7. One rating and one colour are still shown, so the sold row is visible
//    even when there is nothing else to choose.
pickProduct("p4");
assert.ok(!hidden("saleVariantWrapper"), "single-variant picker stays visible");
assert.ok(!hidden("saleVariantRatingGroup"), "the one rating is shown");
assert.deepEqual(optionLabels("saleVariantSelect"), ["32A"]);
assert.ok(!hidden("saleVariantColourGroup"), "the one colour is shown");
assert.deepEqual(optionLabels("saleVariantColour"), ["White"]);
assert.equal(document.getElementById("saleUnitPrice").value, "300");
assert.match(document.getElementById("saleStockHint").textContent, /32A · White — Stock: 4/);

// 8. A single rating without a colour still shows the rating picker.
pickProduct("p5");
assert.ok(!hidden("saleVariantRatingGroup"), "the one rating is shown without a colour");
assert.deepEqual(optionLabels("saleVariantSelect"), ["9W"]);
assert.ok(hidden("saleVariantColourGroup"), "colour picker hidden when the product has none");
assert.equal(document.getElementById("saleUnitPrice").value, "90");
assert.match(document.getElementById("saleStockHint").textContent, /9W — Stock: 2/);

// 9. Old products often carry only Amperes (32A) with blank Rating/Colour;
//    the amperage becomes the visible rating instead of hiding the picker.
pickProduct("p6");
assert.ok(!hidden("saleVariantWrapper"), "amperage-only variants show the picker");
assert.ok(!hidden("saleVariantRatingGroup"), "amperage is shown as the rating");
assert.deepEqual(optionLabels("saleVariantSelect"),
  ["Select rating", "10A", "20A", "32A", "63A"],
  "amperages are formatted and sorted as ratings");
assert.ok(hidden("saleVariantColourGroup"), "no colour picker when colours are blank");
pick("saleVariantSelect", "32A");
assert.equal(document.getElementById("saleUnitPrice").value, "90",
  "the amperage row price is prefilled");
assert.match(document.getElementById("saleStockHint").textContent, /32A — Stock: 3/);
setField("saleQuantity", 1);
document.getElementById("addSaleLineBtn").click();
assert.equal(lines().length, 4, "amperage-only line staged");

// 10. Glass and glow are separate choices: the same 4W + Clear can glow warm
//     or cool white, while 4W + Amber only glows warm white.
pickProduct("p7");
assert.deepEqual(optionLabels("saleVariantSelect"), ["Select rating", "4W", "8W"]);
assert.ok(hidden("saleVariantGlassGroup"), "glass waits for a rating");
pick("saleVariantSelect", "8W");
assert.deepEqual(optionLabels("saleVariantGlass"), ["Clear"],
  "a single glass colour is shown already selected");
assert.deepEqual(optionLabels("saleVariantColour"), ["Warm White"],
  "a single glow colour is shown already selected");
assert.equal(document.getElementById("saleUnitPrice").value, "130");

pick("saleVariantSelect", "4W");
assert.deepEqual(optionLabels("saleVariantGlass"),
  ["Select glass colour", "Amber", "Clear"],
  "glass colours are offered for the chosen rating");
assert.ok(hidden("saleVariantColourGroup"), "glow waits for a glass colour");
pick("saleVariantGlass", "Amber");
assert.deepEqual(optionLabels("saleVariantColour"), ["Warm White"],
  "only glow colours for the chosen glass are offered");
assert.equal(document.getElementById("saleUnitPrice").value, "120");
assert.match(document.getElementById("saleStockHint").textContent,
  /4W · Amber · Warm White — Stock: 3/);

pick("saleVariantGlass", "Clear");
assert.deepEqual(optionLabels("saleVariantColour"),
  ["Select glow colour", "Cool White", "Warm White"]);
assert.equal(document.getElementById("saleUnitPrice").value, "",
  "no price guessed before the glow colour is chosen");
pick("saleVariantColour", "Warm White");
assert.equal(document.getElementById("saleUnitPrice").value, "110");
assert.match(document.getElementById("saleStockHint").textContent,
  /4W · Clear · Warm White — Stock: 4/);
setField("saleQuantity", 1);
document.getElementById("addSaleLineBtn").click();
assert.equal(lines().length, 5, "glass + glow line staged");
assert.match(lines()[4].textContent, /Glass Bulb 4W · Clear · Warm White/);

// 11. Recording sends the resolved indices, not the hidden dropdown position.
posts.length = 0;
setField("saleQuantity", "");
document.getElementById("recordSaleForm").dispatchEvent(
  new window.Event("submit", { bubbles: true, cancelable: true }),
);
await settle(120);
assert.equal(posts.length, 5, "one POST per staged line");
assert.deepEqual(posts.map((post) => [post.productId, post.variantIndex]), [
  ["p1", 1],
  ["p1", 0],
  ["p2", 0],
  ["p6", 2],
  ["p7", 0],
], "each sale stores the exact variant index resolved from rating + glass + glow");
assert.ok(posts.every((post) =>
  [125, 120, 60, 90, 110].includes(post.unitPrice)),
  "each sale stores its variant price");

// 12. The owner account renders the same pickers — this page has no role split.
window.localStorage.setItem("currentUser", JSON.stringify({
  name: "Admin",
  role: "admin",
  expiresAt: tokenExpiry,
}));
await loadSales();
pickProduct("p4");
assert.ok(!hidden("saleVariantRatingGroup"), "admin sees the rating picker too");
assert.deepEqual(optionLabels("saleVariantSelect"), ["32A"]);
assert.ok(!hidden("saleVariantColourGroup"), "admin sees the colour picker too");

console.log("OK — sales variants: rating/glass/glow pickers, stock, exact indices, admin and staff");
