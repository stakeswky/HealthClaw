import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { EncryptedHealthFile } from "../types.js";
import type { PendingOnboardingClearResult, PendingOnboardingProfile } from "./types.js";

type PendingOnboardingStoreOptions = {
  stateDir: string;
};

export class PendingOnboardingStore {
  private readonly onboardingDir: string;
  private readonly dataFile: string;
  private readonly secretFile: string;
  private storageKey: Buffer | null = null;

  constructor(opts: PendingOnboardingStoreOptions) {
    this.onboardingDir = path.join(opts.stateDir, "onboarding");
    this.dataFile = path.join(this.onboardingDir, "pending-profile.enc.json");
    this.secretFile = path.join(this.onboardingDir, "secret.key");
  }

  async load(): Promise<PendingOnboardingProfile | null> {
    try {
      const content = await fs.readFile(this.dataFile, "utf8");
      const file = JSON.parse(content) as EncryptedHealthFile;
      await this.getStorageKey();
      return this.decryptFile(file);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw new Error(`pending onboarding store error: ${asMessage(error)}`);
    }
  }

  async acceptConsent(): Promise<PendingOnboardingProfile> {
    const existing = await this.load();
    const next: PendingOnboardingProfile = {
      ...(existing ?? {}),
      consentAcceptedAt: existing?.consentAcceptedAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    await this.save(next);
    return next;
  }

  async upsert(
    input: Partial<Pick<PendingOnboardingProfile, "gender" | "age" | "heightCm" | "weightKg">>,
  ): Promise<PendingOnboardingProfile> {
    const existing = await this.load();
    if (!existing?.consentAcceptedAt) {
      throw new Error("onboarding consent required before storing profile data");
    }
    const next: PendingOnboardingProfile = {
      consentAcceptedAt: existing.consentAcceptedAt,
      ...(existing.gender != null ? { gender: existing.gender } : {}),
      ...(existing.age != null ? { age: existing.age } : {}),
      ...(existing.heightCm != null ? { heightCm: existing.heightCm } : {}),
      ...(existing.weightKg != null ? { weightKg: existing.weightKg } : {}),
      ...(input.gender != null ? { gender: input.gender } : {}),
      ...(input.age != null ? { age: input.age } : {}),
      ...(input.heightCm != null ? { heightCm: input.heightCm } : {}),
      ...(input.weightKg != null ? { weightKg: input.weightKg } : {}),
      updatedAt: Date.now(),
    };
    await this.save(next);
    return next;
  }

  async clear(): Promise<PendingOnboardingClearResult> {
    try {
      await fs.unlink(this.dataFile);
      return "cleared";
    } catch (error) {
      if (isNotFound(error)) return "not_found";
      throw new Error(`pending onboarding store error: ${asMessage(error)}`);
    }
  }

  private async save(profile: PendingOnboardingProfile): Promise<void> {
    await fs.mkdir(this.onboardingDir, { recursive: true });
    const encrypted = await this.encryptData(profile);
    const tmpPath = `${this.dataFile}.tmp.${Date.now()}`;
    await fs.writeFile(tmpPath, `${JSON.stringify(encrypted)}\n`, "utf8");
    await fs.rename(tmpPath, this.dataFile);
  }

  private async getStorageKey(): Promise<Buffer> {
    if (this.storageKey) return this.storageKey;
    try {
      const raw = await fs.readFile(this.secretFile);
      this.storageKey = raw;
      return raw;
    } catch (error) {
      if (!isNotFound(error)) {
        throw new Error(`pending onboarding store error: ${asMessage(error)}`);
      }
    }
    await fs.mkdir(this.onboardingDir, { recursive: true });
    const generated = randomBytes(32);
    await fs.writeFile(this.secretFile, generated, { mode: 0o600 });
    this.storageKey = generated;
    return generated;
  }

  private async encryptData(data: PendingOnboardingProfile): Promise<EncryptedHealthFile> {
    const key = await this.getStorageKey();
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

  private decryptFile(file: EncryptedHealthFile): PendingOnboardingProfile {
    if (!this.storageKey) {
      throw new Error("pending onboarding storage key not loaded");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.storageKey,
      Buffer.from(file.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(file.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(decrypted.toString("utf8")) as PendingOnboardingProfile;
  }
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
