// ============================================================================
// Health Data Store
// ============================================================================

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginLogger } from "../openclaw-stub.js";
import type {
  DailyHealthSummary,
  EncryptedHealthFile,
  HealthDataPayload,
} from "../types.js";
import type { DecryptionKeys } from "../crypto/types.js";
import {
  createMonthlyAggregate,
  getMonthKeyFromDate,
  mergeHealthData,
  updateMonthlyAggregateDays,
} from "./aggregation.js";

const STORAGE_HKDF_INFO = Buffer.from("openclaw-health-storage-v1");
const STORAGE_HKDF_SALT = Buffer.alloc(32, 0);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

export type UserStats = {
  userId: string;
  dailyRecordCount: number;
  monthlyRecordCount: number;
  earliestDate: string | null;
  latestDate: string | null;
};

export type StoreStats = {
  users: UserStats[];
  totalRecords: number;
  recordsByType: {
    daily: number;
    monthly: number;
  };
};

type HealthStoreOptions = {
  stateDir: string;
  retentionDays: number;
  logger: PluginLogger;
};

export class HealthStore {
  private readonly dataDir: string;
  private readonly retentionDays: number;
  private readonly logger: PluginLogger;
  private storageKey: Buffer | null = null;

  constructor(opts: HealthStoreOptions) {
    this.dataDir = path.join(opts.stateDir, "data");
    this.retentionDays = opts.retentionDays;
    this.logger = opts.logger;
  }

  private getStorageKey(): Buffer {
    if (this.storageKey) return this.storageKey;
    const identitySecret = Buffer.from(
      process.env.OPENCLAW_GATEWAY_IDENTITY_KEY ?? "",
      "hex",
    );
    if (identitySecret.length === 0) {
      throw new Error("OPENCLAW_GATEWAY_IDENTITY_KEY not configured");
    }
    this.storageKey = Buffer.from(
      hkdfSync("sha256", identitySecret, STORAGE_HKDF_SALT, STORAGE_HKDF_INFO, 32),
    );
    return this.storageKey;
  }

