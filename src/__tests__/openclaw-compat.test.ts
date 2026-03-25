import { describe, expect, it } from "vitest";
import { assertCompatibleOpenClawVersion } from "../runtime/openclaw-compat.js";

describe("openclaw compatibility guard", () => {
  it("throws a guided error when the current plugin line does not match the host version", () => {
    expect(() => assertCompatibleOpenClawVersion("2026.3.10")).toThrow(
      /healthclaw-cli install/,
    );
  });
});
