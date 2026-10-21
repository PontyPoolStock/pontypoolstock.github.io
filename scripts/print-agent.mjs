//* Pontypool Silent Print Agent - NO QZ TRAY NEEDED.
//* Record Sale in the browser POSTs here, this prints to the thermal printer.
//* No dialog, no confirm, no popup. Keep this window open on the till.
//* Start: npm run print
//* Logo: save your BLACK-AND-WHITE logo as assets/pontypool-logo-bw.png (PNG).
//* Targets: windows (easiest) | serial (COM3) | lpt1 | file (test).
//* Env: PRINTER_TARGET, PRINTER_NAME, PRINTER_PORT, PRINT_AGENT_PORT, BRANCHES.
//* Browser Record Sale -> POST localhost:5501/print -> thermal printer, no popup.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
//* Default to "windows" so a plain `npm run print` really prints (was "file", which only saved a .bin).
const TARGET = (process.env.PRINTER_TARGET || "windows").toLowerCase();
const PORT = Number(process.env.PRINT_AGENT_PORT || 5501);
const SERIAL_PORT = process.env.PRINTER_PORT || "";
const PRINTER_NAME = process.env.PRINTER_NAME || "";
const BRANCHES = (process.env.BRANCHES || "Ambala Road,Duruma Road").split(",").map((b) => b.trim()).filter(Boolean);
const BRANCH_INFO = {
  "Ambala Road": { company: "PontyPool Enterprises Limited", address: "Ambala Road", phone: "0790225572" },
  "Duruma Road": { company: "PontyPool Enterprises Limited", address: "Duruma Road", phone: "0712255416" },
};
const TAGLINE = "Dealers in Electrical Accessories, Lighting Fixtures & Solar Accessories.";
const QUEUE_DIR = path.join(ROOT, "print-queue");
if (!fs.existsSync(QUEUE_DIR)) fs.mkdirSync(QUEUE_DIR, { recursive: true });

// ── ESC-POS helpers ──────────────────────────────────────────────────────

// ESC @ init
const ESC_INIT = Buffer.from([0x1b, 0x40]);
const ESC_MODE_DOUBLE = Buffer.from([0x1b, 0x21, 0x38]);
const ESC_MODE_NORMAL = Buffer.from([0x1b, 0x21, 0x00]);
const escAlign = (n) => Buffer.from([0x1b, 0x61, n]);
const escFeed = (n) => Buffer.from([0x1b, 0x64, n]);
const GS_CUT = Buffer.from([0x1d, 0x56, 0x66, 0x00]);
function escStr(t) {
  return Buffer.from(String(t).replace(/['']/g, "'").replace(/[""]/g, '"').replace(/[--]/g, "-").replace(/[^ -~]/g, "?"));
}
const LOGO_PATH = path.join(ROOT, "assets", "pontypool-logo-bw.png");
function rasterLogo(maxW) {
  try {
    if (!fs.existsSync(LOGO_PATH)) return null;
    const buf = fs.readFileSync(LOGO_PATH);
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buf.length < 8 || !buf.subarray(0, 8).equals(sig)) return null;
    let pos = 8, w = 0, h = 0, bd = 0, ct = 0, inter = 0;
    const parts = [];
    while (pos + 8 <= buf.length) {
      const len = buf.readUInt32BE(pos);
      const type = buf.toString("ascii", pos + 4, pos + 8);
      const data = buf.subarray(pos + 8, pos + 8 + len);
      if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; inter = data[12]; }
      else if (type === "IDAT") parts.push(data);
      else if (type === "IEND") break;
      pos += 12 + len;
    }
    if (!w || !h || inter !== 0) return null;
    if (bd !== 8 && bd !== 1 && bd !== 2 && bd !== 4) return null;
    const raw = zlib.inflateSync(Buffer.concat(parts));
    const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 4 ? 2 : 1;
    const bpp = Math.max(1, Math.ceil((w * ch * bd) / 8));
    const px = Buffer.alloc(w * h);
    let p = 0, prev = Buffer.alloc(bpp);
    for (let y = 0; y < h; y += 1) {
      const f = raw[p++];
      const cur = raw.subarray(p, p + bpp); p += bpp;
      const rec = Buffer.alloc(bpp);
      for (let i = 0; i < bpp; i += 1) {
        const a = 0, b2 = prev[i] || 0;
        let v = cur[i];
        if (f === 1) v = (v + a) & 255;
        else if (f === 2) v = (v + b2) & 255;
        rec[i] = v;
      }
      prev = rec;
      for (let x = 0; x < w; x += 1) {
        let g = 255;
        if (ct === 0) { g = bd === 8 ? rec[x] : 255; }
        else if (ct === 2) g = Math.round((rec[x * 3] + rec[x * 3 + 1] + rec[x * 3 + 2]) / 3);
        else { const o = x * 4; g = Math.round(((rec[o] || 255) + (rec[o + 1] || 255) + (rec[o + 2] || 255)) / 3); }
        px[y * w + x] = g;
      }
    }
    const sc = Math.min(1, (maxW || 360) / w);
    const rw = Math.max(1, Math.round(w * sc)), rh = Math.max(1, Math.round(h * sc));
    const bpr = Math.ceil(rw / 8), out = Buffer.alloc(bpr * rh, 0);
    for (let y = 0; y < rh; y += 1) {
      for (let x = 0; x < rw; x += 1) {
        const sx = Math.min(w - 1, Math.floor(x / sc)), sy = Math.min(h - 1, Math.floor(y / sc));
        if (px[sy * w + sx] < 160) out[y * bpr + (x >> 3)] |= 128 >> (x % 8);
      }
    }
    return Buffer.concat([escAlign(1), Buffer.from([0x1d, 0x76, 0x30, 0x00, bpr & 255, (bpr >> 8) & 255, rh & 255, (rh >> 8) & 255]), out, escFeed(1)]);
  } catch { return null; }
}

