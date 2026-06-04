import { describe, it, expect, beforeEach } from "vitest";
import { openTestDb, type DB } from "../src/db/db";
import { recall, recordInquiry, getStatsRows, cacheGet, cachePut, subjectIdFor } from "../src/db/store";
import { computeStats } from "@hhc/shared";
import { ok } from "../src/tools/http";

let db: DB;
beforeEach(() => {
  db = openTestDb();
});

describe("subject identity (§7.2)", () => {
  it("same registrable domain → same subject id (company name ignored)", () => {
    const a = subjectIdFor({ company: "Apex Advisory KK", domain: "https://apex.example/jobs" });
    const b = subjectIdFor({ company: "Totally Different", domain: "apex.example" });
    expect(a.subjectId).toBe(b.subjectId);
  });
});

describe("recall + recordInquiry (§5-1, §7.5)", () => {
  it("unknown before, known after; diff is first-time", () => {
    const ids = { company: "Apex Advisory", domain: "apex.example" };
    expect(recall(db, ids).known).toBe(false);
    const r = recordInquiry(db, { identifiers: ids, score: 7, band: "mid", matchedIndicatorIds: ["A1", "C2"] });
    expect(r.diff.firstTime).toBe(true);
    const after = recall(db, ids);
    expect(after.known).toBe(true);
    expect(after.subject?.inquiryCount).toBe(1);
    expect(after.subject?.latestBand).toBe("mid");
  });

  it("repeat inquiry computes a diff (new indicator, band change)", () => {
    const ids = { company: "Apex Advisory", domain: "apex.example" };
    recordInquiry(db, { identifiers: ids, score: 7, band: "mid", matchedIndicatorIds: ["A1", "C2"] });
    const second = recordInquiry(db, {
      identifiers: ids,
      score: 13,
      band: "high",
      matchedIndicatorIds: ["A1", "C2", "D1"],
      evidenceKeys: ["news:scam"],
    });
    expect(second.inquiryCount).toBe(2);
    expect(second.diff.newIndicators).toEqual(["D1"]);
    expect(second.diff.bandChange).toEqual({ from: "mid", to: "high" });
    expect(second.diff.newEvidence).toEqual(["news:scam"]);
  });

  it("auto-clusters two subjects sharing a domain; suggests (not merges) similar company names", () => {
    recordInquiry(db, { identifiers: { company: "Apex Advisory", domain: "apex.example", email: "a@apex.example" }, score: 5, band: "low", matchedIndicatorIds: ["A2"] });
    // different person/email but SAME domain → same cluster
    const r2 = recordInquiry(db, { identifiers: { company: "Apex Advisory Recruiting", domain: "apex.example", email: "b@apex.example" }, score: 6, band: "mid", matchedIndicatorIds: ["A1"] });
    const r1cluster = recall(db, { domain: "apex.example", email: "a@apex.example" }).subject?.clusterId;
    expect(r2.clusterId).toBe(r1cluster);

    // a near-identical company name on a DIFFERENT domain → suggestion only
    const sug = recall(db, { company: "Apex Advisroy", domain: "apex-different.example" }).clusterSuggestions;
    expect(sug.length).toBeGreaterThanOrEqual(1);
    expect(sug[0]?.score).toBeGreaterThanOrEqual(0.92);
  });
});

describe("evidence cache TTL (§7.4)", () => {
  it("returns a cached fresh result and a fresh put round-trips", () => {
    const sid = subjectIdFor({ domain: "apex.example" }).subjectId;
    expect(cacheGet(db, sid, "domain_rdap", "apex.example", "low")).toBeNull();
    cachePut(db, sid, "domain_rdap", "apex.example", ok("domain_rdap", { ageDays: 20 }), "low");
    const got = cacheGet(db, sid, "domain_rdap", "apex.example", "low");
    expect(got?.tool).toBe("domain_rdap");
  });
});

describe("stats over stored rows (§7.6)", () => {
  it("aggregates and flags coordinated targeting", () => {
    for (const c of ["Apex", "Orient", "Blue"]) {
      recordInquiry(db, { identifiers: { company: c, domain: `${c}.example` }, score: 8, band: "mid", matchedIndicatorIds: ["C2", "D1"], theme: "semiconductors" });
    }
    const { inquiries, subjects } = getStatsRows(db);
    const stats = computeStats(inquiries, subjects, { coordinatedThreshold: 3 });
    expect(stats.uniqueSubjects).toBe(3);
    expect(stats.coordinated.length).toBe(1);
    expect(stats.frequentIndicators[0]?.id).toMatch(/C2|D1/);
  });
});

describe("demographic guardrail on writes (§0)", () => {
  it("refuses to persist a record containing a nationality field", () => {
    expect(() =>
      recordInquiry(db, {
        // @ts-expect-error — intentionally malformed to prove the guard fires
        identifiers: { company: "X", domain: "x.example", nationality: "somewhere" },
        score: 1,
        band: "low",
        matchedIndicatorIds: [],
      }),
    ).toThrow(/demographic/i);
  });
});
