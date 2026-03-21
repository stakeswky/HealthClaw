import { describe, expect, it, vi } from "vitest";
import { createHealthReportTool } from "../tools/health-report.js";

describe("health_report tool wrapper", () => {
  const userId = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

  it("keeps the tool response envelope intact and prepends warnings", async () => {
    const reportService = {
      generate: vi.fn().mockResolvedValue({
        status: "report",
        markdown: "# Health Report",
        warnings: ["Note: profile data was unavailable, generic analysis used."],
      }),
    };

    const tool = createHealthReportTool({
      reportService,
      defaultFocusAreas: ["sleep"],
    });

    const result = await tool.execute("tool-1", { userId, period: "day" });

    expect(result).toEqual({
      content: [{
        type: "text",
        text: expect.stringContaining("# Health Report"),
      }],
    });
    expect(result.content[0]?.text).toContain("Note:");
    expect(reportService.generate).toHaveBeenCalledWith({
      userId,
      period: "day",
      focusAreas: ["sleep"],
    });
  });

  it("prefers explicit tool focusAreas over defaults", async () => {
    const reportService = {
      generate: vi.fn().mockResolvedValue({
        status: "report",
        markdown: "# Health Report",
        warnings: [],
      }),
    };

    const tool = createHealthReportTool({
      reportService,
      defaultFocusAreas: ["sleep"],
    });

    await tool.execute("tool-1", { userId, period: "day", focusAreas: ["fitness"] });

    expect(reportService.generate).toHaveBeenCalledWith({
      userId,
      period: "day",
      focusAreas: ["fitness"],
    });
  });

  it("returns exact hard-failure body when the shared service errors", async () => {
    const tool = createHealthReportTool({
      reportService: {
        generate: vi.fn().mockResolvedValue({
          status: "error",
          errorMessage: "boom",
          warnings: [],
        }),
      },
      defaultFocusAreas: ["general_wellness"],
    });

    const result = await tool.execute("tool-1", { userId, period: "day" });

    expect(result.content[0]?.text).toBe("Report generation failed: boom");
  });

  it("returns no-data text when the shared service reports no_data", async () => {
    const tool = createHealthReportTool({
      reportService: {
        generate: vi.fn().mockResolvedValue({
          status: "no_data",
          warnings: [],
        }),
      },
      defaultFocusAreas: ["general_wellness"],
    });

    const result = await tool.execute("tool-1", { userId, period: "day" });

    expect(result.content[0]?.text).toBe("no health data for requested period");
  });
});
