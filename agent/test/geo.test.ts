import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { geoLookup, isPrivateIp } from "../src/audit/geo";

describe("audit/geo (keyless, graceful)", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("classifies private / loopback IPs (not geolocatable)", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("10.0.1.96")).toBe(true);
    expect(isPrivateIp("192.168.1.5")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });

  it("loopback / empty → unavailable, never calls the network", async () => {
    expect((await geoLookup("127.0.0.1")).status).toBe("unavailable");
    expect((await geoLookup("")).status).toBe("unavailable");
    expect(globalThis.fetch as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it("public IP → ok with country/region/city", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: "success", country: "Japan", regionName: "Tokyo", city: "Chiyoda" }),
    });
    const g = await geoLookup("203.0.113.10");
    expect(g.status).toBe("ok");
    expect(g.country).toBe("Japan");
    expect(g.city).toBe("Chiyoda");
  });

  it("unreachable endpoint → error (IP is still recorded by the caller)", async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
    expect((await geoLookup("203.0.113.20")).status).toBe("error");
  });
});
