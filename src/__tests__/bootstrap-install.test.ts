import { describe, expect, it, vi } from "vitest";
import { runBootstrapInstall } from "../bootstrap/install.js";

describe("bootstrap install", () => {
  it("writes plugin config, stores onboarding profile, runs official setup, and schedules delayed restart", async () => {
    let savedConfig: Record<string, unknown> | undefined;
    const pendingStore = {
      acceptConsent: vi.fn().mockResolvedValue({ consentAcceptedAt: 1, updatedAt: 1 }),
      upsert: vi.fn().mockResolvedValue({ consentAcceptedAt: 1, gender: "male", age: 26, updatedAt: 1 }),
      clear: vi.fn(),
    };
    const runSetup = vi.fn().mockResolvedValue("ASCII QR\nManual pairing fallback");
    const scheduleRestart = vi.fn().mockResolvedValue(undefined);

    const result = await runBootstrapInstall(
      {
        pluginPath: "/Users/jimmy/HealthClaw",
        configPath: "/Users/jimmy/.openclaw/openclaw.json",
        relay: "official",
        consent: "yes",
        gender: "male",
        age: 26,
        heightCm: 180,
        weightKg: 84,
        restartDelayMs: 1500,
      },
      {
        readConfig: async () => ({}),
        writeConfig: async (_configPath, config) => {
          savedConfig = config;
        },
        createPendingOnboardingStore: () => pendingStore as never,
        runSetup,
        scheduleRestart,
      },
    );

    expect(savedConfig).toMatchObject({
      plugins: {
        load: {
          paths: ["/Users/jimmy/HealthClaw"],
        },
        entries: {
          health: {
            enabled: true,
            config: {
              relayUrl: "https://healthclaw.proxypool.eu.org",
              enableRelayPolling: true,
              relayPollIntervalMs: 30000,
            },
          },
        },
        installs: {
          health: {
            source: "path",
            sourcePath: "/Users/jimmy/HealthClaw",
            installPath: "/Users/jimmy/HealthClaw",
          },
        },
      },
    });
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
      }),
    }), {
      connectionMode: "official",
    });
    expect(scheduleRestart).toHaveBeenCalledWith(1500);
    expect(result).toContain("ASCII QR");
  });

  it("clears pending onboarding when consent is no", async () => {
    const pendingStore = {
      acceptConsent: vi.fn(),
      upsert: vi.fn(),
      clear: vi.fn().mockResolvedValue("cleared"),
    };

    await runBootstrapInstall(
      {
        pluginPath: "/Users/jimmy/HealthClaw",
        configPath: "/Users/jimmy/.openclaw/openclaw.json",
        relay: "official",
        consent: "no",
      },
      {
        readConfig: async () => ({}),
        writeConfig: async () => undefined,
        createPendingOnboardingStore: () => pendingStore as never,
        runSetup: vi.fn().mockResolvedValue("ASCII QR"),
        scheduleRestart: vi.fn().mockResolvedValue(undefined),
      },
    );

    expect(pendingStore.clear).toHaveBeenCalled();
    expect(pendingStore.acceptConsent).not.toHaveBeenCalled();
    expect(pendingStore.upsert).not.toHaveBeenCalled();
  });
});
