// ============================================================================
// Encrypted Key Bundle Export/Import
// ============================================================================
//
// Provides disaster recovery for gateway encryption keys via password-protected
// key bundles. Users can export their device identity (Ed25519 key pair) to an
// encrypted bundle and restore it on a new gateway.
//
// Security:
// - scrypt with N=2^15 (for storage key) or N=2^17 (for bundle encryption)
// - AES-256-GCM for authenticated encryption
// - Minimum 12 character passphrase required

import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  scrypt,
  KeyObject,
} from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { KeyBundle, KeyBundleConfig, EncryptedKeyBundle, KeyBundleImportResult } from "./types.js";

function scryptAsync(
  password: string | Buffer | Uint8Array,
  salt: Buffer | string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

const STORAGE_SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const BUNDLE_SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const STORAGE_KEY_SALT = Buffer.alloc(32, 0);
const BUNDLE_VERSION = 1;
const MIN_PASSPHRASE_LENGTH = 12;

const KEY_FILES = {
  ed25519Private: "ed25519_private.pem",
  ed25519Public: "ed25519_public.pem",
  x25519Private: "x25519_private.pem",
  x25519Public: "x25519_public.pem",
  metadata: "key-metadata.json",
} as const;

const ENV_DEVICE_ID = "HEALTHCLAW_DEVICE_ID";
const ENV_ED25519_PRIVATE_KEY = "HEALTHCLAW_ED25519_PRIVATE_KEY";
const ENV_ED25519_PUBLIC_KEY = "HEALTHCLAW_ED25519_PUBLIC_KEY";

// ============================================================================
// Storage Key Derivation
// ============================================================================

export async function deriveStorageKey(identitySecret: Uint8Array): Promise<Uint8Array> {
  if (!(identitySecret instanceof Uint8Array)) {
    throw new Error("identitySecret must be a Uint8Array");
  }
  if (identitySecret.length === 0) {
    throw new Error("identitySecret cannot be empty");
  }

  const key = await scryptAsync(identitySecret, STORAGE_KEY_SALT, 32, STORAGE_SCRYPT_PARAMS);
  return new Uint8Array(key);
}

// ============================================================================
// Key Bundle Load/Create
// ============================================================================

interface KeyBundleInternal {
  deviceId: string;
  ed25519PrivateKey: KeyObject;
  ed25519PublicKey: KeyObject;
  x25519PrivateKey: KeyObject;
  x25519PublicKey: KeyObject;
  ed25519PrivateKeyPem: string;
  ed25519PublicKeyPem: string;
  x25519PrivateKeyPem: string;
  x25519PublicKeyPem: string;
  createdAt: number;
}

export async function loadOrCreateKeyBundle(config: KeyBundleConfig): Promise<KeyBundleInternal> {
  if (!config.keyDir || typeof config.keyDir !== "string") {
    throw new Error("config.keyDir must be a non-empty string");
  }
  if (!config.deviceId || typeof config.deviceId !== "string") {
    throw new Error("config.deviceId must be a non-empty string");
  }

  await fs.mkdir(config.keyDir, { recursive: true });

  if (!config.forceCreate) {
    const existing = await tryLoadExistingBundle(config.keyDir);
    if (existing) {
      return existing;
    }
  }

  return await createNewKeyBundle(config.keyDir, config.deviceId);
}

async function tryLoadExistingBundle(keyDir: string): Promise<KeyBundleInternal | null> {
  try {
    const ed25519PrivatePem = await fs.readFile(path.join(keyDir, KEY_FILES.ed25519Private), "utf8");
    const ed25519PublicPem = await fs.readFile(path.join(keyDir, KEY_FILES.ed25519Public), "utf8");
    const x25519PrivatePem = await fs.readFile(path.join(keyDir, KEY_FILES.x25519Private), "utf8");
    const x25519PublicPem = await fs.readFile(path.join(keyDir, KEY_FILES.x25519Public), "utf8");
    const metadataJson = await fs.readFile(path.join(keyDir, KEY_FILES.metadata), "utf8");
    const metadata = JSON.parse(metadataJson) as { deviceId: string; createdAt: number };

    return {
      deviceId: metadata.deviceId,
      ed25519PrivateKey: createPrivateKey(ed25519PrivatePem),
      ed25519PublicKey: createPublicKey(ed25519PublicPem),
      x25519PrivateKey: createPrivateKey(x25519PrivatePem),
      x25519PublicKey: createPublicKey(x25519PublicPem),
      ed25519PrivateKeyPem: ed25519PrivatePem,
      ed25519PublicKeyPem: ed25519PublicPem,
      x25519PrivateKeyPem: x25519PrivatePem,
      x25519PublicKeyPem: x25519PublicPem,
      createdAt: metadata.createdAt,
    };
  } catch {
    return null;
  }
}

async function createNewKeyBundle(keyDir: string, deviceId: string): Promise<KeyBundleInternal> {
  const { privateKey: ed25519PrivateKey, publicKey: ed25519PublicKey } = generateKeyPairSync("ed25519");
  const { privateKey: x25519PrivateKey, publicKey: x25519PublicKey } = generateKeyPairSync("x25519");

  const ed25519PrivatePem = ed25519PrivateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const ed25519PublicPem = ed25519PublicKey.export({ type: "spki", format: "pem" }) as string;
  const x25519PrivatePem = x25519PrivateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const x25519PublicPem = x25519PublicKey.export({ type: "spki", format: "pem" }) as string;

  const createdAt = Date.now();

  await fs.writeFile(path.join(keyDir, KEY_FILES.ed25519Private), ed25519PrivatePem, { mode: 0o600 });
  await fs.writeFile(path.join(keyDir, KEY_FILES.ed25519Public), ed25519PublicPem, { mode: 0o644 });
  await fs.writeFile(path.join(keyDir, KEY_FILES.x25519Private), x25519PrivatePem, { mode: 0o600 });
  await fs.writeFile(path.join(keyDir, KEY_FILES.x25519Public), x25519PublicPem, { mode: 0o644 });
  await fs.writeFile(
    path.join(keyDir, KEY_FILES.metadata),
    JSON.stringify({ deviceId, createdAt }, null, 2) + "\n",
    { mode: 0o644 }
  );

  return {
    deviceId,
    ed25519PrivateKey,
    ed25519PublicKey,
    x25519PrivateKey,
    x25519PublicKey,
    ed25519PrivateKeyPem: ed25519PrivatePem,
    ed25519PublicKeyPem: ed25519PublicPem,
    x25519PrivateKeyPem: x25519PrivatePem,
    x25519PublicKeyPem: x25519PublicPem,
    createdAt,
  };
}

// ============================================================================
// Key Bundle Export
// ============================================================================

export async function exportKeyBundle(bundle: KeyBundleInternal, password: string): Promise<EncryptedKeyBundle> {
  if (!password || password.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  if (!bundle.ed25519PrivateKeyPem || !bundle.ed25519PublicKeyPem) {
    throw new Error("Bundle must contain Ed25519 key pair");
  }

  const salt = randomBytes(32);
  const key = await scryptAsync(password, salt, 32, BUNDLE_SCRYPT_PARAMS);
  const iv = randomBytes(12);

  const plaintext = JSON.stringify({
    ed25519PrivateKeyPem: bundle.ed25519PrivateKeyPem,
    x25519PrivateKeyPem: bundle.x25519PrivateKeyPem,
  });

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    v: 1,
    encryptedPrivateKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    salt: salt.toString("base64"),
    publicKeyPem: bundle.ed25519PublicKeyPem,
    x25519PublicKeyPem: bundle.x25519PublicKeyPem,
    createdAt: Date.now(),
  };
}

// ============================================================================
// Legacy Bundle Export/Import (for backwards compatibility)
// ============================================================================

export async function exportEncryptedKeyBundle(params: { passphrase: string }): Promise<string> {
  const { passphrase } = params;

  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }

  const identity = loadDeviceIdentity();
  if (!identity) {
    throw new Error("Device identity not configured. Set environment variables.");
  }

  const salt = randomBytes(32);
  const key = await scryptAsync(passphrase, salt, 32, BUNDLE_SCRYPT_PARAMS);
  const iv = randomBytes(12);

  const plaintext = JSON.stringify({
    v: BUNDLE_VERSION,
    deviceId: identity.deviceId,
    privateKeyPem: identity.privateKeyPem,
    publicKeyPem: identity.publicKeyPem,
    exportedAt: Date.now(),
  } satisfies KeyBundle);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const bundle = Buffer.concat([salt, iv, tag, encrypted]);
  const b64 = bundle.toString("base64");

  return b64.match(/.{1,64}/g)!.join("\n");
}

