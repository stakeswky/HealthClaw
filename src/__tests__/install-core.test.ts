import { describe, expect, it, vi } from "vitest";
import { runInstallCore } from "../install-core/run-install-core.js";

describe("install core", () => {
  it("persists onboarding state and relay config without editing openclaw install metadata", async () => {
    const pendingStore = {
      acceptConsent: vi.fn().mockResolvedValue({ consentAcceptedAt: 1, updatedAt: 1 }),
      upsert: vi.fn().mockResolvedValue({ consentAcceptedAt: 1, gender: "male", updatedAt: 1 }),
      clear: vi.fn(),
    };
    const runSetup = vi.fn().mockResolvedValue("ASCII QR\nManual pairing fallback");

    const result = await runInstallCore(
      {
        stateRoot: "/Users/jimmy/.openclaw",
        pluginConfig: {
          relayUrl: "https://healthclaw.proxypool.eu.org",
          enableRelayPolling: true,
        },
        relay: "official",
        consent: "yes",
        gender: "male",
        age: 26,
        heightCm: 180,
        weightKg: 84,
      },
      {
        createPendingOnboardingStore: () => pendingStore as never,
        runSetup,
      },
    );

    expect(pendingStore.acceptConsent).toHaveBeenCalled();
    expect(pendingStore.upsert).toHaveBeenCalledWith({
      gender: "male",
      age: 26,
      heightCm: 180,
      weightKg: 84,
    });
    expect(runSetup).toHaveBeenCalledWith(expect.objectContaining({
      pluginConfig: expect.objectContaining({
        relayUrl: "https://healthclaw.proxypool.eu.org",
        enableRelayPolling: true,
      }),
      resolvePath: expect.any(Function),
    }), {
      connectionMode: "official",
    });
    expect(result).toBe("ASCII QR\nManual pairing fallback");
  });

  it("clears onboarding state when consent is no", async () => {
    const pendingStore = {
      acceptConsent: vi.fn(),
      upsert: vi.fn(),
      clear: vi.fn().mockResolvedValue("cleared"),
    };

    await runInstallCore(
      {
        stateRoot: "/Users/jimmy/.openclaw",
        pluginConfig: {},
        relay: "custom",
        relayURL: "https://example.com",
        consent: "no",
      },
      {
        createPendingOnboardingStore: () => pendingStore as never,
        runSetup: vi.fn().mockResolvedValue("ASCII QR"),
      },
    );

    expect(pendingStore.clear).toHaveBeenCalled();
    expect(pendingStore.acceptConsent).not.toHaveBeenCalled();
    expect(pendingStore.upsert).not.toHaveBeenCalled();
  });
});
