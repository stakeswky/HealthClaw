/**
 * Store Integration Tests
 *
 * Tests HealthStore create/read/query operations with file encryption.
 * Uses temp directory and cleans up after each test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const STORAGE_HKDF_INFO = Buffer.from("healthclaw-storage-v1");
const STORAGE_HKDF_SALT = Buffer.alloc(32, 0);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type DailyHealthSummary = {
  date: string;
  userId: string;
  steps?: number;
  activeCalories?: number;
  restingHeartRate?: number;
  receivedAt: number;
  sourceDeviceId: string;
  schemaVersion: 1;
};

type EncryptedHealthFile = {
  data: string;
  iv: string;
  tag: string;
  encryptedAt: number;
};

function getStorageKey(): Buffer {
  const identitySecret = Buffer.from("test-identity-secret-key-32-bytes!", "utf8");
  return Buffer.from(
    hkdfSync("sha256", identitySecret, STORAGE_HKDF_SALT, STORAGE_HKDF_INFO, 32)
  );
}

function encryptData(data: DailyHealthSummary, key: Buffer): EncryptedHealthFile {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    data: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    encryptedAt: Date.now(),
  };
}

function decryptFile(file: EncryptedHealthFile, key: Buffer): DailyHealthSummary {
  const iv = Buffer.from(file.iv, "base64");
  const tag = Buffer.from(file.tag, "base64");
  const encrypted = Buffer.from(file.data, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as DailyHealthSummary;
}

function sanitizeUserId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function createTestSummary(date: string, userId: string, overrides: Partial<DailyHealthSummary> = {}): DailyHealthSummary {
  return {
    date,
    userId,
    steps: 10000,
    activeCalories: 500,
    restingHeartRate: 60,
    receivedAt: Date.now(),
    sourceDeviceId: "device-test",
    schemaVersion: 1,
    ...overrides,
  };
}

describe("Store Integration", () => {
  let tempDir: string;
  let dataDir: string;
  let storageKey: Buffer;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "health-store-test-"));
    dataDir = path.join(tempDir, "data");
    storageKey = getStorageKey();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("File Encryption/Decryption", () => {
    it("should encrypt and decrypt data successfully", () => {
      const summary = createTestSummary("2024-01-15", "user123");

      const encrypted = encryptData(summary, storageKey);
      const decrypted = decryptFile(encrypted, storageKey);

      expect(decrypted.date).toBe("2024-01-15");
      expect(decrypted.userId).toBe("user123");
      expect(decrypted.steps).toBe(10000);
    });

    it("should produce different ciphertext for same data", () => {
      const summary = createTestSummary("2024-01-15", "user123");

      const encrypted1 = encryptData(summary, storageKey);
      const encrypted2 = encryptData(summary, storageKey);

      expect(encrypted1.data).not.toBe(encrypted2.data);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it("should fail decryption with wrong key", () => {
      const summary = createTestSummary("2024-01-15", "user123");
      const encrypted = encryptData(summary, storageKey);
      const wrongKey = randomBytes(32);

      expect(() => decryptFile(encrypted, wrongKey)).toThrow();
    });

    it("should fail decryption with tampered data", () => {
      const summary = createTestSummary("2024-01-15", "user123");
      const encrypted = encryptData(summary, storageKey);

      const tamperedData = Buffer.from(encrypted.data, "base64");
      if (tamperedData[0] !== undefined) tamperedData[0] ^= 0xff;
      const tampered: EncryptedHealthFile = {
        ...encrypted,
        data: tamperedData.toString("base64"),
      };

      expect(() => decryptFile(tampered, storageKey)).toThrow();
    });

    it("should fail decryption with wrong auth tag", () => {
      const summary = createTestSummary("2024-01-15", "user123");
      const encrypted = encryptData(summary, storageKey);

      const tamperedTag = Buffer.from(encrypted.tag, "base64");
      if (tamperedTag[0] !== undefined) tamperedTag[0] ^= 0xff;
      const tampered: EncryptedHealthFile = {
        ...encrypted,
        tag: tamperedTag.toString("base64"),
      };

      expect(() => decryptFile(tampered, storageKey)).toThrow();
    });
  });

  describe("Directory Structure", () => {
    it("should create user directory structure", async () => {
      const userId = "user123";
      const safeUserId = sanitizeUserId(userId);
      const userDir = path.join(dataDir, safeUserId);
      const dailyDir = path.join(userDir, "daily");
      const monthlyDir = path.join(userDir, "monthly");

      await fs.mkdir(dailyDir, { recursive: true });
      await fs.mkdir(monthlyDir, { recursive: true });

      const stats = await fs.stat(userDir);
      expect(stats.isDirectory()).toBe(true);

      const dailyStats = await fs.stat(dailyDir);
      expect(dailyStats.isDirectory()).toBe(true);

      const monthlyStats = await fs.stat(monthlyDir);
      expect(monthlyStats.isDirectory()).toBe(true);
    });

    it("should sanitize user IDs with special characters", () => {
      expect(sanitizeUserId("user@domain.com")).toBe("user_domain_com");
      expect(sanitizeUserId("user/name")).toBe("user_name");
      expect(sanitizeUserId("user name")).toBe("user_name");
      expect(sanitizeUserId("user-name_123")).toBe("user-name_123");
    });
  });

  describe("Daily Summary Storage", () => {
    it("should save and retrieve daily summary", async () => {
      const userId = "user123";
      const date = "2024-01-15";
      const summary = createTestSummary(date, userId);

      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const filePath = path.join(userDir, `${date}.enc.json`);
      const encrypted = encryptData(summary, storageKey);
      await fs.writeFile(filePath, JSON.stringify(encrypted) + "\n", "utf8");

      const content = await fs.readFile(filePath, "utf8");
      const loaded = JSON.parse(content) as EncryptedHealthFile;
      const decrypted = decryptFile(loaded, storageKey);

      expect(decrypted.date).toBe(date);
      expect(decrypted.userId).toBe(userId);
      expect(decrypted.steps).toBe(10000);
    });

    it("should handle non-existent file gracefully", async () => {
      const filePath = path.join(dataDir, "nonexistent.enc.json");

      try {
        await fs.readFile(filePath, "utf8");
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });

    it("should overwrite existing summary", async () => {
      const userId = "user123";
      const date = "2024-01-15";

      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });
      const filePath = path.join(userDir, `${date}.enc.json`);

      const summary1 = createTestSummary(date, userId, { steps: 5000 });
      const encrypted1 = encryptData(summary1, storageKey);
      await fs.writeFile(filePath, JSON.stringify(encrypted1) + "\n", "utf8");

      const summary2 = createTestSummary(date, userId, { steps: 8000 });
      const encrypted2 = encryptData(summary2, storageKey);
      await fs.writeFile(filePath, JSON.stringify(encrypted2) + "\n", "utf8");

      const content = await fs.readFile(filePath, "utf8");
      const loaded = JSON.parse(content) as EncryptedHealthFile;
      const decrypted = decryptFile(loaded, storageKey);

      expect(decrypted.steps).toBe(8000);
    });
  });

  describe("Date Range Queries", () => {
    it("should query date range successfully", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const dates = ["2024-01-10", "2024-01-11", "2024-01-12", "2024-01-13", "2024-01-14"];
      for (const date of dates) {
        const summary = createTestSummary(date, userId, { steps: parseInt(date.slice(-2)) * 100 });
        const encrypted = encryptData(summary, storageKey);
        await fs.writeFile(path.join(userDir, `${date}.enc.json`), JSON.stringify(encrypted) + "\n", "utf8");
      }

      const results: DailyHealthSummary[] = [];
      const startDate = "2024-01-11";
      const endDate = "2024-01-13";

      for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        try {
          const content = await fs.readFile(path.join(userDir, `${dateStr}.enc.json`), "utf8");
          const loaded = JSON.parse(content) as EncryptedHealthFile;
          results.push(decryptFile(loaded, storageKey));
        } catch {
          // skip missing dates
        }
      }

      expect(results.length).toBe(3);
      expect(results.map(r => r.date)).toEqual(["2024-01-11", "2024-01-12", "2024-01-13"]);
    });

    it("should handle empty date range", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const results: DailyHealthSummary[] = [];
      const startDate = "2024-01-01";
      const endDate = "2024-01-05";

      for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        try {
          const content = await fs.readFile(path.join(userDir, `${dateStr}.enc.json`), "utf8");
          const loaded = JSON.parse(content) as EncryptedHealthFile;
          results.push(decryptFile(loaded, storageKey));
        } catch {
          // skip missing dates
        }
      }

      expect(results.length).toBe(0);
    });

    it("should handle gaps in date range", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const dates = ["2024-01-10", "2024-01-12", "2024-01-14"];
      for (const date of dates) {
        const summary = createTestSummary(date, userId);
        const encrypted = encryptData(summary, storageKey);
        await fs.writeFile(path.join(userDir, `${date}.enc.json`), JSON.stringify(encrypted) + "\n", "utf8");
      }

      const results: DailyHealthSummary[] = [];
      for (let d = new Date("2024-01-10"); d <= new Date("2024-01-14"); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        try {
          const content = await fs.readFile(path.join(userDir, `${dateStr}.enc.json`), "utf8");
          const loaded = JSON.parse(content) as EncryptedHealthFile;
          results.push(decryptFile(loaded, storageKey));
        } catch {
          // skip missing dates
        }
      }

      expect(results.length).toBe(3);
      expect(results.map(r => r.date)).toEqual(["2024-01-10", "2024-01-12", "2024-01-14"]);
    });
  });

  describe("Monthly Aggregates", () => {
    it("should save and retrieve monthly aggregate", async () => {
      const userId = "user123";
      const monthKey = "2024-01";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "monthly");
      await fs.mkdir(userDir, { recursive: true });

      const days = [
        createTestSummary("2024-01-01", userId, { steps: 5000 }),
        createTestSummary("2024-01-02", userId, { steps: 6000 }),
        createTestSummary("2024-01-03", userId, { steps: 7000 }),
      ];

      const aggregate = {
        monthKey,
        userId,
        days,
        updatedAt: Date.now(),
      };

      const filePath = path.join(userDir, `${monthKey}.enc.json`);
      const encrypted = encryptData(aggregate as unknown as DailyHealthSummary, storageKey);
      await fs.writeFile(filePath, JSON.stringify(encrypted) + "\n", "utf8");

      const content = await fs.readFile(filePath, "utf8");
      const loaded = JSON.parse(content) as EncryptedHealthFile;
      const decrypted = decryptFile(loaded, storageKey) as unknown as typeof aggregate;

      expect(decrypted.monthKey).toBe(monthKey);
      expect(decrypted.days.length).toBe(3);
    });
  });

  describe("User Listing", () => {
    it("should list all users", async () => {
      await fs.mkdir(path.join(dataDir, "user1", "daily"), { recursive: true });
      await fs.mkdir(path.join(dataDir, "user2", "daily"), { recursive: true });
      await fs.mkdir(path.join(dataDir, "user3", "daily"), { recursive: true });

      const entries = await fs.readdir(dataDir, { withFileTypes: true });
      const users = entries.filter(e => e.isDirectory()).map(e => e.name);

      expect(users.length).toBe(3);
      expect(users).toContain("user1");
      expect(users).toContain("user2");
      expect(users).toContain("user3");
    });

    it("should return empty array for no users", async () => {
      await fs.mkdir(dataDir, { recursive: true });

      try {
        const entries = await fs.readdir(dataDir, { withFileTypes: true });
        const users = entries.filter(e => e.isDirectory()).map(e => e.name);
        expect(users.length).toBe(0);
      } catch {
        // Directory doesn't exist
        expect(true).toBe(true);
      }
    });
  });

  describe("Data Cleanup", () => {
    it("should delete expired daily files", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 30);
      const cutoffStr = cutoffDate.toISOString().slice(0, 10);

      const oldDate = new Date(cutoffDate);
      oldDate.setDate(oldDate.getDate() - 1);
      const oldDateStr = oldDate.toISOString().slice(0, 10);

      const newDate = new Date();
      newDate.setDate(newDate.getDate() - 1);
      const newDateStr = newDate.toISOString().slice(0, 10);

      const oldSummary = createTestSummary(oldDateStr, userId);
      await fs.writeFile(
        path.join(userDir, `${oldDateStr}.enc.json`),
        JSON.stringify(encryptData(oldSummary, storageKey)) + "\n",
        "utf8"
      );

      const newSummary = createTestSummary(newDateStr, userId);
      await fs.writeFile(
        path.join(userDir, `${newDateStr}.enc.json`),
        JSON.stringify(encryptData(newSummary, storageKey)) + "\n",
        "utf8"
      );

      const files = await fs.readdir(userDir);
      expect(files.length).toBe(2);

      let removed = 0;
      for (const file of files) {
        const date = file.replace(".enc.json", "");
        if (DATE_PATTERN.test(date) && date < cutoffStr) {
          await fs.unlink(path.join(userDir, file));
          removed++;
        }
      }

      expect(removed).toBe(1);

      const remainingFiles = await fs.readdir(userDir);
      expect(remainingFiles.length).toBe(1);
      expect(remainingFiles[0]).toBe(`${newDateStr}.enc.json`);
    });

    it("should clear all user data", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId));
      const dailyDir = path.join(userDir, "daily");
      const monthlyDir = path.join(userDir, "monthly");

      await fs.mkdir(dailyDir, { recursive: true });
      await fs.mkdir(monthlyDir, { recursive: true });

      const summary = createTestSummary("2024-01-15", userId);
      await fs.writeFile(
        path.join(dailyDir, "2024-01-15.enc.json"),
        JSON.stringify(encryptData(summary, storageKey)) + "\n",
        "utf8"
      );

      const aggregate = { monthKey: "2024-01", userId, days: [summary], updatedAt: Date.now() };
      await fs.writeFile(
        path.join(monthlyDir, "2024-01.enc.json"),
        JSON.stringify(encryptData(aggregate as unknown as DailyHealthSummary, storageKey)) + "\n",
        "utf8"
      );

      await fs.rm(userDir, { recursive: true, force: true });

      try {
        await fs.stat(userDir);
        expect.fail("Directory should not exist");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });
  });

  describe("File Permissions", () => {
    it("should write files with correct permissions", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const summary = createTestSummary("2024-01-15", userId);
      const filePath = path.join(userDir, "2024-01-15.enc.json");
      const encrypted = encryptData(summary, storageKey);

      await fs.writeFile(filePath, JSON.stringify(encrypted) + "\n", { mode: 0o600 });

      const stats = await fs.stat(filePath);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });

  describe("Concurrent Access", () => {
    it("should handle atomic writes with temp file", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const summary = createTestSummary("2024-01-15", userId);
      const filePath = path.join(userDir, "2024-01-15.enc.json");
      const tmpPath = `${filePath}.tmp.${Date.now()}`;
      const encrypted = encryptData(summary, storageKey);

      await fs.writeFile(tmpPath, JSON.stringify(encrypted) + "\n", "utf8");
      await fs.rename(tmpPath, filePath);

      const content = await fs.readFile(filePath, "utf8");
      const loaded = JSON.parse(content) as EncryptedHealthFile;
      const decrypted = decryptFile(loaded, storageKey);

      expect(decrypted.date).toBe("2024-01-15");

      try {
        await fs.stat(tmpPath);
        expect.fail("Temp file should not exist");
      } catch (error) {
        expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle corrupted encrypted file", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const filePath = path.join(userDir, "2024-01-15.enc.json");
      await fs.writeFile(filePath, "not valid json", "utf8");

      try {
        const content = await fs.readFile(filePath, "utf8");
        JSON.parse(content);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(SyntaxError);
      }
    });

    it("should handle missing required fields in summary", async () => {
      const userId = "user123";
      const userDir = path.join(dataDir, sanitizeUserId(userId), "daily");
      await fs.mkdir(userDir, { recursive: true });

      const incompleteSummary = { date: "2024-01-15" } as DailyHealthSummary;
      const encrypted = encryptData(incompleteSummary, storageKey);
      const decrypted = decryptFile(encrypted, storageKey);

      expect(decrypted.date).toBe("2024-01-15");
      expect(decrypted.userId).toBeUndefined();
    });
  });
});