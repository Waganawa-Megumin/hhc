import { useTranslation } from "react-i18next";

/**
 * Compact, non-blocking disclosure that pasted content is sent to the Anthropic
 * API (via the local backend) and not stored. Replaces the old blocking consent
 * gate — for a single-user personal tool, clicking "Analyze" is the consent.
 */
export function SendDisclosure() {
  const { t } = useTranslation();
  return <p className="send-note muted small">{t("interpret.sendNote")}</p>;
}
