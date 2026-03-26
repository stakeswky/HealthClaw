import { describe, expect, it, vi } from "vitest";
import { registerSetupCommand, renderPairingInstructions } from "../setup/setup-command.js";

describe("setup command", () => {
  it("registers only the supported health_setup command", () => {
    const api = {
      registerCommand: vi.fn(),
    };

    registerSetupCommand(api as never);

    expect(api.registerCommand).toHaveBeenCalledTimes(1);
    expect(api.registerCommand).toHaveBeenCalledWith(expect.objectContaining({ name: "health_setup" }));
  });

  it("renders Chinese pairing fallback guidance", () => {
    const text = renderPairingInstructions(
      {
        v: 1,
        type: "healthclaw-pair",
        relayURL: "https://healthclaw.proxypool.eu.org",
        gatewayDeviceId: "a".repeat(64),
        gatewayPublicKeyBase64: "gateway-public-key-base64",
      },
      "ASCII QR",
    );

    expect(text).toContain("ASCII QR");
    expect(text).toContain("当前终端本地扫码可用");
    expect(text).toContain("手动配对备用信息");
    expect(text).toContain("Relay URL：https://healthclaw.proxypool.eu.org");
    expect(text).toContain(`网关 Device ID：${"a".repeat(64)}`);
    expect(text).toContain("网关公钥（Base64）：gateway-public-key-base64");
    expect(text).toContain("\"type\": \"healthclaw-pair\"");
  });
});