  private encryptData(data: DailyHealthSummary): EncryptedHealthFile {
    const key = this.getStorageKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const json = JSON.stringify(data);
    const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      data: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      encryptedAt: Date.now(),
    };
  }

  private decryptFile(file: EncryptedHealthFile): DailyHealthSummary {
    const key = this.getStorageKey();
    const iv = Buffer.from(file.iv, "base64");
    const tag = Buffer.from(file.tag, "base64");
    const encrypted = Buffer.from(file.data, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as DailyHealthSummary;
  }

  private sanitizeUserId(userId: string): string {
    return userId.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  private userDir(userId: string): string {
    const safe = this.sanitizeUserId(userId);
    return path.join(this.dataDir, safe);
  }

  private dailyDir(userId: string): string {
    return path.join(this.userDir(userId), "daily");
  }

  private monthlyDir(userId: string): string {
    return path.join(this.userDir(userId), "monthly");
  }

  private dayFile(userId: string, date: string): string {
    if (!DATE_PATTERN.test(date)) throw new Error(`Invalid date format: ${date}`);
    return path.join(this.dailyDir(userId), `${date}.enc.json`);
  }

  private monthFile(userId: string, monthKey: string): string {
    if (!MONTH_PATTERN.test(monthKey)) throw new Error(`Invalid month format: ${monthKey}`);
    return path.join(this.monthlyDir(userId), `${monthKey}.enc.json`);
  }

  async saveDailySummary(
    payload: HealthDataPayload,
    deviceId: string,
  ): Promise<{ action: "created" | "merged"; date: string }> {
    const existing = await this.getDailySummary(payload.userId, payload.date);
    let summary: DailyHealthSummary;
    let action: "created" | "merged";

    if (existing) {
      summary = mergeHealthData(existing, payload, deviceId);
      action = "merged";
    } else {
      summary = {
        ...payload,
        receivedAt: Date.now(),
        sourceDeviceId: deviceId,
        schemaVersion: 1,
      };
      action = "created";
    }

    const encrypted = this.encryptData(summary);
    const filePath = this.dayFile(payload.userId, payload.date);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(encrypted) + "\n", "utf8");
    await fs.rename(tmpPath, filePath);

    await this.updateMonthlyAggregate(payload.userId, payload.date, summary);

    return { action, date: payload.date };
  }

  async getDailySummary(userId: string, date: string): Promise<DailyHealthSummary | null> {
    const filePath = this.dayFile(userId, date);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const file = JSON.parse(content) as EncryptedHealthFile;
      return this.decryptFile(file);
    } catch {
      return null;
    }
  }

  async getDateRange(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<DailyHealthSummary[]> {
    const results: DailyHealthSummary[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const summary = await this.getDailySummary(userId, dateStr);
      if (summary) results.push(summary);
    }
    return results;
  }

  async getDateRangeOptimized(
    userId: string,
    startDate: string,
    endDate: string,
    metrics?: string[],
  ): Promise<DailyHealthSummary[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const spanDays = (end.getTime() - start.getTime()) / 86_400_000;

    if (spanDays <= 90) {
      return this.getDateRange(userId, startDate, endDate);
    }

    const results: DailyHealthSummary[] = [];
    for (
      let m = new Date(start.getFullYear(), start.getMonth(), 1);
      m <= end;
      m.setMonth(m.getMonth() + 1)
    ) {
      const monthKey = m.toISOString().slice(0, 7);
      const monthly = await this.getMonthlyAggregate(userId, monthKey);
      if (monthly) {
        for (const day of monthly.days) {
          if (day.date >= startDate && day.date <= endDate) {
            if (
              !metrics
              || metrics.some((k) => (day as unknown as Record<string, unknown>)[k] != null)
            ) {
              results.push(day);
            }
          }
        }
      }
    }
    return results;
  }

  async updateMonthlyAggregate(
    userId: string,
    date: string,
    summary: DailyHealthSummary,
  ): Promise<void> {
    const monthKey = getMonthKeyFromDate(date);
    let aggregate = await this.getMonthlyAggregate(userId, monthKey);
    if (!aggregate) {
      aggregate = createMonthlyAggregate(userId, monthKey);
    }
    aggregate = updateMonthlyAggregateDays(aggregate, summary);

    const encrypted = this.encryptData(aggregate as unknown as DailyHealthSummary);
    const filePath = this.monthFile(userId, monthKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, JSON.stringify(encrypted) + "\n", "utf8");
    await fs.rename(tmpPath, filePath);
  }

  async getMonthlyAggregate(
    userId: string,
    monthKey: string,
  ): Promise<import("./aggregation.js").MonthlyAggregate | null> {
    const filePath = this.monthFile(userId, monthKey);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const file = JSON.parse(content) as EncryptedHealthFile;
      return this.decryptFile(file) as unknown as import("./aggregation.js").MonthlyAggregate;
    } catch {
      return null;
    }
  }

  async listUsers(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.dataDir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async getLatestDate(userId: string): Promise<string | null> {
    try {
      const dir = this.dailyDir(userId);
      const files = await fs.readdir(dir);
      const dates = files
        .filter((f) => f.endsWith(".enc.json"))
        .map((f) => f.replace(".enc.json", ""))
        .filter((d) => DATE_PATTERN.test(d))
        .sort()
        .reverse();
      return dates[0] ?? null;
    } catch {
      return null;
    }
  }

  async cleanupExpired(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let removed = 0;

    const users = await this.listUsers();
    for (const userId of users) {
      const dailyDir = this.dailyDir(userId);
      const monthlyDir = this.monthlyDir(userId);

      try {
        const dailyFiles = await fs.readdir(dailyDir);
        for (const file of dailyFiles) {
          const date = file.replace(".enc.json", "");
          if (DATE_PATTERN.test(date) && date < cutoffStr) {
            await fs.unlink(path.join(dailyDir, file));
            removed++;
          }
        }
      } catch {
        // ignore
      }

      try {
        const monthFiles = await fs.readdir(monthlyDir);
        for (const file of monthFiles) {
          const month = file.replace(".enc.json", "");
          if (MONTH_PATTERN.test(month)) {
            const monthEnd = `${month}-31`;
            if (monthEnd < cutoffStr) {
              await fs.unlink(path.join(monthlyDir, file));
            }
          }
        }
      } catch {
        // ignore
      }
    }

    if (removed > 0) {
      this.logger.info(`health: cleaned up ${removed} expired data files`);
    }
    return removed;
  }

  async clearUserData(userId: string): Promise<number> {
    const dir = this.userDir(userId);
    try {
      let count = 0;
      const dailyDir = this.dailyDir(userId);
      const monthlyDir = this.monthlyDir(userId);

      try {
        const dailyFiles = await fs.readdir(dailyDir);
        for (const file of dailyFiles) {
          await fs.unlink(path.join(dailyDir, file));
          count++;
        }
      } catch {
        // ignore
      }

      try {
        const monthFiles = await fs.readdir(monthlyDir);
        for (const file of monthFiles) {
          await fs.unlink(path.join(monthlyDir, file));
          count++;
        }
      } catch {
        // ignore
      }

      try {
        await fs.rmdir(dailyDir);
        await fs.rmdir(monthlyDir);
        await fs.rmdir(dir);
      } catch {
        // ignore
      }

      return count;
    } catch {
      return 0;
    }
  }

  async isDevicePaired(deviceId: string): Promise<boolean> {
    return typeof deviceId === "string" && deviceId.length > 0;
  }

  getDecryptionKeys(): DecryptionKeys {
    const raw = process.env.OPENCLAW_GATEWAY_X25519_KEY ?? "";
    if (raw.length === 0) {
      this.logger.warn("health: OPENCLAW_GATEWAY_X25519_KEY not configured");
    }
    return { gatewayX25519PrivateKey: Buffer.from(raw, "hex") };
  }

  async getStats(): Promise<StoreStats> {
    const stats: StoreStats = {
      users: [],
      totalRecords: 0,
      recordsByType: { daily: 0, monthly: 0 },
    };

    const users = await this.listUsers();
    for (const userId of users) {
      const userStats: UserStats = {
        userId,
        dailyRecordCount: 0,
        monthlyRecordCount: 0,
        earliestDate: null,
        latestDate: null,
      };

      try {
        const dailyDir = this.dailyDir(userId);
        const dailyFiles = await fs.readdir(dailyDir);
        const dailyDates = dailyFiles
          .filter((f) => f.endsWith(".enc.json"))
          .map((f) => f.replace(".enc.json", ""))
          .filter((d) => DATE_PATTERN.test(d))
          .sort();

        userStats.dailyRecordCount = dailyDates.length;
        if (dailyDates.length > 0) {
          userStats.earliestDate = dailyDates[0] ?? null;
          userStats.latestDate = dailyDates[dailyDates.length - 1] ?? null;
        }
      } catch {
        // ignore
      }

      try {
        const monthlyDir = this.monthlyDir(userId);
        const monthlyFiles = await fs.readdir(monthlyDir);
        userStats.monthlyRecordCount = monthlyFiles.filter(
          (f) => f.endsWith(".enc.json") && MONTH_PATTERN.test(f.replace(".enc.json", "")),
        ).length;
      } catch {
        // ignore
      }

      stats.users.push(userStats);
      stats.totalRecords += userStats.dailyRecordCount;
    }

    stats.recordsByType = {
      daily: stats.users.reduce((sum, u) => sum + u.dailyRecordCount, 0),
      monthly: stats.users.reduce((sum, u) => sum + u.monthlyRecordCount, 0),
    };

    return stats;
  }
}