export async function importEncryptedKeyBundle(params: {
  bundleBase64: string;
  passphrase: string;
}): Promise<KeyBundleImportResult> {
  const { bundleBase64, passphrase } = params;

  const raw = Buffer.from(bundleBase64.replace(/\s+/g, ""), "base64");

  if (raw.length < 60) {
    return { ok: false, error: "Invalid bundle: too short" };
  }

  const salt = raw.subarray(0, 32);
  const iv = raw.subarray(32, 44);
  const tag = raw.subarray(44, 60);
  const ciphertext = raw.subarray(60);

  let key: Buffer;
  try {
    key = await scryptAsync(passphrase, salt, 32, BUNDLE_SCRYPT_PARAMS);
  } catch (err) {
    return { ok: false, error: `Key derivation failed: ${String(err)}` };
  }

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  let decrypted: Buffer;
  try {
    decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return { ok: false, error: "Decryption failed (wrong passphrase or corrupted bundle)" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decrypted.toString("utf8"));
  } catch {
    return { ok: false, error: "Invalid bundle: corrupted JSON" };
  }

  if (!isKeyBundle(parsed)) {
    return { ok: false, error: "Invalid bundle: missing required fields" };
  }

  if (parsed.v !== BUNDLE_VERSION) {
    return { ok: false, error: `Unsupported bundle version: ${parsed.v}` };
  }

  return { ok: true, bundle: parsed };
}

