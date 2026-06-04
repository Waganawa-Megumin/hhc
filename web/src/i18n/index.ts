import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import type { Lang } from "@hhc/shared";
import ja from "./ja.json";
import en from "./en.json";

export const SUPPORTED_LANGS = ["ja", "en"] as const;
export type UiLang = (typeof SUPPORTED_LANGS)[number];

void i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  lng: "ja",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** Current UI language, narrowed to the `Lang` used by the shared KB labels. */
export function useLang(): Lang {
  const { i18n: instance } = useTranslation();
  return instance.language.startsWith("en") ? "en" : "ja";
}

export default i18n;
