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
  categories: ["name", "description", "image_url"],
  stockAdjustments: ["product_id", "product_name", "type", "quantity", "reason", "date", "old_quantity", "new_quantity"],
  activityLog: ["action", "details", "user", "timestamp"],
  sales: ["product_id", "product_name", "quantity", "unit_price", "total", "sold_at"],
};

const toCamel = (row: Record<string, unknown>) => ({
  ...row,
  categoryId: row.category_id,
  reorderLevel: row.reorder_level,
  imageUrl: row.image_url,
  productId: row.product_id,
  productName: row.product_name,
  oldQuantity: row.old_quantity,
  newQuantity: row.new_quantity,
  unitPrice: row.unit_price,
  soldAt: row.sold_at,
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
    reorderLevel: "reorder_level",
    imageUrl: "image_url",
    productId: "product_id",
    productName: "product_name",
    oldQuantity: "old_quantity",
    newQuantity: "new_quantity",
    unitPrice: "unit_price",
    soldAt: "sold_at",
  };
  const normalized = Object.fromEntries(
    Object.entries(body).map(([key, value]) => [aliases[key as keyof typeof aliases] || key, value]),
  );
  if (normalized.sku === "") normalized.sku = null;
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

    if (!(resource in tableNames)) return json({ error: "Not found" }, 404);
    const table = tableNames[resource as keyof typeof tableNames];
    const typedResource = resource as keyof typeof fieldMap;

    if (request.method === "GET") {
      const result = id
        ? await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id])
        : await pool.query(`SELECT * FROM ${table} ORDER BY updated_at DESC, id DESC`);
      if (id && !result.rows[0]) return json({ error: "Not found" }, 404);
      return json(id ? toCamel(result.rows[0]) : result.rows.map(toCamel));
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
    return json({ error: "Database request failed" }, 500);
  }
}
