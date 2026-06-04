import { describe, it, expect, beforeEach } from "vitest";
import { openTestDb, type DB } from "../src/db/db";
import { recordInquiry, recall } from "../src/db/store";
import { exportCaseArmored, importCaseArmored } from "../src/db/exportImport";

const PASS = "correct horse battery staple";
// Low scrypt work factor keeps the age round-trip fast in tests.
const WF = 10;

let db: DB;
beforeEach(() => {
  db = openTestDb();
});

function seed(d: DB) {
  recordInquiry(d, { identifiers: { company: "Apex Advisory", domain: "apex.example" }, score: 13, band: "high", matchedIndicatorIds: ["A1", "C2", "D1"], theme: "semiconductors" });
  recordInquiry(d, { identifiers: { company: "Orient Insight", domain: "orient.example" }, score: 6, band: "mid", matchedIndicatorIds: ["A1"] });
}

describe("§9 age-encrypted export / import", () => {
  it("produces an armored age file and round-trips into a fresh DB", async () => {
    seed(db);
    const armored = await exportCaseArmored(db, PASS, WF);
    expect(armored).toMatch(/BEGIN AGE ENCRYPTED FILE/);
    expect(armored).not.toContain("Apex Advisory"); // encrypted at rest

    const fresh = openTestDb();
    expect(recall(fresh, { domain: "apex.example" }).known).toBe(false);
    const result = await importCaseArmored(fresh, armored, PASS);
    expect(result.subjects).toBe(2);
    expect(result.inquiries).toBe(2);

    const r = recall(fresh, { company: "Apex Advisory", domain: "apex.example" });
    expect(r.known).toBe(true);
    expect(r.subject?.latestBand).toBe("high");
  });

  it("is idempotent (re-importing the same file does not duplicate)", async () => {
    seed(db);
    const armored = await exportCaseArmored(db, PASS, WF);
    const fresh = openTestDb();
    await importCaseArmored(fresh, armored, PASS);
    await importCaseArmored(fresh, armored, PASS);
    expect((fresh.prepare("SELECT COUNT(*) n FROM inquiries").get() as { n: number }).n).toBe(2);
  });

  it("fails with the wrong passphrase", async () => {
    seed(db);
    const armored = await exportCaseArmored(db, PASS, WF);
    const fresh = openTestDb();
    await expect(importCaseArmored(fresh, armored, "wrong passphrase")).rejects.toThrow(/decrypt_failed/);
  });

  it("rejects a tampered export that smuggles a demographic field", async () => {
    // Build a plausible but malicious payload and age-encrypt it the same way.
    const age = await import("age-encryption");
    const enc = new age.Encrypter();
    enc.setPassphrase(PASS);
    enc.setScryptWorkFactor(WF);
    const payload = JSON.stringify({
      kind: "hhc-case-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      subjects: [{ subject_id: "x", cluster_id: "x", nationality: "somewhere" }],
      inquiries: [],
      evidence_cache: [],
    });
    const armored = age.armor.encode(await enc.encrypt(payload));
    await expect(importCaseArmored(openTestDb(), armored, PASS)).rejects.toThrow(/demographic/i);
  });
});
