// Case store (§7.2/7.3/7.4/7.5). All access goes through here so the encrypted
// driver stays isolated in db.ts and every write is guarded against demographic
// fields. Functions take a DB so they are unit-testable against an in-memory DB.
import { createHash, randomUUID } from "node:crypto";
import {
  normalizeIdentifiers,
  stableIdentifierString,
  jaroWinkler,
  CLUSTER_SUGGESTION_THRESHOLD,
  diffSnapshots,
  isStale,
  assertNoDemographicScoringFields,
  type RawIdentifiers,
  type NormalizedIdentifiers,
  type Band,
  type Snapshot,
  type DiffResult,
  type ToolRun,
  type Volatility,
  type InquiryStat,
  type SubjectStat,
} from "@hhc/shared";
import type { DB } from "./db";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Identity basis: stable ids (domain/email/phone) if any, else exact normalized company+handle. */
function identityBasis(n: NormalizedIdentifiers): string {
  const stable = stableIdentifierString(n);
  if (stable) return stable;
  const fallback = [n.company ? `company:${n.company}` : "", n.handle ? `handle:${n.handle}` : ""]
    .filter(Boolean)
    .sort()
    .join("|");
  return fallback || "anon";
}

export function subjectIdFor(raw: RawIdentifiers): { subjectId: string; norm: NormalizedIdentifiers } {
  const norm = normalizeIdentifiers(raw);
  return { subjectId: sha256(identityBasis(norm)), norm };
}

interface SubjectRow {
  subject_id: string;
  cluster_id: string;
  identifiers: string;
  norm_domain: string;
  norm_email: string;
  norm_phone: string;
  norm_company: string;
  first_seen: string;
  last_seen: string;
  inquiry_count: number;
  latest_band: Band | null;
  band_history: string;
}

export interface ClusterSuggestion {
  subjectId: string;
  clusterId: string;
  company: string;
  score: number;
}

export interface RecallResult {
  known: boolean;
  subject: {
    subjectId: string;
    clusterId: string;
    inquiryCount: number;
    latestBand: Band | null;
    firstSeen: string;
    lastSeen: string;
    bandHistory: Array<{ ts: string; band: Band }>;
  } | null;
  clusterSuggestions: ClusterSuggestion[];
}

