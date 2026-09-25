//* Reports row counts for the linked Neon branch so you can confirm the app is talking to the right database.
//^ Usage: npm run db:check   (reads DATABASE_URL from .env.local, .env, or the shell environment)
import fs from "node:fs";
import pg from "pg";

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

const connectionString = readConnectionString();
if (!connectionString) {
  console.error("DATABASE_URL not found. Run `neon link` or `neon env pull` first.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: false } });

try {
  const host = new URL(connectionString).host;
  const counts = await pool.query(`
    SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM products) AS products,
      (SELECT count(*) FROM categories) AS categories,
      (SELECT count(*) FROM stock_adjustments) AS adjustments,
      (SELECT count(*) FROM activity_log) AS activity,
      (SELECT count(*) FROM sales) AS sales
  `);

  console.log(`Connected to ${host}`);
  console.log(counts.rows[0]);
} catch (error) {
  console.error("Database request failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
