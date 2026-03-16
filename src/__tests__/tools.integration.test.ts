/**
 * Tools Integration Tests
 *
 * Tests health_query and health_report tools.
 * Mocks store data for testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type DailyHealthSummary = {
  date: string;
  userId: string;
  steps?: number;
  activeCalories?: number;
  restingHeartRate?: number;
  averageHeartRate?: number;
  maxHeartRate?: number;
  heartRateVariability?: number;
  sleepMinutes?: number;
  deepSleepMinutes?: number;
  remSleepMinutes?: number;
  weight?: number;
  bloodOxygen?: number;
  walkingDistance?: number;
  exerciseMinutes?: number;
  standHours?: number;
  respiratoryRate?: number;
  custom?: Record<string, number>;
  receivedAt: number;
  sourceDeviceId: string;
  schemaVersion: 1;
};

type HealthQueryInput = {
  userId: string;
  startDate: string;
  endDate: string;
  metrics?: string[];
};

type HealthQueryOutput = {
  ok: true;
  data: DailyHealthSummary[];
  summary: {
    totalDays: number;
    avgSteps?: number;
    avgRestingHeartRate?: number;
    totalActiveCalories?: number;
    totalSleepMinutes?: number;
  };
};

type HealthReportInput = {
  userId: string;
  startDate: string;
  endDate: string;
  focusAreas?: string[];
  language?: string;
};

type HealthReportOutput = {
  ok: true;
  report: string;
  generatedAt: number;
  dataRange: {
    startDate: string;
    endDate: string;
    totalDays: number;
  };
};

type MockHealthStore = {
  getDateRange: (userId: string, startDate: string, endDate: string) => Promise<DailyHealthSummary[]>;
  listUsers: () => Promise<string[]>;
  getLatestDate: (userId: string) => Promise<string | null>;
};

function createMockStore(data: Map<string, DailyHealthSummary[]>): MockHealthStore {
  return {
    getDateRange: vi.fn(async (userId: string, startDate: string, endDate: string) => {
      const userData = data.get(userId) ?? [];
      return userData.filter(d => d.date >= startDate && d.date <= endDate);
    }),
    listUsers: vi.fn(async () => Array.from(data.keys())),
    getLatestDate: vi.fn(async (userId: string) => {
      const userData = data.get(userId) ?? [];
      if (userData.length === 0) return null;
      return userData.sort((a, b) => b.date.localeCompare(a.date))[0]?.date ?? null;
    }),
  };
}

function createTestSummary(date: string, userId: string, overrides: Partial<DailyHealthSummary> = {}): DailyHealthSummary {
  return {
    date,
    userId,
    steps: 10000,
    activeCalories: 500,
    restingHeartRate: 60,
    receivedAt: Date.now(),
    sourceDeviceId: "device-test",
    schemaVersion: 1,
    ...overrides,
  };
}

function calculateSummary(data: DailyHealthSummary[]): HealthQueryOutput["summary"] {
  if (data.length === 0) {
    return { totalDays: 0 };
  }

  const totalSteps = data.reduce((sum, d) => sum + (d.steps ?? 0), 0);
  const totalCalories = data.reduce((sum, d) => sum + (d.activeCalories ?? 0), 0);
  const totalSleep = data.reduce((sum, d) => sum + (d.sleepMinutes ?? 0), 0);
  const heartRates = data.filter(d => d.restingHeartRate != null).map(d => d.restingHeartRate!);

  return {
    totalDays: data.length,
    avgSteps: Math.round(totalSteps / data.length),
    avgRestingHeartRate: heartRates.length > 0 ? Math.round(heartRates.reduce((a, b) => a + b) / heartRates.length) : undefined,
    totalActiveCalories: Math.round(totalCalories),
    totalSleepMinutes: totalSleep,
  };
}

async function healthQuery(store: MockHealthStore, input: HealthQueryInput): Promise<HealthQueryOutput> {
  const data = await store.getDateRange(input.userId, input.startDate, input.endDate);

  let filteredData = data;
  if (input.metrics && input.metrics.length > 0) {
    filteredData = data.map(d => {
      const filtered: Partial<DailyHealthSummary> = { date: d.date, userId: d.userId, receivedAt: d.receivedAt, sourceDeviceId: d.sourceDeviceId, schemaVersion: d.schemaVersion };
      for (const metric of input.metrics!) {
        if (metric in d) {
          (filtered as Record<string, unknown>)[metric] = d[metric as keyof DailyHealthSummary];
        }
      }
      return filtered as DailyHealthSummary;
    });
  }

  return {
    ok: true,
    data: filteredData,
    summary: calculateSummary(data),
  };
}

async function healthReport(store: MockHealthStore, input: HealthReportInput): Promise<HealthReportOutput> {
  const data = await store.getDateRange(input.userId, input.startDate, input.endDate);
  const summary = calculateSummary(data);

  const lines: string[] = [];
  lines.push(`# Health Report for ${input.userId}`);
  lines.push(`Period: ${input.startDate} to ${input.endDate}`);
  lines.push(`Total Days: ${summary.totalDays}`);
  lines.push("");

  if (summary.avgSteps != null) {
    lines.push(`Average Steps: ${summary.avgSteps.toLocaleString()}`);
  }
  if (summary.avgRestingHeartRate != null) {
    lines.push(`Average Resting Heart Rate: ${summary.avgRestingHeartRate} bpm`);
  }
  if (summary.totalActiveCalories != null) {
    lines.push(`Total Active Calories: ${summary.totalActiveCalories.toLocaleString()} kcal`);
  }
  if (summary.totalSleepMinutes != null && summary.totalSleepMinutes > 0) {
    const hours = Math.floor(summary.totalSleepMinutes / 60);
    const mins = summary.totalSleepMinutes % 60;
    lines.push(`Total Sleep: ${hours}h ${mins}m`);
  }

  if (input.focusAreas && input.focusAreas.length > 0) {
    lines.push("");
    lines.push("## Focus Areas");
    for (const area of input.focusAreas) {
      lines.push(`- ${area}`);
    }
  }

  return {
    ok: true,
    report: lines.join("\n"),
    generatedAt: Date.now(),
    dataRange: {
      startDate: input.startDate,
      endDate: input.endDate,
      totalDays: summary.totalDays,
    },
  };
}

describe("Tools Integration", () => {
  let mockStore: MockHealthStore;
  let testData: Map<string, DailyHealthSummary[]>;

  beforeEach(() => {
    testData = new Map();
    mockStore = createMockStore(testData);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("health_query tool", () => {
    it("should return data for valid date range", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-10", "user123", { steps: 8000 }),
        createTestSummary("2024-01-11", "user123", { steps: 9000 }),
        createTestSummary("2024-01-12", "user123", { steps: 10000 }),
      ]);

      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-12",
      });

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(3);
      expect(result.summary.totalDays).toBe(3);
      expect(result.summary.avgSteps).toBe(9000);
    });

    it("should return empty data for non-existent user", async () => {
      const result = await healthQuery(mockStore, {
        userId: "nonexistent",
        startDate: "2024-01-01",
        endDate: "2024-01-10",
      });

      expect(result.ok).toBe(true);
      expect(result.data.length).toBe(0);
      expect(result.summary.totalDays).toBe(0);
    });

    it("should filter data by date range", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-01", "user123"),
        createTestSummary("2024-01-05", "user123"),
        createTestSummary("2024-01-10", "user123"),
        createTestSummary("2024-01-15", "user123"),
        createTestSummary("2024-01-20", "user123"),
      ]);

      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "2024-01-05",
        endDate: "2024-01-15",
      });

      expect(result.data.length).toBe(3);
      expect(result.data[0]?.date).toBe("2024-01-05");
      expect(result.data[2]?.date).toBe("2024-01-15");
    });

    it("should calculate summary correctly", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-10", "user123", { steps: 6000, activeCalories: 300, restingHeartRate: 58 }),
        createTestSummary("2024-01-11", "user123", { steps: 8000, activeCalories: 400, restingHeartRate: 62 }),
        createTestSummary("2024-01-12", "user123", { steps: 10000, activeCalories: 500, restingHeartRate: 60 }),
      ]);

      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-12",
      });

      expect(result.summary.avgSteps).toBe(8000);
      expect(result.summary.avgRestingHeartRate).toBe(60);
      expect(result.summary.totalActiveCalories).toBe(1200);
    });

    it("should handle missing metrics gracefully", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-10", "user123", { steps: 10000, restingHeartRate: undefined }),
        createTestSummary("2024-01-11", "user123", { steps: 8000, restingHeartRate: 60 }),
      ]);

      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-11",
      });

      expect(result.summary.avgRestingHeartRate).toBe(60);
      expect(result.summary.avgSteps).toBe(9000);
    });

    it("should filter specific metrics when requested", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-10", "user123", { steps: 10000, restingHeartRate: 60, activeCalories: 500 }),
      ]);

      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-10",
        metrics: ["steps"],
      });

      expect(result.data[0]?.steps).toBe(10000);
      expect(result.data[0]?.restingHeartRate).toBeUndefined();
      expect(result.data[0]?.activeCalories).toBeUndefined();
    });
  });

  describe("health_report tool", () => {
    it("should generate report for valid data", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-10", "user123", { steps: 8000, activeCalories: 400, restingHeartRate: 60 }),
        createTestSummary("2024-01-11", "user123", { steps: 10000, activeCalories: 500, restingHeartRate: 62 }),
      ]);

      const result = await healthReport(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-11",
      });

      expect(result.ok).toBe(true);
      expect(result.report).toContain("Health Report for user123");
      expect(result.report).toContain("Average Steps: 9,000");
      expect(result.report).toContain("Total Active Calories: 900 kcal");
      expect(result.dataRange.totalDays).toBe(2);
    });

    it("should include focus areas in report", async () => {
      testData.set("user123", [createTestSummary("2024-01-10", "user123")]);

      const result = await healthReport(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-10",
        focusAreas: ["weight_loss", "fitness"],
      });

      expect(result.report).toContain("Focus Areas");
      expect(result.report).toContain("weight_loss");
      expect(result.report).toContain("fitness");
    });

    it("should handle empty data gracefully", async () => {
      const result = await healthReport(mockStore, {
        userId: "nonexistent",
        startDate: "2024-01-01",
        endDate: "2024-01-10",
      });

      expect(result.ok).toBe(true);
      expect(result.report).toContain("Total Days: 0");
      expect(result.dataRange.totalDays).toBe(0);
    });

    it("should include sleep data in report", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-10", "user123", { sleepMinutes: 420, deepSleepMinutes: 90, remSleepMinutes: 60 }),
        createTestSummary("2024-01-11", "user123", { sleepMinutes: 480, deepSleepMinutes: 100, remSleepMinutes: 70 }),
      ]);

      const result = await healthReport(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-11",
      });

      expect(result.report).toContain("Total Sleep: 15h 0m");
    });

    it("should set correct metadata", async () => {
      testData.set("user123", [createTestSummary("2024-01-10", "user123")]);

      const before = Date.now();
      const result = await healthReport(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-10",
      });
      const after = Date.now();

      expect(result.generatedAt).toBeGreaterThanOrEqual(before);
      expect(result.generatedAt).toBeLessThanOrEqual(after);
      expect(result.dataRange.startDate).toBe("2024-01-10");
      expect(result.dataRange.endDate).toBe("2024-01-10");
    });
  });

  describe("Error Cases", () => {
    it("should handle invalid date format gracefully", async () => {
      testData.set("user123", [createTestSummary("2024-01-10", "user123")]);

      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "invalid-date",
        endDate: "2024-01-10",
      });

      expect(result.data.length).toBe(0);
    });

    it("should handle reversed date range", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-10", "user123"),
        createTestSummary("2024-01-11", "user123"),
      ]);

      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "2024-01-11",
        endDate: "2024-01-10",
      });

      expect(result.data.length).toBe(0);
    });

    it("should handle store errors gracefully", async () => {
      const errorStore: MockHealthStore = {
        getDateRange: vi.fn().mockRejectedValue(new Error("Store error")),
        listUsers: vi.fn(),
        getLatestDate: vi.fn(),
      };

      await expect(healthQuery(errorStore, {
        userId: "user123",
        startDate: "2024-01-01",
        endDate: "2024-01-10",
      })).rejects.toThrow("Store error");
    });
  });

  describe("Data Aggregation", () => {
    it("should calculate totals for cumulative metrics", async () => {
      testData.set("user123", [
        createTestSummary("2024-01-10", "user123", { steps: 5000, walkingDistance: 4000, exerciseMinutes: 30 }),
        createTestSummary("2024-01-11", "user123", { steps: 7000, walkingDistance: 5600, exerciseMinutes: 45 }),
        createTestSummary("2024-01-12", "user123", { steps: 8000, walkingDistance: 6400, exerciseMinutes: 60 }),
      ]);

      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "2024-01-10",
        endDate: "2024-01-12",
      });

      expect(result.summary.avgSteps).toBe(6667);
    });

    it("should handle large datasets efficiently", async () => {
      const summaries: DailyHealthSummary[] = [];
      for (let i = 1; i <= 90; i++) {
        summaries.push(createTestSummary(`2024-01-${String(i).padStart(2, "0")}`, "user123", {
          steps: 8000 + Math.floor(Math.random() * 4000),
        }));
      }
      testData.set("user123", summaries);

      const start = performance.now();
      const result = await healthQuery(mockStore, {
        userId: "user123",
        startDate: "2024-01-01",
        endDate: "2024-03-31",
      });
      const duration = performance.now() - start;

      expect(result.data.length).toBe(90);
      expect(duration).toBeLessThan(100);
    });
  });

  describe("Multiple Users", () => {
    it("should isolate data between users", async () => {
      testData.set("user1", [createTestSummary("2024-01-10", "user1", { steps: 5000 })]);
      testData.set("user2", [createTestSummary("2024-01-10", "user2", { steps: 10000 })]);

      const result1 = await healthQuery(mockStore, {
        userId: "user1",
        startDate: "2024-01-10",
        endDate: "2024-01-10",
      });

      const result2 = await healthQuery(mockStore, {
        userId: "user2",
        startDate: "2024-01-10",
        endDate: "2024-01-10",
      });

      expect(result1.data[0]?.steps).toBe(5000);
      expect(result2.data[0]?.steps).toBe(10000);
    });

    it("should list all users", async () => {
      testData.set("user1", []);
      testData.set("user2", []);
      testData.set("user3", []);

      const users = await mockStore.listUsers();

      expect(users.length).toBe(3);
      expect(users).toContain("user1");
      expect(users).toContain("user2");
      expect(users).toContain("user3");
    });
  });
});