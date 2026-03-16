// ============================================================================
// HTTP Handler for Health Data Upload
// ============================================================================

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi, PluginLogger } from "../openclaw-stub.js";
import { decryptHealthEnvelope } from "../crypto/decrypt.js";
import type { HealthStore } from "../store/HealthStore.js";
import type { HealthDataEnvelope } from "../types.js";
import { formatValidationErrors, validateEnvelope } from "./validation.js";

type HealthHttpHandlerDeps = {
  store: HealthStore;
  api: OpenClawPluginApi;
  logger: PluginLogger;
};

const MAX_BODY_SIZE = 1_048_576;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

export function createHealthHttpHandler(deps: HealthHttpHandlerDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return true;
    }

    let body: Buffer;
    try {
      body = await readBody(req);
    } catch {
      deps.logger.warn("health: failed to read request body");
      sendJson(res, 400, { error: "Failed to read request body" });
      return true;
    }

    if (body.length > MAX_BODY_SIZE) {
      sendJson(res, 413, { error: "Payload too large" });
      return true;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      sendJson(res, 400, { error: "Invalid JSON" });
      return true;
    }

    const validation = validateEnvelope(parsed);
    if (!validation.ok) {
      const errorMsg = formatValidationErrors(validation.errors);
      deps.logger.warn(`health: validation failed: ${errorMsg}`);
      sendJson(res, 400, { error: "Validation failed", details: validation.errors });
      return true;
    }

    const envelope: HealthDataEnvelope = validation.envelope;

    const paired = await deps.store.isDevicePaired(envelope.deviceId);
    if (!paired) {
      deps.logger.warn(`health: upload rejected - unknown device ${envelope.deviceId}`);
      sendJson(res, 403, { error: "Device not paired" });
      return true;
    }

    const keys = deps.store.getDecryptionKeys();
    const result = decryptHealthEnvelope(envelope, keys);
    if (!result.ok) {
      deps.logger.warn(`health: decryption failed for device ${envelope.deviceId}: ${result.error}`);
      sendJson(res, 400, { error: result.error });
      return true;
    }

    try {
      const saveResult = await deps.store.saveDailySummary(result.payload, result.deviceId);
      deps.logger.info(
        `health: received data for device=${envelope.deviceId} date=${result.payload.date} action=${saveResult.action}`,
      );
      sendJson(res, 200, {
        ok: true,
        date: result.payload.date,
        action: saveResult.action,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error(`health: failed to save data for device ${envelope.deviceId}: ${message}`);
      sendJson(res, 500, { error: "Failed to save data" });
    }

    return true;
  };
}