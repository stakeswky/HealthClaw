/**
 * Daily Report Scheduler
 *
 * Automatically generates health reports at the configured reportTime each day.
 */

import type { PluginLogger } from "../openclaw-stub.js";
import type { HealthStore } from "../store/HealthStore.js";
import type { HealthFocusArea } from "../types.js";
import {
  analyzeTrend,
  detectAnomalies,
  generateRecommendations,
  splitDataIntoPeriods,
  calculateDateRange,
  calculateTotalDays,
  generateMarkdownReport,
  METRICS_TO_ANALYZE,
  type MetricTrend,
  type HealthReportResult,
} from "../tools/health-report.js";

export type DailyReportSchedulerOpts = {
  reportTime: string; // "HH:MM"
  store: HealthStore;
  logger: PluginLogger;
  focusAreas: HealthFocusArea[];
  language: string;
};

export class DailyReportScheduler {
  private readonly reportTime: string;
  private readonly store: HealthStore;
  private readonly logger: PluginLogger;
  private readonly focusAreas: string[];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: DailyReportSchedulerOpts) {
    this.reportTime = opts.reportTime;
    this.store = opts.store;
    this.logger = opts.logger;
    this.focusAreas = opts.focusAreas;
  }

  start(): void {
    this.scheduleNext();
    this.logger.info(`health: daily report scheduler started (reportTime=${this.reportTime})`);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.logger.info("health: daily report scheduler stopped");
  }

  private scheduleNext(): void {
    const delayMs = this.msUntilNextReport();
    this.timer = setTimeout(async () => {
      await this.generateReport();
      // Schedule next run in ~24h
      this.scheduleNext();
    }, delayMs);

    const nextRun = new Date(Date.now() + delayMs);
    this.logger.debug(`health: next daily report scheduled at ${nextRun.toISOString()}`);
  }

  private msUntilNextReport(): number {
    const now = new Date();
    const [hours, minutes] = this.reportTime.split(":").map(Number);
    const target = new Date(now);
    target.setHours(hours!, minutes!, 0, 0);

    // If target time already passed today, schedule for tomorrow
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }

    return target.getTime() - now.getTime();
  }

  async generateReport(): Promise<void> {
    try {
      const stats = await this.store.getStats();
      if (stats.users.length === 0) {
        this.logger.info("health: daily report skipped — no users with data");
        return;
      }

      for (const user of stats.users) {
        if (user.dailyRecordCount === 0) continue;

        const { startDate, endDate } = calculateDateRange("week");
        const data = await this.store.getDateRangeOptimized(user.userId, startDate, endDate);

        if (data.length === 0) {
          this.logger.debug(`health: daily report skipped for user=${user.userId} — no recent data`);
          continue;
        }

        const { current, previous } = splitDataIntoPeriods(data, "week");

        const trends: MetricTrend[] = [];
        for (const metric of METRICS_TO_ANALYZE) {
          const trend = analyzeTrend(current, previous, metric);
          if (trend) trends.push(trend);
        }

        const anomalies = detectAnomalies(data);
        const recommendations = generateRecommendations(trends, anomalies, this.focusAreas);

        const totalDays = calculateTotalDays(startDate, endDate);
        const dataCompleteness = totalDays > 0 ? (data.length / totalDays) * 100 : 0;

        const result: HealthReportResult = {
          userId: user.userId,
          period: "week",
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

        const markdown = generateMarkdownReport(result, this.focusAreas);
        this.logger.info(`health: daily report generated for user=${user.userId}\n${markdown}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`health: daily report generation failed: ${msg}`);
    }
  }
}
