/**
 * Daily Report Scheduler
 *
 * Automatically generates health reports at the configured reportTime each day.
 */

import type { PluginLogger } from "../openclaw-stub.js";
import type { HealthStore } from "../store/HealthStore.js";
import type { HealthFocusArea } from "../types.js";
import type { HealthReportService } from "../report/HealthReportService.js";
import { ReportDeliveryService } from "../report/ReportDeliveryService.js";

export type DailyReportSchedulerOpts = {
  reportTime: string; // "HH:MM"
  store: HealthStore;
  logger: PluginLogger;
  focusAreas: HealthFocusArea[];
  language: string;
  reportService: HealthReportService;
  deliveryService: ReportDeliveryService;
};

export class DailyReportScheduler {
  private readonly reportTime: string;
  private readonly store: HealthStore;
  private readonly logger: PluginLogger;
  private readonly focusAreas: string[];
  private readonly reportService: HealthReportService;
  private readonly deliveryService: ReportDeliveryService;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: DailyReportSchedulerOpts) {
    this.reportTime = opts.reportTime;
    this.store = opts.store;
    this.logger = opts.logger;
    this.focusAreas = opts.focusAreas;
    this.reportService = opts.reportService;
    this.deliveryService = opts.deliveryService;
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
        try {
          const result = await this.reportService.generate({
            userId: user.userId,
            period: "day",
            focusAreas: this.focusAreas,
          });

          if (result.status === "no_data") {
            this.logger.debug(`health: daily report skipped for user=${user.userId} — no day data`);
            continue;
          }

          for (const warning of result.warnings) {
            this.logger.warn(`health: daily report warning user=${user.userId}: ${warning}`);
          }

          if (result.status === "error") {
            this.logger.error(
              `health: daily report generation failed for user=${user.userId}: ${result.errorMessage}`,
            );
            continue;
          }

          const delivery = await this.deliveryService.send(result.markdown);
          if (delivery === "sent") {
            this.logger.info(`health: daily report generated for user=${user.userId}\n${result.markdown}`);
          } else {
            this.logger.warn(`health: daily report generated but undeliverable for user=${user.userId}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`health: daily report iteration failed for user=${user.userId}: ${msg}`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`health: daily report generation failed: ${msg}`);
    }
  }
}
