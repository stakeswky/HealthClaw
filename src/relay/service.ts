import {
  createPrivateKey,
  sign,
  type KeyObject,
} from "node:crypto";
import { decryptRelayHealthEnvelope } from "../crypto/index.js";
import type { PluginLogger } from "../openclaw-stub.js";
import type {
  HealthPluginConfig,
  RelayPollHealthMessage,
} from "../types.js";
import type { HealthStore } from "../store/HealthStore.js";

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 20;
const RAW_ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

type RelayPollResponse = {
  ok: boolean;
  messages?: RelayPollHealthMessage[];
  hasMore?: boolean;
  error?: string;
  message?: string;
};

type RelayAckResponse = {
  ok: boolean;
  acknowledged?: number;
  notFound?: number;
  error?: string;
  message?: string;
};

export type RelayPollingRuntimeConfig = {
  relayUrl: string;
  gatewayDeviceId: string;
  pollIntervalMs: number;
  batchSize: number;
  gatewayEd25519PrivateKey: string;
};

export type RelayHealthIngestionServiceDeps = {
  store: HealthStore;
  logger: PluginLogger;
  config: RelayPollingRuntimeConfig;
  fetchImpl?: typeof fetch;
};

export class RelayHealthIngestionService {
  private readonly store: HealthStore;
  private readonly logger: PluginLogger;
  private readonly config: RelayPollingRuntimeConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly gatewayPrivateKey: KeyObject;
  private running = false;
  private loopPromise: Promise<void> | null = null;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: RelayHealthIngestionServiceDeps) {
    this.store = deps.store;
    this.logger = deps.logger;
    this.config = deps.config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.gatewayPrivateKey = importEd25519PrivateKey(deps.config.gatewayEd25519PrivateKey);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loopPromise = this.runLoop();
    this.logger.info(
      `health: relay polling started (gateway=${this.config.gatewayDeviceId}, interval=${this.config.pollIntervalMs}ms, batch=${this.config.batchSize})`,
    );
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.sleepTimer) {
      clearTimeout(this.sleepTimer);
      this.sleepTimer = null;
    }
    await this.loopPromise;
    this.loopPromise = null;
    this.logger.info("health: relay polling stopped");
  }

  async pollOnce(): Promise<void> {
    const messages = await this.pollMessages();
    if (messages.length === 0) {
      this.logger.debug("health: relay poll returned no messages");
      return;
    }

    const ackIds: string[] = [];
    for (const message of messages) {
      const result = decryptRelayHealthEnvelope(message.envelope, this.store.getDecryptionKeys());
      if (!result.ok) {
        this.logger.warn(
          `health: failed to decrypt relay envelope messageId=${message.messageId}: ${result.error}`,
        );
        continue;
      }

      try {
        const saveResult = await this.store.saveDailySummary(result.payload, result.deviceId);
        ackIds.push(message.messageId);
        this.logger.info(
          `health: relay envelope processed messageId=${message.messageId} date=${saveResult.date} action=${saveResult.action}`,
        );
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `health: failed to persist relay envelope messageId=${message.messageId}: ${messageText}`,
        );
      }
    }

    if (ackIds.length > 0) {
      await this.acknowledgeMessages(ackIds);
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`health: relay polling iteration failed: ${message}`);
      }

      if (!this.running) break;
      await this.sleep(this.config.pollIntervalMs);
    }
  }

  private async pollMessages(): Promise<RelayPollHealthMessage[]> {
    const signedAtMs = Date.now();
    const gatewayId = this.config.gatewayDeviceId;
    const payload = `healthclaw-poll-v1\n${gatewayId}\n${signedAtMs}\nGET /v1/health/poll/${gatewayId}`;
    const signature = sign(null, Buffer.from(payload, "utf8"), this.gatewayPrivateKey).toString("base64url");

    const url = new URL(`/v1/health/poll/${gatewayId}`, withTrailingSlash(this.config.relayUrl));
    url.searchParams.set("limit", String(this.config.batchSize));

    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        "x-openclaw-gateway-device-id": gatewayId,
        "x-openclaw-gateway-signature": signature,
        "x-openclaw-gateway-signed-at-ms": String(signedAtMs),
      },
    });

    const result = await response.json() as RelayPollResponse;
    if (!response.ok || !result.ok) {
      throw new Error(result.message ?? result.error ?? `Relay poll failed with status ${response.status}`);
    }

    return result.messages ?? [];
  }

  private async acknowledgeMessages(messageIds: string[]): Promise<void> {
    const signedAtMs = Date.now();
    const body = JSON.stringify({
      gatewayId: this.config.gatewayDeviceId,
      messageIds,
    });
    const payload = `healthclaw-ack-v1\n${this.config.gatewayDeviceId}\n${signedAtMs}\n${body}`;
    const signature = sign(null, Buffer.from(payload, "utf8"), this.gatewayPrivateKey).toString("base64url");

    const response = await this.fetchImpl(
      new URL("/v1/health/ack", withTrailingSlash(this.config.relayUrl)),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openclaw-gateway-device-id": this.config.gatewayDeviceId,
          "x-openclaw-gateway-signature": signature,
          "x-openclaw-gateway-signed-at-ms": String(signedAtMs),
        },
        body,
      },
    );

    const result = await response.json() as RelayAckResponse;
    if (!response.ok || !result.ok) {
      throw new Error(result.message ?? result.error ?? `Relay ack failed with status ${response.status}`);
    }

    this.logger.debug(
      `health: relay ack completed acknowledged=${result.acknowledged ?? 0} notFound=${result.notFound ?? 0}`,
    );
  }

  private sleep(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        resolve();
      }, durationMs);
    });
  }
}

export function resolveRelayPollingRuntimeConfig(
  config: HealthPluginConfig,
  env: NodeJS.ProcessEnv = process.env,
): RelayPollingRuntimeConfig | null {
  const relayUrl = config.relayUrl?.trim();
  if (!relayUrl) return null;

  const gatewayDeviceId = config.gatewayDeviceId?.trim() || env.HEALTHCLAW_DEVICE_ID?.trim() || "";
  const gatewayEd25519PrivateKey = env.HEALTHCLAW_ED25519_PRIVATE_KEY?.trim() || "";
  if (!gatewayDeviceId || !gatewayEd25519PrivateKey) {
    return null;
  }

  return {
    relayUrl,
    gatewayDeviceId,
    pollIntervalMs: normalizeInt(config.relayPollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 1_000, 300_000),
    batchSize: normalizeInt(config.relayBatchSize, DEFAULT_BATCH_SIZE, 1, 100),
    gatewayEd25519PrivateKey,
  };
}

function normalizeInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function importEd25519PrivateKey(input: string): KeyObject {
  const trimmed = input.trim();
  if (trimmed.includes("BEGIN")) {
    return createPrivateKey(trimmed);
  }

  const binary = decodeOpaqueBinary(trimmed);
  try {
    return createPrivateKey({ key: binary, format: "der", type: "pkcs8" });
  } catch {
    if (binary.length === 32) {
      return createPrivateKey({
        key: Buffer.concat([RAW_ED25519_PKCS8_PREFIX, binary]),
        format: "der",
        type: "pkcs8",
      });
    }
    throw new Error("Unsupported HEALTHCLAW_ED25519_PRIVATE_KEY format");
  }
}

function decodeOpaqueBinary(value: string): Buffer {
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    return Buffer.from(value, "hex");
  }

  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}
