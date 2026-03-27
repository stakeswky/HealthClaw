import { describe, expect, it, vi } from "vitest";
import { DownstreamPushService } from "../downstream/DownstreamPushService.js";
import type { DownstreamHealthAnalysis } from "../shared-types/index.js";

function createTestKey(): string {
  // 32-byte Ed25519 private key in base64
  return Buffer.from(new Uint8Array(32).fill(0x42)).toString("base64");
}

function createAnalysis(): DownstreamHealthAnalysis {
  return {
    type: "health_analysis",
    period: "day",
    startDate: "2025-01-01",
    endDate: "2025-01-01",
    language: "zh-CN",
    trends: [
      { metric: "steps", direction: "increasing", changePercent: 15, currentValue: 8500, previousValue: 7391 },
    ],
    anomalies: [],
    recommendations: ["Keep up the walking"],
    generatedAtMs: Date.now(),
  };
}

describe("DownstreamPushService", () => {
  it("sends POST with correct headers and body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, messageId: "msg_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const service = new DownstreamPushService({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      config: {
        relayUrl: "https://relay.test",
        gatewayDeviceId: "gw-device-001",
        gatewayEd25519PrivateKey: createTestKey(),
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await service.pushAnalysis(createAnalysis());
    expect(result).toBe(true);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://relay.test/v1/health/downstream/gw-device-001");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers["x-openclaw-gateway-device-id"]).toBe("gw-device-001");
    expect(init.headers["x-openclaw-gateway-signature"]).toBeTruthy();
    expect(init.headers["x-openclaw-gateway-signed-at-ms"]).toBeTruthy();

    const body = JSON.parse(init.body);
    expect(body.message.type).toBe("health_analysis");
  });

  it("returns false on HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("server error", { status: 500 }),
    );

    const service = new DownstreamPushService({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      config: {
        relayUrl: "https://relay.test",
        gatewayDeviceId: "gw-device-001",
        gatewayEd25519PrivateKey: createTestKey(),
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await service.pushAnalysis(createAnalysis());
    expect(result).toBe(false);
  });

  it("returns false on network error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));

    const service = new DownstreamPushService({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as any,
      config: {
        relayUrl: "https://relay.test",
        gatewayDeviceId: "gw-device-001",
        gatewayEd25519PrivateKey: createTestKey(),
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await service.pushAnalysis(createAnalysis());
    expect(result).toBe(false);
  });
});
