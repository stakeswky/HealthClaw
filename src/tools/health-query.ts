// ============================================================================
// Health Query Tool - OpenClaw Agent Tool for querying health data
// ============================================================================

import { Type, type Static } from "@sinclair/typebox";
import type { DailyHealthSummary } from "../types.js";
import type { HealthStore } from "../store/HealthStore.js";

// ============================================================================
// Health Metric Types - Queryable health metrics from DailyHealthSummary
// ============================================================================

/**
 * Queryable health metric types derived from DailyHealthSummary
 */
export const HealthMetricTypeValues = {
  steps: "steps",
  activeCalories: "activeCalories",
  walkingDistance: "walkingDistance",
  exerciseMinutes: "exerciseMinutes",
  standHours: "standHours",
  restingHeartRate: "restingHeartRate",
  averageHeartRate: "averageHeartRate",
  maxHeartRate: "maxHeartRate",
  heartRateVariability: "heartRateVariability",
  bloodOxygen: "bloodOxygen",
  weight: "weight",
  respiratoryRate: "respiratoryRate",
  sleepMinutes: "sleepMinutes",
  deepSleepMinutes: "deepSleepMinutes",
  remSleepMinutes: "remSleepMinutes",
} as const;

export type HealthMetricType = keyof typeof HealthMetricTypeValues;

export const AggregationTypeValues = {
  sum: "sum",
  avg: "avg",
  min: "min",
  max: "max",
} as const;

export type AggregationType = keyof typeof AggregationTypeValues;

// ============================================================================
// Typebox Schemas
// ============================================================================

/**
 * Schema for health_query tool parameters
 */
export const HealthQuerySchema = Type.Object(
  {
    userId: Type.String({
      description: "User identifier from device pairing",
    }),
    startDate: Type.String({
      description: "Start date in YYYY-MM-DD format",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    }),
    endDate: Type.String({
      description: "End date in YYYY-MM-DD format",
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
    }),
    types: Type.Optional(
      Type.Array(Type.Enum(HealthMetricTypeValues), {
        description: "Health metric types to query (e.g., ['steps', 'weight'])",
      }),
    ),
    aggregation: Type.Optional(
      Type.Enum(AggregationTypeValues, {
        description: "Aggregation method: sum, avg, min, or max",
      }),
    ),
  },
  {
    additionalProperties: false,
  },
);

export type HealthQueryParams = Static<typeof HealthQuerySchema>;

// ============================================================================
// Query Result Types
// ============================================================================

export type MetricAggregate = {
  type: HealthMetricType;
  value: number | null;
  count: number;
  min: number | null;
  max: number | null;
  unit: string;
};

export type HealthQueryResult = {
  userId: string;
  startDate: string;
  endDate: string;
  daysQueried: number;
  daysWithData: number;
  dataCompleteness: number;
  metrics: MetricAggregate[];
};

// ============================================================================
// Metric Unit Mapping
// ============================================================================

const METRIC_UNITS: Record<HealthMetricType, string> = {
  steps: "steps",
  activeCalories: "kcal",
  walkingDistance: "m",
  exerciseMinutes: "min",
  standHours: "hours",
  restingHeartRate: "bpm",
  averageHeartRate: "bpm",
  maxHeartRate: "bpm",
  heartRateVariability: "ms",
  bloodOxygen: "%",
  weight: "kg",
  respiratoryRate: "breaths/min",
  sleepMinutes: "min",
  deepSleepMinutes: "min",
  remSleepMinutes: "min",
};

// ============================================================================
// Aggregation Functions
// ============================================================================

/**
 * Aggregate values using the specified method
 */
function aggregateValues(
  values: number[],
  method: AggregationType,
): number | null {
  if (values.length === 0) return null;

  switch (method) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "avg":
      return values.reduce((a, b) => a + b, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return null;
  }
}

/**
 * Extract metric values from daily summaries
 */
function extractMetricValues(
  data: DailyHealthSummary[],
  metric: HealthMetricType,
): number[] {
  const values: number[] = [];
  for (const day of data) {
    const value = day[metric];
    if (typeof value === "number" && !Number.isNaN(value)) {
      values.push(value);
    }
  }
  return values;
}

/**
 * Calculate aggregate for a single metric
 */
