// §7.6 personal threat landscape, computed over plain rows (DB-agnostic, testable).
import type { Band } from "./bands";

export interface InquiryStat {
  subjectId: string;
  clusterId: string;
  ts: string;
  band: Band;
  score: number;
  matchedIndicatorIds: string[];
  theme?: string;
}

export interface SubjectStat {
  subjectId: string;
  clusterId: string;
  inquiryCount: number;
  latestBand: Band;
}

export interface CoordinatedCluster {
  windowStart: string;
  windowEnd: string;
  distinctSubjects: number;
  subjectIds: string[];
  theme?: string;
}

export interface StatsResult {
  totalInquiries: number;
  uniqueSubjects: number;
  repeatContacts: number;
  bandDistribution: Record<Band, number>;
  frequentIndicators: Array<{ id: string; count: number }>;
  habitualActors: Array<{ clusterId: string; inquiryCount: number; subjectCount: number }>;
  coordinated: CoordinatedCluster[];
  probedThemes: Array<{ theme: string; count: number }>;
}

export interface StatsOptions {
  windowDays?: number;
  coordinatedThreshold?: number;
  topIndicators?: number;
}

export function computeStats(
  inquiries: InquiryStat[],
  subjects: SubjectStat[],
  opts: StatsOptions = {},
): StatsResult {
  const windowMs = (opts.windowDays ?? 14) * 86_400_000;
  const threshold = opts.coordinatedThreshold ?? 3;
  const topN = opts.topIndicators ?? 8;

  const bandDistribution: Record<Band, number> = { low: 0, mid: 0, high: 0 };
  const indicatorCounts = new Map<string, number>();
  const themeCounts = new Map<string, number>();
  for (const q of inquiries) {
    bandDistribution[q.band]++;
    for (const id of q.matchedIndicatorIds) indicatorCounts.set(id, (indicatorCounts.get(id) ?? 0) + 1);
    if (q.theme) themeCounts.set(q.theme, (themeCounts.get(q.theme) ?? 0) + 1);
  }

  const uniqueSubjects = new Set(inquiries.map((q) => q.subjectId)).size;
  const repeatContacts = subjects.filter((s) => s.inquiryCount >= 2).length;

  // Habitual actors per cluster (aliases collapse into one cluster_id).
  const clusterMap = new Map<string, { inquiryCount: number; subjects: Set<string> }>();
  for (const q of inquiries) {
    const e = clusterMap.get(q.clusterId) ?? { inquiryCount: 0, subjects: new Set<string>() };
    e.inquiryCount++;
    e.subjects.add(q.subjectId);
    clusterMap.set(q.clusterId, e);
  }
  const habitualActors = [...clusterMap.entries()]
    .map(([clusterId, e]) => ({ clusterId, inquiryCount: e.inquiryCount, subjectCount: e.subjects.size }))
    .filter((a) => a.inquiryCount >= 2 || a.subjectCount >= 2)
    .sort((a, b) => b.inquiryCount - a.inquiryCount);

  // Coordinated targeting: a short window touching ≥threshold distinct subjects.
  const sorted = [...inquiries].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const coordinated: CoordinatedCluster[] = [];
  let i = 0;
  while (i < sorted.length) {
    const startMs = new Date(sorted[i]!.ts).getTime();
    const subjectsInWindow = new Set<string>();
    const themesInWindow = new Set<string>();
    let j = i;
    while (j < sorted.length && new Date(sorted[j]!.ts).getTime() - startMs <= windowMs) {
      subjectsInWindow.add(sorted[j]!.subjectId);
      if (sorted[j]!.theme) themesInWindow.add(sorted[j]!.theme!);
      j++;
    }
    if (subjectsInWindow.size >= threshold) {
      coordinated.push({
        windowStart: sorted[i]!.ts,
        windowEnd: sorted[j - 1]!.ts,
        distinctSubjects: subjectsInWindow.size,
        subjectIds: [...subjectsInWindow],
        theme: themesInWindow.size === 1 ? [...themesInWindow][0] : undefined,
      });
      i = j;
    } else {
      i++;
    }
  }

  return {
    totalInquiries: inquiries.length,
    uniqueSubjects,
    repeatContacts,
    bandDistribution,
    frequentIndicators: [...indicatorCounts.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN),
    habitualActors,
    coordinated,
    probedThemes: [...themeCounts.entries()]
      .map(([theme, count]) => ({ theme, count }))
      .sort((a, b) => b.count - a.count),
  };
}
