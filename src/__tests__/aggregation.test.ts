import { describe, expect, it } from "vitest";
import { mergeHealthData } from "../store/aggregation.js";

describe("mergeHealthData", () => {
  it("updates deviceName when a merged payload includes a newer alias", () => {
    const existing = {
      date: "2026-03-19",
      userId: "user-1",
      deviceName: "iPhone",
      steps: 100,
      receivedAt: 1,
      sourceDeviceId: "device-1",
      schemaVersion: 1 as const,
    };

    const incoming = {
      date: "2026-03-19",
      userId: "user-1",
      deviceName: "Jimmy HealthClaw",
      steps: 200,
    };

    const merged = mergeHealthData(existing, incoming, "device-1");

    expect(merged.deviceName).toBe("Jimmy HealthClaw");
    expect(merged.steps).toBe(200);
  });

  it("preserves existing deviceName when the incoming payload omits it", () => {
    const existing = {
      date: "2026-03-19",
      userId: "user-1",
      deviceName: "Jimmy HealthClaw",
      steps: 100,
      receivedAt: 1,
      sourceDeviceId: "device-1",
      schemaVersion: 1 as const,
    };

    const incoming = {
      date: "2026-03-19",
      userId: "user-1",
      steps: 200,
    };

    const merged = mergeHealthData(existing, incoming, "device-1");

    expect(merged.deviceName).toBe("Jimmy HealthClaw");
    expect(merged.steps).toBe(200);
  });

  it("replaces stale exerciseMinutes with the latest synced value", () => {
    const existing = {
      date: "2026-03-19",
      userId: "user-1",
      exerciseMinutes: 24,
      receivedAt: 1,
      sourceDeviceId: "device-1",
      schemaVersion: 1 as const,
    };

    const incoming = {
      date: "2026-03-19",
      userId: "user-1",
      exerciseMinutes: 7,
    };

    const merged = mergeHealthData(existing, incoming, "device-1");

    expect(merged.exerciseMinutes).toBe(7);
  });
});
