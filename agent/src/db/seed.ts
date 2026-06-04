// Seed the encrypted case DB with a few sample approaches so the recall / diff /
// stats / coordinated-targeting features can be demoed. Run: `npm run seed`
// (requires HHC_DB_KEY). Personal self-defense records only — not real people.
import { getDb, isDbEnabled, dbFilePath } from "./db";
import { recordInquiry, type RecordInquiryInput } from "./store";

const samples: RecordInquiryInput[] = [
  {
    identifiers: { company: "Apex Strategic Advisory", domain: "apex-advisory.example" },
    score: 13, band: "high", matchedIndicatorIds: ["A1", "C2", "D1"], theme: "semiconductor export controls",
    evidenceKeys: ["rdap:apex-advisory.example"],
  },
  {
    identifiers: { company: "Orient Insight Partners", domain: "orient-insight.example" },
    score: 7, band: "mid", matchedIndicatorIds: ["A1", "C1"], theme: "semiconductor export controls",
  },
  {
    identifiers: { company: "Blue Harbor Research", domain: "blueharbor.example" },
    score: 6, band: "mid", matchedIndicatorIds: ["B1", "C1"], theme: "semiconductor export controls",
  },
  {
    // repeat contact from the first subject (same domain) — drives recall + diff
    identifiers: { company: "Apex Strategic Advisory", domain: "apex-advisory.example" },
    score: 18, band: "high", matchedIndicatorIds: ["A1", "C2", "D1", "D3"], theme: "semiconductor export controls",
    evidenceKeys: ["rdap:apex-advisory.example", "news:apex-scam-warning"],
  },
  {
    identifiers: { company: "Northwind Talent", domain: "northwind.example" },
    score: 5, band: "high", matchedIndicatorIds: ["D3"], theme: "defense procurement",
  },
];

function main() {
  if (!isDbEnabled()) {
    console.error("[seed] HHC_DB_KEY is not set — the encrypted case DB is disabled. Set it in .env first.");
    process.exit(1);
  }
  const db = getDb();
  for (const s of samples) {
    const r = recordInquiry(db, s);
    console.log(`[seed] ${s.identifiers.company} → ${s.band} (subject seen ${r.inquiryCount}x, cluster ${r.clusterId.slice(0, 8)})`);
  }
  console.log(`[seed] done → ${dbFilePath()}`);
}

main();
