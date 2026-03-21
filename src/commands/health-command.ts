import type { OpenClawPluginApi } from "../openclaw-stub.js";
import type { HealthFocusArea } from "../types.js";
import type { HealthReportServiceResult } from "../report/types.js";
import type { HealthUserProfile, ProfileClearResult } from "../profile/types.js";

const USER_ID_PATTERN = /^[a-f0-9]{64}$/;

type ProfileStoreLike = {
  load(userId: string): Promise<HealthUserProfile | null>;
  upsert(input: Omit<HealthUserProfile, "updatedAt">): Promise<HealthUserProfile>;
  clear(userId: string): Promise<ProfileClearResult>;
};

type ReportServiceLike = {
  generate(input: {
    userId: string;
    period: "day" | "week" | "month";
    focusAreas: HealthFocusArea[] | string[];
  }): Promise<HealthReportServiceResult>;
};

export type HealthCommandDeps = {
  profileStore: ProfileStoreLike;
  reportService: ReportServiceLike;
  focusAreas: HealthFocusArea[] | string[];
};

export function registerHealthCommand(api: Pick<OpenClawPluginApi, "registerCommand">, deps: HealthCommandDeps) {
  api.registerCommand(createHealthCommand(deps));
}

export function createHealthCommand(deps: HealthCommandDeps) {
  return {
    name: "health",
    description: "Health profile and report commands",
    acceptsArgs: true,
    handler: async (ctx: { args?: string }) => {
      const rawArgs = ctx.args?.trim() ?? "";
      if (rawArgs.length === 0 || rawArgs === "help") {
        return { text: buildHealthHelp() };
      }

      const [subcommand, ...rest] = rawArgs.split(/\s+/);
      if (subcommand === "profile") {
        return handleProfile(rest, deps.profileStore);
      }
      if (subcommand === "report") {
        return handleReport(rest, deps.reportService, deps.focusAreas);
      }
      return { text: buildHealthHelp() };
    },
  };
}

async function handleProfile(args: string[], profileStore: ProfileStoreLike): Promise<{ text: string }> {
  const [action, userIdRaw, field, value] = args;
  if (!action || action === "help") {
    return { text: buildHealthProfileHelp() };
  }

  const userId = normalizeUserId(userIdRaw);
  if (!userId) return { text: "invalid userId" };

  if (action === "show") {
    try {
      const profile = await profileStore.load(userId);
      if (!profile) return { text: "profile not found" };
      return { text: renderProfile(profile) };
    } catch (error) {
      return { text: `profile store error: ${messageOf(error)}` };
    }
  }

  if (action === "clear") {
    try {
      const result = await profileStore.clear(userId);
      return { text: result === "cleared" ? "profile cleared" : "profile not found" };
    } catch (error) {
      return { text: `profile store error: ${messageOf(error)}` };
    }
  }

  if (action !== "set" || !field || value == null) {
    return { text: buildHealthProfileHelp() };
  }

  const normalized = normalizeProfileField(field, value);
  if (!normalized) {
    return { text: buildHealthProfileHelp() };
  }
  if ("error" in normalized) {
    return { text: normalized.error };
  }

  try {
    await profileStore.upsert({ userId, ...normalized.value });
    const [key, savedValue] = Object.entries(normalized.value)[0] ?? [];
    return { text: `profile updated: ${key}=${savedValue}` };
  } catch (error) {
    return { text: `profile store error: ${messageOf(error)}` };
  }
}

async function handleReport(
  args: string[],
  reportService: ReportServiceLike,
  focusAreas: HealthFocusArea[] | string[],
): Promise<{ text: string }> {
  const [userIdRaw, periodRaw] = args;
  const userId = normalizeUserId(userIdRaw);
  if (!userId) return { text: "invalid userId" };

  const period = (periodRaw ?? "day") as "day" | "week" | "month";
  if (!["day", "week", "month"].includes(period)) {
    return { text: "invalid period: use day, week, or month" };
  }

  const result = await reportService.generate({ userId, period, focusAreas });
  if (result.status === "no_data") {
    return { text: "no health data for requested period" };
  }
  if (result.status === "error") {
    return { text: `report generation failed: ${result.errorMessage}` };
  }
  const prefix = result.warnings.length > 0 ? `${result.warnings.join("\n")}\n` : "";
  return { text: `${prefix}${result.markdown}` };
}

function normalizeUserId(raw: string | undefined): string | null {
  const normalized = raw?.trim().toLowerCase() ?? "";
  return USER_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeProfileField(
  field: string,
  rawValue: string,
):
  | { value: Partial<Pick<HealthUserProfile, "age" | "heightCm" | "weightKg">> }
  | { error: string }
  | null {
  if (field === "age") {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) {
      return { error: "invalid age: must be an integer between 1 and 120" };
    }
    return { value: { age: parsed } };
  }

  if (field === "heightCm") {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 50 || parsed > 260) {
      return { error: "invalid heightCm: must be a number between 50 and 260" };
    }
    return { value: { heightCm: Number(parsed.toFixed(1)) } };
  }

  if (field === "weightKg") {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed < 20 || parsed > 400) {
      return { error: "invalid weightKg: must be a number between 20 and 400" };
    }
    return { value: { weightKg: Number(parsed.toFixed(1)) } };
  }

  return null;
}

function renderProfile(profile: HealthUserProfile): string {
  const lines = [`userId: ${profile.userId}`];
  if (profile.age != null) lines.push(`age: ${profile.age}`);
  if (profile.heightCm != null) lines.push(`heightCm: ${profile.heightCm}`);
  if (profile.weightKg != null) lines.push(`weightKg: ${profile.weightKg}`);
  lines.push(`updatedAt: ${new Date(profile.updatedAt).toISOString()}`);
  return lines.join("\n");
}

function buildHealthHelp(): string {
  return [
    "/health help",
    "/health report <userId> [day|week|month]",
    "/health profile show <userId>",
    "/health profile set <userId> <field> <value>",
    "/health profile clear <userId>",
  ].join("\n");
}

function buildHealthProfileHelp(): string {
  return [
    "supported fields: age, heightCm, weightKg",
    `example set: /health profile set ${USER_ID_PATTERN.source.slice(1, 9)}... age 32`,
    "example show: /health profile show <userId>",
    "example clear: /health profile clear <userId>",
  ].join("\n");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
