//* Creates (or repairs) the staff account on the linked Neon branch.
//^ Usage: npm run db:seed-staff   (reads DATABASE_URL from .env.local, .env, or the shell)
//*
//* The staff account signs in with staff@pontypool.com / staff123 and gets the
//* staff side of the app only (Products, Categories, Record Sale — see
//* js/utils/role.js). The password is stored in the same scrypt$ format
//* hello.ts verifies; re-running this script resets the password to staff123
//* and keeps the role pinned to 'staff'.
import fs from "node:fs";
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const EMAIL = "staff@pontypool.com";
const NAME = "Staff User";
const ROLE = "staff";
const PASSWORD = "staff123";

const ENV_FILES = [".env.local", ".env"];

function readConnectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    const line = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .find((entry) => entry.startsWith("DATABASE_URL="));
    if (line) return line.split("=").slice(1).join("=").replace(/^"|"$/g, "").trim();
  }

  return "";
}

//* Same format as hashPassword() in hello.ts: scrypt$<salt-hex>$<hash-hex>
function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

const connectionString = readConnectionString();
if (!connectionString) {
  console.error("DATABASE_URL not found. Run `neon link` or `neon env pull` first.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: false } });

try {
  const host = new URL(connectionString).host;
  const hash = hashPassword(PASSWORD);

  const result = await pool.query(
    `INSERT INTO users (name, email, password, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email)
     DO UPDATE SET name = EXCLUDED.name, password = EXCLUDED.password,
                   role = EXCLUDED.role, updated_at = NOW()
     RETURNING id, name, email, role`,
    [NAME, EMAIL, hash, ROLE],
  );

  console.log(`Connected to ${host}`);
  console.log(`Staff account ready: ${result.rows[0].email} (role ${result.rows[0].role}, id ${result.rows[0].id})`);
  console.log(`Sign in with ${EMAIL} / ${PASSWORD}`);
} catch (error) {
  console.error("Seed failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}