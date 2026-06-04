import { useState, type ClipboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { SendDisclosure } from "./ConsentGate";
import { httpAgentClient } from "../api/httpAgentClient";
import type { AgentHealth } from "../api/httpAgentClient";
import type { ChecklistController } from "../state/useChecklist";

interface Attachment {
  kind: "image" | "pdf";
  mediaType: string;
  dataBase64: string;
  previewUrl?: string;
  name?: string;
}

// Anthropic rejects images whose dimensions exceed 8000px and downsamples
// anything over ~1568px on the long edge anyway, so resize images client-side to
// a safe long edge before sending. PDFs are sent as-is (document blocks).
const MAX_EDGE = 1568;
const MAX_PDF_BYTES = 32 * 1024 * 1024; // Anthropic PDF size limit

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

function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/** Read an image (downscaled) or a PDF (as-is). Returns null for an oversized PDF. */
async function readAttachment(file: File): Promise<Attachment | null> {
  if (file.type === "application/pdf") {
    if (file.size > MAX_PDF_BYTES) return null;
    const dataUrl = await fileToDataUrl(file);
    return { kind: "pdf", mediaType: "application/pdf", dataBase64: base64FromDataUrl(dataUrl), name: file.name };
  }
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
    return { kind: "image", mediaType: "image/jpeg", dataBase64: base64FromDataUrl(out), previewUrl: out };
  } catch {
    return { kind: "image", mediaType: file.type || "image/png", dataBase64: base64FromDataUrl(original), previewUrl: original };
  }
}

const MAX_TEXT_BYTES = 200 * 1024;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|log|ya?ml|html?|eml|text)$/i;

function isMedia(f: File): boolean {
  return f.type.startsWith("image/") || f.type === "application/pdf";
}

function isTextFile(f: File): boolean {
  return f.type.startsWith("text/") || f.type === "application/json" || TEXT_EXT.test(f.name);
}

async function readTextFile(file: File): Promise<{ name: string; body: string; truncated: boolean }> {
  const truncated = file.size > MAX_TEXT_BYTES;
  const body = await (truncated ? file.slice(0, MAX_TEXT_BYTES) : file).text();
  return { name: file.name, body, truncated };
}

export function PasteIntake({ c, health }: { c: ChecklistController; health: AgentHealth | null }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [images, setImages] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "interpret" | "osint">("idle");
  const [withOsint, setWithOsint] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const backendReady = health?.ok === true;
  const offline = health?.offline === true;
  const noKey = health ? health.anthropicKey === false : false;
  const canSend = backendReady && !offline && !noKey && !busy && (text.trim().length > 0 || images.length > 0);

  async function addFiles(incoming: File[]) {
    const media = incoming.filter(isMedia);
    const texts = incoming.filter((f) => !isMedia(f) && isTextFile(f));

    if (media.length > 0) {
      const read = await Promise.all(media.map(readAttachment));
      const ok = read.filter((a): a is Attachment => a !== null);
      if (ok.length < media.length) setError(t("interpret.pdfTooLarge"));
      setImages((prev) => [...prev, ...ok].slice(0, 8));
    }
    if (texts.length > 0) {
      // Text files are folded into the textarea (transparent + editable).
      const parts = await Promise.all(texts.map(readTextFile));
      const appended = parts
        .map((p) => `\n\n----- ${p.name} -----\n${p.body}${p.truncated ? "\n…(truncated)" : ""}`)
        .join("");
      setText((prev) => (prev + appended).replace(/^\n+/, ""));
    }
  }

  async function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData.items)
      .filter((it) => it.kind === "file")
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    await addFiles(files);
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    void addFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    void addFiles(Array.from(e.dataTransfer.files));
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

      <div
        className={dragging ? "dropzone dragover" : "dropzone"}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <textarea
          className="intake-text"
          rows={5}
          placeholder={t("interpret.textareaPlaceholder")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
        />
        {dragging ? <div className="drop-hint">{t("interpret.dropHint")}</div> : null}
      </div>
      <div className="intake-actions">
        <label className="ghost file-btn">
          {t("interpret.addImages")}
          <input
            type="file"
            accept="image/*,application/pdf,text/*,.md,.markdown,.csv,.tsv,.log,.json,.yml,.yaml,.eml"
            multiple
            hidden
            onChange={onPickFiles}
          />
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
          {images.map((att, i) =>
            att.kind === "pdf" ? (
              <span key={i} className="thumb pdf-chip" title={att.name}>
                📄 {att.name ?? "PDF"}
              </span>
            ) : (
              <img key={i} src={att.previewUrl} alt={`pasted-${i}`} className="thumb" />
            ),
          )}
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
