import fs from "node:fs";
import path from "node:path";

let missing = 0;
let checked = 0;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(file);
      continue;
    }
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      checked += 1;
      const target = path.resolve(path.dirname(file), match[1]);
      if (!fs.existsSync(target)) {
        missing += 1;
        console.error(`MISSING ${match[1]} in ${file}`);
      }
    }
  }
}

walk("js");
console.log(`imports checked: ${checked}, missing: ${missing}`);
process.exit(missing ? 1 : 0);
