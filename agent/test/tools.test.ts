import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeDomainRdapTool } from "../src/tools/domainRdap";
import { makeCertCtTool } from "../src/tools/certCt";
import { makeOpenSanctionsTool } from "../src/tools/openSanctions";
import { makeScreeningUsCslTool } from "../src/tools/screeningUsCsl";
import { makeReverseImageTool } from "../src/tools/reverseImageLinks";
import { makeWebSearchTool } from "../src/tools/webSearch";
import type { ToolContext } from "../src/tools/types";

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    offline: false,
    houjinAppId: "",
    gbizToken: "",
    openCorporatesToken: "",
    openSanctionsBaseUrl: "https://api.opensanctions.org",
    openSanctionsApiKey: "",
    tradeGovKey: "",
    ...over,
  };
}

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

describe("domain_rdap (A2)", () => {
  it("parses registration age from RDAP", async () => {
    const reg = new Date(Date.now() - 30 * 86_400_000).toISOString();
    mockFetch({ ldhName: "acme.example", events: [{ eventAction: "registration", eventDate: reg }] });
    const run = await makeDomainRdapTool(ctx()).run({ domain: "acme.example" });
    expect(run.status).toBe("ok");
    expect((run.data as { ageDays: number }).ageDays).toBeGreaterThanOrEqual(29);
  });

  it("404 → no_match with absence note", async () => {
    mockFetch("", { ok: false, status: 404 });
    const run = await makeDomainRdapTool(ctx()).run({ domain: "nope.example" });
    expect(run.status).toBe("no_match");
    expect(run.note).toMatch(/NOT evidence of innocence/);
  });

  it("offline → unavailable, available=false", async () => {
    const tool = makeDomainRdapTool(ctx({ offline: true }));
    expect(tool.available).toBe(false);
    const run = await tool.run({ domain: "x.example" });
    expect(run.status).toBe("unavailable");
  });
});

describe("cert_ct (A2)", () => {
  it("summarizes crt.sh certs", async () => {
    mockFetch([
      { not_before: "2026-01-01T00:00:00", name_value: "a.acme.example" },
      { not_before: "2026-02-01T00:00:00", name_value: "b.acme.example" },
    ]);
    const run = await makeCertCtTool(ctx()).run({ domain: "acme.example" });
    expect(run.status).toBe("ok");
    expect((run.data as { certCount: number }).certCount).toBe(2);
  });
});

describe("sanctions_opensanctions (F)", () => {
  const mk = (c: ToolContext) =>
    makeOpenSanctionsTool(c, { name: "sanctions_opensanctions", dataset: "default", description: "d" });

  it("hosted API without key → unavailable", async () => {
    const tool = mk(ctx());
    expect(tool.available).toBe(false);
    expect((await tool.run({ name: "X" })).status).toBe("unavailable");
  });

  it("self-hosted yente needs no key and maps scores to F1/F3 (pending confirmation)", async () => {
    mockFetch({
      responses: {
        q1: {
          results: [
            { caption: "ACME SANCTIONED LLC", score: 0.93, datasets: ["us_ofac_sdn"], properties: { topics: ["sanction"] } },
            { caption: "Acme Similar", score: 0.55, datasets: ["x"], properties: { topics: [] } },
          ],
        },
      },
    });
    const tool = mk(ctx({ openSanctionsBaseUrl: "http://localhost:8000" }));
    expect(tool.available).toBe(true);
    const run = await tool.run({ name: "Acme" });
    expect(run.status).toBe("ok");
    const cands = (run.data as { candidates: Array<{ maps_to: string; pending_human_confirmation: boolean }> }).candidates;
    expect(cands[0]?.maps_to).toBe("F1");
    expect(cands[0]?.pending_human_confirmation).toBe(true);
    expect(cands[1]?.maps_to).toBe("F3"); // weak score → flag only
  });
});

describe("screening_us_csl (F1)", () => {
  it("no key → unavailable", async () => {
    const tool = makeScreeningUsCslTool(ctx());
    expect(tool.available).toBe(false);
    expect((await tool.run({ name: "X" })).status).toBe("unavailable");
  });

  it("with key parses results into candidates", async () => {
    mockFetch({ results: [{ name: "Listed Co", source: "Entity List (EL)", score: 0.9 }] });
    const run = await makeScreeningUsCslTool(ctx({ tradeGovKey: "k" })).run({ name: "Listed Co" });
    expect(run.status).toBe("ok");
    expect((run.data as { candidates: unknown[] }).candidates).toHaveLength(1);
  });
});

describe("reverse_image (B1) — links only, always available", () => {
  it("returns deep links and never claims a match", async () => {
    const tool = makeReverseImageTool(ctx());
    expect(tool.available).toBe(true);
    const run = await tool.run({ imageUrl: "https://x/p.jpg" });
    expect(run.status).toBe("ok");
    const data = run.data as { links: Record<string, string>; note: string };
    expect(Object.keys(data.links)).toContain("tineye");
    expect(data.note).toMatch(/does not perform automated face matching/i);
  });
});

describe("web_search availability", () => {
  it("unavailable without an injected search backend", async () => {
    const tool = makeWebSearchTool(ctx());
    expect(tool.available).toBe(false);
    expect((await tool.run({ query: "acme" })).status).toBe("unavailable");
  });
});
