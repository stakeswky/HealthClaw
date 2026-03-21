/**
 * Health Plugin - Main Entry Point
 *
 * HealthClaw plugin for encrypted health data reception,
 * storage, and AI-powered health analysis reports.
 */

import { createHash, createPrivateKey } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
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
import { DailyReportScheduler } from "./scheduler/daily-report.js";
import { FirstSyncNotifier } from "./notify/first-sync.js";
import { HealthReportService } from "./report/HealthReportService.js";
import { ProfileStore } from "./profile/ProfileStore.js";
import { registerHealthCommand } from "./commands/health-command.js";
import { ReportDeliveryService } from "./report/ReportDeliveryService.js";

const DEFAULT_REPORT_TIME = "08:00";
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_LANGUAGE = "zh-CN";
const DEFAULT_RELAY_POLL_INTERVAL_MS = 30_000;
const DEFAULT_RELAY_BATCH_SIZE = 20;

type PersistedRelayConfig = {
  relayUrl: string;
  gatewayDeviceId: string;
  ed25519PrivateKeyPath: string;
  configuredAt: number;
};

async function loadPersistedRelayConfig(
  stateDir: string,
): Promise<PersistedRelayConfig | null> {
  try {
    const raw = await fs.readFile(path.join(stateDir, "relay-config.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.relayUrl === "string" &&
      typeof parsed.gatewayDeviceId === "string" &&
      typeof parsed.ed25519PrivateKeyPath === "string"
    ) {
      return parsed as PersistedRelayConfig;
    }
    return null;
  } catch {
    return null;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveRelayStateDir(primaryStateDir: string): Promise<string> {
  const primaryConfigPath = path.join(primaryStateDir, "relay-config.json");
  if (await pathExists(primaryConfigPath)) {
    return primaryStateDir;
  }

  const fallbackStateDir = "/root/.openclaw/state/plugins/health";
  const fallbackConfigPath = path.join(fallbackStateDir, "relay-config.json");
  if (await pathExists(fallbackConfigPath)) {
    return fallbackStateDir;
  }

  return primaryStateDir;
}

function deriveIdentityKeyFromPem(pemContent: string): string {
  const keyObject = createPrivateKey(pemContent);
  const rawKey = keyObject.export({ type: "pkcs8", format: "der" }).subarray(-32);
  return createHash("sha256").update(rawKey).digest("hex");
}

function extractRawPrivateKeyHexFromPem(pemContent: string): string {
  const keyObject = createPrivateKey(pemContent);
  const rawKey = keyObject.export({ type: "pkcs8", format: "der" }).subarray(-32);
  return Buffer.from(rawKey).toString("hex");
}

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
      notify:
        cfg.notify && typeof cfg.notify === "object"
          ? {
              enabled:
                typeof (cfg.notify as Record<string, unknown>).enabled === "boolean"
                  ? (cfg.notify as Record<string, unknown>).enabled as boolean
                  : true,
              channel:
                typeof (cfg.notify as Record<string, unknown>).channel === "string"
                  ? ((cfg.notify as Record<string, unknown>).channel as string).trim()
                  : undefined,
              target:
                typeof (cfg.notify as Record<string, unknown>).target === "string"
                  ? ((cfg.notify as Record<string, unknown>).target as string).trim()
                  : undefined,
              firstPairingMessage:
                typeof (cfg.notify as Record<string, unknown>).firstPairingMessage === "boolean"
                  ? (cfg.notify as Record<string, unknown>).firstPairingMessage as boolean
                  : true,
              firstReportMessage:
                typeof (cfg.notify as Record<string, unknown>).firstReportMessage === "boolean"
                  ? (cfg.notify as Record<string, unknown>).firstReportMessage as boolean
                  : true,
            }
          : undefined,
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
      notify: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean", default: true },
          channel: { type: "string" },
          target: { type: "string" },
          firstPairingMessage: { type: "boolean", default: true },
          firstReportMessage: { type: "boolean", default: true },
        },
      },
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
    const stateDir = api.resolvePath("health");
    const store = new HealthStore({
      stateDir,
      retentionDays: cfg.retentionDays ?? DEFAULT_RETENTION_DAYS,
      logger: api.logger,
    });
    const profileStore = new ProfileStore({
      stateDir,
      logger: api.logger,
    });
    const reportService = new HealthReportService({
      store,
      profileStore,
    });

    // Deferred: relay config + identity key loaded async in service.start()
    let relayService: RelayHealthIngestionService | null = null;
    let scheduler: DailyReportScheduler | null = null;
    const firstSyncNotifier = new FirstSyncNotifier({
      stateDir,
      logger: api.logger,
      runtime: api.runtime,
      config: cfg,
    });

    api.registerHttpRoute({
      path: "/health/upload",
      auth: "plugin",
      match: "exact",
      handler: createHealthHttpHandler({ store, api, logger: api.logger }) as unknown as (
        req: unknown,
        res: unknown,
      ) => Promise<boolean>,
    });

    for (const tool of createHealthTools({
      store,
      reportService,
      defaultFocusAreas: cfg.focusAreas ?? ["general_wellness"],
    })) {
      api.registerTool(tool, { name: tool.name });
    }

    registerSetupCommand(api);
    registerHealthCommand(api, {
      profileStore,
      reportService,
      focusAreas: cfg.focusAreas ?? ["general_wellness"],
    });

    api.registerService({
      id: "health",
      start: async () => {
        const relayStateDir = await resolveRelayStateDir(stateDir);
        api.logger.info(
          `health: service starting (stateDir=${stateDir}, relayStateDir=${relayStateDir})`,
        );

        // Load persisted relay config and derive identity key
        const persisted = await loadPersistedRelayConfig(relayStateDir);
        if (persisted) {
          const keyPath = path.join(relayStateDir, persisted.ed25519PrivateKeyPath);
          api.logger.info(
            `health: found persisted relay config (relayUrl=${persisted.relayUrl}, gatewayDeviceId=${persisted.gatewayDeviceId}, keyPath=${keyPath})`,
          );
          try {
            await fs.access(keyPath);
            const pemContent = await fs.readFile(keyPath, "utf8");

            // Set env vars so resolveRelayPollingRuntimeConfig and HealthStore work
            if (!process.env.HEALTHCLAW_ED25519_PRIVATE_KEY) {
              process.env.HEALTHCLAW_ED25519_PRIVATE_KEY = pemContent;
            }
            if (!process.env.HEALTHCLAW_GATEWAY_IDENTITY_KEY) {
              process.env.HEALTHCLAW_GATEWAY_IDENTITY_KEY = deriveIdentityKeyFromPem(pemContent);
            }

            const x25519KeyPath = path.join(relayStateDir, "keys", "x25519_private.pem");
            if (await pathExists(x25519KeyPath)) {
              const x25519PemContent = await fs.readFile(x25519KeyPath, "utf8");
              if (!process.env.HEALTHCLAW_GATEWAY_X25519_KEY) {
                process.env.HEALTHCLAW_GATEWAY_X25519_KEY = extractRawPrivateKeyHexFromPem(
                  x25519PemContent,
                );
              }
              api.logger.info(`health: loaded X25519 private key from ${x25519KeyPath}`);
            } else {
              api.logger.warn(`health: X25519 private key not found at ${x25519KeyPath}`);
            }

            api.logger.info("health: loaded persisted relay config and derived identity key");
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            api.logger.warn(`health: failed to load key from persisted config: ${msg}`);
          }
        } else {
          api.logger.info(
            `health: no persisted relay config found at ${path.join(relayStateDir, "relay-config.json")}`,
          );
        }

        // Merge persisted config into plugin config for relay resolution
        const mergedCfg: HealthPluginConfig = {
          ...cfg,
          relayUrl: cfg.relayUrl || persisted?.relayUrl,
          gatewayDeviceId: cfg.gatewayDeviceId || persisted?.gatewayDeviceId,
        };

        api.logger.info(
          `health: relay runtime inputs (relayUrl=${mergedCfg.relayUrl ?? "<missing>"}, gatewayDeviceId=${mergedCfg.gatewayDeviceId ?? "<missing>"}, enableRelayPolling=${mergedCfg.enableRelayPolling ?? true}, hasEd25519Key=${process.env.HEALTHCLAW_ED25519_PRIVATE_KEY ? "yes" : "no"}, hasX25519Key=${process.env.HEALTHCLAW_GATEWAY_X25519_KEY ? "yes" : "no"})`,
        );

        const relayConfig = resolveRelayPollingRuntimeConfig(mergedCfg);
        if (relayConfig && mergedCfg.enableRelayPolling !== false) {
          relayService = new RelayHealthIngestionService({
            store,
            logger: api.logger,
            config: relayConfig,
            onProcessed: async ({ action, payload, deviceId }) => {
              if (action === "created") {
                await firstSyncNotifier.maybeNotifyFirstSync({
                  userId: payload.userId,
                  deviceId,
                  deviceName: payload.deviceName,
                  summary: {
                    ...payload,
                    receivedAt: Date.now(),
                    sourceDeviceId: deviceId,
                    schemaVersion: 1,
                  },
                  action,
                });
              }
            },
          });
          relayService.start();
        } else if (mergedCfg.relayUrl && !relayConfig) {
          api.logger.warn(
            "health: relay polling disabled because relay runtime configuration is incomplete",
          );
        }

        await store.cleanupExpired().catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          api.logger.warn(`health: initial cleanup failed: ${message}`);
        });

        // Start daily report scheduler
        if (cfg.dailyReport !== false) {
          scheduler = new DailyReportScheduler({
            reportTime: cfg.reportTime ?? DEFAULT_REPORT_TIME,
            store,
            logger: api.logger,
            focusAreas: cfg.focusAreas ?? ["general_wellness"],
            language: cfg.language ?? DEFAULT_LANGUAGE,
            reportService,
            deliveryService: new ReportDeliveryService({
              runtime: api.runtime,
              notifyTarget: cfg.notify?.target,
              notifyChannel: cfg.notify?.channel,
              reportChannel: cfg.reportChannel,
            }),
          });
          scheduler.start();
        }
      },
      stop: async () => {
        await relayService?.stop();
        scheduler?.stop();
      },
    });

    api.logger.info(
      `health: plugin loaded (config: reportTime=${cfg.reportTime}, retentionDays=${cfg.retentionDays}, relay=${cfg.relayUrl ? "enabled" : "disabled"})`,
    );

    api.logger.info("health: plugin initialized");
  },
};

export { plugin };

export function register(api: OpenClawPluginApi) {
  return plugin.register(api);
}

export const activate = register;

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
