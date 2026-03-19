/**
 * Crypto Integration Tests
 *
 * Tests encrypt/decrypt roundtrip, key derivation, and key bundle creation
 * using Node.js crypto module.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
  sign,
  verify,
  KeyObject,
} from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const HKDF_INFO = Buffer.from("healthclaw-v1");
const HKDF_SALT = Buffer.alloc(32, 0);

describe("Crypto Integration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "health-crypto-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("Ed25519 Key Generation", () => {
    it("should generate valid Ed25519 key pair", () => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");

      expect(privateKey).toBeInstanceOf(KeyObject);
      expect(publicKey).toBeInstanceOf(KeyObject);
      expect(privateKey.type).toBe("private");
      expect(publicKey.type).toBe("public");
    });

    it("should export keys in PEM format", () => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");

      const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
      const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string;

      expect(privatePem).toContain("-----BEGIN PRIVATE KEY-----");
      expect(privatePem).toContain("-----END PRIVATE KEY-----");
      expect(publicPem).toContain("-----BEGIN PUBLIC KEY-----");
      expect(publicPem).toContain("-----END PUBLIC KEY-----");
    });

    it("should create and verify Ed25519 signature", () => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const data = Buffer.from("test-data-to-sign");

      const signature = sign(null, data, privateKey);
      const isValid = verify(null, data, publicKey, signature);

      expect(isValid).toBe(true);
    });

    it("should reject signature with modified data", () => {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const originalData = Buffer.from("original-data");
      const modifiedData = Buffer.from("modified-data");

      const signature = sign(null, originalData, privateKey);
      const isValid = verify(null, modifiedData, publicKey, signature);

      expect(isValid).toBe(false);
    });

    it("should reject signature from wrong key", () => {
      const { privateKey: key1 } = generateKeyPairSync("ed25519");
      const { publicKey: key2 } = generateKeyPairSync("ed25519");
      const data = Buffer.from("test-data");

      const signature = sign(null, data, key1);
      const isValid = verify(null, data, key2, signature);

      expect(isValid).toBe(false);
    });
  });

  describe("X25519 Key Exchange", () => {
    it("should perform ECDH key exchange", () => {
      const { privateKey: alicePrivate, publicKey: alicePublic } = generateKeyPairSync("x25519");
      const { privateKey: bobPrivate, publicKey: bobPublic } = generateKeyPairSync("x25519");

      const aliceShared = diffieHellman({
        privateKey: alicePrivate,
        publicKey: bobPublic,
      });

      const bobShared = diffieHellman({
        privateKey: bobPrivate,
        publicKey: alicePublic,
      });

      expect(aliceShared.equals(bobShared)).toBe(true);
      expect(aliceShared.length).toBe(32);
    });

    it("should derive different shared secrets with different peers", () => {
      const { privateKey: alicePrivate } = generateKeyPairSync("x25519");
      const { publicKey: bobPublic } = generateKeyPairSync("x25519");
      const { publicKey: charliePublic } = generateKeyPairSync("x25519");

      const aliceBobShared = diffieHellman({
        privateKey: alicePrivate,
        publicKey: bobPublic,
      });

      const aliceCharlieShared = diffieHellman({
        privateKey: alicePrivate,
        publicKey: charliePublic,
      });

      expect(aliceBobShared.equals(aliceCharlieShared)).toBe(false);
    });
  });

  describe("HKDF Key Derivation", () => {
    it("should derive consistent keys from same input", () => {
      const sharedSecret = randomBytes(32);

      const key1 = Buffer.from(hkdfSync("sha256", sharedSecret, HKDF_SALT, HKDF_INFO, 32));
      const key2 = Buffer.from(hkdfSync("sha256", sharedSecret, HKDF_SALT, HKDF_INFO, 32));

      expect(key1.equals(key2)).toBe(true);
    });

    it("should derive different keys from different shared secrets", () => {
      const secret1 = randomBytes(32);
      const secret2 = randomBytes(32);

      const key1 = Buffer.from(hkdfSync("sha256", secret1, HKDF_SALT, HKDF_INFO, 32));
      const key2 = Buffer.from(hkdfSync("sha256", secret2, HKDF_SALT, HKDF_INFO, 32));

      expect(key1.equals(key2)).toBe(false);
    });

    it("should derive different keys with different info", () => {
      const sharedSecret = randomBytes(32);
      const info1 = Buffer.from("healthclaw-v1");
      const info2 = Buffer.from("healthclaw-v2");

      const key1 = Buffer.from(hkdfSync("sha256", sharedSecret, HKDF_SALT, info1, 32));
      const key2 = Buffer.from(hkdfSync("sha256", sharedSecret, HKDF_SALT, info2, 32));

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe("AES-256-GCM Encryption", () => {
    it("should encrypt and decrypt data successfully", () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = Buffer.from('{"date":"2024-01-01","steps":10000}', "utf8");

      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

      expect(decrypted.equals(plaintext)).toBe(true);
    });

    it("should reject decryption with wrong key", () => {
      const correctKey = randomBytes(32);
      const wrongKey = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = Buffer.from("secret-data");

      const cipher = createCipheriv("aes-256-gcm", correctKey, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const decipher = createDecipheriv("aes-256-gcm", wrongKey, iv);
      decipher.setAuthTag(authTag);

      expect(() => {
        Buffer.concat([decipher.update(encrypted), decipher.final()]);
      }).toThrow();
    });

    it("should reject decryption with tampered ciphertext", () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = Buffer.from("secret-data");

      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const tamperedEncrypted = Buffer.from(encrypted);
      if (tamperedEncrypted[0] !== undefined) tamperedEncrypted[0] ^= 0xff;

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);

      expect(() => {
        Buffer.concat([decipher.update(tamperedEncrypted), decipher.final()]);
      }).toThrow();
    });

    it("should reject decryption with wrong auth tag", () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const plaintext = Buffer.from("secret-data");

      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const wrongAuthTag = Buffer.from(authTag);
      if (wrongAuthTag[0] !== undefined) wrongAuthTag[0] ^= 0xff;

      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(wrongAuthTag);

      expect(() => {
        Buffer.concat([decipher.update(encrypted), decipher.final()]);
      }).toThrow();
    });

    it("should reject decryption with wrong IV", () => {
      const key = randomBytes(32);
      const iv = randomBytes(12);
      const wrongIv = randomBytes(12);
      const plaintext = Buffer.from("secret-data");

      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const decipher = createDecipheriv("aes-256-gcm", key, wrongIv);
      decipher.setAuthTag(authTag);

      expect(() => {
        Buffer.concat([decipher.update(encrypted), decipher.final()]);
      }).toThrow();
    });
  });

  describe("Full Encrypt/Decrypt Roundtrip", () => {
    it("should complete ECDH + HKDF + AES-GCM roundtrip", () => {
      const { privateKey: gatewayPrivate, publicKey: gatewayPublic } = generateKeyPairSync("x25519");
      const { privateKey: ephemeralPrivate, publicKey: ephemeralPublic } = generateKeyPairSync("x25519");

      const payload = {
        date: "2024-01-15",
        userId: "user123",
        steps: 8500,
        activeCalories: 320,
        restingHeartRate: 62,
      };
      const plaintext = Buffer.from(JSON.stringify(payload), "utf8");

      const nonce = randomBytes(12);

      const sharedSecret = diffieHellman({
        privateKey: ephemeralPrivate,
        publicKey: gatewayPublic,
      });

      const aesKey = Buffer.from(hkdfSync("sha256", sharedSecret, HKDF_SALT, HKDF_INFO, 32));

      const cipher = createCipheriv("aes-256-gcm", aesKey, nonce);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const envelope = {
        ephemeralPublicKey: ephemeralPublic.export({ type: "spki", format: "der" }).toString("hex"),
        nonce: nonce.toString("base64"),
        ciphertext: Buffer.concat([encrypted, authTag]).toString("base64"),
      };

      const ephemeralPubFromEnvelope = createPublicKey({
        key: Buffer.from(envelope.ephemeralPublicKey, "hex"),
        type: "spki",
        format: "der",
      });

      const gatewayShared = diffieHellman({
        privateKey: gatewayPrivate,
        publicKey: ephemeralPubFromEnvelope,
      });

      const gatewayAesKey = Buffer.from(hkdfSync("sha256", gatewayShared, HKDF_SALT, HKDF_INFO, 32));

      const combined = Buffer.from(envelope.ciphertext, "base64");
      const receivedCiphertext = combined.subarray(0, combined.length - 16);
      const receivedTag = combined.subarray(combined.length - 16);

      const decipher = createDecipheriv("aes-256-gcm", gatewayAesKey, Buffer.from(envelope.nonce, "base64"));
      decipher.setAuthTag(receivedTag);
      const decrypted = Buffer.concat([decipher.update(receivedCiphertext), decipher.final()]);

      const decryptedPayload = JSON.parse(decrypted.toString("utf8"));
      expect(decryptedPayload.date).toBe("2024-01-15");
      expect(decryptedPayload.steps).toBe(8500);
    });
  });

  describe("Key Bundle Creation", () => {
    it("should create and store key bundle files", async () => {
      const deviceId = "test-device-" + Date.now();
      const { privateKey: ed25519Private, publicKey: ed25519Public } = generateKeyPairSync("ed25519");
      const { privateKey: x25519Private, publicKey: x25519Public } = generateKeyPairSync("x25519");

      const ed25519PrivatePem = ed25519Private.export({ type: "pkcs8", format: "pem" }) as string;
      const ed25519PublicPem = ed25519Public.export({ type: "spki", format: "pem" }) as string;
      const x25519PrivatePem = x25519Private.export({ type: "pkcs8", format: "pem" }) as string;
      const x25519PublicPem = x25519Public.export({ type: "spki", format: "pem" }) as string;

      await fs.writeFile(path.join(tempDir, "ed25519_private.pem"), ed25519PrivatePem, { mode: 0o600 });
      await fs.writeFile(path.join(tempDir, "ed25519_public.pem"), ed25519PublicPem, { mode: 0o644 });
      await fs.writeFile(path.join(tempDir, "x25519_private.pem"), x25519PrivatePem, { mode: 0o600 });
      await fs.writeFile(path.join(tempDir, "x25519_public.pem"), x25519PublicPem, { mode: 0o644 });
      await fs.writeFile(
        path.join(tempDir, "key-metadata.json"),
        JSON.stringify({ deviceId, createdAt: Date.now() }, null, 2)
      );

      const files = await fs.readdir(tempDir);
      expect(files).toContain("ed25519_private.pem");
      expect(files).toContain("ed25519_public.pem");
      expect(files).toContain("x25519_private.pem");
      expect(files).toContain("x25519_public.pem");
      expect(files).toContain("key-metadata.json");

      const loadedPrivate = await fs.readFile(path.join(tempDir, "ed25519_private.pem"), "utf8");
      const loadedPublic = await fs.readFile(path.join(tempDir, "ed25519_public.pem"), "utf8");

      const recreatedPrivate = createPrivateKey(loadedPrivate);
      const recreatedPublic = createPublicKey(loadedPublic);

      expect(recreatedPrivate.type).toBe("private");
      expect(recreatedPublic.type).toBe("public");
    });
  });

  describe("Scrypt Key Derivation", () => {
    it("should derive consistent keys from password", () => {
      const password = "super-secret-password";
      const salt = randomBytes(32);
      const params = { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

      const key1 = scryptSync(password, salt, 32, params);
      const key2 = scryptSync(password, salt, 32, params);

      expect(key1.equals(key2)).toBe(true);
    });

    it("should derive different keys from different passwords", () => {
      const salt = randomBytes(32);
      const params = { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

      const key1 = scryptSync("password1", salt, 32, params);
      const key2 = scryptSync("password2", salt, 32, params);

      expect(key1.equals(key2)).toBe(false);
    });

    it("should derive different keys from different salts", () => {
      const password = "same-password";
      const salt1 = randomBytes(32);
      const salt2 = randomBytes(32);
      const params = { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

      const key1 = scryptSync(password, salt1, 32, params);
      const key2 = scryptSync(password, salt2, 32, params);

      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe("Encrypted Key Bundle Export/Import", () => {
    it("should export and import encrypted key bundle", async () => {
      const { privateKey } = generateKeyPairSync("ed25519");
      const password = "secure-password-123";

      const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

      const salt = randomBytes(32);
      const key = scryptSync(password, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      const iv = randomBytes(12);

      const plaintext = JSON.stringify({
        deviceId: "device123",
        privateKeyPem: privatePem,
        exportedAt: Date.now(),
      });

      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const bundle = Buffer.concat([salt, iv, authTag, encrypted]);

      const raw = bundle;
      const bundleSalt = raw.subarray(0, 32);
      const bundleIv = raw.subarray(32, 44);
      const bundleTag = raw.subarray(44, 60);
      const bundleCiphertext = raw.subarray(60);

      const derivedKey = scryptSync(password, bundleSalt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

      const decipher = createDecipheriv("aes-256-gcm", derivedKey, bundleIv);
      decipher.setAuthTag(bundleTag);
      const decrypted = Buffer.concat([decipher.update(bundleCiphertext), decipher.final()]);

      const parsed = JSON.parse(decrypted.toString("utf8"));
      expect(parsed.deviceId).toBe("device123");
    });

    it("should reject import with wrong password", async () => {
      const password = "correct-password";
      const wrongPassword = "wrong-password";

      const salt = randomBytes(32);
      const key = scryptSync(password, salt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
      const iv = randomBytes(12);

      const plaintext = JSON.stringify({ data: "secret" });

      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();

      const bundle = Buffer.concat([salt, iv, authTag, encrypted]);

      const raw = bundle;
      const bundleSalt = raw.subarray(0, 32);
      const bundleIv = raw.subarray(32, 44);
      const bundleTag = raw.subarray(44, 60);
      const bundleCiphertext = raw.subarray(60);

      const wrongKey = scryptSync(wrongPassword, bundleSalt, 32, { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });

      const decipher = createDecipheriv("aes-256-gcm", wrongKey, bundleIv);
      decipher.setAuthTag(bundleTag);

      expect(() => {
        Buffer.concat([decipher.update(bundleCiphertext), decipher.final()]);
      }).toThrow();
    });
  });
});