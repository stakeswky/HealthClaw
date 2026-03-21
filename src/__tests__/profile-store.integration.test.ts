import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ProfileStore } from "../profile/ProfileStore.js";

const USER_ID = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("ProfileStore", () => {
  let tempDir: string;
  let store: ProfileStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(tmpdir(), "health-profile-store-"));
    process.env.HEALTHCLAW_GATEWAY_IDENTITY_KEY = "11".repeat(32);
    store = new ProfileStore({
      stateDir: tempDir,
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    delete process.env.HEALTHCLAW_GATEWAY_IDENTITY_KEY;
  });

  it("creates a profile with omitted unset fields", async () => {
    const saved = await store.upsert({ userId: USER_ID.toUpperCase(), age: 32 });
    const loaded = await store.load(USER_ID);

    expect(saved.userId).toBe(USER_ID);
    expect(loaded).toEqual(saved);
    expect("heightCm" in (loaded ?? {})).toBe(false);
    expect("weightKg" in (loaded ?? {})).toBe(false);
  });

  it("clear deletes by file path even when the record is corrupt", async () => {
    const profileDir = path.join(tempDir, "profiles");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, `${USER_ID}.enc.json`), "{not-json}\n", "utf8");

    await expect(store.clear(USER_ID)).resolves.toBe("cleared");
    await expect(store.load(USER_ID)).resolves.toBeNull();
  });

  it("upsert fails closed on decrypt failure for an existing corrupt record", async () => {
    const profileDir = path.join(tempDir, "profiles");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, `${USER_ID}.enc.json`), "{not-json}\n", "utf8");

    await expect(store.upsert({ userId: USER_ID, age: 33 })).rejects.toThrow("profile store error");
  });

  it("load returns profile store error for corrupt records", async () => {
    const profileDir = path.join(tempDir, "profiles");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(path.join(profileDir, `${USER_ID}.enc.json`), "{not-json}\n", "utf8");

    await expect(store.load(USER_ID)).rejects.toThrow("profile store error");
  });

  it("returns not_found when clearing a missing profile", async () => {
    await expect(store.clear(USER_ID)).resolves.toBe("not_found");
  });
});
