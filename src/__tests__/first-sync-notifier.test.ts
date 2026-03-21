import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { FirstSyncNotifier } from "../notify/first-sync.js";

describe("FirstSyncNotifier", () => {
  it("binds pending onboarding data, generates first report, and enqueues it to the main session", async () => {
    const stateDir = `/tmp/health-first-sync-${randomUUID()}-1`;
    const pendingOnboardingStore = {
      load: vi.fn().mockResolvedValue({
        consentAcceptedAt: 1,
        gender: "male",
        age: 26,
        heightCm: 180,
        weightKg: 84,
        updatedAt: 1,
      }),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const profileStore = {
      upsert: vi.fn().mockResolvedValue(undefined),
    };
    const reportService = {
      generate: vi.fn().mockResolvedValue({
        status: "report",
        markdown: "# First Report\nAll good",
        warnings: [],
      }),
    };
    const enqueueSystemEvent = vi.fn();

    const notifier = new FirstSyncNotifier({
      stateDir,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      runtime: {
        config: {
          loadConfig: () => ({}),
        },
        system: {
          enqueueSystemEvent,
        },
      },
      config: {
        reportTime: "08:00",
        focusAreas: ["general_wellness"],
        retentionDays: 90,
        language: "zh-CN",
        dailyReport: true,
      },
      pendingOnboardingStore: pendingOnboardingStore as never,
      profileStore: profileStore as never,
      reportService: reportService as never,
    });

    await notifier.maybeNotifyFirstSync({
      userId: "a".repeat(64),
      deviceId: "b".repeat(64),
      deviceName: "天一",
      action: "created",
      summary: {
        userId: "a".repeat(64),
        date: "2026-03-21",
        steps: 11185,
        activeCalories: 589,
        exerciseMinutes: 30,
        receivedAt: Date.now(),
        sourceDeviceId: "b".repeat(64),
        schemaVersion: 1,
      },
    });

    expect(profileStore.upsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: "a".repeat(64),
      gender: "male",
      age: 26,
      heightCm: 180,
      weightKg: 84,
    }));
    expect(pendingOnboardingStore.clear).toHaveBeenCalled();
    expect(reportService.generate).toHaveBeenCalledWith({
      userId: "a".repeat(64),
      period: "day",
      focusAreas: ["general_wellness"],
    });
    expect(enqueueSystemEvent).toHaveBeenCalledWith(
      expect.stringContaining("这是首次健康分析"),
      { sessionKey: "agent:main:main" },
    );
  });

  it("falls back to generic analysis when no pending onboarding profile exists", async () => {
    const stateDir = `/tmp/health-first-sync-${randomUUID()}-2`;
    const enqueueCalls: unknown[][] = [];
    const enqueueSystemEvent = (...args: unknown[]) => {
      enqueueCalls.push(args);
    };
    const notifier = new FirstSyncNotifier({
      stateDir,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      runtime: {
        config: {
          loadConfig: () => ({}),
        },
        system: {
          enqueueSystemEvent,
        },
      },
      config: {
        reportTime: "08:00",
        focusAreas: ["general_wellness"],
        retentionDays: 90,
        language: "zh-CN",
        dailyReport: true,
      },
      pendingOnboardingStore: {
        load: vi.fn().mockResolvedValue(null),
        clear: vi.fn(),
      } as never,
      profileStore: {
        upsert: vi.fn(),
      } as never,
      reportService: {
        generate: vi.fn().mockResolvedValue({
          status: "report",
          markdown: "# Generic Report",
          warnings: ["Note: profile data was unavailable, generic analysis used."],
        }),
      } as never,
    });

    await notifier.maybeNotifyFirstSync({
      userId: "a".repeat(64),
      deviceId: "b".repeat(64),
      deviceName: "天一",
      action: "created",
      summary: {
        userId: "a".repeat(64),
        date: "2026-03-21",
        steps: 11185,
        receivedAt: Date.now(),
        sourceDeviceId: "b".repeat(64),
        schemaVersion: 1,
      },
    });

    expect(enqueueCalls).toHaveLength(1);
    expect(enqueueCalls[0]?.[0]).toEqual(expect.stringContaining("仅基于健康记录"));
    expect(enqueueCalls[0]?.[1]).toEqual({ sessionKey: "agent:main:main" });
  });
});
