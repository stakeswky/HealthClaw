// ============================================================================
// Health Data Envelope Decryption
// ============================================================================

import { createDecipheriv, diffieHellman, hkdfSync, verify } from "node:crypto";
import type { HealthDataEnvelope, HealthDataPayload } from "../types.js";
import type { DecryptionKeys, DecryptResult } from "./types.js";

const HKDF_INFO = Buffer.from("openclaw-health-v1");
const HKDF_SALT = Buffer.alloc(32, 0);
const TIMESTAMP_DRIFT_MS = 5 * 60 * 1000; // 5 minutes tolerance

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
      privateKey: { key: keys.gatewayX25519PrivateKey, type: "x25519" },
      publicKey: { key: ephemeralPub, type: "x25519" },
    } as unknown as Parameters<typeof diffieHellman>[0]);
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