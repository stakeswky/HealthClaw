import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(currentDir, "../../package.json");

describe("publishable package metadata", () => {
  it("exposes a publishable runtime entry", async () => {
    const pkg = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      name?: string;
      private?: boolean;
      main?: string;
      openclaw?: { extensions?: string[] };
    };

    expect(pkg.name).toBe("@stakeswky/healthclaw");
    expect(pkg.private).not.toBe(true);
    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.openclaw?.extensions).toEqual(["./dist/index.js"]);
  });
});
