import { useState, type ClipboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { SendDisclosure } from "./ConsentGate";
import { httpAgentClient } from "../api/httpAgentClient";
import type { AgentHealth } from "../api/httpAgentClient";
import type { ChecklistController } from "../state/useChecklist";

interface PastedImage {
  mediaType: string;
  dataBase64: string;
  previewUrl: string;
}

// Anthropic rejects images whose dimensions exceed 8000px and downsamples
// anything over ~1568px on the long edge anyway, so resize client-side to a safe
// long edge before sending. Avoids "image dimensions exceed max allowed size".
const MAX_EDGE = 1568;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUrl;
  });
}

async function readImageFile(file: File): Promise<PastedImage> {
  const original = await fileToDataUrl(file);
  try {
    const img = await loadImage(original);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    const scale = Math.min(1, MAX_EDGE / (longest || 1));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", 0.85);
    const comma = out.indexOf(",");
    return { mediaType: "image/jpeg", dataBase64: comma >= 0 ? out.slice(comma + 1) : out, previewUrl: out };
  } catch {
    // Fallback: send the original if canvas processing fails.
    const comma = original.indexOf(",");
    return {
      mediaType: file.type || "image/png",
      dataBase64: comma >= 0 ? original.slice(comma + 1) : original,
      previewUrl: original,
    };
  }
}

export function PasteIntake({ c, health }: { c: ChecklistController; health: AgentHealth | null }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [images, setImages] = useState<PastedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "interpret" | "osint">("idle");
  const [withOsint, setWithOsint] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const backendReady = health?.ok === true;
  const offline = health?.offline === true;
  const noKey = health ? health.anthropicKey === false : false;
  const canSend = backendReady && !offline && !noKey && !busy && (text.trim().length > 0 || images.length > 0);

  async function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    const read = await Promise.all(files.map(readImageFile));
    setImages((prev) => [...prev, ...read].slice(0, 8));
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    const read = await Promise.all(files.map(readImageFile));
    setImages((prev) => [...prev, ...read].slice(0, 8));
    e.target.value = "";
  }

  async function runAnalyze() {
    setBusy(true);
    setError(null);
    setPhase("interpret");
    try {
      const result = await httpAgentClient.analyzeApproach({
        text,
        images: images.map((i) => ({ mediaType: i.mediaType, dataBase64: i.dataBase64 })),
        consent: true,
      });
      c.applyInterpretResult(result); // auto-ticks the matched indicators
      const hint = result.subject_hint;
      const hasId = !!(hint && (hint.company || hint.domain || hint.person));
      if (withOsint && hasId) {
        setPhase("osint");
        try {
          const osint = await httpAgentClient.runOsintAgent(hint);
          c.applyOsintResult(osint); // auto-pulls + auto-applies F2/F3 (F1 stays for confirm)
        } catch (e) {
          setError(`OSINT: ${(e as Error).message}`);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      setPhase("idle");
    }
  }

  function clearIntake() {
    setText("");
    setImages([]);
    setError(null);
  }

  return (
    <section className="intake" aria-label={t("interpret.heading")}>
      <div className="section-head">
        <h2>{t("interpret.heading")}</h2>
        {!backendReady ? <span className="net-badge offline">{t("interpret.backendUnavailable")}</span> : null}
      </div>
      <p className="muted">{t("interpret.intro")}</p>

      <textarea
        className="intake-text"
        rows={5}
        placeholder={t("interpret.textareaPlaceholder")}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
      />
      <div className="intake-actions">
        <label className="ghost file-btn">
          {t("interpret.addImages")}
          <input type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
        </label>
        <label className="osint-toggle small">
          <input type="checkbox" checked={withOsint} onChange={(e) => setWithOsint(e.target.checked)} disabled={busy} />
          {t("interpret.alsoOsint")}
        </label>
        <div className="spacer" />
        <button type="button" className="ghost" onClick={clearIntake} disabled={busy}>
          {t("interpret.clear")}
        </button>
        <button type="button" className="primary" onClick={runAnalyze} disabled={!canSend}>
          {busy
            ? phase === "osint"
              ? t("interpret.phaseOsint")
              : t("interpret.phaseInterpret")
            : t("interpret.analyzeBtn")}
        </button>
      </div>
      <SendDisclosure />

      {images.length > 0 ? (
        <div className="thumbs">
          {images.map((img, i) => (
            <img key={i} src={img.previewUrl} alt={`pasted-${i}`} className="thumb" />
          ))}
        </div>
      ) : null}

      {offline ? <p className="warn">{t("interpret.backendOffline")}</p> : null}
      {noKey ? <p className="warn">{t("interpret.noKey")}</p> : null}
      {error ? <p className="warn">{t("interpret.error", { msg: error })}</p> : null}

      {c.aiNotes ? <AiNotesView c={c} /> : null}
    </section>
  );
}

function AiNotesView({ c }: { c: ChecklistController }) {
  const { t } = useTranslation();
  const notes = c.aiNotes!;
  const hint = c.subjectHint;
  const hasHint = hint && (hint.company || hint.domain || hint.person || hint.title);
  return (
    <div className="ai-notes">
      <p className="ai-tag">{t("interpret.aiTag")}</p>
      {hasHint ? (
        <p className="subject-hint">
          {[hint?.person, hint?.title, hint?.company, hint?.domain].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {notes.notes ? <p>{notes.notes}</p> : null}
      {notes.observations.length > 0 ? (
        <ul>
          {notes.observations.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      ) : null}
      {notes.suggestedBand ? (
        <p className="muted small">{t("interpret.suggestedBandHint", { band: notes.suggestedBand })}</p>
      ) : null}
    </div>
  );
}
