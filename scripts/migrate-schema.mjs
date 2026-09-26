//* Brings the linked Neon branch in line with schema.sql.
//^ Usage: npm run db:schema   (reads DATABASE_URL from .env.local, .env, or the shell)
//*
//* schema.sql is written so it can be re-run, but `CREATE TABLE IF NOT EXISTS`
//* only creates a missing table — it never adds a column to a table that already
//* exists. A live table drifting one column behind the file is exactly what makes
//* the API answer 500 "Database request failed", so this script also issues
//* `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for every column schema.sql declares.
import fs from "node:fs";
import pg from "pg";

const SCHEMA_FILE = "schema.sql";
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

//* schema.sql without its comments
function readSchema() {
  return fs
    .readFileSync(SCHEMA_FILE, "utf8")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

//* Split a script on the semicolons that sit outside parentheses and quotes
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let depth = 0;
  let quote = "";

  for (const char of sql) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === ";" && depth === 0) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

//* Split a CREATE TABLE body into its column definitions
function splitColumns(body) {
  const columns = [];
  let current = "";
  let depth = 0;

  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      columns.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) columns.push(current.trim());
  return columns;
}

const NOT_A_COLUMN = ["PRIMARY", "UNIQUE", "FOREIGN", "CHECK", "CONSTRAINT", "EXCLUDE"];

function parseCreateTable(statement) {
  const match = statement.match(
    /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[\w.]+"?)\s*\(([\s\S]*)\)$/i,
  );
  if (!match) return null;

  return {
    table: match[1].replace(/"/g, ""),
    columns: splitColumns(match[2]).filter(
      (definition) => !NOT_A_COLUMN.includes(definition.split(/\s+/)[0].toUpperCase()),
    ),
  };
}

const creates = [];
const indexes = [];
const alters = [];
const ignored = [];

for (const statement of splitStatements(readSchema())) {
  if (/^CREATE\s+TABLE/i.test(statement)) {
    creates.push(statement);
    const parsed = parseCreateTable(statement);
    if (!parsed) {
      console.warn("Could not read the columns of:", statement.replace(/\s+/g, " ").slice(0, 80));
      continue;
    }
    for (const definition of parsed.columns) {
      alters.push(`ALTER TABLE ${parsed.table} ADD COLUMN IF NOT EXISTS ${definition}`);
    }
  } else if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(statement)) {
    indexes.push(statement);
  } else {
    ignored.push(statement.split(/\s+/).slice(0, 2).join(" "));
  }
}

const connectionString = readConnectionString();
if (!connectionString) {
  console.error("DATABASE_URL not found. Run `neon link` or `neon env pull` first.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString, max: 2, ssl: { rejectUnauthorized: false } });

async function run(statement) {
  try {
    await pool.query(statement);
  } catch (error) {
    console.error("FAILED:", statement.replace(/\s+/g, " ").slice(0, 120));
    console.error(" ->", error.message);
    process.exitCode = 1;
  }
}

try {
  const host = new URL(connectionString).host;
  console.log(
    `Applying ${SCHEMA_FILE} to ${host}: ${creates.length} tables, `
    + `${alters.length} column checks, ${indexes.length} indexes`,
  );

  for (const statement of creates) await run(statement);
  for (const statement of alters) await run(statement);
  for (const statement of indexes) await run(statement);

  if (ignored.length) {
    console.log("Not schema, so it was left alone:", ignored.join(", "));
  }

  for (const statement of creates) {
    const parsed = parseCreateTable(statement);
    if (!parsed) continue;

    const result = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [parsed.table],
    );
    const live = result.rows.map((row) => row.column_name);
    const expected = parsed.columns.map((definition) =>
      definition.split(/\s+/)[0].replace(/"/g, ""));
    const missing = expected.filter((name) => !live.includes(name));

    if (missing.length) {
      console.error(`${parsed.table}: still missing ${missing.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log(`${parsed.table}: up to date`);
    }
  }
} catch (error) {
  console.error("Schema sync failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
