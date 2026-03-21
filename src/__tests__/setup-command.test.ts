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

  it("renders terminal-local ASCII guidance with manual pairing fallback details", () => {
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
    expect(text).toContain("terminal-local");
    expect(text).toContain("Manual pairing fallback");
    expect(text).toContain("Relay URL: https://healthclaw.proxypool.eu.org");
    expect(text).toContain(`Gateway Device ID: ${"a".repeat(64)}`);
    expect(text).toContain("Gateway Public Key (Base64): gateway-public-key-base64");
    expect(text).toContain("\"type\": \"healthclaw-pair\"");
  });
});
