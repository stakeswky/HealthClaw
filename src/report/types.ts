import type { HealthFocusArea } from "../types.js";
import type { ReportPeriod } from "../tools/health-report.js";

export type HealthReportServiceInput = {
  userId: string;
  period: ReportPeriod;
  focusAreas: HealthFocusArea[] | string[];
};

export type HealthReportServiceResult =
  | { status: "report"; markdown: string; warnings: string[] }
  | { status: "no_data"; warnings: string[] }
  | { status: "error"; errorMessage: string; warnings: string[] };
