//* Generates a password hash for the `users` table and a fresh AUTH_SECRET for the API.
//^ Usage: node scripts/hash-password.mjs <password>
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];

if (!password) {
  console.error("Usage: node scripts/hash-password.mjs <password>");
  process.exit(1);
}

//* Format matches hello.ts: scrypt$<salt-hex>$<hash-hex>
const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");

console.log(`password hash: scrypt$${salt}$${hash}`);
console.log(`AUTH_SECRET:   ${randomBytes(32).toString("hex")}`);
