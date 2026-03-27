import type { HealthFocusArea } from "../types.js";
import type { ReportPeriod, MetricTrend, AnomalyDetection } from "../tools/health-report.js";

export type HealthReportServiceInput = {
  userId: string;
  period: ReportPeriod;
  focusAreas: HealthFocusArea[] | string[];
};

export type HealthReportServiceResult =
  | {
      status: "report";
      markdown: string;
      warnings: string[];
      structured: {
        period: ReportPeriod;
        startDate: string;
        endDate: string;
        trends: MetricTrend[];
        anomalies: AnomalyDetection[];
        recommendations: string[];
      };
    }
  | { status: "no_data"; warnings: string[] }
  | { status: "error"; errorMessage: string; warnings: string[] };
