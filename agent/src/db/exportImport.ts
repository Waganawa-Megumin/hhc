// §9 — age-encrypted export/import of the case DB, so history survives outside an
// ephemeral Codespace. The export is an ASCII-armored age file encrypted with a
// passphrase (HHC_DB_KEY by default), interoperable with the standard `age` CLI.
import * as age from "age-encryption";
import { assertNoDemographicScoringFields } from "@hhc/shared";
import type { DB } from "./db";

const EXPORT_VERSION = 1;

export interface CaseExport {
  kind: "hhc-case-export";
  version: number;
  exportedAt: string;
  subjects: Record<string, unknown>[];
  inquiries: Record<string, unknown>[];
  evidence_cache: Record<string, unknown>[];
}

const SUBJECT_COLS = [
  "subject_id", "cluster_id", "identifiers", "norm_domain", "norm_email", "norm_phone",
  "norm_company", "first_seen", "last_seen", "inquiry_count", "latest_band", "band_history",
];
const INQUIRY_COLS = [
  "inquiry_id", "subject_id", "cluster_id", "ts", "input_fingerprint", "score", "band",
  "matched_indicators", "theme", "evidence_ref",
];
const EVIDENCE_COLS = [
  "cache_key", "subject_id", "source", "query", "result", "fetched_at", "content_hash", "volatility_class",
];

export function dumpCase(db: DB): CaseExport {
  return {
    kind: "hhc-case-export",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    subjects: db.prepare("SELECT * FROM subjects").all() as Record<string, unknown>[],
    inquiries: db.prepare("SELECT * FROM inquiries").all() as Record<string, unknown>[],
    evidence_cache: db.prepare("SELECT * FROM evidence_cache").all() as Record<string, unknown>[],
  };
}

/** Encrypt the whole case DB to an ASCII-armored age file. workFactor lowered only in tests. */
export async function exportCaseArmored(db: DB, passphrase: string, workFactor = 18): Promise<string> {
  if (!passphrase) throw new Error("export requires a passphrase (set HHC_DB_KEY)");
  const json = JSON.stringify(dumpCase(db));
  const enc = new age.Encrypter();
  enc.setPassphrase(passphrase);
  enc.setScryptWorkFactor(workFactor);
  const ciphertext = await enc.encrypt(json);
  return age.armor.encode(ciphertext);
}

export interface ImportResult {
  subjects: number;
  inquiries: number;
  evidence_cache: number;
}

function insertAll(db: DB, table: string, cols: string[], rows: Record<string, unknown>[]): number {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => "@" + c).join(", ")})`,
  );
  let n = 0;
  for (const row of rows) {
    const clean: Record<string, unknown> = {};
    for (const c of cols) clean[c] = row[c] ?? null;
    stmt.run(clean);
    n++;
  }
  return n;
}

/** Decrypt an armored age export and merge it into the DB (idempotent by primary key). */
export async function importCaseArmored(db: DB, armored: string, passphrase: string): Promise<ImportResult> {
  if (!passphrase) throw new Error("import requires a passphrase (set HHC_DB_KEY)");
  let json: string;
  try {
    const raw = age.armor.decode(armored.trim());
    const dec = new age.Decrypter();
    dec.addPassphrase(passphrase);
    json = await dec.decrypt(raw, "text");
  } catch {
    throw new Error("decrypt_failed: wrong passphrase or corrupt file");
  }
  const data = JSON.parse(json) as CaseExport;
  if (data.kind !== "hhc-case-export") throw new Error("not_an_hhc_export");

  // Guardrail: a tampered export must not introduce demographic fields.
  assertNoDemographicScoringFields(data.subjects, "imported subjects");
  assertNoDemographicScoringFields(data.inquiries, "imported inquiries");

  let result: ImportResult = { subjects: 0, inquiries: 0, evidence_cache: 0 };
  const tx = db.transaction(() => {
    result = {
      subjects: insertAll(db, "subjects", SUBJECT_COLS, data.subjects ?? []),
      inquiries: insertAll(db, "inquiries", INQUIRY_COLS, data.inquiries ?? []),
      evidence_cache: insertAll(db, "evidence_cache", EVIDENCE_COLS, data.evidence_cache ?? []),
    };
  });
  tx();
  return result;
}
