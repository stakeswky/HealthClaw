const CURRENT_PLUGIN_DIST_TAG: "latest" | "legacy" = "legacy";
const OPENCLAW_HEALTH_COMPAT_MATRIX = [
  {
    distTag: "legacy" as const,
    openclawRange: { gte: "2026.3.0", lt: "2026.3.22" },
    label: "1.x (legacy host line)",
  },
  {
    distTag: "latest" as const,
    openclawRange: { gte: "2026.3.22" },
    label: "2.x (current host line)",
  },
];

export function assertCompatibleOpenClawVersion(
  version: string | null | undefined,
  currentDistTag: "latest" | "legacy" = CURRENT_PLUGIN_DIST_TAG,
): void {
  if (!version) return;

  const matched = findOpenClawCompatEntry(version);
  if (!matched) {
    throw new Error(
      [
        "[openclaw-health] Unsupported OpenClaw version.",
        `  Current OpenClaw version: ${version}`,
        "  Run: npx -y @stakeswky/healthclaw-cli install",
      ].join("\n"),
    );
  }

  if (matched.distTag === currentDistTag) {
    return;
  }

  throw new Error(
    [
      "[openclaw-health] Host version is incompatible with the installed plugin line.",
      `  Current OpenClaw version: ${version}`,
      `  This plugin line supports: ${formatOpenClawCompatRange(findRangeForDistTag(currentDistTag))}`,
      `  Recommended plugin line: ${matched.label} (${matched.distTag})`,
      "  Run: npx -y @stakeswky/healthclaw-cli install",
    ].join("\n"),
  );
}

export function resolveHostOpenClawVersion(runtime: unknown): string | null {
  const runtimeObject = runtime && typeof runtime === "object"
    ? runtime as Record<string, unknown>
    : undefined;

  if (typeof runtimeObject?.version === "string") {
    return runtimeObject.version;
  }

  if (typeof runtimeObject?.openclawVersion === "string") {
    return runtimeObject.openclawVersion;
  }

  if (typeof process.env.OPENCLAW_VERSION === "string" && process.env.OPENCLAW_VERSION.trim()) {
    return process.env.OPENCLAW_VERSION.trim();
  }

  return null;
}

function findRangeForDistTag(distTag: "latest" | "legacy") {
  return OPENCLAW_HEALTH_COMPAT_MATRIX.find((entry) => entry.distTag === distTag)?.openclawRange
    ?? { gte: "2026.3.22" };
}

function findOpenClawCompatEntry(version: string) {
  return OPENCLAW_HEALTH_COMPAT_MATRIX.find((entry) =>
    satisfiesOpenClawRange(version, entry.openclawRange)
  ) ?? null;
}

function satisfiesOpenClawRange(version: string, range: { gte: string; lt?: string }): boolean {
  if (compareOpenClawVersions(version, range.gte) < 0) return false;
  if (range.lt && compareOpenClawVersions(version, range.lt) >= 0) return false;
  return true;
}

function compareOpenClawVersions(left: string, right: string): number {
  const parsedLeft = parseOpenClawVersion(left);
  const parsedRight = parseOpenClawVersion(right);
  if (!parsedLeft || !parsedRight) return Number.NaN;

  if (parsedLeft[0] !== parsedRight[0]) return parsedLeft[0] - parsedRight[0];
  if (parsedLeft[1] !== parsedRight[1]) return parsedLeft[1] - parsedRight[1];
  return parsedLeft[2] - parsedRight[2];
}

function parseOpenClawVersion(version: string): [number, number, number] | null {
  const match = String(version).match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (Number.isNaN(major) || Number.isNaN(minor) || Number.isNaN(patch)) {
    return null;
  }

  return [major, minor, patch];
}

function formatOpenClawCompatRange(range: { gte: string; lt?: string }): string {
  return [range.gte ? `>=${range.gte}` : "", range.lt ? `<${range.lt}` : ""]
    .filter(Boolean)
    .join(" ");
}
