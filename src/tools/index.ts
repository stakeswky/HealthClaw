// ============================================================================
// Health Tools - OpenClaw Agent Tools exports
// ============================================================================

import type { HealthStore } from "../store/HealthStore.js";
import type { HealthReportService } from "../report/HealthReportService.js";
import type { HealthFocusArea } from "../types.js";
import {
  createHealthQueryTool,
  HealthQuerySchema,
  healthQueryToolDefinition,
  type HealthQueryTool,
  type HealthQueryToolDeps,
  type HealthQueryParams,
  type HealthQueryResult,
  type HealthMetricType,
  type AggregationType,
} from "./health-query.js";
import {
  createHealthReportTool,
  HealthReportSchema,
  healthReportToolDefinition,
  type HealthReportTool,
  type HealthReportToolDeps,
  type HealthReportParams,
  type HealthReportResult,
  type ReportPeriod,
  type MetricTrend,
  type AnomalyDetection,
} from "./health-report.js";

// ============================================================================
// Re-exports
// ============================================================================

export {
  // health-query
  createHealthQueryTool,
  HealthQuerySchema,
  healthQueryToolDefinition,
  // health-report
  createHealthReportTool,
  HealthReportSchema,
  healthReportToolDefinition,
};

// ============================================================================
// Types
// ============================================================================

export type {
  // health-query types
  HealthQueryTool,
  HealthQueryToolDeps,
  HealthQueryParams,
  HealthQueryResult,
  HealthMetricType,
  AggregationType,
  // health-report types
  HealthReportTool,
  HealthReportToolDeps,
  HealthReportParams,
  HealthReportResult,
  ReportPeriod,
  MetricTrend,
  AnomalyDetection,
};

// ============================================================================
// Tool Factory
// ============================================================================

export type HealthToolsDeps = {
  store: HealthStore;
  reportService: HealthReportService;
  defaultFocusAreas?: HealthFocusArea[];
};

/**
 * Create all health tools for registration with OpenClaw
 */
export function createHealthTools(deps: HealthToolsDeps) {
  return [
    createHealthQueryTool(deps),
    createHealthReportTool({
      reportService: deps.reportService,
      defaultFocusAreas: deps.defaultFocusAreas,
    }),
  ];
}

/**
 * Pre-configured tool array for direct registration
 * Usage: api.registerTool(tools[0]); api.registerTool(tools[1]);
 */
export const healthTools = [
  healthQueryToolDefinition,
  healthReportToolDefinition,
];
