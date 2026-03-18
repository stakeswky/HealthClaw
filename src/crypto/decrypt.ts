// ============================================================================
// Health Data Envelope Decryption
// ============================================================================

import {
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
  verify,
} from "node:crypto";
import type { HealthDataEnvelope, HealthDataPayload, RelayHealthEnvelope } from "../types.js";
import type { DecryptionKeys, DecryptResult } from "./types.js";

const HKDF_INFO = Buffer.from("healthclaw-v1");
const HKDF_SALT = Buffer.alloc(32, 0);
const TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes tolerance
const X963_INFO = Buffer.from("healthclaw-sync");
const X25519_PRIVATE_KEY_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_PUBLIC_KEY_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

/**
 * Decrypts a health data envelope using X25519 ECDH + AES-256-GCM.
 *
 * Security notes:
 * - Timestamp validation prevents replay attacks
 * - Ed25519 signature verification ensures data integrity
 * - Decrypted data exists only in memory, never written to logs
 *
 * @param envelope - The encrypted health data envelope from iOS device
 * @param keys - Decryption keys containing gateway's X25519 private key
 * @returns DecryptResult with payload on success, or error message on failure
 */
export function decryptHealthEnvelope(
  envelope: HealthDataEnvelope,
  keys: DecryptionKeys,
): DecryptResult {
  // 1. Timestamp validation (prevent replay attacks)
  const drift = Math.abs(Date.now() - envelope.timestamp);
  if (drift > TIMESTAMP_DRIFT_MS) {
    return { ok: false, error: "Envelope timestamp out of acceptable range" };
  }

  // 2. Ed25519 signature verification
  const encryptedBuf = Buffer.from(envelope.encryptedPayload, "base64");
  const sigValid = verifyDeviceSignature(
    encryptedBuf,
    Buffer.from(envelope.signature, "hex"),
    Buffer.from(envelope.publicKey, "hex"),
  );
  if (!sigValid) {
    return { ok: false, error: "Invalid device signature" };
  }

  // 3. X25519 ECDH - derive shared secret
  const ephemeralPub = Buffer.from(envelope.ephemeralPublicKey, "hex");
  let sharedSecret: Buffer;
  try {
    sharedSecret = diffieHellman({
      privateKey: importRawX25519PrivateKey(keys.gatewayX25519PrivateKey),
      publicKey: importRawX25519PublicKey(ephemeralPub),
    });
  } catch {
    return { ok: false, error: "ECDH key exchange failed" };
  }

  // 4. HKDF-SHA256 derive AES-256 key
  const aesKey = Buffer.from(hkdfSync("sha256", sharedSecret, HKDF_SALT, HKDF_INFO, 32));

  // 5. AES-256-GCM decryption (auth tag = last 16 bytes of encrypted payload)
  const nonce = Buffer.from(envelope.nonce, "base64");
  if (nonce.length !== 12) {
    return { ok: false, error: "Invalid nonce length" };
  }

  const authTag = encryptedBuf.subarray(encryptedBuf.length - 16);
  const ciphertext = encryptedBuf.subarray(0, encryptedBuf.length - 16);

  const decipher = createDecipheriv("aes-256-gcm", aesKey, nonce);
  decipher.setAuthTag(authTag);

  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return { ok: false, error: "Decryption failed (invalid key or tampered data)" };
  }

  // 6. Parse JSON - data exists only in memory, never logged
  let payload: HealthDataPayload;
  try {
    payload = JSON.parse(decrypted.toString("utf8")) as HealthDataPayload;
  } catch {
    return { ok: false, error: "Invalid JSON payload" };
  }

  // Validate required fields
  if (!payload.date || !payload.userId) {
    return { ok: false, error: "Missing required fields in payload" };
  }

  return { ok: true, payload, deviceId: envelope.deviceId };
}

/**
 * Decrypts the canonical relay envelope using X25519 + ANSI X9.63 KDF + AES-256-GCM.
 *
 * This matches the current iOS CryptoKit implementation that derives the symmetric key via
 * `SharedSecret.x963DerivedSymmetricKey(using: .sha256, sharedInfo: "healthclaw-sync")`.
 */
export function decryptRelayHealthEnvelope(
  envelope: RelayHealthEnvelope,
  keys: DecryptionKeys,
): DecryptResult {
  const ephemeralPub = decodeBase64Url(envelope.ephemeralPubKey);
  let sharedSecret: Buffer;
  try {
    sharedSecret = diffieHellman({
      privateKey: importRawX25519PrivateKey(keys.gatewayX25519PrivateKey),
      publicKey: importRawX25519PublicKey(ephemeralPub),
    });
  } catch {
    return { ok: false, error: "Relay envelope ECDH key exchange failed" };
  }

  const aesKey = deriveX963Key(sharedSecret, X963_INFO, 32);
  const nonce = decodeBase64Url(envelope.nonce);
  const ciphertext = decodeBase64Url(envelope.ciphertext);
  const authTag = decodeBase64Url(envelope.tag);

  if (nonce.length !== 12) {
    return { ok: false, error: "Invalid relay nonce length" };
  }
  if (authTag.length !== 16) {
    return { ok: false, error: "Invalid relay auth tag length" };
  }

  const decipher = createDecipheriv("aes-256-gcm", aesKey, nonce);
  decipher.setAuthTag(authTag);

  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return { ok: false, error: "Relay envelope decryption failed" };
  }

  let payload: HealthDataPayload;
  try {
    payload = JSON.parse(decrypted.toString("utf8")) as HealthDataPayload;
  } catch {
    return { ok: false, error: "Invalid JSON payload" };
  }

  if (!payload.date || !payload.userId) {
    return { ok: false, error: "Missing required fields in payload" };
  }

  return { ok: true, payload, deviceId: envelope.deviceId };
}

/**
 * Verifies Ed25519 signature of device data.
 *
 * @param data - The signed data buffer
 * @param signature - Ed25519 signature (raw 64 bytes)
 * @param publicKey - Ed25519 public key (raw 32 bytes)
 * @returns true if signature is valid, false otherwise
 */
export function verifyDeviceSignature(data: Buffer, signature: Buffer, publicKey: Buffer): boolean {
  try {
    return verify(null, data, { key: publicKey, type: "ed25519" } as unknown as Parameters<typeof verify>[2], signature);
  } catch {
    return false;
  }
}

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
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

function importRawX25519PrivateKey(rawPrivateKey: Buffer): ReturnType<typeof createPrivateKey> {
  return createPrivateKey({
    key: Buffer.concat([X25519_PRIVATE_KEY_PREFIX, rawPrivateKey]),
    format: "der",
    type: "pkcs8",
  });
}

function importRawX25519PublicKey(rawPublicKey: Buffer): ReturnType<typeof createPublicKey> {
  return createPublicKey({
    key: Buffer.concat([X25519_PUBLIC_KEY_PREFIX, rawPublicKey]),
    format: "der",
    type: "spki",
  });
}
