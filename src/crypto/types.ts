// ============================================================================
// Crypto Module Types
// ============================================================================

import type { HealthDataPayload } from "../types.js";

/** Keys required for decrypting health data envelopes */
export type DecryptionKeys = {
  /** Gateway's X25519 private key (raw 32 bytes) */
  gatewayX25519PrivateKey: Buffer;
};

/** Result of decrypting a health data envelope */
export type DecryptResult =
  | { ok: true; payload: HealthDataPayload; deviceId: string }
  | { ok: false; error: string };

/** Key bundle content (decrypted) */
export type KeyBundle = {
  /** Bundle format version */
  v: 1;
  /** Device identifier */
  deviceId: string;
  /** Ed25519 private key in PEM format */
  privateKeyPem: string;
  /** Ed25519 public key in PEM format */
  publicKeyPem: string;
  /** Timestamp when bundle was exported */
  exportedAt: number;
};

/** Result of key bundle import operation */
export type KeyBundleImportResult =
  | { ok: true; bundle: KeyBundle }
  | { ok: false; error: string };