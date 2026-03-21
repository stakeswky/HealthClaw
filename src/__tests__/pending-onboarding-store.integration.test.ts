import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PendingOnboardingStore } from "../onboarding/PendingOnboardingStore.js";

let tempDir = "";

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(tmpdir(), "health-onboarding-store-"));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("PendingOnboardingStore", () => {
  it("persists consent plus partial profile fields", async () => {
    const store = new PendingOnboardingStore({ stateDir: tempDir });

    await store.acceptConsent();
    await store.upsert({ gender: "male", age: 26 });

    const loaded = await store.load();
    expect(loaded?.consentAcceptedAt).toBeTypeOf("number");
    expect(loaded?.gender).toBe("male");
    expect(loaded?.age).toBe(26);
    expect(loaded?.updatedAt).toBeTypeOf("number");
  });

  it("clears the pending onboarding profile", async () => {
    const store = new PendingOnboardingStore({ stateDir: tempDir });

    await store.acceptConsent();
    await store.upsert({ heightCm: 180, weightKg: 84 });
    await store.clear();

    await expect(store.load()).resolves.toBeNull();
  });
});
