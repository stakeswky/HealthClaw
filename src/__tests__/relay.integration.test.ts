import {
  createCipheriv,
  createHash,
  diffieHellman,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { plugin } from "../index.js";
import { RelayHealthIngestionService } from "../relay/index.js";
import { HealthStore } from "../store/index.js";
import type { OpenClawPluginApi, PluginLogger } from "../openclaw-stub.js";
import type { RelayHealthEnvelope } from "../types.js";

function toBase64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function deriveX963Key(sharedSecret: Buffer, sharedInfo: Buffer, outputLength: number): Buffer {
  const chunks: Buffer[] = [];
  let counter = 1;

  while (Buffer.concat(chunks).length < outputLength) {
    const counterBuffer = Buffer.alloc(4);
    counterBuffer.writeUInt32BE(counter++, 0);
    chunks.push(
      createHash("sha256")
        .update(sharedSecret)
        .update(counterBuffer)
        .update(sharedInfo)
        .digest(),
    );
  }

  return Buffer.concat(chunks).subarray(0, outputLength);
}

function createRelayEnvelope(
  gatewayPublicKey: KeyObject,
  deviceId: string,
  gatewayId: string,
  payload: Record<string, unknown>,
): RelayHealthEnvelope {
  const { privateKey: ephemeralPrivate, publicKey: ephemeralPublic } = generateKeyPairSync("x25519");
  const sharedSecret = diffieHellman({
    privateKey: ephemeralPrivate,
    publicKey: gatewayPublicKey,
  });
  const key = deriveX963Key(sharedSecret, Buffer.from("openclaw-health-sync"), 32);
  const nonce = Buffer.from("0102030405060708090a0b0c", "hex");
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    deviceId,
    gatewayId,
    ephemeralPubKey: toBase64Url(ephemeralPublic.export({ format: "der", type: "spki" }).subarray(-32)),
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(ciphertext),
    tag: toBase64Url(tag),
    dataType: "health.summary",
    createdAtMs: Date.now(),
  };
}

function createLogger(): PluginLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

type MockApi = OpenClawPluginApi & {
  httpRoutes: unknown[];
  tools: Array<{ tool: unknown; options?: { name: string } }>;
  services: Array<{ id: string; start: (ctx: { stateDir: string }) => Promise<void>; stop: () => Promise<void> }>;
};

function createMockApi(pluginConfig: unknown): MockApi {
  const httpRoutes: unknown[] = [];
  const tools: Array<{ tool: unknown; options?: { name: string } }> = [];
  const services: Array<{ id: string; start: (ctx: { stateDir: string }) => Promise<void>; stop: () => Promise<void> }> = [];
  const logger = createLogger();

  return {
    pluginConfig,
    logger,
    resolvePath(relativePath: string) {
      return path.join("/tmp", relativePath);
    },
    registerHttpRoute(config) {
      httpRoutes.push(config);
    },
    registerTool(tool, options) {
      tools.push({ tool, options });
    },
    registerCommand() {
      return;
    },
    registerService(config) {
      services.push(config);
    },
    on() {
      return;
    },
    runtime: {},
    httpRoutes,
    tools,
    services,
  };
}

let tempDir = "";
const envBackup = { ...process.env };

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), "health-relay-service-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.env = { ...envBackup };
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("plugin relay integration", () => {
  it("registers health route, tools, and lifecycle service", () => {
    const api = createMockApi({
      relayUrl: "https://relay.example",
      relayPollIntervalMs: 5000,
      relayBatchSize: 10,
    });
    process.env.OPENCLAW_DEVICE_ID = "a".repeat(64);
    process.env.OPENCLAW_ED25519_PRIVATE_KEY = Buffer.alloc(32, 7).toString("base64url");

    plugin.register(api);

    expect(api.httpRoutes).toHaveLength(1);
    expect(api.tools).toHaveLength(2);
    expect(api.services).toHaveLength(1);
    expect(api.services[0]?.id).toBe("health");
  });

  it("polls relay messages, decrypts canonical envelopes, stores results, and ACKs them", async () => {
    const gatewayDeviceId = "b".repeat(64);
    const { privateKey: gatewayPrivateKey, publicKey: gatewayPublicKey } = generateKeyPairSync("x25519");
    const { privateKey: signingPrivateKey } = generateKeyPairSync("ed25519");
    const gatewayX25519Raw = gatewayPrivateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
    const signingPrivatePem = signingPrivateKey.export({ format: "pem", type: "pkcs8" }) as string;

    process.env.OPENCLAW_DEVICE_ID = gatewayDeviceId;
    process.env.OPENCLAW_ED25519_PRIVATE_KEY = signingPrivatePem;
    process.env.OPENCLAW_GATEWAY_X25519_KEY = gatewayX25519Raw.toString("hex");
    process.env.OPENCLAW_GATEWAY_IDENTITY_KEY = "11".repeat(32);

    const deviceId = "c".repeat(64);
    const envelope = createRelayEnvelope(gatewayPublicKey, deviceId, gatewayDeviceId, {
      date: "2026-03-17",
      userId: "user-123",
      steps: 12345,
      sleepMinutes: 430,
    });

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        messages: [{ messageId: "msg_1", envelope, receivedAtMs: Date.now() }],
        hasMore: false,
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        acknowledged: 1,
        notFound: 0,
      })));

    const store = new HealthStore({
      stateDir: tempDir,
      retentionDays: 90,
      logger: createLogger(),
    });
    const service = new RelayHealthIngestionService({
      store,
      logger: createLogger(),
      config: {
        relayUrl: "https://relay.example",
        gatewayDeviceId,
        pollIntervalMs: 5000,
        batchSize: 10,
        gatewayEd25519PrivateKey: signingPrivatePem,
      },
      fetchImpl: fetchImpl as typeof fetch,
    });

    await service.pollOnce();

    const saved = await store.getDailySummary("user-123", "2026-03-17");
    expect(saved?.steps).toBe(12345);
    expect(saved?.sleepMinutes).toBe(430);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const ackCall = fetchImpl.mock.calls[1];
    expect(ackCall?.[0].toString()).toContain("/v1/health/ack");
    const ackBody = ackCall?.[1]?.body;
    expect(typeof ackBody).toBe("string");
    expect(JSON.parse(ackBody as string)).toEqual({
      gatewayId: gatewayDeviceId,
      messageIds: ["msg_1"],
    });
  });
});