function calculateMetricAggregate(
  data: DailyHealthSummary[],
  metric: HealthMetricType,
  aggregation: AggregationType,
): MetricAggregate {
  const values = extractMetricValues(data, metric);

  return {
    type: metric,
    value: aggregateValues(values, aggregation),
    count: values.length,
    min: values.length > 0 ? Math.min(...values) : null,
    max: values.length > 0 ? Math.max(...values) : null,
    unit: METRIC_UNITS[metric],
  };
}

// ============================================================================
// Markdown Table Generation
// ============================================================================

/**
 * Generate markdown table from query result
 */
function generateMarkdownTable(result: HealthQueryResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`## Health Query Results`);
  lines.push("");
  lines.push(`**User:** ${result.userId}`);
  lines.push(`**Period:** ${result.startDate} to ${result.endDate}`);
  lines.push(`**Days Queried:** ${result.daysQueried}`);
  lines.push(`**Days with Data:** ${result.daysWithData}`);
  lines.push(`**Data Completeness:** ${result.dataCompleteness.toFixed(1)}%`);
  lines.push("");

  // Empty results check
  if (result.metrics.length === 0 || result.metrics.every((m) => m.value === null)) {
    lines.push("*No data available for the specified criteria.*");
    return lines.join("\n");
  }

  // Metrics table
  lines.push("### Aggregated Metrics");
  lines.push("");
  lines.push("| Metric | Value | Count | Min | Max | Unit |");
  lines.push("|--------|-------|-------|-----|-----|------|");

  for (const metric of result.metrics) {
    if (metric.value !== null) {
      const row = [
        metric.type,
        metric.value.toFixed(1),
        metric.count.toString(),
        metric.min !== null ? metric.min.toFixed(1) : "-",
        metric.max !== null ? metric.max.toFixed(1) : "-",
        metric.unit,
      ];
      lines.push(`| ${row.join(" | ")} |`);
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Date Validation
// ============================================================================

function validateDateRange(startDate: string, endDate: string): void {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid startDate: ${startDate}`);
  }
  if (Number.isNaN(end.getTime())) {
    throw new Error(`Invalid endDate: ${endDate}`);
  }
  if (start > end) {
    throw new Error(`startDate must be before or equal to endDate`);
  }
}

function calculateDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

// ============================================================================
// Tool Definition
// ============================================================================

export type HealthQueryToolDeps = {
  store: HealthStore;
};

export type HealthQueryTool = {
  name: string;
  description: string;
  inputSchema: typeof HealthQuerySchema;
  execute: (params: HealthQueryParams) => Promise<{ content: string }>;
};

/**
 * Create the health_query tool
 */
export function createHealthQueryTool(deps: HealthQueryToolDeps): HealthQueryTool {
  return {
    name: "health_query",
    description:
      "Query stored health data for a user by date range with optional aggregation. Returns aggregated metrics as a markdown table.",
    inputSchema: HealthQuerySchema,
    async execute(params: HealthQueryParams): Promise<{ content: string }> {
      const { userId, startDate, endDate, types, aggregation = "avg" } = params;

      // Validate date range
      validateDateRange(startDate, endDate);

      // Determine which metrics to query
      const metricsToQuery: HealthMetricType[] =
        types && types.length > 0 ? (types as HealthMetricType[]) : Object.keys(HealthMetricTypeValues) as HealthMetricType[];

      // Fetch data from store
      const data = await deps.store.getDateRangeOptimized(
        userId,
        startDate,
        endDate,
        metricsToQuery,
      );

      // Calculate aggregates
      const metricResults: MetricAggregate[] = metricsToQuery.map((metric) =>
        calculateMetricAggregate(data, metric, aggregation),
      );

      // Calculate completeness
      const daysQueried = calculateDaysBetween(startDate, endDate);
      const daysWithData = data.length;
      const dataCompleteness = daysQueried > 0 ? (daysWithData / daysQueried) * 100 : 0;

      const result: HealthQueryResult = {
        userId,
        startDate,
        endDate,
        daysQueried,
        daysWithData,
        dataCompleteness,
        metrics: metricResults,
      };

      return {
        content: generateMarkdownTable(result),
      };
    },
  };
}

/**
 * Default export for tool registration
 */
export const healthQueryToolDefinition = {
  name: "health_query",
  description:
    "Query stored health data for a user by date range with optional aggregation. Returns aggregated metrics as a markdown table.",
  inputSchema: HealthQuerySchema,
};