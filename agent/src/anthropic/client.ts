import Anthropic from "@anthropic-ai/sdk";
import { env } from "../env";
import type { ModelComplete } from "./interpret";

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * The real model caller backing §6 (and reusable by §7). The long guardrail system
 * prompt is marked ephemeral so it is prompt-cached across calls.
 */
export function makeModelComplete(): ModelComplete {
  const anthropic = getAnthropic();
  return async ({ system, userText, images, maxTokens }) => {
    const content: Anthropic.ContentBlockParam[] = [];
    if (userText.trim()) content.push({ type: "text", text: userText });
    for (const img of images) {
      if (!ALLOWED_IMAGE_TYPES.has(img.mediaType)) continue;
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: img.dataBase64,
        },
      });
    }
    if (content.length === 0) content.push({ type: "text", text: "(no content)" });

    const resp = await anthropic.messages.create({
      model: env.HHC_MODEL,
      max_tokens: maxTokens ?? 1024,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
    });

    return resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
  };
}
