import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginLogger } from "../openclaw-stub.js";
import type { EncryptedHealthFile } from "../types.js";
import type { HealthUserProfile, ProfileClearResult } from "./types.js";

const STORAGE_HKDF_INFO = Buffer.from("healthclaw-storage-v1");
const STORAGE_HKDF_SALT = Buffer.alloc(32, 0);
const USER_ID_PATTERN = /^[a-f0-9]{64}$/;

type ProfileStoreOptions = {
  stateDir: string;
  logger: PluginLogger;
};

export class ProfileStore {
  private readonly profileDir: string;
  private storageKey: Buffer | null = null;

  constructor(opts: ProfileStoreOptions) {
    this.profileDir = path.join(opts.stateDir, "profiles");
  }

  async load(userId: string): Promise<HealthUserProfile | null> {
    const normalizedUserId = normalizeUserId(userId);
    const filePath = this.profilePath(normalizedUserId);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const file = JSON.parse(content) as EncryptedHealthFile;
      const parsed = this.decryptFile(file);
      return {
        ...parsed,
        userId: normalizeUserId(parsed.userId),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new Error(`profile store error: ${asMessage(error)}`);
    }
  }

  async upsert(input: Omit<HealthUserProfile, "updatedAt">): Promise<HealthUserProfile> {
    const normalizedUserId = normalizeUserId(input.userId);
    const existing = await this.load(normalizedUserId);
    const profile: HealthUserProfile = {
      userId: normalizedUserId,
      ...(existing?.age != null ? { age: existing.age } : {}),
      ...(existing?.heightCm != null ? { heightCm: existing.heightCm } : {}),
      ...(existing?.weightKg != null ? { weightKg: existing.weightKg } : {}),
      ...(input.age != null ? { age: input.age } : {}),
      ...(input.heightCm != null ? { heightCm: input.heightCm } : {}),
      ...(input.weightKg != null ? { weightKg: input.weightKg } : {}),
      updatedAt: Date.now(),
    };

    const filePath = this.profilePath(normalizedUserId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const encrypted = this.encryptData(profile);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, `${JSON.stringify(encrypted)}\n`, "utf8");
    await fs.rename(tmpPath, filePath);
    return profile;
  }

  async clear(userId: string): Promise<ProfileClearResult> {
    const normalizedUserId = normalizeUserId(userId);
    const filePath = this.profilePath(normalizedUserId);
    try {
      await fs.unlink(filePath);
      return "cleared";
    } catch (error) {
      if (isNotFound(error)) return "not_found";
      throw new Error(`profile store error: ${asMessage(error)}`);
    }
  }

  private profilePath(userId: string): string {
    return path.join(this.profileDir, `${userId}.enc.json`);
  }

  private getStorageKey(): Buffer {
    if (this.storageKey) return this.storageKey;
    const identitySecret = Buffer.from(process.env.HEALTHCLAW_GATEWAY_IDENTITY_KEY ?? "", "hex");
    if (identitySecret.length === 0) {
      throw new Error("HEALTHCLAW_GATEWAY_IDENTITY_KEY not configured");
    }
    this.storageKey = Buffer.from(
      hkdfSync("sha256", identitySecret, STORAGE_HKDF_SALT, STORAGE_HKDF_INFO, 32),
    );
    return this.storageKey;
  }

  private encryptData(data: HealthUserProfile): EncryptedHealthFile {
    const key = this.getStorageKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
    return {
      data: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      encryptedAt: Date.now(),
    };
  }

  private decryptFile(file: EncryptedHealthFile): HealthUserProfile {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.getStorageKey(),
      Buffer.from(file.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(file.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as HealthUserProfile;
  }
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim().toLowerCase();
  if (!USER_ID_PATTERN.test(normalized)) {
    throw new Error("invalid userId");
  }
  return normalized;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "ENOENT";
}