/** §7.2 company-name suggestions (Jaro-Winkler ≥ 0.92) — proposals only, never auto-merged. */
function companySuggestions(db: DB, normCompany: string, excludeClusterId?: string): ClusterSuggestion[] {
  if (!normCompany) return [];
  const rows = db
    .prepare("SELECT subject_id, cluster_id, norm_company FROM subjects WHERE norm_company <> ''")
    .all() as Array<Pick<SubjectRow, "subject_id" | "cluster_id" | "norm_company">>;
  const out: ClusterSuggestion[] = [];
  for (const r of rows) {
    if (excludeClusterId && r.cluster_id === excludeClusterId) continue;
    const score = jaroWinkler(normCompany, r.norm_company);
    if (score >= CLUSTER_SUGGESTION_THRESHOLD) {
      out.push({ subjectId: r.subject_id, clusterId: r.cluster_id, company: r.norm_company, score });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function recall(db: DB, raw: RawIdentifiers): RecallResult {
  const { subjectId, norm } = subjectIdFor(raw);
  const row = db.prepare("SELECT * FROM subjects WHERE subject_id = ?").get(subjectId) as SubjectRow | undefined;
  const subject = row
    ? {
        subjectId: row.subject_id,
        clusterId: row.cluster_id,
        inquiryCount: row.inquiry_count,
        latestBand: row.latest_band,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        bandHistory: JSON.parse(row.band_history) as Array<{ ts: string; band: Band }>,
      }
    : null;
  return {
    known: !!row,
    subject,
    clusterSuggestions: companySuggestions(db, norm.company, row?.cluster_id),
  };
}

/** Find an existing cluster sharing an exact stable identifier (domain/email/phone). */
function findClusterByStableId(db: DB, n: NormalizedIdentifiers): string | null {
  const row = db
    .prepare(
      `SELECT cluster_id FROM subjects
       WHERE (norm_domain <> '' AND norm_domain = @d)
          OR (norm_email <> '' AND norm_email = @e)
          OR (norm_phone <> '' AND norm_phone = @p)
       LIMIT 1`,
    )
    .get({ d: n.domain, e: n.email, p: n.phone }) as { cluster_id: string } | undefined;
  return row?.cluster_id ?? null;
}

export interface RecordInquiryInput {
  identifiers: RawIdentifiers;
  score: number;
  band: Band;
  matchedIndicatorIds: string[];
  theme?: string;
  evidenceKeys?: string[];
  inputFingerprint?: string;
}

export interface RecordInquiryResult {
  subjectId: string;
  clusterId: string;
  inquiryCount: number;
  diff: DiffResult;
}

export function recordInquiry(db: DB, input: RecordInquiryInput): RecordInquiryResult {
  // Guardrail: nothing demographic may ever be persisted.
  assertNoDemographicScoringFields(input.identifiers, "case DB subject identifiers");
  assertNoDemographicScoringFields({ matched: input.matchedIndicatorIds }, "case DB inquiry");

  const { subjectId, norm } = subjectIdFor(input.identifiers);
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT * FROM subjects WHERE subject_id = ?").get(subjectId) as SubjectRow | undefined;

  // Build the diff against this subject's most recent prior inquiry.
  const prevRow = db
    .prepare("SELECT score, band, matched_indicators, evidence_ref FROM inquiries WHERE subject_id = ? ORDER BY ts DESC LIMIT 1")
    .get(subjectId) as { score: number; band: Band; matched_indicators: string; evidence_ref: string } | undefined;
  const prevSnapshot: Snapshot | null = prevRow
    ? {
        rawScore: prevRow.score,
        band: prevRow.band,
        matchedIndicatorIds: JSON.parse(prevRow.matched_indicators),
        evidenceKeys: JSON.parse(prevRow.evidence_ref),
      }
    : null;
  const nextSnapshot: Snapshot = {
    rawScore: input.score,
    band: input.band,
    matchedIndicatorIds: input.matchedIndicatorIds,
    evidenceKeys: input.evidenceKeys ?? [],
  };
  const diff = diffSnapshots(prevSnapshot, nextSnapshot);

  const clusterId = existing?.cluster_id ?? findClusterByStableId(db, norm) ?? subjectId;

  const tx = db.transaction(() => {
    if (existing) {
      const history = JSON.parse(existing.band_history) as Array<{ ts: string; band: Band }>;
      history.push({ ts: now, band: input.band });
      db.prepare(
        `UPDATE subjects SET last_seen=@now, inquiry_count=inquiry_count+1, latest_band=@band,
         band_history=@history, identifiers=@identifiers,
         norm_domain=@d, norm_email=@e, norm_phone=@p, norm_company=@c
         WHERE subject_id=@id`,
      ).run({
        now,
        band: input.band,
        history: JSON.stringify(history),
        identifiers: JSON.stringify(norm),
        d: norm.domain, e: norm.email, p: norm.phone, c: norm.company,
        id: subjectId,
      });
    } else {
      db.prepare(
        `INSERT INTO subjects (subject_id, cluster_id, identifiers, norm_domain, norm_email, norm_phone, norm_company,
          first_seen, last_seen, inquiry_count, latest_band, band_history)
         VALUES (@id, @cluster, @identifiers, @d, @e, @p, @c, @now, @now, 1, @band, @history)`,
      ).run({
        id: subjectId,
        cluster: clusterId,
        identifiers: JSON.stringify(norm),
        d: norm.domain, e: norm.email, p: norm.phone, c: norm.company,
        now,
        band: input.band,
        history: JSON.stringify([{ ts: now, band: input.band }]),
      });
    }
    db.prepare(
      `INSERT INTO inquiries (inquiry_id, subject_id, cluster_id, ts, input_fingerprint, score, band, matched_indicators, theme, evidence_ref)
       VALUES (@iid, @sid, @cid, @ts, @fp, @score, @band, @mi, @theme, @ev)`,
    ).run({
      iid: randomUUID(),
      sid: subjectId,
      cid: clusterId,
      ts: now,
      fp: input.inputFingerprint ?? null,
      score: input.score,
      band: input.band,
      mi: JSON.stringify(input.matchedIndicatorIds),
      theme: input.theme ?? null,
      ev: JSON.stringify(input.evidenceKeys ?? []),
    });
  });
  tx();

  const count = (db.prepare("SELECT inquiry_count FROM subjects WHERE subject_id=?").get(subjectId) as { inquiry_count: number }).inquiry_count;
  return { subjectId, clusterId, inquiryCount: count, diff };
}

export function getStatsRows(db: DB): { inquiries: InquiryStat[]; subjects: SubjectStat[] } {
  const inqRows = db.prepare("SELECT subject_id, cluster_id, ts, band, score, matched_indicators, theme FROM inquiries").all() as Array<{
    subject_id: string; cluster_id: string; ts: string; band: Band; score: number; matched_indicators: string; theme: string | null;
  }>;
  const subjRows = db.prepare("SELECT subject_id, cluster_id, inquiry_count, latest_band FROM subjects").all() as Array<{
    subject_id: string; cluster_id: string; inquiry_count: number; latest_band: Band | null;
  }>;
  return {
    inquiries: inqRows.map((r) => ({
      subjectId: r.subject_id,
      clusterId: r.cluster_id,
      ts: r.ts,
      band: r.band,
      score: r.score,
      matchedIndicatorIds: JSON.parse(r.matched_indicators),
      theme: r.theme ?? undefined,
    })),
    subjects: subjRows.map((r) => ({
      subjectId: r.subject_id,
      clusterId: r.cluster_id,
      inquiryCount: r.inquiry_count,
      latestBand: r.latest_band ?? "low",
    })),
  };
}

// §7.4 evidence cache — re-query only stale sources.
function cacheKey(subjectId: string, source: string, query: string): string {
  return `${subjectId}|${source}|${query}`;
}

export function cacheGet(db: DB, subjectId: string, source: string, query: string, volatility: Volatility): ToolRun | null {
  const row = db
    .prepare("SELECT result, fetched_at FROM evidence_cache WHERE cache_key = ?")
    .get(cacheKey(subjectId, source, query)) as { result: string; fetched_at: string } | undefined;
  if (!row) return null;
  if (isStale(row.fetched_at, volatility)) return null;
  try {
    return JSON.parse(row.result) as ToolRun;
  } catch {
    return null;
  }
}

export function cachePut(db: DB, subjectId: string, source: string, query: string, run: ToolRun, volatility: Volatility): void {
  const result = JSON.stringify(run);
  db.prepare(
    `INSERT INTO evidence_cache (cache_key, subject_id, source, query, result, fetched_at, content_hash, volatility_class)
     VALUES (@k, @sid, @source, @query, @result, @fetched, @hash, @vol)
     ON CONFLICT(cache_key) DO UPDATE SET result=@result, fetched_at=@fetched, content_hash=@hash, volatility_class=@vol`,
  ).run({
    k: cacheKey(subjectId, source, query),
    sid: subjectId,
    source,
    query,
    result,
    fetched: new Date().toISOString(),
    hash: sha256(result),
    vol: volatility,
  });
}
