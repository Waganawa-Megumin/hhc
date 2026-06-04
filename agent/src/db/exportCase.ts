// CLI: write an age-encrypted export of the case DB.
//   npm run export                 → data/hhc-case-<ts>.age
//   npm run export -- /path/out.age
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "../env";
import { getDb, isDbEnabled } from "./db";
import { exportCaseArmored } from "./exportImport";

async function main() {
  if (!isDbEnabled()) {
    console.error("[export] HHC_DB_KEY is not set — nothing to export.");
    process.exit(1);
  }
  const out = process.argv[2] ?? resolve(process.cwd(), `hhc-case-${new Date().toISOString().replace(/[:.]/g, "-")}.age`);
  const armored = await exportCaseArmored(getDb(), env.HHC_DB_KEY);
  writeFileSync(out, armored, "utf8");
  console.log(`[export] wrote age-encrypted case export → ${out}`);
}

void main();
