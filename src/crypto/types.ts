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

/** Configuration for loading or creating a key bundle */
export type KeyBundleConfig = {
  /** Directory path where key files are stored */
  keyDir: string;
  /** Device identifier (used when creating new keys) */
  deviceId: string;
  /** Optional: Force creation of new keys even if existing ones found */
  forceCreate?: boolean;
};

/** Encrypted key bundle for export/import */
export type EncryptedKeyBundle = {
  /** Bundle format version */
  v: 1;
  /** AES-256-GCM encrypted private key (base64) */
  encryptedPrivateKey: string;
  /** IV/nonce for encryption (base64, 12 bytes) */
  iv: string;
  /** Authentication tag (base64, 16 bytes) */
  authTag: string;
  /** Salt used for key derivation (base64, 32 bytes) */
  salt: string;
  /** Ed25519 public key in PEM format (plaintext) */
  publicKeyPem: string;
  /** X25519 public key in PEM format (plaintext, derived from Ed25519) */
  x25519PublicKeyPem: string;
  /** Timestamp when bundle was created */
  createdAt: number;
};

/** Result of deriveStorageKey operation */
export type DeriveStorageKeyResult =
  | { ok: true; key: Uint8Array }
  | { ok: false; error: string };