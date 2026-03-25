import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { healthPluginConfigSchema } from "../index.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(currentDir, "../../openclaw.plugin.json");
const packageJsonPath = path.resolve(currentDir, "../../package.json");

describe("plugin manifest", () => {
  it("matches the runtime config schema", async () => {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      id: string;
      name: string;
      version: string;
      configSchema: unknown;
    };
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      version: string;
    };

    expect(manifest.id).toBe("health");
    expect(manifest.name).toBe("Health");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.configSchema).toEqual(healthPluginConfigSchema.jsonSchema);
  });
});
