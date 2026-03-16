// ============================================================================
// HTTP Request Validation
// ============================================================================

import type { HealthDataEnvelope } from "../types.js";

export type ValidationError = {
  field: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; envelope: HealthDataEnvelope }
  | { ok: false; errors: ValidationError[] };

const REQUIRED_FIELDS: (keyof HealthDataEnvelope)[] = [
  "deviceId",
  "signature",
  "publicKey",
  "ephemeralPublicKey",
  "encryptedPayload",
  "nonce",
  "timestamp",
];

const HEX_PATTERN = /^[0-9a-fA-F]+$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/;

export function validateEnvelope(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, errors: [{ field: "root", message: "Request body must be a JSON object" }] };
  }

  const envelope = data as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    const value = envelope[field];
    if (value === undefined || value === null) {
      errors.push({ field, message: `Missing required field: ${field}` });
    } else if (typeof value !== "string") {
      errors.push({ field, message: `Field ${field} must be a string` });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const deviceId = envelope.deviceId;
  if (typeof deviceId === "string" && deviceId.length === 0) {
    errors.push({ field: "deviceId", message: "deviceId cannot be empty" });
  }

  const signature = envelope.signature;
  if (typeof signature === "string" && !HEX_PATTERN.test(signature)) {
    errors.push({ field: "signature", message: "signature must be a hex string" });
  }

  const publicKey = envelope.publicKey;
  if (typeof publicKey === "string" && !HEX_PATTERN.test(publicKey)) {
    errors.push({ field: "publicKey", message: "publicKey must be a hex string" });
  }

  const ephemeralPublicKey = envelope.ephemeralPublicKey;
  if (typeof ephemeralPublicKey === "string" && !HEX_PATTERN.test(ephemeralPublicKey)) {
    errors.push({ field: "ephemeralPublicKey", message: "ephemeralPublicKey must be a hex string" });
  }

  const encryptedPayload = envelope.encryptedPayload;
  if (typeof encryptedPayload === "string" && !BASE64_PATTERN.test(encryptedPayload)) {
    errors.push({ field: "encryptedPayload", message: "encryptedPayload must be a base64 string" });
  }

  const nonce = envelope.nonce;
  if (typeof nonce === "string") {
    if (!BASE64_PATTERN.test(nonce)) {
      errors.push({ field: "nonce", message: "nonce must be a base64 string" });
    } else {
      const nonceBytes = Buffer.from(nonce, "base64");
      if (nonceBytes.length !== 12) {
        errors.push({ field: "nonce", message: "nonce must be 12 bytes when decoded" });
      }
    }
  }

  const timestamp = envelope.timestamp;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    errors.push({ field: "timestamp", message: "timestamp must be a number" });
  } else if (timestamp <= 0) {
    errors.push({ field: "timestamp", message: "timestamp must be a positive number" });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, envelope: envelope as HealthDataEnvelope };
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `${e.field}: ${e.message}`).join("; ");
}