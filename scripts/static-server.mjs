//* Tiny dependency-free static server so the app can be opened locally or shared on your network.
//^ Usage: npm run serve   (override with the PORT / HOST env vars)
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const PORT = Number(process.env.PORT || 5500);
const HOST = process.env.HOST || "0.0.0.0";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

//* Resolve a request path to a file inside the project, refusing to escape the root
function resolveFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.resolve(ROOT, `.${decoded}`);

  if (!target.startsWith(ROOT) || !fs.existsSync(target)) return null;
  if (fs.statSync(target).isDirectory()) {
    const indexFile = path.join(target, "index.html");
    return fs.existsSync(indexFile) ? indexFile : null;
  }

  return target;
}

const server = http.createServer((request, response) => {
  const file = resolveFile(request.url || "/");

  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("404 Not Found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Type": MIME_TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
  });
  fs.createReadStream(file).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`Pontypool is being served from ${ROOT}`);
  console.log(`  Local:   http://localhost:${PORT}/login.html`);

  for (const address of Object.values(os.networkInterfaces()).flat()) {
    if (address?.family === "IPv4" && !address.internal) {
      console.log(`  Sharing: http://${address.address}:${PORT}/login.html`);
    }
  }

  console.log("Data is saved to the Neon database configured in js/config.js.");
});
