//* Pontypool Silent Print Agent
//* Runs on the till desktop and receives ESC-POS receipt data from the browser
//* via HTTP, then prints directly to the cable-connected thermal printer —
//* no browser print dialog, no Ctrl+P, no user confirmation.
//*
//* Usage:
//*   node scripts/print-agent.mjs
//*   // then configure the agent URL in the browser (see PRINTER_PORT below)
//*
//* Printer output targets (set PRINTER_TARGET env var):
//*   serial   -> serial port (PRINTER_PORT, e.g. COM3) — USB thermal printers often enumerate as a virtual COM port
//*   lpt1     -> parallel port LPT1 (legacy)
//*   file     -> write to ./print-queue/receipt-{id}.txt for manual testing (default if no target matches)
//*
//* Env vars:
//*   PRINTER_TARGET   serial | lpt1 | file   (default: file)
//*   PRINTER_PORT     COM port name, e.g. COM3  (required when target=serial)
//*   PRINT_AGENT_PORT HTTP listen port          (default: 5501)
//*   BRANCHES         comma-separated branch names (default: Ambala Road,Duruma Road)

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const TARGET = (process.env.PRINTER_TARGET || "file").toLowerCase();
const PORT = Number(process.env.PRINT_AGENT_PORT || 5501);
const SERIAL_PORT = process.env.PRINTER_PORT || "";
const BRANCHES = (process.env.BRANCHES || "Ambala Road,Duruma Road")
  .split(",")
  .map((b) => b.trim())
  .filter(Boolean);

const QUEUE_DIR = path.join(process.cwd(), "print-queue");
if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

// ── ESC-POS helpers ──────────────────────────────────────────────────────

// ESC @ : initialize printer
const ESC_INIT = Buffer.from([0x1b, 0x40]);
// ESC ! n : set print mode (n=0x08 double width, 0x10 double height, 0x18 both)
const ESC_MODE_DOUBLE = Buffer.from([0x1b, 0x21, 0x18]);
// ESC ! 0 : normal text
const ESC_MODE_NORMAL = Buffer.from([0x1b, 0x21, 0x00]);
// ESC a n : justification (0=left,1=center,2=right)
const escAlign = (n) => Buffer.from([0x1b, 0x61, n]);
// ESC d n : feed n lines
const escFeed = (n) => Buffer.from([0x1b, 0x64, n]);
// GS V 66 : full cut
const GS_CUT = Buffer.from([0x1d, 0x56, 0x66, 0x00]);

function escStr(text) {
  // CP437-ish: keep ascii, replace common smart quotes/dashes
  return Buffer.from(
    String(text)
      .replace(/\u2018|\u2019/g, "'")
      .replace(/\u201c|\u201d/g, '"')
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\u00a3/g, "P") // pound sign fallback
      .replace(/[^\x00-\x7f]/g, "?")
  );
}

function buildReceipt(branch, sale) {
  const lines = [];
  lines.push("========================================");
  lines.push(branch.toUpperCase());
  lines.push("Pontypool Stock Management");
  lines.push("----------------------------------------");
  lines.push(`Sale #    ${sale.id}`);
  lines.push(`Date      ${new Date(sale.soldAt || sale.createdAt || Date.now()).toLocaleDateString()}`);
  lines.push(`Time      ${new Date(sale.soldAt || sale.createdAt || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
  lines.push("----------------------------------------");
  lines.push(`${"ITEM".padEnd(18)}${"QTY".padStart(4)}${"PRICE".padStart(8)}${"TOTAL".padStart(8)}`);
  lines.push("----------------------------------------");

  // Single-line snapshot from the sale row (matches what renderReceiptHtml produces)
  const qty = Number(sale.quantity) || 0;
  const unitPrice = Number(sale.unitPrice) || 0;
  const lineTotal = Number(sale.total) || 0;
  const name = String(sale.productName || "Product").padEnd(18);
  lines.push(`${name}${" ".repeat(Math.max(0, 4 - String(qty).length))}${qty}${" ".repeat(Math.max(0, 8 - String(unitPrice).length))}${unitPrice}${" ".repeat(Math.max(0, 8 - String(lineTotal).length))}${lineTotal}`);

  lines.push("----------------------------------------");
  lines.push(`${"Subtotal".padEnd(28)}${lineTotal}`);
  lines.push(`${"Tax".padEnd(28)}${0}`);
  lines.push(`========================================`);
  lines.push(`${"TOTAL".padEnd(28)}${lineTotal}`);
  lines.push("----------------------------------------");
  lines.push("Thank you for your business");
  lines.push("Computer-generated receipt");
  lines.push("");
  lines.push("");

  const body = lines.join("\n");
  const chunks = [ESC_INIT, ESC_MODE_DOUBLE, escAlign(1), escStr(branch.toUpperCase()), ESC_MODE_NORMAL, escAlign(0), escFeed(1), escStr(body), escFeed(2), GS_CUT];
  return Buffer.concat(chunks);
}

// ── Printer output ───────────────────────────────────────────────────────

function printToSerial(data) {
  if (!SERIAL_PORT) throw new Error("PRINTER_PORT not set (e.g. COM3)");
  // Windows: copy /b data.bin COM3
  const tmp = path.join(QUEUE_DIR, `job-${Date.now()}.bin`);
  fs.writeFileSync(tmp, data);
  try {
    execSync(`copy /b "${tmp}" "${SERIAL_PORT}"`, { stdio: "pipe", windowsHide: true });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function printToLpt1(data) {
  const tmp = path.join(QUEUE_DIR, `job-${Date.now()}.bin`);
  fs.writeFileSync(tmp, data);
  try {
    execSync(`copy /b "${tmp}" LPT1`, { stdio: "pipe", windowsHide: true });
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

function printToFile(data, saleId) {
  const file = path.join(QUEUE_DIR, `receipt-${saleId || Date.now()}.txt`);
  fs.writeFileSync(file, data);
  return file;
}

function sendToPrinter(data, saleId) {
  if (TARGET === "serial") return printToSerial(data);
  if (TARGET === "lpt1") return printToLpt1(data);
  // default: file queue for manual/testing
  return printToFile(data, saleId);
}

// ── HTTP server ──────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/print") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const { branch, sale } = payload;
        if (!branch || !sale) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "branch and sale are required" }));
          return;
        }
        if (!BRANCHES.includes(branch)) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `unknown branch: ${branch}` }));
          return;
        }

        const escpos = buildReceipt(branch, sale);
        const result = sendToPrinter(escpos, sale.id);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          branch,
          saleId: sale.id,
          target: TARGET,
          ...(TARGET === "file" ? { queueFile: result } : {}),
        }));
      } catch (err) {
        console.error("Print error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "Print failed" }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, target: TARGET, serialPort: SERIAL_PORT || "n/a", branches: BRANCHES }));
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[print-agent] listening on http://localhost:${PORT}`);
  console.log(`[print-agent] target=${TARGET}` + (SERIAL_PORT ? ` port=${SERIAL_PORT}` : ""));
  console.log(`[print-agent] branches=${BRANCHES.join(", ")}`);
  console.log(`[print-agent] health: http://localhost:${PORT}/health`);
});
