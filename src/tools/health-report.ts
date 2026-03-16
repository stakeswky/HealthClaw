// ============================================================================
// Health Report Tool - OpenClaw Agent Tool for generating health reports
// ============================================================================

import { Type, type Static } from "@sinclair/typebox";
import type { DailyHealthSummary, HealthFocusArea } from "../types.js";
import { HEALTH_FOCUS_AREAS } from "../types.js";
import type { HealthStore } from "../store/HealthStore.js";

// ============================================================================
// Report Period Types
// ============================================================================

export const ReportPeriodValues = {
  day: "day",
  week: "week",
  month: "month",
} as const;

export type ReportPeriod = keyof typeof ReportPeriodValues;

// ============================================================================
// Typebox Schemas
// ============================================================================

export const HealthReportSchema = Type.Object(
  {
    userId: Type.String({
      description: "User identifier from device pairing",
    }),
    period: Type.Enum(ReportPeriodValues, {
      description: "Report period: day, week, or month",
    }),
    focusAreas: Type.Optional(
      Type.Array(Type.String(), {
        description: "Health focus areas for analysis (e.g., ['fitness', 'sleep'])",
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

export type HealthReportParams = Static<typeof HealthReportSchema>;

// ============================================================================
// Trend Analysis Types
// ============================================================================

export type TrendDirection = "increasing" | "decreasing" | "stable";

export type MetricTrend = {
  metric: string;
  direction: TrendDirection;
  changePercent: number;
  currentValue: number | null;
  previousValue: number | null;
};

export type AnomalyDetection = {
  metric: string;
  type: "high" | "low" | "missing";
  severity: "info" | "warning" | "critical";
  value: number | null;
  expectedRange: { min: number; max: number };
  message: string;
};

export type HealthReportResult = {
  userId: string;
  period: ReportPeriod;
  startDate: string;
  endDate: string;
  summary: {
    daysWithData: number;
    totalDays: number;
    dataCompleteness: number;
  };
  trends: MetricTrend[];
  anomalies: AnomalyDetection[];
  recommendations: string[];
};

// ============================================================================
// Baseline Thresholds (rule-based, not ML)
// ============================================================================

const METRIC_BASELINES: Record<
  string,
  { min: number; max: number; unit: string; contextLow: string; contextHigh: string }
> = {
  restingHeartRate: {
    min: 40,
    max: 100,
    unit: "bpm",
    contextLow: "Unusually low resting heart rate",
    contextHigh: "Elevated resting heart rate",
  },
  averageHeartRate: {
    min: 50,
    max: 150,
    unit: "bpm",
    contextLow: "Low average heart rate",
    contextHigh: "High average heart rate",
  },
  heartRateVariability: {
    min: 20,
    max: 100,
    unit: "ms",
    contextLow: "Low HRV may indicate stress",
    contextHigh: "High HRV indicates good recovery",
  },
  bloodOxygen: {
    min: 94,
    max: 100,
    unit: "%",
    contextLow: "Blood oxygen below normal range",
    contextHigh: "Blood oxygen excellent",
  },
  sleepMinutes: {
    min: 360,
    max: 600,
    unit: "min",
    contextLow: "Insufficient sleep duration",
    contextHigh: "Good sleep duration",
  },
  steps: {
    min: 5000,
    max: 20000,
    unit: "steps",
    contextLow: "Below recommended daily steps",
    contextHigh: "Excellent activity level",
  },
  activeCalories: {
    min: 200,
    max: 800,
    unit: "kcal",
    contextLow: "Low active calories burned",
    contextHigh: "High calorie burn",
  },
  weight: {
    min: 40,
    max: 200,
    unit: "kg",
    contextLow: "Weight below typical range",
    contextHigh: "Weight above typical range",
  },
};

// ============================================================================
// Date Range Calculation
// ============================================================================

function calculateDateRange(period: ReportPeriod): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  let startDate: string;

  switch (period) {
    case "day":
      startDate = endDate;
      break;
    case "week": {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      startDate = weekAgo.toISOString().slice(0, 10);
      break;
    }
    case "month": {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      startDate = monthAgo.toISOString().slice(0, 10);
      break;
    }
    default:
      startDate = endDate;
  }

  return { startDate, endDate };
}

function splitDataIntoPeriods(
  data: DailyHealthSummary[],
  period: ReportPeriod,
): { current: DailyHealthSummary[]; previous: DailyHealthSummary[] } {
  if (period === "day" || data.length < 2) {
    const mid = Math.ceil(data.length / 2);
    return {
      current: data.slice(mid),
      previous: data.slice(0, mid),
    };
  }

  const midIndex = Math.ceil(data.length / 2);
  return {
    current: data.slice(midIndex),
    previous: data.slice(0, midIndex),
  };
}

// ============================================================================
// Trend Analysis
// ============================================================================

function calculateAverage(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function extractValues(data: DailyHealthSummary[], key: string): number[] {
  return data
    .map((d) => d[key as keyof DailyHealthSummary])
    .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
}

function analyzeTrend(
  current: DailyHealthSummary[],
  previous: DailyHealthSummary[],
  metric: string,
): MetricTrend | null {
  const currentValues = extractValues(current, metric);
  const previousValues = extractValues(previous, metric);

  if (currentValues.length === 0 && previousValues.length === 0) return null;

  const currentValue = calculateAverage(currentValues);
  const previousValue = calculateAverage(previousValues);

  if (currentValue === null || previousValue === null || previousValue === 0) {
    return {
      metric,
      direction: "stable",
      changePercent: 0,
      currentValue,
      previousValue,
    };
  }

  const changePercent = ((currentValue - previousValue) / previousValue) * 100;
  let direction: TrendDirection;

  if (Math.abs(changePercent) < 5) {
    direction = "stable";
  } else if (changePercent > 0) {
    direction = "increasing";
  } else {
    direction = "decreasing";
  }

  return {
    metric,
    direction,
    changePercent: Math.round(changePercent * 10) / 10,
    currentValue: Math.round(currentValue * 10) / 10,
    previousValue: Math.round(previousValue * 10) / 10,
  };
}

// ============================================================================
// Anomaly Detection
// ============================================================================

function detectAnomalies(data: DailyHealthSummary[]): AnomalyDetection[] {
  const anomalies: AnomalyDetection[] = [];

  for (const [metric, baseline] of Object.entries(METRIC_BASELINES)) {
    const values = extractValues(data, metric);

    if (values.length === 0) {
      if (["restingHeartRate", "bloodOxygen", "sleepMinutes"].includes(metric)) {
        anomalies.push({
          metric,
          type: "missing",
          severity: "info",
          value: null,
          expectedRange: { min: baseline.min, max: baseline.max },
          message: `No ${metric.replace(/([A-Z])/g, " $1").toLowerCase()} data available`,
        });
      }
      continue;
    }

    const avg = calculateAverage(values);
    if (avg === null) continue;

    if (avg < baseline.min) {
      const severity = avg < baseline.min * 0.8 ? "warning" : "info";
      anomalies.push({
        metric,
        type: "low",
        severity,
        value: Math.round(avg * 10) / 10,
        expectedRange: { min: baseline.min, max: baseline.max },
        message: `${baseline.contextLow}: ${Math.round(avg * 10) / 10} ${baseline.unit}`,
      });
    } else if (avg > baseline.max) {
      const severity = avg > baseline.max * 1.2 ? "warning" : "info";
      anomalies.push({
        metric,
        type: "high",
        severity,
        value: Math.round(avg * 10) / 10,
        expectedRange: { min: baseline.min, max: baseline.max },
        message: `${baseline.contextHigh}: ${Math.round(avg * 10) / 10} ${baseline.unit}`,
      });
    }
  }

  return anomalies;
}

// ============================================================================
// Recommendation Generation
// ============================================================================

function generateRecommendations(
  trends: MetricTrend[],
  anomalies: AnomalyDetection[],
  focusAreas: string[],
): string[] {
  const recommendations: string[] = [];

  const criticalAnomalies = anomalies.filter((a) => a.severity === "warning");
  for (const anomaly of criticalAnomalies) {
    recommendations.push(`**${anomaly.metric}**: ${anomaly.message}. Consider monitoring closely.`);
  }

  const lowStepsTrend = trends.find((t) => t.metric === "steps" && t.direction === "decreasing");
  if (lowStepsTrend && lowStepsTrend.changePercent < -20) {
    recommendations.push(
      "Activity has decreased significantly. Try adding a short walk to your daily routine.",
    );
  }

  const sleepTrend = trends.find((t) => t.metric === "sleepMinutes" && t.direction === "decreasing");
  if (sleepTrend && sleepTrend.changePercent < -15) {
    recommendations.push(
      "Sleep duration is trending down. Consider establishing a consistent bedtime routine.",
    );
  }

  if (focusAreas.includes("heart_health")) {
    const hrAnomaly = anomalies.find(
      (a) => a.metric === "restingHeartRate" && (a.type === "high" || a.type === "low"),
    );
    if (hrAnomaly) {
      recommendations.push(
        "For heart health focus: Monitor your resting heart rate trends and consider consulting a healthcare provider if the pattern persists.",
      );
    }
  }

  if (focusAreas.includes("fitness")) {
    const stepsAnomaly = anomalies.find((a) => a.metric === "steps" && a.type === "low");
    if (stepsAnomaly) {
      recommendations.push(
        "For fitness focus: Set a daily step goal and track your progress. Even small increases in daily steps can improve overall health.",
      );
    }
  }

  if (focusAreas.includes("sleep")) {
    const sleepAnomaly = anomalies.find((a) => a.metric === "sleepMinutes");
    if (sleepAnomaly) {
      recommendations.push(
        "For sleep focus: Aim for 7-9 hours of sleep. Create a relaxing bedtime environment and limit screen time before bed.",
      );
    }
  }

  if (recommendations.length === 0) {
    recommendations.push(
      "Your health metrics look good overall. Keep maintaining your current habits!",
    );
  }

  recommendations.push(
    "*Note: These recommendations are informational only. Consult a healthcare professional for medical advice.*",
  );

  return recommendations;
}

// ============================================================================
// Markdown Report Generation
// ============================================================================

function generateMarkdownReport(result: HealthReportResult, focusAreas: string[]): string {
  const lines: string[] = [];

  lines.push(`# Health Report`);
  lines.push("");
  lines.push(`**User:** ${result.userId}`);
  lines.push(`**Period:** ${result.startDate} to ${result.endDate} (${result.period})`);
  lines.push("");

  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- **Days with Data:** ${result.summary.daysWithData} / ${result.summary.totalDays}`);
  lines.push(`- **Data Completeness:** ${result.summary.dataCompleteness.toFixed(1)}%`);
  lines.push("");

  if (result.trends.length > 0) {
    lines.push(`## Trends`);
    lines.push("");
    lines.push("| Metric | Direction | Change | Current | Previous |");
    lines.push("|--------|-----------|--------|---------|----------|");
    for (const trend of result.trends) {
      const changeStr =
        trend.changePercent > 0
          ? `+${trend.changePercent}%`
          : trend.changePercent < 0
            ? `${trend.changePercent}%`
            : "stable";
      lines.push(
        `| ${trend.metric} | ${trend.direction} | ${changeStr} | ${trend.currentValue ?? "-"} | ${trend.previousValue ?? "-"} |`,
      );
    }
    lines.push("");
  }

  if (result.anomalies.length > 0) {
    lines.push(`## Anomalies`);
    lines.push("");
    for (const anomaly of result.anomalies) {
      const severityIcon =
        anomaly.severity === "warning" ? "⚠️" : anomaly.severity === "critical" ? "🚨" : "ℹ️";
      lines.push(`${severityIcon} **${anomaly.metric}**: ${anomaly.message}`);
      lines.push(`   - Expected range: ${anomaly.expectedRange.min} - ${anomaly.expectedRange.max}`);
      lines.push("");
    }
  }

  if (result.recommendations.length > 0) {
    lines.push(`## Recommendations`);
    lines.push("");
    for (const rec of result.recommendations) {
      lines.push(`- ${rec}`);
    }
    lines.push("");
  }

  if (focusAreas.length > 0) {
    lines.push(`**Focus Areas:** ${focusAreas.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Tool Definition
// ============================================================================

export type HealthReportToolDeps = {
  store: HealthStore;
};

export type HealthReportTool = {
  name: string;
  description: string;
  inputSchema: typeof HealthReportSchema;
  execute: (params: HealthReportParams) => Promise<{ content: string }>;
};

export function createHealthReportTool(deps: HealthReportToolDeps): HealthReportTool {
  return {
    name: "health_report",
    description:
      "Generate a comprehensive health analysis report with trends, anomalies, and recommendations based on stored health data.",
    inputSchema: HealthReportSchema,
    async execute(params: HealthReportParams): Promise<{ content: string }> {
      const { userId, period, focusAreas: inputFocusAreas } = params;

      const focusAreas = validateFocusAreas(inputFocusAreas);

      const { startDate, endDate } = calculateDateRange(period);

      const data = await deps.store.getDateRangeOptimized(userId, startDate, endDate);

      const { current, previous } = splitDataIntoPeriods(data, period);

      const metricsToAnalyze = [
        "steps",
        "activeCalories",
        "restingHeartRate",
        "averageHeartRate",
        "heartRateVariability",
        "bloodOxygen",
        "sleepMinutes",
        "weight",
      ];

      const trends: MetricTrend[] = [];
      for (const metric of metricsToAnalyze) {
        const trend = analyzeTrend(current, previous, metric);
        if (trend) trends.push(trend);
      }

      const anomalies = detectAnomalies(data);

      const recommendations = generateRecommendations(trends, anomalies, focusAreas);

      const totalDays = calculateTotalDays(startDate, endDate);
      const dataCompleteness = totalDays > 0 ? (data.length / totalDays) * 100 : 0;

      const result: HealthReportResult = {
        userId,
        period,
        startDate,
        endDate,
        summary: {
          daysWithData: data.length,
          totalDays,
          dataCompleteness,
        },
        trends,
        anomalies,
        recommendations,
      };

      return {
        content: generateMarkdownReport(result, focusAreas),
      };
    },
  };
}

function validateFocusAreas(areas?: string[]): string[] {
  if (!areas || areas.length === 0) {
    return ["general_wellness"];
  }
  return areas.filter((a): a is HealthFocusArea =>
    HEALTH_FOCUS_AREAS.includes(a as HealthFocusArea),
  );
}

function calculateTotalDays(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

export const healthReportToolDefinition = {
  name: "health_report",
  description:
    "Generate a comprehensive health analysis report with trends, anomalies, and recommendations based on stored health data.",
  inputSchema: HealthReportSchema,
};