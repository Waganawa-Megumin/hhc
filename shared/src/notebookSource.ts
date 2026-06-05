// §5-7 — build a single, self-contained "source" document optimized to drop into
// NotebookLM (Enterprise) so the user can one-click an Infographic / Audio Overview
// / summary there. NotebookLM has no external generation API, so HHC's job is to
// hand it the best possible source: clear sections, a glossary (so the indicators
// can be explained), and an explicit key-facts block (infographics love numbers).
//
// Deterministic and keyless — no AI, no nationality/ethnicity, model text scrubbed.
import { BAND_GUIDANCE } from "./i18n-keys";
import { CATEGORIES, CRITICAL_OVERRIDES, indicatorById, type Lang } from "./indicators";
import { stripForbiddenLabels } from "./guardrails";
import { explainMatch, rateName } from "./matchExplain";
import type { EventLogInput } from "./eventLog";

function scrub(s: string | undefined): string {
  return stripForbiddenLabels(s ?? "").text;
}
function candidateCount(data: unknown): number {
  const c = (data as { candidates?: unknown[] } | undefined)?.candidates;
  return Array.isArray(c) ? c.length : 0;
}

const T = {
  title: { ja: "HHC リスク評価 — NotebookLM 用ソース", en: "HHC risk assessment — NotebookLM source" },
  lead: {
    ja: "このドキュメントは NotebookLM 等に取り込み、インフォグラフィック・音声概要・要約を生成するための「ソース」です。HHC が公開・適法な情報のみから自衛目的で作成した、断定ではないリスク評価です。",
    en: "This document is a self-contained source to import into NotebookLM (or similar) to generate an Infographic / Audio Overview / summary. It is a non-accusatory, self-defense risk assessment built by HHC from public, lawful information only.",
  },
  whatHead: { ja: "1. HHC とは（背景）", en: "1. What HHC is (background)" },
  what: {
    ja: [
      "求人・ヘッドハンティングを装った勧誘、または なりすまし応募者・受託者 を自己診断する、ローカル優先の自衛ツール。",
      "出力はリスク帯域（低・中・高）＋推奨アクションのみ。個人を「スパイ」と断定しない。",
      "国家・情報機関とのつながりは、所属・指定リストとの突合（カテゴリF）で捉える。国籍・民族は自動スコアの軸にしない。",
    ],
    en: [
      "A local-first self-defense tool to triage a job/headhunting approach, or a fraudulent applicant/contractor.",
      "Output is only a risk band (low/medium/high) plus a recommended action; it never labels a person.",
      "State/intelligence nexus is captured by affiliation/designation-list matching (category F); nationality/ethnicity are not the scoring axis.",
    ],
  },
  subjHead: { ja: "2. 対象（自己申告の識別子）", en: "2. Subject (self-reported identifiers)" },
  company: { ja: "会社", en: "Company" },
  domain: { ja: "ドメイン", en: "Domain" },
  person: { ja: "氏名", en: "Name" },
  fieldTitle: { ja: "肩書き・所属", en: "Title / affiliation" },
  originCtx: { ja: "出身（参考・非加点）", en: "Origin (reference, non-scored)" },
  none: { ja: "（なし）", en: "(none)" },
  verdictHead: { ja: "3. リスク判定（結論）", en: "3. Risk verdict (conclusion)" },
  band: { ja: "リスク帯域", en: "Risk band" },
  score: { ja: "スコア", en: "Score" },
  bySource: { ja: "判定根拠", en: "Determined by" },
  bySourceScore: { ja: "スコア", en: "score" },
  bySourceOverride: { ja: "クリティカル指標による強制昇格", en: "a critical indicator (forced)" },
  action: { ja: "推奨アクション", en: "Recommended action" },
  critical: { ja: "発動したクリティカル指標", en: "Critical indicators that fired" },
  keyPoints: { ja: "キーポイント（infographic向け）", en: "Key points (for the infographic)" },
  whyHead: { ja: "4. なぜこの判定か（指標の内訳）", en: "4. Why this verdict (indicator breakdown)" },
  pts: { ja: "点", en: "pts" },
  uncounted: { ja: "非加点", en: "not scored" },
  rationale: { ja: "根拠", en: "rationale" },
  coeffNote: {
    ja: "標的属性の係数（あなた側の条件）: ",
    en: "Target-attribute coefficients (about you): ",
  },
  glossHead: { ja: "5. 指標の用語集（説明用）", en: "5. Indicator glossary (for explanation)" },
  osintHead: { ja: "6. OSINTで調べた情報源（どこを）", en: "6. OSINT sources queried (where)" },
  status: { ja: "状態", en: "status" },
  hits: { ja: "候補", en: "candidates" },
  watchHead: { ja: "7. リスト合致の詳細（どう一致したか）", en: "7. Watchlist match detail (how it matched)" },
  watchNote: {
    ja: "いずれも人間の同定確認が前提の候補。弱い/翻字/同名は弱い一致で、別人・別社のことが多い。",
    en: "All are candidates pending human identity confirmation. Weak/transliteration/same-name hits are low-confidence and often a different entity.",
  },
  matchStrength: { ja: "一致度", en: "match strength" },
  fuzzy: { ja: "あいまい一致（綴り・音のみ近い）", en: "fuzzy (spelling/sound only)" },
  strong: { ja: "強い一致", en: "strong" },
  evidenceHead: { ja: "8. 根拠（出典付き）", en: "8. Evidence (with sources)" },
  unavailHead: { ja: "9. 未取得ソース（証拠なし＝無実ではない）", en: "9. Unavailable sources (absence ≠ innocence)" },
  methodHead: { ja: "10. 方法論・ガードレール", en: "10. Methodology & guardrails" },
  method: {
    ja: [
      "決定論スコア = 合致指標の重み合計 × 標的属性係数（E1 ×1.3 / E2 ×1.2）。帯域: 0–5 低 / 6–12 中 / 13+ 高。",
      "クリティカル・オーバーライド: D3単独 / C2＋D1 / 人間確認済みF1 → スコアに関わらず『高』。AIの提案より決定論が常に優先。",
      "リスト合致（F）は人間が同定を確認するまで加点しない。弱い一致はフラグのみ（F3）。",
      "国籍・民族は自動スコアにしない・自動推論しない。公開・適法な情報源のみ（ログイン背後・スクレイピング不可）。",
      "「証拠なし＝無実ではない」。リスト不掲載でスコアは下げない。",
    ],
    en: [
      "Deterministic score = sum of matched weights × target coefficients (E1 ×1.3 / E2 ×1.2). Bands: 0–5 low / 6–12 mid / 13+ high.",
      "Critical overrides: D3 alone / C2+D1 / human-confirmed F1 → force 'high' regardless of score. The deterministic score always overrides the AI.",
      "Designation-list hits (F) do not score until a human confirms identity; weak hits are flag-only (F3).",
      "Nationality/ethnicity are never auto-scored or inferred. Public, lawful sources only (no login-gated access, no scraping).",
      "\"No evidence\" is not innocence; absence from a list never lowers the score.",
    ],
  },
  factsHead: { ja: "キーファクト（数値サマリ）", en: "Key facts (numeric summary)" },
  fScore: { ja: "スコア", en: "Score" },
  fBand: { ja: "帯域", en: "Band" },
  fMatched: { ja: "加点された指標数", en: "Scored indicators" },
  fCritical: { ja: "クリティカル指標数", en: "Critical indicators" },
  fSources: { ja: "OSINT照会ソース数", en: "OSINT sources queried" },
  fWatch: { ja: "ウォッチリスト候補数", en: "Watchlist candidates" },
  fUnavail: { ja: "未取得ソース数", en: "Unavailable sources" },
  disclaimer: {
    ja: "免責: 本書は断定・告発ではなく、指標合致と公開情報に基づく自衛上のリスク評価です。特定個人を外国情報機関の構成員と断定するものではなく、民族の自動推論も行っていません。",
    en: "Disclaimer: This is not an accusation. It is a self-defense risk assessment based on indicator matches and public information; it does not assert any individual is an operative of a foreign service, and performs no automated ethnicity inference.",
  },
} as const;

