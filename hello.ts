import { attachDatabasePool } from "@neon/functions";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

attachDatabasePool(pool);

const tableNames = {
  users: "users",
  products: "products",
  categories: "categories",
  stockAdjustments: "stock_adjustments",
  activityLog: "activity_log",
  sales: "sales",
};

const fieldMap = {
  users: ["name", "email", "password", "role"],
  products: ["name", "sku", "category_id", "price", "quantity", "reorder_level", "unit", "image_url", "variants"],
  categories: ["name", "description", "parent_id", "image_url"],
  stockAdjustments: ["product_id", "product_name", "type", "quantity", "reason", "date", "old_quantity", "new_quantity"],
  activityLog: ["action", "details", "user", "timestamp"],
  sales: ["product_id", "product_name", "variant_index", "quantity", "unit_price", "total", "sold_at"],
};

const toCamel = (row: Record<string, unknown>) => ({
  ...row,
  categoryId: row.category_id,
  parentId: row.parent_id,
  reorderLevel: row.reorder_level,
  imageUrl: row.image_url,
  productId: row.product_id,
  productName: row.product_name,
  oldQuantity: row.old_quantity,
  newQuantity: row.new_quantity,
  unitPrice: row.unit_price,
  soldAt: row.sold_at,
  variantIndex: row.variant_index,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const PASSWORD_PREFIX = "scrypt";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5500",
  "http://localhost:3000",
  "http://127.0.0.1:5500",
  "http://127.0.0.1:3000",
  "https://abdulrahmansiraj.github.io",
  "https://pontypoolstock.github.io",
  "https://pontypool.loca.lt",
];

function isOriginAllowed(origin: string | null) {
  if (!origin) return false;
  const normalized = origin.toLowerCase().replace(/\/$/, "");
  if (DEFAULT_ALLOWED_ORIGINS.some((allowed) => allowed.toLowerCase() === normalized)) {
    return true;
  }
  const extra = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/\/$/, ""))
    .filter(Boolean);
  return extra.includes(normalized);
}

