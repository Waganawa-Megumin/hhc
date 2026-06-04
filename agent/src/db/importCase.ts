// CLI: merge an age-encrypted export back into the case DB.
//   npm run import -- /path/to/hhc-case-....age
import { readFileSync } from "node:fs";
import { env } from "../env";
import { getDb, isDbEnabled } from "./db";
import { importCaseArmored } from "./exportImport";

async function main() {
  if (!isDbEnabled()) {
    console.error("[import] HHC_DB_KEY is not set — cannot import.");
    process.exit(1);
  }
  const path = process.argv[2];
  if (!path) {
    console.error("[import] usage: npm run import -- <file.age>");
    process.exit(1);
  }
  const armored = readFileSync(path, "utf8");
  const r = await importCaseArmored(getDb(), armored, env.HHC_DB_KEY);
  console.log(`[import] merged subjects=${r.subjects} inquiries=${r.inquiries} evidence=${r.evidence_cache}`);
}

void main();
