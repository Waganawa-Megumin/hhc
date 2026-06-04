// Typed access to the §2 knowledge base (indicators.json). This is the single
// source of truth consumed by both web (Vite) and agent (tsx).
import raw from "./indicators.json";

export type Lang = "ja" | "en";
export type LocalizedText = Record<Lang, string>;
export type CategoryId = "A" | "B" | "C" | "D" | "E" | "F" | "G";
export type IndicatorType = "weight" | "coefficient" | "watchlist";

export interface WeightIndicator {
  id: string;
  category: CategoryId;
  type: "weight";
  weight: number;
  critical: boolean;
  label: LocalizedText;
  description: LocalizedText;
}

export interface CoefficientIndicator {
  id: string;
  category: "E";
  type: "coefficient";
  coefficient: number;
  label: LocalizedText;
  description: LocalizedText;
}

export interface WatchlistIndicator {
  id: string;
  category: "F";
  type: "watchlist";
  weight: number;
  critical: boolean;
  requiresHumanConfirm?: boolean;
  flagOnly?: boolean;
  label: LocalizedText;
  description: LocalizedText;
}

export type Indicator = WeightIndicator | CoefficientIndicator | WatchlistIndicator;

export type OverrideKind = "single" | "all" | "humanConfirmedF1";
export interface CriticalOverride {
  id: string;
  kind: OverrideKind;
  indicators: string[];
  label: LocalizedText;
}

export interface BandRange {
  min: number;
  max?: number;
}
export interface BandConfig {
  low: BandRange;
  mid: BandRange;
  high: BandRange;
}

export interface IndicatorsKB {
  version: string;
  note: string;
  bands: BandConfig;
  categories: Record<CategoryId, { label: LocalizedText }>;
  indicators: Indicator[];
  criticalOverrides: CriticalOverride[];
}

export const indicatorsKB = raw as unknown as IndicatorsKB;

export const INDICATORS: readonly Indicator[] = indicatorsKB.indicators;
export const CATEGORIES = indicatorsKB.categories;
export const CRITICAL_OVERRIDES: readonly CriticalOverride[] = indicatorsKB.criticalOverrides;
export const BANDS = indicatorsKB.bands;

const byId = new Map<string, Indicator>(INDICATORS.map((i) => [i.id, i]));

export function indicatorById(id: string): Indicator | undefined {
  return byId.get(id);
}

export function isKnownIndicator(id: string): boolean {
  return byId.has(id);
}

/** Indicators a human ticks in the checklist (weight A–D and watchlist F), in KB order. */
export function selectableIndicators(): Indicator[] {
  return INDICATORS.filter((i) => i.type === "weight" || i.type === "watchlist");
}

/** The two E coefficients. */
export function coefficientIndicators(): CoefficientIndicator[] {
  return INDICATORS.filter((i): i is CoefficientIndicator => i.type === "coefficient");
}

export function indicatorsByCategory(category: CategoryId): Indicator[] {
  return INDICATORS.filter((i) => i.category === category);
}
