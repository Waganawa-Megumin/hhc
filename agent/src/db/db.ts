// Encrypted SQLite (SQLCipher) connection. The native driver is isolated to this
// file so it can be swapped (plain better-sqlite3 + age, or node:sqlite) if a
// prebuild is unavailable on some host. Case features are disabled unless
// HHC_DB_KEY is set; Layer-1 and §6/§7 are unaffected.
import Database from "better-sqlite3-multiple-ciphers";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env";

export type DB = Database.Database;

const here = dirname(fileURLToPath(import.meta.url)); // agent/src/db

/** Idempotent migrations for DBs created before a column existed (CREATE TABLE IF
 * NOT EXISTS does not add columns to an existing table). Each ALTER is best-effort:
 * SQLite throws "duplicate column" if it already exists, which we ignore. */
function migrate(db: DB): void {
  const addColumn = (sql: string) => {
    try {
      db.exec(sql);
    } catch {
      /* column already present */
    }
  };
  addColumn("ALTER TABLE audit_logs ADD COLUMN detail TEXT");
}

export function dbFilePath(): string {
  // data/ at the repo root (gitignored).
  return resolve(here, "../../../data/hhc-cases.db");
}

export function isDbEnabled(): boolean {
  return env.HHC_DB_KEY.trim().length > 0;
}

let instance: DB | null = null;

export function getDb(): DB {
  if (!isDbEnabled()) throw new Error("case_db_disabled: set HHC_DB_KEY to enable the encrypted case DB");
  if (instance) return instance;
  const path = dbFilePath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("cipher='sqlcipher'");
  db.pragma(`key='${env.HHC_DB_KEY.replace(/'/g, "''")}'`);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(resolve(here, "schema.sql"), "utf8");
  db.exec(schema);
  migrate(db);
  instance = db;
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

/**
 * For tests: an in-memory DB with the schema applied. In-memory databases cannot
 * be keyed (and need not be — they never touch disk); the encrypted on-disk path
 * is exercised by getDb() in production.
 */
export function openTestDb(): DB {
  const db = new Database(":memory:");
  const schema = readFileSync(resolve(here, "schema.sql"), "utf8");
  db.exec(schema);
  migrate(db);
  return db;
}