function getCorsHeaders(origin: string | null) {
  const allowed = isOriginAllowed(origin);
  return {
    ...(allowed ? { "Access-Control-Allow-Origin": origin! } : {}),
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
}

function authSecret() {
  return (
    process.env.AUTH_SECRET ||
    createHash("sha256")
      .update(`${process.env.DATABASE_URL || "pontypool-fallback"}:pontypool-auth`)
      .digest("hex")
  );
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${PASSWORD_PREFIX}$${salt}$${derived}`;
}

function passwordMatches(password: string, stored: string) {
  const value = String(stored || "");
  if (!value.startsWith(`${PASSWORD_PREFIX}$`)) {
    return value === password;
  }
  const parts = value.split("$");
  if (parts.length !== 3) return false;
  const [, salt, expected] = parts;
  const derived = scryptSync(password, salt, 64).toString("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const derivedBuffer = Buffer.from(derived, "hex");
  return expectedBuffer.length === derivedBuffer.length && timingSafeEqual(expectedBuffer, derivedBuffer);
}

function signToken(userId: string | number) {
  const payload = Buffer.from(
    JSON.stringify({ u: String(userId), e: Date.now() + TOKEN_TTL_MS }),
  ).toString("base64url");
  const signature = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function tokenIsValid(token: string) {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return false;

  const expected = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (expBuf.length !== sigBuf.length || !timingSafeEqual(expBuf, sigBuf)) return false;

  try {
    const { e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return Number(e) > Date.now();
  } catch {
    return false;
  }
}

function getRoute(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  return { resource: parts[0] || "", id: parts[1] || "" };
}

function getFields(resource: keyof typeof fieldMap, body: Record<string, unknown>) {
  return fieldMap[resource].filter((field) => body[field] !== undefined);
}

function normalizeBody(body: Record<string, unknown>) {
  const aliases = {
    categoryId: "category_id",
    parentId: "parent_id",
    reorderLevel: "reorder_level",
    imageUrl: "image_url",
    productId: "product_id",
    productName: "product_name",
    oldQuantity: "old_quantity",
    newQuantity: "new_quantity",
    unitPrice: "unit_price",
    soldAt: "sold_at",
    variantIndex: "variant_index",
  };
  const normalized = Object.fromEntries(
    Object.entries(body).map(([key, value]) => [aliases[key as keyof typeof aliases] || key, value]),
  );
  //^ empty optional fields become NULL / 0 so NOT NULL + CHECK columns accept them
  if (normalized.sku === "") normalized.sku = null;
  if (normalized.category_id === "") normalized.category_id = null;
  if (normalized.parent_id === "") normalized.parent_id = null;
  if (normalized.price === "") normalized.price = 0;
  if (normalized.quantity === "") normalized.quantity = 0;
  if (normalized.reorder_level === "") normalized.reorder_level = 0;
  //^ numeric columns become real numbers so garbage input can't reach the DB
  const numericFields = [
    "price",
    "quantity",
    "reorder_level",
    "old_quantity",
    "new_quantity",
    "unit_price",
    "total",
  ];
  for (const field of numericFields) {
    const value = normalized[field];
    if (value === undefined || value === null || value === "") continue;
    const num = Number(value);
    normalized[field] = Number.isFinite(num) ? Math.max(0, num) : 0;
  }
  return normalized;
}

function sqlColumn(field: string) {
  return field === "user" ? '"user"' : field;
}

function getDatabaseValues(fields: string[], body: Record<string, unknown>) {
  //^ the variants column is jsonb, so arrays/objects must be serialised to JSON text
  return fields.map((field) => {
    const value = body[field];
    if (field !== "variants" || typeof value === "string") return value;
    return JSON.stringify(value);
  });
}

async function readBody(request: Request) {
  return await request.json() as Record<string, unknown>;
}

//* Best-effort login throttling (per instance, in-memory)
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function loginAttemptKey(request: Request) {
  const forwarded = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function registerLoginAttempt(request: Request) {
  const key = loginAttemptKey(request);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt <= now) {
    if (loginAttempts.size > 1000) loginAttempts.clear();
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) return false;
  entry.count += 1;
  return true;
}

function clearLoginAttempts(request: Request) {
  loginAttempts.delete(loginAttemptKey(request));
}

//* Sales are written through a single transaction so a sale can never exist
//* without its stock deduction (and vice versa). Editing and deleting a sale go
//* through their own transactions that reverse the original stock movement in
//* the same breath, so history and stock can never drift apart.
async function recordSale(body: Record<string, unknown>) {
  const productId = String(body.productId ?? "").trim();
  const quantity = Number(body.quantity);
  const unitPrice = Number(body.unitPrice);
  const variantRaw = body.variantIndex;

  if (!productId) return { error: "Product is required" };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a whole number greater than 0" };
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { error: "Selling price must be 0 or more" };
  }

  const total = Math.round(unitPrice * quantity * 100) / 100;
  const soldAt = new Date();
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    //* Lock the product row so two simultaneous sales cannot oversell it
    const productResult = await client.query(
      "SELECT * FROM products WHERE id = $1 FOR UPDATE",
      [productId],
    );
    const product = productResult.rows[0];
    if (!product) {
      await client.query("ROLLBACK");
      return { error: "Product not found" };
    }

    const variants: Record<string, unknown>[] = Array.isArray(product.variants)
      ? product.variants
      : [];
    let productName = String(product.name || "");
    let nextQuantity = Number(product.quantity) || 0;
    let nextVariants: Record<string, unknown>[] | null = null;

    if (variants.length) {
      const index = Number.parseInt(String(variantRaw ?? ""), 10);
      const variant = Number.isNaN(index) ? undefined : variants[index];
      if (!variant) {
        await client.query("ROLLBACK");
        return { error: "Select the rating being sold" };
      }
      const available = Number(variant.quantity) || 0;
      if (available < quantity) {
        await client.query("ROLLBACK");
        return { error: `Only ${available} in stock for this rating` };
      }

      nextVariants = variants.map((item, position) => (
        position === index ? { ...item, quantity: available - quantity } : item
      ));
      nextQuantity = nextVariants.reduce(
        (sum, item) => sum + (Number(item.quantity) || 0),
        0,
      );
      productName = saleVariantName(productName, variant);
    } else {
      const available = nextQuantity;
      if (available < quantity) {
        await client.query("ROLLBACK");
        return { error: `Only ${available} in stock` };
      }
      nextQuantity = available - quantity;
    }

    await client.query(
      nextVariants
        ? "UPDATE products SET quantity = $1, variants = $2, updated_at = NOW() WHERE id = $3"
        : "UPDATE products SET quantity = $1, updated_at = NOW() WHERE id = $2",
      nextVariants
        ? [nextQuantity, JSON.stringify(nextVariants), productId]
        : [nextQuantity, productId],
    );

    //* variant_index is stored so a later edit knows which rating to give back
    const saleResult = await client.query(
      `INSERT INTO sales (product_id, product_name, variant_index, quantity, unit_price, total, sold_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        productId,
        productName,
        Number.isNaN(Number.parseInt(String(variantRaw ?? ""), 10))
          ? null
          : Number.parseInt(String(variantRaw), 10),
        quantity,
        unitPrice,
        total,
        soldAt,
      ],
    );

    await client.query(
      `INSERT INTO activity_log (action, details, "user", timestamp) VALUES ($1, $2, $3, $4)`,
      [
        "SALE_RECORDED",
        `Sale recorded: ${quantity} × ${productName} — KSh ${total}`,
        "admin",
        soldAt,
      ],
    );

    await client.query("COMMIT");
    return { sale: toCamel(saleResult.rows[0]) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

//* Edit a recorded sale: put the original stock back, then take the corrected
//* amount out, all inside one transaction. If anything fails, nothing changes.
//* This is what keeps "sales revenue" and "stock on hand" telling one story.
async function updateSale(
  id: string,
  body: Record<string, unknown>,
): Promise<{ error?: string; status?: number; sale?: Record<string, unknown> }> {
  const quantity = Number(body.quantity);
  const unitPrice = Number(body.unitPrice);
  const productId = String(body.productId ?? "").trim();
  const variantRaw = body.variantIndex;

  if (!productId) return { error: "Product is required" };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { error: "Quantity must be a whole number greater than 0" };
  }
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { error: "Selling price must be 0 or more" };
  }

  const total = Math.round(unitPrice * quantity * 100) / 100;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    //* Lock the sale row so two concurrent edits of the same sale serialise
    const saleResult = await client.query(
      "SELECT * FROM sales WHERE id = $1 FOR UPDATE",
      [id],
    );
    const sale = saleResult.rows[0];
    if (!sale) {
      await client.query("ROLLBACK");
      return { error: "Not found", status: 404 };
    }

    const oldQuantity = Number(sale.quantity) || 0;
    const oldUnitPrice = Number(sale.unit_price) || 0;
    const soldAt = sale.sold_at ? new Date(sale.sold_at) : new Date();

    //* 1. Give the original stock back (to the product and rating it left)
    const oldVariantIndex = await resolveOriginalVariantIndex(client, sale);
    const giveBack = await applyStockDelta(
      client, sale.product_id, oldVariantIndex, oldQuantity, true,
    );
    if (giveBack.error) {
      await client.query("ROLLBACK");
      return giveBack;
    }

    //* 2. Take the corrected amount out
    const newVariantIndex = variantRaw === null || variantRaw === undefined || variantRaw === ""
      ? null
      : Number(variantRaw);
    const take = await applyStockDelta(client, productId, newVariantIndex, -quantity, false);
    if (take.error) {
      //* Undo the give-back so a refused edit leaves stock untouched
      await client.query("ROLLBACK");
      return take;
    }

    //* 3. Rewrite the sale row itself
    const updated = await client.query(
      `UPDATE sales
         SET product_id = $1, product_name = $2, variant_index = $3,
             quantity = $4, unit_price = $5, total = $6, sold_at = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [
        productId,
        take.productName,
        newVariantIndex,
        quantity,
        unitPrice,
        total,
        soldAt,
        id,
      ],
    );

    //* 4. Leave a clear trail of what changed
    const before = `${oldQuantity} x ${sale.product_name} @ KSh ${oldUnitPrice}`;
    const after = `${quantity} x ${take.productName} @ KSh ${unitPrice}`;
    await client.query(
      `INSERT INTO activity_log (action, details, "user", timestamp) VALUES ($1, $2, $3, $4)`,
      [
        "SALE_EDITED",
        `Sale corrected: ${before} -> ${after}`,
        "admin",
        new Date(),
      ],
    );

    await client.query("COMMIT");
    return { sale: toCamel(updated.rows[0]) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

//* Sales recorded before variant_index existed have no stored rating. Recover it
//* by matching the saved product_name against the product's rating rows, so an
//* old sale can still be edited and its stock returned to the right rating.
async function resolveOriginalVariantIndex(
  client: { query: (sql: string, values?: unknown[]) => Promise<any> },
  sale: Record<string, unknown>,
) {
  const stored = Number.parseInt(String(sale.variant_index ?? ""), 10);
  if (!Number.isNaN(stored)) return stored;

  const result = await client.query(
    "SELECT name, variants FROM products WHERE id = $1",
    [sale.product_id],
  );
  const product = result.rows[0];
  const variants: Record<string, unknown>[] = Array.isArray(product?.variants)
    ? product.variants
    : [];
  if (!variants.length) return null;

  const savedName = String(sale.product_name || "");
  const found = variants.findIndex((variant) => {
    const label = String(variant.label ?? "").trim();
    const colour = String(variant.colour ?? "").trim();
    if (label && savedName.includes(label)) return true;
    return Boolean(colour && savedName.includes(colour));
  });
  return found >= 0 ? found : null;
}

//* Move one product's stock by `delta` (positive = add, negative = remove),
//* honouring the rating rows when the product has them.
async function applyStockDelta(
  client: { query: (sql: string, values?: unknown[]) => Promise<any> },
  productId: unknown,
  variantIndex: unknown,
  delta: number,
  isGiveBack: boolean,
): Promise<{ error?: string; productName?: string }> {
  const result = await client.query(
    "SELECT * FROM products WHERE id = $1 FOR UPDATE",
    [productId],
  );
  const product = result.rows[0];
  if (!product) {
    return {
      error: isGiveBack
        ? "The product for this sale no longer exists, so its stock cannot be adjusted."
        : "Product not found",
    };
  }

  const variants: Record<string, unknown>[] = Array.isArray(product.variants)
    ? product.variants
    : [];
  let productName = String(product.name || "");
  let nextQuantity = Number(product.quantity) || 0;
  let nextVariants: Record<string, unknown>[] | null = null;

  if (variants.length) {
    const index = Number.parseInt(String(variantIndex ?? ""), 10);
    const variant = Number.isNaN(index) ? undefined : variants[index];
    if (!variant) {
      return {
        error: isGiveBack
          ? "The rating sold for this sale no longer exists, so its stock cannot be adjusted."
          : "Select the rating being sold",
      };
    }
    const current = Number(variant.quantity) || 0;
    const updated = current + delta;
    if (updated < 0) {
      return { error: `Only ${current} in stock for this rating` };
    }
    nextVariants = variants.map((item, position) => (
      position === index ? { ...item, quantity: updated } : item
    ));
    nextQuantity = nextVariants.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0),
      0,
    );
    productName = saleVariantName(productName, variant);
  } else {
    const current = nextQuantity;
    const updated = current + delta;
    if (updated < 0) {
      return { error: `Only ${current} in stock` };
    }
    nextQuantity = updated;
  }

  await client.query(
    nextVariants
      ? "UPDATE products SET quantity = $1, variants = $2, updated_at = NOW() WHERE id = $3"
      : "UPDATE products SET quantity = $1, updated_at = NOW() WHERE id = $2",
    nextVariants
      ? [nextQuantity, JSON.stringify(nextVariants), product.id]
      : [nextQuantity, product.id],
  );

  return { productName };
}

//* Voiding a sale is the exact mirror of recording one: the stock it consumed
//* goes back to the same rating, the row is removed, and both happen in one
//* transaction. A partial failure would leave revenue and stock on hand
//* disagreeing, so everything here either lands together or not at all.
async function deleteSale(
  id: string,
): Promise<{ error?: string; status?: number; deleted?: boolean; id?: number }> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    //* Lock the sale row so two concurrent deletes of the same sale serialise
    const saleResult = await client.query(
      "SELECT * FROM sales WHERE id = $1 FOR UPDATE",
      [id],
    );
    const sale = saleResult.rows[0];
    if (!sale) {
      await client.query("ROLLBACK");
      return { error: "Not found", status: 404 };
    }

    const quantity = Number(sale.quantity) || 0;
    const total = Number(sale.total) || 0;
    const soldAt = sale.sold_at ? new Date(sale.sold_at) : new Date();

    //* products.product_id is ON DELETE SET NULL, so a sale can outlive its
    //* product. There is then no stock left to return the units to, so the
    //* delete still goes ahead rather than being blocked forever.
    let productName = String(sale.product_name || "Product");
    if (sale.product_id) {
      const variantIndex = await resolveOriginalVariantIndex(client, sale);
      const giveBack = await applyStockDelta(
        client, sale.product_id, variantIndex, quantity, true,
      );
      if (giveBack.error) {
        await client.query("ROLLBACK");
        return giveBack;
      }
      if (giveBack.productName) productName = giveBack.productName;
    }

    await client.query("DELETE FROM sales WHERE id = $1", [id]);

    await client.query(
      `INSERT INTO activity_log (action, details, "user", timestamp) VALUES ($1, $2, $3, $4)`,
      [
        "SALE_DELETED",
        `Sale deleted: ${quantity} × ${productName} — KSh ${total} (stock returned)`,
        "admin",
        soldAt.toISOString(),
      ],
    );

    await client.query("COMMIT");
    return { deleted: true, id: Number(id) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function saleVariantName(productName: string, variant: Record<string, unknown>) {
  const ampsRaw = variant.amps;
  const amps =
    ampsRaw !== "" && ampsRaw !== null && ampsRaw !== undefined && Number.isFinite(Number(ampsRaw))
      ? `${Number(ampsRaw)}A`
      : "";
  const suffix = [variant.label, variant.colour, amps]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
  return suffix ? `${productName} ${suffix}` : productName;
}

export default async function api(request: Request): Promise<Response> {
  const origin = request.headers.get("Origin");
  const headers = getCorsHeaders(origin);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  const { resource, id } = getRoute(new URL(request.url).pathname);

  try {
    if (resource === "auth" && id === "login" && request.method === "POST") {
      const body = await readBody(request);
      const email = String(body.email || "").trim();
      const password = String(body.password || "");

      if (!registerLoginAttempt(request)) {
        return json({ error: "Too many login attempts. Try again in a few minutes." }, 429);
      }

      const result = await pool.query(
        `SELECT id, name, email, role, password FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email],
      );
      const user = result.rows[0];
      if (!user || !passwordMatches(password, String(user.password))) {
        return json({ error: "Invalid email or password" }, 401);
      }

      //* Upgrade plain-text password to scrypt hash on first successful login
      if (!String(user.password).startsWith(`${PASSWORD_PREFIX}$`)) {
        await pool.query(
          `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
          [hashPassword(password), user.id],
        );
      }

      clearLoginAttempts(request);
      const token = signToken(user.id);
      return json({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        token,
      });
    }

    //* All other endpoints require a valid session token
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!tokenIsValid(token)) {
      return json({ error: "Authentication required" }, 401);
    }

    if (!Object.prototype.hasOwnProperty.call(tableNames, resource)) return json({ error: "Not found" }, 404);
    const table = tableNames[resource as keyof typeof tableNames];
    const typedResource = resource as keyof typeof fieldMap;

    if (request.method === "GET") {
      // Optional ?fields=id,name,price projection to avoid transferring megabytes of inline images on list views
      const requestedFields = new URL(request.url).searchParams.get("fields");
      let selectClause = "*";
      if (requestedFields) {
        // Map camelCase to snake_case and sanitize against allowable resource columns
        const allowedCols = new Set([...fieldMap[typedResource], "id", "created_at", "updated_at"]);
        const camelToSnake: Record<string, string> = {
          categoryId: "category_id",
          parentId: "parent_id",
          reorderLevel: "reorder_level",
          imageUrl: "image_url",
          productId: "product_id",
          productName: "product_name",
          oldQuantity: "old_quantity",
          newQuantity: "new_quantity",
          unitPrice: "unit_price",
          soldAt: "sold_at",
          createdAt: "created_at",
          updatedAt: "updated_at",
        };
        const validCols = requestedFields
          .split(",")
          .map((f) => f.trim())
          .map((f) => camelToSnake[f] || f)
          .filter((col) => allowedCols.has(col))
          .map(sqlColumn);

        // Always ensure 'id' is included in the projection
        if (validCols.length > 0) {
          if (!validCols.includes("id")) validCols.unshift("id");
          selectClause = validCols.join(", ");
        }
      }

      const result = id
        ? await pool.query(`SELECT ${selectClause} FROM ${table} WHERE id = $1`, [id])
        : await pool.query(`SELECT ${selectClause} FROM ${table} ORDER BY updated_at DESC, id DESC`);
      if (id && !result.rows[0]) return json({ error: "Not found" }, 404);
      return json(id ? toCamel(result.rows[0]) : result.rows.map(toCamel));
    }

    //* Recorded sales go through the transaction above, not the generic insert
    if (request.method === "POST" && typedResource === "sales") {
      const result = await recordSale(await readBody(request));
      if (result.error) return json({ error: result.error }, 400);
      return json(result.sale, 201);
    }

    //* Editing a sale reverses the old stock movement and applies the new one in
    //* one transaction, so revenue and stock can never disagree. Deleting voids
    //* the sale the same way: stock goes back and the row goes, together.
    if (request.method === "PUT" && id && typedResource === "sales") {
      const result = await updateSale(id, await readBody(request));
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result.sale);
    }
    if (request.method === "DELETE" && id && typedResource === "sales") {
      const result = await deleteSale(id);
      if (result.error) return json({ error: result.error }, result.status || 400);
      return json(result);
    }

    if (request.method === "POST") {
      const body = normalizeBody(await readBody(request));
      // Keep older databases compatible after the category description field was removed.
      if (typedResource === "categories" && body.description === undefined) {
        body.description = "";
      }
      if (typedResource === "stockAdjustments" && body.reason === undefined) {
        body.reason = "Manual adjustment";
      }
      const fields = getFields(typedResource, body);
      if (!fields.length) return json({ error: "No supported fields supplied" }, 400);
      const columns = fields.map(sqlColumn).join(", ");
      const placeholders = fields.map((_, index) => `$${index + 1}`).join(", ");
      const result = await pool.query(
        `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`,
        getDatabaseValues(fields, body),
      );
      return json(toCamel(result.rows[0]), 201);
    }

    if (request.method === "PUT" && id) {
      const body = normalizeBody(await readBody(request));
      const fields = getFields(typedResource, body);
      if (!fields.length) return json({ error: "No supported fields supplied" }, 400);
      const assignments = fields.map((field, index) => `${sqlColumn(field)} = $${index + 1}`).join(", ");
      const result = await pool.query(
        `UPDATE ${table} SET ${assignments}, updated_at = NOW() WHERE id = $${fields.length + 1} RETURNING *`,
        [...getDatabaseValues(fields, body), id],
      );
      if (!result.rows[0]) return json({ error: "Not found" }, 404);
      return json(toCamel(result.rows[0]));
    }

    if (request.method === "DELETE" && id) {
      const result = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
      if (!result.rows[0]) return json({ error: "Not found" }, 404);
      return new Response(null, { status: 204, headers });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("API error", error);
    //^ the raw database reason rides along in `detail` so a 500 can be fixed
    //^ from the message instead of guesswork
    const detail = error instanceof Error ? error.message : String(error);
    return json({ error: "Database request failed", detail }, 500);
  }
}
