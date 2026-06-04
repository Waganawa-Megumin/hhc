import type { ToolRun } from "@hhc/shared";
import { ok } from "./http";
import type { OsintTool, ToolContext } from "./types";

const TOOL = "reverse_image";

/**
 * Provides deep links to reverse-image search engines for a profile photo (B1).
 * LINKS ONLY — HHC never performs automated face matching (design §13-5). The
 * human opens the links and judges. Always available (no network call, no key).
 */
export function makeReverseImageTool(_ctx: ToolContext): OsintTool {
  return {
    name: TOOL,
    description:
      "Return reverse-image-search deep links (Google Lens, TinEye, Yandex) for a profile photo URL, to help a human check for AI-generated or reused images (B1). LINKS ONLY — no automated face matching is performed or implied.",
    inputSchema: {
      type: "object",
      properties: { imageUrl: { type: "string", description: "URL of the profile photo (optional)" } },
    },
    available: true,
    async run(input): Promise<ToolRun> {
      const imageUrl = String(input.imageUrl ?? "").trim();
      const enc = encodeURIComponent(imageUrl);
      const links = imageUrl
        ? {
            googleLens: `https://lens.google.com/uploadbyurl?url=${enc}`,
            tineye: `https://tineye.com/search?url=${enc}`,
            yandex: `https://yandex.com/images/search?rpt=imageview&url=${enc}`,
          }
        : {
            googleLens: "https://lens.google.com/",
            tineye: "https://tineye.com/",
            yandex: "https://yandex.com/images/",
          };
      return ok(
        TOOL,
        {
          links,
          note: "Open these links and inspect manually. HHC does not perform automated face matching.",
        },
        { citation: "reverse-image search (links only)" },
      );
    },
  };
}
