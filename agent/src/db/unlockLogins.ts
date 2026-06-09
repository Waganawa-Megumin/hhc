// Admin tool: clear login-attempt history to lift a lockout immediately.
//   npm run unlock              # clear all locked accounts
//   npm run unlock -- a@b.com   # clear just one email
// Requires HHC_DB_KEY (the encrypted DB key).
import { getDb, isDbEnabled } from "./db";
import { clearLoginFailures } from "./authStore";

if (!isDbEnabled()) {
  console.error("[hhc-auth] set HHC_DB_KEY first (the encrypted DB key).");
  process.exit(1);
}

const email = process.argv[2]?.trim().toLowerCase();
const n = clearLoginFailures(getDb(), email || undefined);
console.log(`[hhc-auth] cleared ${n} failed login attempt(s)${email ? ` for ${email}` : ""}. Lockout reset.`);
