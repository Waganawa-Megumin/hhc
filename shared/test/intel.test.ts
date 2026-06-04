import { describe, it, expect } from "vitest";
import { jaroWinkler, CLUSTER_SUGGESTION_THRESHOLD } from "../src/fuzzy";
import {
  registrableDomain,
  normalizeCompany,
  normalizeEmail,
  normalizePhone,
  normalizeIdentifiers,
  stableIdentifierString,
} from "../src/fingerprint";
import { isStale, volatilityForSource, TTL_DAYS } from "../src/ttl";
import { diffSnapshots, type Snapshot } from "../src/diff";
import { computeStats, type InquiryStat, type SubjectStat } from "../src/stats";

describe("fuzzy (Jaro-Winkler)", () => {
  it("scores identical strings 1 and near-identical high", () => {
    expect(jaroWinkler("acme global", "acme global")).toBe(1);
    expect(jaroWinkler("acme global advisory", "acme globel advisory")).toBeGreaterThan(CLUSTER_SUGGESTION_THRESHOLD);
  });
  it("scores clearly different names low", () => {
    expect(jaroWinkler("acme advisory", "zenith logistics")).toBeLessThan(0.7);
  });
});

describe("fingerprint normalization", () => {
  it("extracts registrable domain eTLD+1 (incl. multi-part TLD, from email/URL, dropping subdomains)", () => {
    expect(registrableDomain("https://www.Acme-Advisory.co.jp/careers?x=1")).toBe("acme-advisory.co.jp");
    expect(registrableDomain("recruiter@mail.acme.com")).toBe("acme.com");
    expect(registrableDomain("jobs.acme.example.com")).toBe("example.com");
    expect(registrableDomain("acme.com")).toBe("acme.com");
  });
  it("strips company legal suffixes (EN + JP)", () => {
    expect(normalizeCompany("Acme Advisory K.K.")).toBe("acme advisory");
    expect(normalizeCompany("株式会社アクメ")).toBe("アクメ");
    expect(normalizeCompany("Zenith Co., Ltd.")).toBe("zenith");
  });
  it("normalizes email and phone", () => {
    expect(normalizeEmail("  Recruiter@Acme.COM ")).toBe("recruiter@acme.com");
    expect(normalizePhone("+81 (3) 1234-5678")).toBe("+81312345678");
  });
  it("subject identity uses stable ids only — never the company name", () => {
    const a = normalizeIdentifiers({ company: "Acme Advisory KK", domain: "acme.com" });
    const b = normalizeIdentifiers({ company: "Totally Different Name", domain: "https://acme.com/x" });
    expect(stableIdentifierString(a)).toBe(stableIdentifierString(b)); // same domain → same identity
    expect(stableIdentifierString(a)).toContain("domain:acme.com");
    expect(stableIdentifierString(a)).not.toContain("acme advisory");
  });
});

describe("ttl (smart refresh)", () => {
  it("registry sources are low-volatility (90d), sanctions high", () => {
    expect(volatilityForSource("domain_rdap")).toBe("low");
    expect(volatilityForSource("sanctions_opensanctions")).toBe("high");
    expect(TTL_DAYS.low).toBe(90);
  });
  it("isStale honours the TTL", () => {
    const now = Date.UTC(2026, 5, 1);
    const fresh = new Date(now - 10 * 86_400_000).toISOString(); // 10d ago
    const old = new Date(now - 100 * 86_400_000).toISOString(); // 100d ago
    expect(isStale(fresh, "low", now)).toBe(false);
    expect(isStale(old, "low", now)).toBe(true);
    expect(isStale(fresh, "high", now)).toBe(true); // high TTL is 3d
  });
});

describe("diff (re-investigation)", () => {
  const prev: Snapshot = { rawScore: 6, band: "mid", matchedIndicatorIds: ["A1", "C2"], evidenceKeys: ["rdap:acme"] };
  it("first time → everything is new, no band change", () => {
    const d = diffSnapshots(null, prev);
    expect(d.firstTime).toBe(true);
    expect(d.newIndicators).toEqual(["A1", "C2"]);
  });
  it("reports new/lost indicators, score and band deltas", () => {
    const next: Snapshot = { rawScore: 13, band: "high", matchedIndicatorIds: ["A1", "D1"], evidenceKeys: ["rdap:acme", "news:scam"] };
    const d = diffSnapshots(prev, next);
    expect(d.newIndicators).toEqual(["D1"]);
    expect(d.lostIndicators).toEqual(["C2"]);
    expect(d.scoreDelta).toBe(7);
    expect(d.bandChange).toEqual({ from: "mid", to: "high" });
    expect(d.newEvidence).toEqual(["news:scam"]);
    expect(d.changed).toBe(true);
  });
  it("no change collapses", () => {
    const d = diffSnapshots(prev, { ...prev });
    expect(d.changed).toBe(false);
  });
});

describe("stats (threat landscape + coordinated targeting)", () => {
  const subjects: SubjectStat[] = [
    { subjectId: "s1", clusterId: "c1", inquiryCount: 2, latestBand: "high" },
    { subjectId: "s2", clusterId: "c1", inquiryCount: 1, latestBand: "mid" },
    { subjectId: "s3", clusterId: "c2", inquiryCount: 1, latestBand: "low" },
  ];
  const base = (id: string, cluster: string, day: number, band: "low" | "mid" | "high", theme: string): InquiryStat => ({
    subjectId: id,
    clusterId: cluster,
    ts: new Date(Date.UTC(2026, 5, day)).toISOString(),
    band,
    score: 10,
    matchedIndicatorIds: ["C2", "D1"],
    theme,
  });
  const inquiries: InquiryStat[] = [
    base("s1", "c1", 1, "high", "semiconductors"),
    base("s2", "c1", 2, "mid", "semiconductors"),
    base("s3", "c2", 3, "low", "semiconductors"),
    base("s1", "c1", 40, "high", "semiconductors"),
  ];

  it("computes totals, repeats, band distribution, frequent indicators", () => {
    const s = computeStats(inquiries, subjects);
    expect(s.totalInquiries).toBe(4);
    expect(s.uniqueSubjects).toBe(3);
    expect(s.repeatContacts).toBe(1); // s1 has 2
    expect(s.bandDistribution.high).toBe(2);
    expect(s.frequentIndicators[0]).toEqual({ id: "C2", count: 4 });
  });

  it("flags coordinated targeting when ≥3 distinct subjects cluster in a short window", () => {
    const s = computeStats(inquiries, subjects, { windowDays: 14, coordinatedThreshold: 3 });
    expect(s.coordinated.length).toBe(1);
    expect(s.coordinated[0]?.distinctSubjects).toBe(3);
    expect(s.coordinated[0]?.theme).toBe("semiconductors");
  });

  it("identifies habitual actors per cluster (aliases collapse)", () => {
    const s = computeStats(inquiries, subjects);
    const c1 = s.habitualActors.find((a) => a.clusterId === "c1");
    expect(c1?.inquiryCount).toBe(3);
    expect(c1?.subjectCount).toBe(2);
  });
});
