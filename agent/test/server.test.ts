import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server";

describe("agent server routes (no network, no API key)", () => {
  it("GET /health reports status", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe("hhc-agent");
    expect(body.anthropicKey).toBe(false); // no key in test env
    await app.close();
  });

  it("POST /interpret without consent → 403", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/interpret",
      payload: { text: "hello", consent: false },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("consent_required");
    await app.close();
  });

  it("POST /interpret with consent but no API key → 503 no_api_key", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/interpret",
      payload: { text: "hello", consent: true },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("no_api_key");
    await app.close();
  });
});
