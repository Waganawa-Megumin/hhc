import Anthropic from "@anthropic-ai/sdk";
import type { ToolRun } from "@hhc/shared";
import { env } from "../env";
import type { ModelComplete } from "./interpret";
import type { LoopCaller } from "./osintAgent";
import { ok, errored } from "../tools/http";

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

/** The tool-use loop caller backing §7. The loop core stays SDK-free; this adapts it. */
export function makeLoopCreateMessage(): LoopCaller {
  const anthropic = getAnthropic();
  return async ({ system, tools, messages, maxTokens }) => {
    const resp = await anthropic.messages.create({
      model: env.HHC_MODEL,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: tools as unknown as Anthropic.Tool[],
      messages: messages as unknown as Anthropic.MessageParam[],
    });
    return { content: resp.content as unknown as { type: string }[], stop_reason: resp.stop_reason };
  };
}

/** web_search tool backing: a one-shot Anthropic server-side web search. Public/lawful only. */
export function makeWebSearch(): (query: string) => Promise<ToolRun> {
  const anthropic = getAnthropic();
  return async (query: string) => {
    try {
      const resp = await anthropic.messages.create({
        model: env.HHC_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Research and summarize public, lawful information about: ${query}. Cite source URLs. Do not access login-gated pages and do not scrape LinkedIn.`,
          },
        ],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 } as unknown as Anthropic.Tool],
      });
      const text = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return ok("web_search", { summary: text }, { citation: "Anthropic web_search" });
    } catch (e) {
      return errored("web_search", (e as Error).message);
    }
  };
}
