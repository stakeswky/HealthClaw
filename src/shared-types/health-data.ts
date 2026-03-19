/**
 * Health data payload types for decrypted health data
 * @module health-data
 */

/**
 * Decrypted health data payload from iOS
 */
export interface HealthDataPayload {
  /** Data date in YYYY-MM-DD format */
  date: string;
  /** Human-readable device name from the source iPhone */
  deviceName?: string;
  /** User identifier assigned during device pairing */
  userId: string;
  /** Step count */
  steps?: number;
  /** Active calories burned (kcal) */
  activeCalories?: number;
  /** Resting heart rate (bpm) */
  restingHeartRate?: number;
  /** Average heart rate (bpm) */
  averageHeartRate?: number;
  /** Maximum heart rate (bpm) */
  maxHeartRate?: number;
  /** Heart rate variability (ms) */
  heartRateVariability?: number;
  /** Total sleep duration (minutes) */
  sleepMinutes?: number;
  /** Deep sleep duration (minutes) */
  deepSleepMinutes?: number;
  /** REM sleep duration (minutes) */
  remSleepMinutes?: number;
  /** Body weight (kg) */
  weight?: number;
  /** Blood oxygen saturation (%) */
  bloodOxygen?: number;
  /** Walking distance (meters) */
  walkingDistance?: number;
  /** Exercise duration (minutes) */
  exerciseMinutes?: number;
  /** Standing hours count */
  standHours?: number;
  /** Respiratory rate (breaths per minute) */
  respiratoryRate?: number;
  /** Additional custom metrics */
  custom?: Record<string, number>;
}

/**
 * Daily health summary stored on disk (plaintext before encryption)
 */
export interface DailyHealthSummary extends HealthDataPayload {
  /** Timestamp when data was received (ms) */
  receivedAt: number;
  /** Source device ID */
  sourceDeviceId: string;
  /** Schema version for future migrations */
  schemaVersion: 1;
}

/**
 * Schema version constant
 */
export const HEALTH_DATA_SCHEMA_VERSION = 1 as const;

/**
 * Encrypted file format stored on disk
 */
export interface EncryptedHealthFile {
  /** AES-256-GCM encrypted JSON (base64) */
  data: string;
  /** IV/nonce (base64, 12 bytes) */
  iv: string;
  /** Authentication tag (base64, 16 bytes) */
  tag: string;
  /** Encryption timestamp */
  encryptedAt: number;
}

/**
 * Health report request parameters
 */
export interface HealthReportRequest {
  /** User ID */
  userId: string;
  /** Start date in YYYY-MM-DD format */
  startDate: string;
  /** End date in YYYY-MM-DD format */
  endDate: string;
  /** Focus areas for the report */
  focusAreas?: HealthFocusArea[];
  /** Report language code */
  language?: string;
}

/**
 * User-configurable focus areas for health reports
 */
export const HEALTH_FOCUS_AREAS = [
  "weight_loss",
  "fitness",
  "sleep",
  "heart_health",
  "general_wellness",
] as const;

/**
 * Health focus area type
 */
export type HealthFocusArea = (typeof HEALTH_FOCUS_AREAS)[number];

/**
 * Plugin configuration for health extension
 */
export interface HealthPluginConfig {
  /** Daily report time in HH:MM format (24h), default "08:00" */
  reportTime?: string;
  /** Focus areas for health reports */
  focusAreas?: HealthFocusArea[];
  /** Data retention days, default 90 */
  retentionDays?: number;
  /** Report language, default "zh-CN" */
  language?: string;
  /** Report delivery channel (e.g., "telegram"), defaults to message source */
  reportChannel?: string;
  /** Enable daily automatic report, default true */
  dailyReport?: boolean;
  /** Relay base URL used by the gateway plugin to poll encrypted envelopes */
  relayUrl?: string;
  /** Enable relay polling lifecycle, default true when relayUrl is set */
  enableRelayPolling?: boolean;
  /** Poll interval in milliseconds, default 30000 */
  relayPollIntervalMs?: number;
  /** Maximum number of messages to fetch per poll request, default 20 */
  relayBatchSize?: number;
  /** Optional override for the gateway device ID; falls back to HEALTHCLAW_DEVICE_ID */
  gatewayDeviceId?: string;
}

/**
 * Default retention days
 */
export const DEFAULT_RETENTION_DAYS = 90 as const;

/**
 * Default report time
 */
export const DEFAULT_REPORT_TIME = "08:00" as const;

/**
 * Default report language
 */
export const DEFAULT_LANGUAGE = "zh-CN" as const;
