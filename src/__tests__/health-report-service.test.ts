import { describe, expect, it, vi } from "vitest";
import { HealthReportService } from "../report/HealthReportService.js";

describe("HealthReportService", () => {
  const userId = "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890";

  const summary = {
    date: "2026-03-21",
    userId: userId.toLowerCase(),
    steps: 4321,
    activeCalories: 210,
    receivedAt: Date.now(),
    sourceDeviceId: "device-1",
    schemaVersion: 1 as const,
  };

  it("returns no_data when the requested window has no summaries", async () => {
    const store = {
      getDateRangeOptimized: vi.fn().mockResolvedValue([]),
    };
    const profileStore = {
      load: vi.fn().mockResolvedValue(null),
    };

    const service = new HealthReportService({ store, profileStore });
    const result = await service.generate({
      userId,
      period: "day",
      focusAreas: ["general_wellness"],
    });

    expect(result).toEqual({ status: "no_data", warnings: [] });
    expect(store.getDateRangeOptimized).toHaveBeenCalledWith(
      userId.toLowerCase(),
      expect.any(String),
      expect.any(String),
    );
  });

  it("returns error when summary loading fails", async () => {
    const store = {
      getDateRangeOptimized: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const profileStore = {
      load: vi.fn(),
    };

    const service = new HealthReportService({ store, profileStore });
    const result = await service.generate({
      userId,
      period: "day",
      focusAreas: ["general_wellness"],
    });

    expect(result).toEqual({ status: "error", errorMessage: "boom", warnings: [] });
  });

  it("uses the provided focusAreas verbatim when the caller resolved them explicitly", async () => {
    const store = {
      getDateRangeOptimized: vi.fn().mockResolvedValue([summary]),
    };
    const profileStore = {
      load: vi.fn().mockResolvedValue(null),
    };

    const service = new HealthReportService({ store, profileStore });
    const result = await service.generate({
      userId,
      period: "day",
      focusAreas: ["sleep"],
    });

    expect(result.status).toBe("report");
    if (result.status !== "report") {
      throw new Error("expected report result");
    }
    expect(result.markdown).toContain("Focus Areas");
    expect(result.markdown).toContain("sleep");
  });

  it("renders only Age in Profile Context for age-only profile", async () => {
    const store = {
      getDateRangeOptimized: vi.fn().mockResolvedValue([summary]),
    };
    const profileStore = {
      load: vi.fn().mockResolvedValue({ userId: userId.toLowerCase(), gender: "male", age: 32, updatedAt: 1 }),
    };

    const service = new HealthReportService({ store, profileStore });
    const result = await service.generate({
      userId,
      period: "day",
      focusAreas: ["general_wellness"],
    });

    expect(result.status).toBe("report");
    if (result.status !== "report") throw new Error("expected report");
    expect(result.markdown).toContain("## Profile Context");
    expect(result.markdown).toContain("Gender: male");
    expect(result.markdown).toContain("Age: 32");
    expect(result.markdown).not.toContain("BMI:");
  });

  it("keeps height-only profiles generic", async () => {
    const store = {
      getDateRangeOptimized: vi.fn().mockResolvedValue([summary]),
    };
    const profileStore = {
      load: vi.fn().mockResolvedValue({ userId: userId.toLowerCase(), heightCm: 172.5, updatedAt: 1 }),
    };

    const service = new HealthReportService({ store, profileStore });
    const result = await service.generate({
      userId,
      period: "day",
      focusAreas: ["general_wellness"],
    });

    expect(result.status).toBe("report");
    if (result.status !== "report") throw new Error("expected report");
    expect(result.markdown).not.toContain("## Profile Context");
    expect(result.markdown).not.toContain("BMI:");
  });

  it("renders BMI plus height and weight when both are present", async () => {
    const store = {
      getDateRangeOptimized: vi.fn().mockResolvedValue([summary]),
    };
    const profileStore = {
      load: vi.fn().mockResolvedValue({
        userId: userId.toLowerCase(),
        heightCm: 172.5,
        weightKg: 68,
        updatedAt: 1,
      }),
    };

    const service = new HealthReportService({ store, profileStore });
    const result = await service.generate({
      userId,
      period: "day",
      focusAreas: ["general_wellness"],
    });

    expect(result.status).toBe("report");
    if (result.status !== "report") throw new Error("expected report");
    expect(result.markdown).toContain("## Profile Context");
    expect(result.markdown).toContain("Height: 172.5 cm");
    expect(result.markdown).toContain("Weight: 68 kg");
    expect(result.markdown).toContain("BMI:");
    expect(result.markdown).toContain("healthy");
  });

  it("renders combined age and BMI context for a full profile", async () => {
    const store = {
      getDateRangeOptimized: vi.fn().mockResolvedValue([summary]),
    };
    const profileStore = {
      load: vi.fn().mockResolvedValue({
        userId: userId.toLowerCase(),
        gender: "male",
        age: 32,
        heightCm: 172.5,
        weightKg: 68,
        updatedAt: 1,
      }),
    };

    const service = new HealthReportService({ store, profileStore });
    const result = await service.generate({
      userId,
      period: "day",
      focusAreas: ["general_wellness"],
    });

    expect(result.status).toBe("report");
    if (result.status !== "report") throw new Error("expected report");
    expect(result.markdown).toContain("Gender: male");
    expect(result.markdown).toContain("Age: 32");
    expect(result.markdown).toContain("BMI:");
  });

  it("falls back to generic output with warnings when profile loading fails", async () => {
    const store = {
      getDateRangeOptimized: vi.fn().mockResolvedValue([summary]),
    };
    const profileStore = {
      load: vi.fn().mockRejectedValue(new Error("decrypt failed")),
    };

    const service = new HealthReportService({ store, profileStore });
    const result = await service.generate({
      userId,
      period: "day",
      focusAreas: ["general_wellness"],
    });

    expect(result.status).toBe("report");
    if (result.status !== "report") throw new Error("expected report");
    expect(result.warnings[0]).toContain("profile data was unavailable");
    expect(result.markdown).not.toContain("## Profile Context");
  });
});