export function buildNotebookLmSource(input: EventLogInput, lang: Lang): string {
  const r = input.result;
  const g = BAND_GUIDANCE[r.band];
  const out: string[] = [];
  const bandLabel = g.label[lang];

  out.push(`# ${T.title[lang]}`);
  out.push("");
  out.push(`> ${T.lead[lang]}`);
  out.push(`> generated: ${input.generatedAt}`);
  out.push("");

  // 1. Background
  out.push(`## ${T.whatHead[lang]}`);
  for (const x of T.what[lang]) out.push(`- ${x}`);
  out.push("");

  // 2. Subject
  out.push(`## ${T.subjHead[lang]}`);
  out.push(`- ${T.company[lang]}: ${input.subject.company || T.none[lang]}`);
  out.push(`- ${T.domain[lang]}: ${input.subject.domain || T.none[lang]}`);
  out.push(`- ${T.person[lang]}: ${input.subject.person || T.none[lang]}`);
  out.push(`- ${T.fieldTitle[lang]}: ${input.subject.title || T.none[lang]}`);
  if (input.nationalityContext) out.push(`- ${T.originCtx[lang]}: ${input.nationalityContext}`);
  out.push("");

  // 3. Verdict
  out.push(`## ${T.verdictHead[lang]}`);
  out.push(`- **${T.band[lang]}: ${bandLabel}**`);
  out.push(`- ${T.score[lang]}: ${r.rawScore} (base ${r.baseScore} × ${r.coefficient})`);
  out.push(`- ${T.bySource[lang]}: ${r.bandSource === "override" ? T.bySourceOverride[lang] : T.bySourceScore[lang]}`);
  out.push(`- ${T.action[lang]}: ${g.action4R[lang]} — ${g.detail[lang]}`);
  if (r.criticalFlags.length) {
    const labels = r.criticalFlags.map((id) => CRITICAL_OVERRIDES.find((o) => o.id === id)?.label[lang] ?? id);
    out.push(`- ${T.critical[lang]}: ${labels.join("; ")}`);
  }
  out.push("");
  out.push(`### ${T.keyPoints[lang]}`);
  const counted = r.contributing.filter((c) => c.counted);
  out.push(`- ${T.band[lang]}: ${bandLabel} / ${T.score[lang]} ${r.rawScore}`);
  for (const c of counted.slice(0, 4)) {
    out.push(`- ${c.id} (${indicatorById(c.id)?.label[lang] ?? ""}) +${c.weight}${T.pts[lang]}`);
  }
  if (input.osint && input.osint.watchlist_candidates.length) {
    out.push(`- ${T.watchHead[lang].replace(/^7\.\s*/, "")}: ${input.osint.watchlist_candidates.length}`);
  }
  out.push("");

  // 4. Why (breakdown)
  out.push(`## ${T.whyHead[lang]}`);
  for (const c of r.contributing) {
    const label = indicatorById(c.id)?.label[lang] ?? "";
    const weight = c.counted ? `+${c.weight}${T.pts[lang]}` : `0 (${T.uncounted[lang]})`;
    const sug = input.suggestions[c.id];
    const why = sug?.rationale ? ` — ${T.rationale[lang]}: ${scrub(sug.rationale)}` : "";
    out.push(`- **${c.id}** ${label}: ${weight}${why}`);
  }
  const coeffs: string[] = [];
  if (input.coefficients.E1) coeffs.push(`E1 (${indicatorById("E1")?.label[lang] ?? "E1"}) ×1.3`);
  if (input.coefficients.E2) coeffs.push(`E2 (${indicatorById("E2")?.label[lang] ?? "E2"}) ×1.2`);
  if (coeffs.length) out.push(`- ${T.coeffNote[lang]}${coeffs.join(", ")}`);
  out.push("");

  // 5. Glossary — distinct categories + the specific matched indicators.
  out.push(`## ${T.glossHead[lang]}`);
  const glossIds = [...new Set(r.contributing.map((c) => c.id))];
  const cats = [...new Set(glossIds.map((id) => indicatorById(id)?.category).filter(Boolean))] as string[];
  for (const cat of cats) {
    out.push(`- **${cat}** — ${CATEGORIES[cat as keyof typeof CATEGORIES]?.label[lang] ?? cat}`);
  }
  for (const id of glossIds) {
    const ind = indicatorById(id);
    if (ind) out.push(`  - ${id}: ${ind.label[lang]} — ${ind.description[lang]}`);
  }
  out.push("");

  // OSINT-derived sections.
  const o = input.osint;
  if (o) {
    out.push(`## ${T.osintHead[lang]}`);
    for (const tr of o.tool_runs) {
      const hits = candidateCount(tr.data);
      const hitTxt = hits > 0 ? ` (${hits} ${T.hits[lang]})` : "";
      const cite = tr.citation ? ` — ${scrub(tr.citation)}` : "";
      out.push(`- \`${tr.tool}\` — ${T.status[lang]}: ${tr.status}${hitTxt}${cite}${tr.source_url ? ` <${tr.source_url}>` : ""}`);
    }
    out.push("");

    if (o.watchlist_candidates.length) {
      out.push(`## ${T.watchHead[lang]}`);
      out.push(`> ${T.watchNote[lang]}`);
      for (const w of o.watchlist_candidates) {
        const ex = explainMatch(w.query, w.matched_entity);
        const matchKind = ex.fuzzyOnly ? T.fuzzy[lang] : T.strong[lang];
        const pct = typeof w.score === "number" ? `${Math.round(w.score * 100)}% (${rateName(w.score)})` : "n/a";
        out.push(`- **${w.maps_to}** ${w.list}: \`${w.query}\` → \`${w.matched_entity}\``);
        out.push(`  - ${T.matchStrength[lang]}: ${pct} · ${matchKind}`);
      }
      out.push("");
    }

    if (o.evidence.length) {
      out.push(`## ${T.evidenceHead[lang]}`);
      for (const e of o.evidence) out.push(`- ${scrub(e.source)}: ${scrub(e.summary)}${e.url ? ` <${e.url}>` : ""}`);
      out.push("");
    }

    out.push(`## ${T.unavailHead[lang]}`);
    out.push(o.unavailable_sources.length ? o.unavailable_sources.join(", ") : T.none[lang]);
    out.push("");
  }

  // 10. Methodology.
  out.push(`## ${T.methodHead[lang]}`);
  for (const x of T.method[lang]) out.push(`- ${x}`);
  out.push("");

  // Key facts (numbers for the infographic).
  out.push(`## ${T.factsHead[lang]}`);
  out.push(`- ${T.fScore[lang]}: ${r.rawScore}`);
  out.push(`- ${T.fBand[lang]}: ${bandLabel}`);
  out.push(`- ${T.fMatched[lang]}: ${counted.length}`);
  out.push(`- ${T.fCritical[lang]}: ${r.criticalFlags.length}`);
  out.push(`- ${T.fSources[lang]}: ${o ? o.tool_runs.length : 0}`);
  out.push(`- ${T.fWatch[lang]}: ${o ? o.watchlist_candidates.length : 0}`);
  out.push(`- ${T.fUnavail[lang]}: ${o ? o.unavailable_sources.length : 0}`);
  out.push("");

  out.push(`> ${T.disclaimer[lang]}`);
  return out.join("\n");
}
