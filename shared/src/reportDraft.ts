// §5-7 report-draft generator (pure, bilingual). Produces a CSIRT/authority draft
// from an assessment. It frames findings as indicator-based risk, never an
// accusation, and explicitly states nationality/ethnicity were not used.
import { BAND_GUIDANCE } from "./i18n-keys";
import { indicatorById, CRITICAL_OVERRIDES, type Lang } from "./indicators";
import type { Band, BandSource } from "./bands";
import type { Evidence, SubjectHint } from "./schema";

export interface AssessmentSummary {
  generatedAt: string;
  subject: SubjectHint;
  score: number;
  band: Band;
  bandSource: BandSource;
  criticalFlags: string[];
  matchedIndicatorIds: string[];
  evidence: Evidence[];
  unavailableSources: string[];
  /** Non-scored context only; included verbatim if the user provided it. */
  nationalityContext?: string;
}

const L = {
  title: { ja: "HHC リスク評価レポート（通報下書き）", en: "HHC risk assessment (report draft)" },
  generated: { ja: "生成日時", en: "Generated" },
  subject: { ja: "対象（自己申告の識別子）", en: "Subject (self-reported identifiers)" },
  band: { ja: "リスク帯域", en: "Risk band" },
  action: { ja: "推奨アクション", en: "Recommended action" },
  indicators: { ja: "合致した指標", en: "Matched indicators" },
  critical: { ja: "クリティカル指標", en: "Critical indicators" },
  evidence: { ja: "根拠（出典）", en: "Evidence (sources)" },
  unavailable: { ja: "未取得ソース（証拠なし＝無実ではない）", en: "Unavailable sources (absence ≠ innocence)" },
  context: { ja: "参考（非加点の文脈）", en: "Context (non-scored)" },
  none: { ja: "なし", en: "none" },
  disclaimer: {
    ja: "本書は断定・告発ではありません。指標合致と公開情報に基づく自衛上のリスク評価であり、特定個人を外国情報機関の構成員と断定するものではありません。国籍・民族は判定に使用していません。",
    en: "This is not an accusation. It is a self-defense risk assessment based on indicator matches and public information; it does not assert any individual is an operative of a foreign service. Nationality/ethnicity were not used in the assessment.",
  },
} as const;

export function buildReportDraft(a: AssessmentSummary, lang: Lang): { title: string; body: string } {
  const g = BAND_GUIDANCE[a.band];
  const lines: string[] = [];
  lines.push(`# ${L.title[lang]}`);
  lines.push(`${L.generated[lang]}: ${a.generatedAt}`);
  lines.push("");
  lines.push(`## ${L.subject[lang]}`);
  lines.push([a.subject.person, a.subject.title, a.subject.company, a.subject.domain].filter(Boolean).join(" · ") || L.none[lang]);
  lines.push("");
  lines.push(`## ${L.band[lang]}: ${g.label[lang]} (${a.score}${a.bandSource === "override" ? " / override" : ""})`);
  lines.push(`${L.action[lang]}: ${g.action4R[lang]} — ${g.detail[lang]}`);
  if (a.criticalFlags.length) {
    const labels = a.criticalFlags.map((id) => CRITICAL_OVERRIDES.find((o) => o.id === id)?.label[lang] ?? id);
    lines.push(`${L.critical[lang]}: ${labels.join("; ")}`);
  }
  lines.push("");
  lines.push(`## ${L.indicators[lang]}`);
  if (a.matchedIndicatorIds.length) {
    for (const id of a.matchedIndicatorIds) lines.push(`- ${id}: ${indicatorById(id)?.label[lang] ?? ""}`);
  } else {
    lines.push(`- ${L.none[lang]}`);
  }
  if (a.evidence.length) {
    lines.push("");
    lines.push(`## ${L.evidence[lang]}`);
    for (const e of a.evidence) lines.push(`- ${e.source}: ${e.summary}${e.url ? ` (${e.url})` : ""}`);
  }
  if (a.unavailableSources.length) {
    lines.push("");
    lines.push(`## ${L.unavailable[lang]}`);
    lines.push(a.unavailableSources.join(", "));
  }
  if (a.nationalityContext) {
    lines.push("");
    lines.push(`## ${L.context[lang]}`);
    lines.push(a.nationalityContext);
  }
  lines.push("");
  lines.push(`> ${L.disclaimer[lang]}`);
  return { title: L.title[lang], body: lines.join("\n") };
}