function money(n) {
  const v = Number(n) || 0;
  return "KSH " + v.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
  const dt = new Date(d || Date.now());
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  let h = dt.getHours(); const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return mm + "/" + dd + "/" + dt.getFullYear() + ", " + h + ":" + String(dt.getMinutes()).padStart(2, "0") + " " + ap;
}
const W = 42, DASH = "-".repeat(42), EQ = "=".repeat(42);
const ctr = (s) => { s = String(s); if (s.length >= 42) return s.slice(0, 42); const p = Math.floor((42 - s.length) / 2); return " ".repeat(p) + s; };
function buildReceipt(branch, sale) {
  const info = BRANCH_INFO[branch] || { company: "PontyPool Enterprises Limited", address: branch, phone: "" };
  const lines = Array.isArray(sale.lines) && sale.lines.length ? sale.lines : [{ name: sale.productName || "Product", qty: sale.quantity, unitPrice: sale.unitPrice, lineTotal: sale.total }];
  const total = Number(sale.total != null ? sale.total : lines.reduce((s, l) => s + (Number(l.lineTotal != null ? l.lineTotal : l.total) || 0), 0)) || 0;
  const no = String(sale.receiptNo != null ? sale.receiptNo : sale.id != null ? sale.id : Date.now()).slice(-8);
  const b = [];
  b.push(DASH, ctr("Dealers in Electrical Accessories,"), ctr("Lighting Fixtures & Solar Accessories."), DASH);
  b.push(ctr(info.company), ctr(info.address));
  if (info.phone) b.push(ctr(info.phone));
  b.push(EQ, ctr(fmtDate(sale.soldAt || sale.createdAt || Date.now())), ctr("Receipt #" + no), DASH);
  for (const l of lines) {
    const q = Number(l.qty != null ? l.qty : l.quantity) || 0;
    const u = Number(l.unitPrice) || 0;
    const t = Number(l.lineTotal != null ? l.lineTotal : l.total != null ? l.total : q * u) || 0;
    const nm = String(l.name || l.productName || "Product").trim() || "Product";
    b.push(nm.slice(0, 42));
    const left = q + " x " + u.toLocaleString("en-KE", { minimumFractionDigits: 2 });
    const right = t.toLocaleString("en-KE", { minimumFractionDigits: 2 });
    b.push(left + " ".repeat(Math.max(1, 42 - left.length - right.length)) + right);
  }
  b.push(DASH);
  const tl = "TOTAL", ts = money(total);
  b.push(tl + " ".repeat(Math.max(1, 42 - tl.length - ts.length)) + ts, DASH);
  const chunks = [ESC_INIT];
  const logo = rasterLogo(360);
  if (logo) chunks.push(logo);
  else { chunks.push(escAlign(1), ESC_MODE_DOUBLE, escStr("PONTYPOOL"), ESC_MODE_NORMAL, escFeed(1), escAlign(1), escStr("Electricals & Lighting"), escFeed(1)); }
  chunks.push(escAlign(0), escStr(b.join("\n")), escFeed(1), escAlign(1));
  chunks.push(Buffer.from([0x1d, 0x68, 0x50, 0x1d, 0x77, 0x02]));
  const code = String(no).replace(/[^0-9A-Z ]/gi, "").slice(0, 12) || "0";
  chunks.push(Buffer.concat([Buffer.from([0x1d, 0x6b, 0x04]), escStr("*" + code.toUpperCase() + "*"), Buffer.from([0x00])]));
  chunks.push(escFeed(2), escStr(ctr(EQ)), escFeed(3), GS_CUT);
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

//* Sends the real ESC-POS receipt (logo, layout, barcode, cut) as RAW bytes to the
//* Windows printer. The old Out-Printer path printed plain text and lost the template.
function printToWindows(data, sale, branch) {
  const tmp = path.join(QUEUE_DIR, "job-" + Date.now() + ".bin");
  fs.writeFileSync(tmp, data);
  try {
    const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "print-raw.ps1"), "-FilePath", tmp];
    if (PRINTER_NAME) args.push("-PrinterName", PRINTER_NAME);
    execFileSync("powershell.exe", args, { windowsHide: true, stdio: "pipe", timeout: 15000 });
  } catch (err) {
    const detail = String((err.stderr && err.stderr.toString()) || (err.stdout && err.stdout.toString()) || err.message || err).trim();
    throw new Error("Windows printer error: " + detail.split(/\r?\n/).filter(Boolean).slice(0, 3).join(" "));
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
  return tmp;
}
function buildText(branch, sale) {
  const info = BRANCH_INFO[branch] || { company: "PontyPool Enterprises Limited", address: branch, phone: "" };
  const lines = Array.isArray(sale.lines) && sale.lines.length ? sale.lines : [{ name: sale.productName || "Product", qty: sale.quantity, unitPrice: sale.unitPrice, lineTotal: sale.total }];
  const total = Number(sale.total != null ? sale.total : lines.reduce((s, l) => s + (Number(l.lineTotal != null ? l.lineTotal : l.total) || 0), 0)) || 0;
  const r = ["PONTYPOOL - Electricals & Lighting", TAGLINE, info.company, info.address];
  if (info.phone) r.push(info.phone);
  r.push(fmtDate(sale.soldAt || sale.createdAt || Date.now()));
  for (const l of lines) r.push((l.name || l.productName) + "  " + (l.qty != null ? l.qty : l.quantity) + " x " + l.unitPrice + " = " + (l.lineTotal != null ? l.lineTotal : l.total));
  r.push("TOTAL  " + money(total));
  return r.join("\r\n") + "\r\n\r\n\r\n";
}
function printToFile(data, saleId) {
  const file = path.join(QUEUE_DIR, `receipt-${saleId || Date.now()}.bin`);
  fs.writeFileSync(file, data);
  try { fs.writeFileSync(file + ".txt", data.toString("utf8").replace(/[^\x20-\x7e\r\n]/g, "")); } catch {}
  return file;
}

