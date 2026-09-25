//* Copies the offline dataset (data/db.json) into the Neon production branch.
//^ Preview first: `node scripts/migrate-db-json-to-neon.mjs`
//^ Write it:     `node scripts/migrate-db-json-to-neon.mjs --apply`
import fs from "node:fs";
import pg from "pg";

const APPLY = process.argv.includes("--apply");
const SOURCE = "data/db.json";

//* The Neon schema does not store these, so they are reported instead of silently dropped
const UNSUPPORTED_FIELDS = ["variants", "parentId"];

function readConnectionString() {
  const line = fs
    .readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL is missing from .env.local");
  return line.split("=").slice(1).join("=").replace(/^"|"$/g, "").trim();
}

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toTimestamp = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

const textOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

const db = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
const sourceCategories = Array.isArray(db.categories) ? db.categories : [];
const sourceProducts = Array.isArray(db.products) ? db.products : [];
const sourceAdjustments = Array.isArray(db.stockAdjustments) ? db.stockAdjustments : [];
const sourceActivity = Array.isArray(db.activityLog) ? db.activityLog : [];

console.log(`Source ${SOURCE}: ${sourceCategories.length} categories, ${sourceProducts.length} products, ` +
  `${sourceAdjustments.length} adjustments, ${sourceActivity.length} activity rows`);

const skipped = {};
for (const field of UNSUPPORTED_FIELDS) {
  const owners = [...sourceCategories, ...sourceProducts].filter(
    (row) => row[field] !== undefined && row[field] !== "" && !(Array.isArray(row[field]) && !row[field].length),
  );
  if (owners.length) skipped[field] = owners.length;
}
if (Object.keys(skipped).length) {
  console.log("Not supported by the Neon schema, so it will not be copied:", skipped);
}

//* Empty SKUs have to become NULL: the column is UNIQUE and only NULL may repeat
const emptySkus = sourceProducts.filter((row) => !String(row.sku ?? "").trim()).length;
if (emptySkus) console.log(`${emptySkus} product(s) have an empty SKU and will be stored as NULL.`);

const pool = new pg.Pool({ connectionString: readConnectionString(), max: 2, ssl: { rejectUnauthorized: false } });
const client = await pool.connect();

try {
  await client.query("BEGIN");

  const before = await client.query(`
    SELECT
      (SELECT count(*) FROM products) AS products,
      (SELECT count(*) FROM categories) AS categories,
      (SELECT count(*) FROM stock_adjustments) AS adjustments,
      (SELECT count(*) FROM activity_log) AS activity,
      (SELECT count(*) FROM sales) AS sales
  `);
  console.log("Neon before:", before.rows[0]);
  const replaced = await client.query("SELECT name FROM products ORDER BY id");
  console.log("Replacing (users are kept):", replaced.rows.map((row) => row.name).join(", ") || "no products");

  await client.query("DELETE FROM activity_log");
  await client.query("DELETE FROM stock_adjustments");
  await client.query("DELETE FROM sales");
  await client.query("DELETE FROM products");
  await client.query("DELETE FROM categories");
  for (const sequence of ["categories_id_seq", "products_id_seq", "stock_adjustments_id_seq", "activity_log_id_seq"]) {
    await client.query(`ALTER SEQUENCE ${sequence} RESTART WITH 1`);
  }

  const categoryIds = new Map();
  for (const category of sourceCategories) {
    const result = await client.query(
      `INSERT INTO categories (name, description, image_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        String(category.name).trim(),
        String(category.description ?? ""),
        textOrNull(category.imageUrl),
        toTimestamp(category.createdAt),
        toTimestamp(category.updatedAt ?? category.createdAt),
      ],
    );
    categoryIds.set(String(category.id), result.rows[0].id);
  }

  const productIds = new Map();
  let unmappedCategories = 0;
  for (const product of sourceProducts) {
    const mappedCategory = categoryIds.get(String(product.categoryId));
    if (!mappedCategory) unmappedCategories += 1;

    const result = await client.query(
      `INSERT INTO products (name, sku, category_id, price, quantity, reorder_level, unit, image_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        String(product.name).trim(),
        textOrNull(product.sku),
        mappedCategory ?? null,
        toNumber(product.price),
        Math.trunc(toNumber(product.quantity)),
        Math.trunc(toNumber(product.reorderLevel)),
        String(product.unit || "box").trim(),
        textOrNull(product.imageUrl),
        toTimestamp(product.createdAt),
        toTimestamp(product.updatedAt ?? product.createdAt),
      ],
    );
    productIds.set(String(product.id), result.rows[0].id);
  }
  if (unmappedCategories) {
    console.log(`${unmappedCategories} product(s) reference a missing category and were saved without one.`);
  }

  for (const adjustment of sourceAdjustments) {
    await client.query(
      `INSERT INTO stock_adjustments (product_id, product_name, type, quantity, reason, date, old_quantity, new_quantity, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        productIds.get(String(adjustment.productId)) ?? null,
        String(adjustment.productName).trim(),
        String(adjustment.type).trim(),
        Math.trunc(toNumber(adjustment.quantity)),
        String(adjustment.reason || "Manual adjustment"),
        toTimestamp(adjustment.date),
        Math.trunc(toNumber(adjustment.oldQuantity)),
        Math.trunc(toNumber(adjustment.newQuantity)),
        toTimestamp(adjustment.createdAt ?? adjustment.date),
        toTimestamp(adjustment.updatedAt ?? adjustment.date),
      ],
    );
  }

  for (const entry of sourceActivity) {
    await client.query(
      `INSERT INTO activity_log (action, details, "user", timestamp, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        String(entry.action).trim(),
        String(entry.details ?? "").trim(),
        String(entry.user || "admin").trim(),
        toTimestamp(entry.timestamp),
        toTimestamp(entry.createdAt ?? entry.timestamp),
        toTimestamp(entry.updatedAt ?? entry.timestamp),
      ],
    );
  }

  const after = await client.query(`
    SELECT
      (SELECT count(*) FROM products) AS products,
      (SELECT count(*) FROM categories) AS categories,
      (SELECT count(*) FROM stock_adjustments) AS adjustments,
      (SELECT count(*) FROM activity_log) AS activity,
      (SELECT count(*) FROM sales) AS sales,
      (SELECT count(*) FROM users) AS users
  `);
  console.log("Neon after:", after.rows[0]);

  if (APPLY) {
    await client.query("COMMIT");
    console.log("Committed to the Neon production branch.");
  } else {
    await client.query("ROLLBACK");
    console.log("Dry run only - nothing was written. Re-run with --apply to copy the data.");
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error("Migration failed, everything was rolled back:", error.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}