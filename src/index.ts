/**
 * Health Plugin - Main Entry Point
 *
 * OpenClaw plugin for encrypted health data reception,
 * storage, and AI-powered health analysis reports.
 */

import type { OpenClawPluginApi } from "./openclaw-stub.js";
import {
  HEALTH_FOCUS_AREAS,
  type HealthPluginConfig,
  type HealthFocusArea,
  type HealthDataEnvelope,
  type HealthDataPayload,
  type DailyHealthSummary,
  type EncryptedHealthFile,
  type HealthReportRequest,
} from "./types.js";
import { createHealthHttpHandler } from "./http/index.js";
import { HealthStore } from "./store/index.js";
import { createHealthTools } from "./tools/index.js";
import {
  RelayHealthIngestionService,
  resolveRelayPollingRuntimeConfig,
} from "./relay/index.js";
import { registerSetupCommand } from "./setup/setup-command.js";

const DEFAULT_REPORT_TIME = "08:00";
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_LANGUAGE = "zh-CN";
const DEFAULT_RELAY_POLL_INTERVAL_MS = 30_000;
const DEFAULT_RELAY_BATCH_SIZE = 20;

function parseReportTime(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_REPORT_TIME;
  const trimmed = raw.trim();
  if (!/^\d{2}:\d{2}$/.test(trimmed)) {
    return DEFAULT_REPORT_TIME;
  }
  const parts = trimmed.split(":").map(Number);
  const h = parts[0];
  const m = parts[1];
  if (h === undefined || m === undefined || h < 0 || h > 23 || m < 0 || m > 59) {
    return DEFAULT_REPORT_TIME;
  }
  return trimmed;
}

function parseFocusAreas(raw: unknown): HealthFocusArea[] {
  if (!Array.isArray(raw)) return ["general_wellness"];
  const valid = raw.filter(
    (item): item is HealthFocusArea =>
      typeof item === "string" && HEALTH_FOCUS_AREAS.includes(item as HealthFocusArea),
  );
  return valid.length > 0 ? valid : ["general_wellness"];
}

const healthPluginConfigSchema = {
  safeParse(value: unknown) {
    if (value === undefined) return { success: true, data: undefined };
    try {
      return { success: true, data: healthPluginConfigSchema.parse(value) };
    } catch (error) {
      return {
        success: false,
        error: {
          issues: [{ path: [], message: error instanceof Error ? error.message : String(error) }],
        },
      };
    }
  },
  parse(value: unknown): HealthPluginConfig {
    const cfg = (value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {}) as Record<string, unknown>;

    const retentionDays =
      typeof cfg.retentionDays === "number" ? Math.floor(cfg.retentionDays) : DEFAULT_RETENTION_DAYS;

    return {
      reportTime: parseReportTime(cfg.reportTime),
      focusAreas: parseFocusAreas(cfg.focusAreas),
      retentionDays: Math.max(1, Math.min(365, retentionDays)),
      language: typeof cfg.language === "string" ? cfg.language.trim() : DEFAULT_LANGUAGE,
      reportChannel: typeof cfg.reportChannel === "string" ? cfg.reportChannel.trim() : undefined,
      dailyReport: cfg.dailyReport !== false,
      relayUrl: typeof cfg.relayUrl === "string" ? cfg.relayUrl.trim() : undefined,
      enableRelayPolling:
        typeof cfg.enableRelayPolling === "boolean" ? cfg.enableRelayPolling : undefined,
      relayPollIntervalMs:
        typeof cfg.relayPollIntervalMs === "number"
          ? Math.max(1_000, Math.min(300_000, Math.floor(cfg.relayPollIntervalMs)))
          : DEFAULT_RELAY_POLL_INTERVAL_MS,
      relayBatchSize:
        typeof cfg.relayBatchSize === "number"
          ? Math.max(1, Math.min(100, Math.floor(cfg.relayBatchSize)))
          : DEFAULT_RELAY_BATCH_SIZE,
      gatewayDeviceId:
        typeof cfg.gatewayDeviceId === "string" ? cfg.gatewayDeviceId.trim() : undefined,
    };
  },
  jsonSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reportTime: { type: "string", pattern: "^\\d{2}:\\d{2}$", default: DEFAULT_REPORT_TIME },
      focusAreas: {
        type: "array",
        items: { type: "string", enum: [...HEALTH_FOCUS_AREAS] },
      },
      retentionDays: { type: "number", minimum: 1, maximum: 365, default: DEFAULT_RETENTION_DAYS },
      language: { type: "string", default: DEFAULT_LANGUAGE },
      reportChannel: { type: "string" },
      dailyReport: { type: "boolean", default: true },
      relayUrl: { type: "string" },
      enableRelayPolling: { type: "boolean" },
      relayPollIntervalMs: {
        type: "number",
        minimum: 1000,
        maximum: 300000,
        default: DEFAULT_RELAY_POLL_INTERVAL_MS,
      },
      relayBatchSize: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: DEFAULT_RELAY_BATCH_SIZE,
      },
      gatewayDeviceId: { type: "string" },
    },
  },
};

