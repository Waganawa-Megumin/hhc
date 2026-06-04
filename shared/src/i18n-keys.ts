// Shared domain strings needed by BOTH web and agent (e.g. the agent's report
// draft reuses band guidance). UI chrome strings live in web/src/i18n/*.json.
import type { LocalizedText } from "./indicators";
import type { Band } from "./bands";

export interface BandGuidance {
  /** Colour name from §3 (grey/amber/red). */
  color: "grey" | "amber" | "red";
  label: LocalizedText;
  /** The 4R recommended action for this band. */
  action4R: LocalizedText;
  detail: LocalizedText;
}

/** §3 band → recommended action (4R). */
export const BAND_GUIDANCE: Record<Band, BandGuidance> = {
  low: {
    color: "grey",
    label: { ja: "低", en: "Low" },
    action4R: { ja: "通常の警戒", en: "Normal vigilance" },
    detail: {
      ja: "通常の警戒を保ち、やり取りの証拠保存を習慣化する。",
      en: "Keep normal vigilance; habitually preserve evidence of the exchange.",
    },
  },
  mid: {
    color: "amber",
    label: { ja: "中", en: "Medium" },
    action4R: { ja: "Realise: 検証する", en: "Realise: verify" },
    detail: {
      ja: "ビデオ通話や身元確認で相手を検証する。非公開情報は提供しない。",
      en: "Verify the other party via video call / identity checks. Do not share any non-public information.",
    },
  },
  high: {
    color: "red",
    label: { ja: "高", en: "High" },
    action4R: { ja: "Report & Remove: 停止・通報", en: "Report & Remove: stop and report" },
    detail: {
      ja: "エンゲージを停止し、証拠を保全し、所属組織のCSIRTや公安調査庁等へ通報する。",
      en: "Stop engaging, preserve evidence, and report to your organisation's CSIRT or the relevant authority.",
    },
  },
};

export function pickText(text: LocalizedText, lang: "ja" | "en"): string {
  return text[lang];
}
