import { describe, expect, it, vi } from "vitest";
import { DailyReportScheduler } from "../scheduler/daily-report.js";

describe("DailyReportScheduler", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  it("uses day period for scheduled reports", async () => {
    const reportService = {
      generate: vi.fn().mockResolvedValue({
        status: "report",
        markdown: "# Report",
        warnings: [],
      }),
    };
    const scheduler = new DailyReportScheduler({
      reportTime: "08:00",
      store: {
        getStats: vi.fn().mockResolvedValue({
          users: [{ userId: "user-1", dailyRecordCount: 1, monthlyRecordCount: 0, earliestDate: null, latestDate: null }],
          totalRecords: 1,
          recordsByType: { daily: 1, monthly: 0 },
        }),
      } as never,
      logger,
      focusAreas: ["sleep"],
      language: "zh-CN",
      reportService: reportService as never,
      deliveryService: { send: vi.fn().mockResolvedValue("sent") } as never,
    });

    await scheduler.generateReport();

    expect(reportService.generate).toHaveBeenCalledWith({
      userId: "user-1",
      period: "day",
      focusAreas: ["sleep"],
    });
  });

  it("skips users with no data in the current day window", async () => {
    const scheduler = new DailyReportScheduler({
      reportTime: "08:00",
      store: {
        getStats: vi.fn().mockResolvedValue({
          users: [{ userId: "user-1", dailyRecordCount: 1, monthlyRecordCount: 0, earliestDate: null, latestDate: null }],
          totalRecords: 1,
          recordsByType: { daily: 1, monthly: 0 },
        }),
      } as never,
      logger,
      focusAreas: ["sleep"],
      language: "zh-CN",
      reportService: { generate: vi.fn().mockResolvedValue({ status: "no_data", warnings: [] }) } as never,
      deliveryService: { send: vi.fn() } as never,
    });

    await scheduler.generateReport();

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining("no day data"));
  });

  it("logs warnings once per user and continues after an error result", async () => {
    const reportService = {
      generate: vi.fn()
        .mockResolvedValueOnce({
          status: "error",
          errorMessage: "boom",
          warnings: ["Note: profile data was unavailable (decrypt failed), generic analysis used."],
        })
        .mockResolvedValueOnce({
          status: "report",
          markdown: "# Report",
          warnings: [],
        }),
    };
    const scheduler = new DailyReportScheduler({
      reportTime: "08:00",
      store: {
        getStats: vi.fn().mockResolvedValue({
          users: [
            { userId: "user-1", dailyRecordCount: 1, monthlyRecordCount: 0, earliestDate: null, latestDate: null },
            { userId: "user-2", dailyRecordCount: 1, monthlyRecordCount: 0, earliestDate: null, latestDate: null },
          ],
          totalRecords: 2,
          recordsByType: { daily: 2, monthly: 0 },
        }),
      } as never,
      logger,
      focusAreas: ["sleep"],
      language: "zh-CN",
      reportService: reportService as never,
      deliveryService: { send: vi.fn().mockResolvedValue("sent") } as never,
    });

    await scheduler.generateReport();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("decrypt failed"));
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("report generation failed"));
    expect(reportService.generate).toHaveBeenCalledTimes(2);
  });
});