// ============================================================================
// Helpers
// ============================================================================

function loadDeviceIdentity(): {
  deviceId: string;
  privateKeyPem: string;
  publicKeyPem: string;
} | null {
  const deviceId = process.env[ENV_DEVICE_ID];
  const privateKey = process.env[ENV_ED25519_PRIVATE_KEY];
  const publicKey = process.env[ENV_ED25519_PUBLIC_KEY];

  if (!deviceId || !privateKey || !publicKey) {
    return null;
  }

  const privateKeyPem = privateKey.includes("-----BEGIN")
    ? privateKey
    : hexToEd25519PrivateKeyPem(privateKey);

  const publicKeyPem = publicKey.includes("-----BEGIN")
    ? publicKey
    : hexToEd25519PublicKeyPem(publicKey);

  return { deviceId, privateKeyPem, publicKeyPem };
}

function hexToEd25519PrivateKeyPem(hex: string): string {
  const raw = Buffer.from(hex, "hex");
  const lines = raw.toString("base64").match(/.{1,64}/g) || [];
  return [
    "-----BEGIN PRIVATE KEY-----",
    ...lines,
    "-----END PRIVATE KEY-----",
  ].join("\n");
}

function hexToEd25519PublicKeyPem(hex: string): string {
  const raw = Buffer.from(hex, "hex");
  const lines = raw.toString("base64").match(/.{1,64}/g) || [];
  return [
    "-----BEGIN PUBLIC KEY-----",
    ...lines,
    "-----END PUBLIC KEY-----",
  ].join("\n");
}

function isKeyBundle(value: unknown): value is KeyBundle {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as KeyBundle).v === "number" &&
    typeof (value as KeyBundle).deviceId === "string" &&
    typeof (value as KeyBundle).privateKeyPem === "string" &&
    typeof (value as KeyBundle).publicKeyPem === "string" &&
    typeof (value as KeyBundle).exportedAt === "number"
  );
}