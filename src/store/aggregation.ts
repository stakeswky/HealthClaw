// ============================================================================
// Health Data Aggregation & Merging
// ============================================================================

import type { DailyHealthSummary, HealthDataPayload } from "../types.js";

const CUMULATIVE_KEYS = [
  "steps",
  "activeCalories",
  "walkingDistance",
  "standHours",
] as const;

const LATEST_KEYS = [
  "exerciseMinutes",
  "restingHeartRate",
  "averageHeartRate",
  "heartRateVariability",
  "bloodOxygen",
  "weight",
  "respiratoryRate",
] as const;

const SLEEP_KEYS = ["sleepMinutes", "deepSleepMinutes", "remSleepMinutes"] as const;

export type MonthlyAggregate = {
  monthKey: string;
  userId: string;
  days: DailyHealthSummary[];
  updatedAt: number;
};

export function mergeHealthData(
  existing: DailyHealthSummary,
  incoming: HealthDataPayload,
  deviceId: string,
): DailyHealthSummary {
  const merged = { ...existing };
  merged.receivedAt = Date.now();

  if (incoming.deviceName) {
    merged.deviceName = incoming.deviceName;
  }

  for (const key of CUMULATIVE_KEYS) {
    if (incoming[key] != null) {
      merged[key] = Math.max(merged[key] ?? 0, incoming[key]!);
    }
  }

  for (const key of LATEST_KEYS) {
    if (incoming[key] != null) {
      merged[key] = incoming[key]!;
    }
  }

  if (incoming.maxHeartRate != null) {
    merged.maxHeartRate = Math.max(merged.maxHeartRate ?? 0, incoming.maxHeartRate);
  }

  for (const key of SLEEP_KEYS) {
    if (incoming[key] != null) {
      merged[key] = incoming[key]!;
    }
  }

  if (incoming.custom) {
    merged.custom = { ...merged.custom, ...incoming.custom };
  }

  merged._mergeCount = (existing._mergeCount ?? 0) + 1;
  merged._lastMergedFrom = deviceId;
  merged._lastMergedAt = Date.now();

  return merged;
}

export function createMonthlyAggregate(
  userId: string,
  monthKey: string,
): MonthlyAggregate {
  return {
    monthKey,
    userId,
    days: [],
    updatedAt: Date.now(),
  };
}

export function updateMonthlyAggregateDays(
  aggregate: MonthlyAggregate,
  summary: DailyHealthSummary,
): MonthlyAggregate {
  const existingIndex = aggregate.days.findIndex((d) => d.date === summary.date);

  const updatedDays = [...aggregate.days];
  if (existingIndex >= 0) {
    updatedDays[existingIndex] = summary;
  } else {
    updatedDays.push(summary);
    updatedDays.sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    ...aggregate,
    days: updatedDays,
    updatedAt: Date.now(),
  };
}

export function getMonthKeyFromDate(date: string): string {
  return date.slice(0, 7);
}

export function isDateInMonth(date: string, monthKey: string): boolean {
  return date.startsWith(monthKey);
}
