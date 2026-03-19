/**
 * @fileoverview Encrypted health envelope types for E2EE relay protocol
 * @module envelope
 */

import type { Base64Url, DeviceId, TimestampMs } from "./device.js";

/**
 * Supported health data types for relay routing
 * Worker does not decrypt, only uses for Gateway routing
 */
export type HealthDataType =
  | "health.samples"
  | "health.workout"
  | "health.summary";

/**
 * Protocol version for the encrypted envelope
 */
export const HEALTH_ENVELOPE_VERSION = 1 as const;

/**
 * Encrypted health envelope format
 * @description E2EE envelope that iOS sends to relay, relay forwards to Gateway
 * All sensitive health data is encrypted - relay sees only ciphertext and routing metadata
 */
export interface EncryptedHealthEnvelope {
  /** Protocol version */
  version: typeof HEALTH_ENVELOPE_VERSION;
  /** Sender device ID (SHA-256 of Ed25519 public key) */
  deviceId: DeviceId;
  /** Target Gateway device ID */
  gatewayId: DeviceId;
  /** Ephemeral X25519 public key (base64url, 32 bytes) for ECDH key exchange */
  ephemeralPubKey: Base64Url;
  /** AES-256-GCM nonce (base64url, 12 bytes) */
  nonce: Base64Url;
  /** AES-256-GCM ciphertext (base64url) */
  ciphertext: Base64Url;
  /** AES-256-GCM authentication tag (base64url, 16 bytes) */
  tag: Base64Url;
  /** Data type hint for routing (Worker does not decrypt) */
  dataType: HealthDataType;
  /** Creation timestamp in milliseconds */
  createdAtMs: TimestampMs;
}

/**
 * Health envelope with sync ID for idempotency
 * Used when iOS sends multiple uploads for the same day (late arrivals)
 */
export interface EncryptedHealthEnvelopeWithSyncId
  extends EncryptedHealthEnvelope {
  /** Sync identifier for deduplication on Gateway side */
  syncId: string;
}

/**
 * Envelope upload request body
 */
export interface UploadEnvelopeRequest {
  /** The encrypted health envelope */
  envelope: EncryptedHealthEnvelope;
}

/**
 * Type guard to check if envelope has syncId
 */
export function isEnvelopeWithSyncId(
  envelope: EncryptedHealthEnvelope
): envelope is EncryptedHealthEnvelopeWithSyncId {
  return "syncId" in envelope && typeof envelope.syncId === "string";
}