const plugin = {
  id: "health",
  name: "Health",
  description: "Encrypted iOS health data sync with AI-powered daily analysis reports.",
  configSchema: healthPluginConfigSchema,

  register(api: OpenClawPluginApi) {
    const cfg = healthPluginConfigSchema.parse(api.pluginConfig);
    const store = new HealthStore({
      stateDir: api.resolvePath("health"),
      retentionDays: cfg.retentionDays ?? DEFAULT_RETENTION_DAYS,
      logger: api.logger,
    });
    const relayConfig = resolveRelayPollingRuntimeConfig(cfg);
    const relayService = relayConfig
      ? new RelayHealthIngestionService({
          store,
          logger: api.logger,
          config: relayConfig,
        })
      : null;

    api.registerHttpRoute({
      path: "/health/upload",
      auth: "plugin",
      match: "exact",
      handler: createHealthHttpHandler({ store, api, logger: api.logger }) as unknown as (
        req: unknown,
        res: unknown,
      ) => Promise<boolean>,
    });

    for (const tool of createHealthTools({ store })) {
      api.registerTool(tool, { name: tool.name });
    }

    registerSetupCommand(api);

    api.registerService({
      id: "health",
      start: async () => {
        await store.cleanupExpired().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          api.logger.warn(`health: initial cleanup failed: ${message}`);
        });

        if (cfg.enableRelayPolling !== false && relayService) {
          relayService.start();
        } else if (cfg.relayUrl && !relayConfig) {
          api.logger.warn(
            "health: relay polling disabled because relay runtime configuration is incomplete",
          );
        }
      },
      stop: async () => {
        await relayService?.stop();
      },
    });

    api.logger.info(
      `health: plugin loaded (config: reportTime=${cfg.reportTime}, retentionDays=${cfg.retentionDays}, relay=${cfg.relayUrl ? "enabled" : "disabled"})`,
    );

    api.logger.info("health: plugin initialized");
  },
};

export { plugin };

export {
  healthPluginConfigSchema,
  parseReportTime,
  parseFocusAreas,
};

export type {
  HealthPluginConfig,
  HealthFocusArea,
  HealthDataEnvelope,
  HealthDataPayload,
  DailyHealthSummary,
  EncryptedHealthFile,
  HealthReportRequest,
};

// ============================================================
// Crypto Module Re-exports
// ============================================================

export {
  decryptHealthEnvelope,
  decryptRelayHealthEnvelope,
  verifyDeviceSignature,
  deriveStorageKey,
  loadOrCreateKeyBundle,
  exportKeyBundle,
  exportEncryptedKeyBundle,
  importEncryptedKeyBundle,
} from "./crypto/index.js";

export type {
  DecryptionKeys,
  DecryptResult,
  KeyBundle,
  KeyBundleConfig,
  EncryptedKeyBundle,
  KeyBundleImportResult,
  DeriveStorageKeyResult,
} from "./crypto/index.js";

// ============================================================
// Store Module Re-exports
// ============================================================

export {
  HealthStore,
  createMonthlyAggregate,
  getMonthKeyFromDate,
  isDateInMonth,
  mergeHealthData,
  updateMonthlyAggregateDays,
} from "./store/index.js";

export type {
  StoreStats,
  UserStats,
  MonthlyAggregate,
} from "./store/index.js";

// ============================================================
// HTTP Module Re-exports
// ============================================================

export {
  createHealthHttpHandler,
  formatValidationErrors,
  validateEnvelope,
} from "./http/index.js";

export type {
  ValidationError,
  ValidationResult,
} from "./http/index.js";

// ============================================================
// Relay Module Re-exports
// ============================================================

export {
  RelayHealthIngestionService,
  resolveRelayPollingRuntimeConfig,
} from "./relay/index.js";

export type {
  RelayHealthIngestionServiceDeps,
  RelayPollingRuntimeConfig,
} from "./relay/index.js";