function sendToPrinter(data, sale, branch, saleId) {
  if (TARGET === "serial") return printToSerial(data);
  if (TARGET === "lpt1") return printToLpt1(data);
  if (TARGET === "windows") return printToWindows(data, sale, branch);
  return printToFile(data, saleId);
}

// ── HTTP server ──────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  //* Chrome/Edge block a public https site from calling localhost unless this is sent.
  res.setHeader("Access-Control-Allow-Private-Network", "true");

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
        const result = sendToPrinter(escpos, sale, branch, sale.receiptNo != null ? sale.receiptNo : sale.id);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          branch,
          saleId: sale.id != null ? sale.id : sale.receiptNo,
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
    res.end(JSON.stringify({ ok: true, target: TARGET, printer: PRINTER_NAME || "windows-default", serialPort: SERIAL_PORT || "n/a", branches: BRANCHES, logo: fs.existsSync(LOGO_PATH) ? "found" : "missing-assets/pontypool-logo-bw.png" }));
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[print-agent] listening on http://localhost:${PORT}`);
  console.log(`[print-agent] target=${TARGET}` + (PRINTER_NAME ? ` printer="${PRINTER_NAME}"` : "") + (SERIAL_PORT ? ` port=${SERIAL_PORT}` : ""));
  console.log(`[print-agent] branches=${BRANCHES.join(", ")}`);
  console.log(`[print-agent] logo=${fs.existsSync(LOGO_PATH) ? LOGO_PATH : "MISSING - save assets/pontypool-logo-bw.png"}`);
  console.log(`[print-agent] Record Sale prints by itself - no popup.`);
});
