import { describe, expect, it } from "vitest";
import { assertCompatibleOpenClawVersion } from "../runtime/openclaw-compat.js";

describe("openclaw compatibility guard", () => {
  it("accepts a legacy host version when the plugin is on the legacy line", () => {
    expect(() => assertCompatibleOpenClawVersion("2026.3.10")).not.toThrow();
  });

  it("throws a guided error when the legacy plugin line is used on a latest-only host", () => {
    expect(() => assertCompatibleOpenClawVersion("2026.3.25")).toThrow(
      /healthclaw-cli install/,
    );
  });
});
