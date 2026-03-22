import type { OpenClawPluginApi } from "../openclaw-stub.js";
import type { HealthFocusArea } from "../types.js";
import type { HealthReportServiceResult } from "../report/types.js";
import type { HealthUserProfile, ProfileClearResult } from "../profile/types.js";
import type { PendingOnboardingClearResult, PendingOnboardingProfile } from "../onboarding/types.js";

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

type PendingOnboardingStoreLike = {
  load(): Promise<PendingOnboardingProfile | null>;
  acceptConsent(): Promise<PendingOnboardingProfile>;
  upsert(
    input: Partial<Pick<PendingOnboardingProfile, "gender" | "age" | "heightCm" | "weightKg">>,
  ): Promise<PendingOnboardingProfile>;
  clear(): Promise<PendingOnboardingClearResult>;
};

export type HealthCommandDeps = {
  profileStore: ProfileStoreLike;
  pendingOnboardingStore: PendingOnboardingStoreLike;
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
      if (subcommand === "onboarding") {
        return handleOnboarding(rest, deps.pendingOnboardingStore);
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

  if (action === "start") {
    return { text: buildHealthOnboardingStartScript() };
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

async function handleOnboarding(
  args: string[],
  store: PendingOnboardingStoreLike,
): Promise<{ text: string }> {
  const [action, field, value] = args;
  if (!action || action === "help") {
    return { text: buildHealthOnboardingHelp() };
  }

  if (action === "show") {
    try {
      const profile = await store.load();
      return { text: renderOnboarding(profile) };
    } catch (error) {
      return { text: `onboarding store error: ${messageOf(error)}` };
    }
  }

  if (action === "start") {
    return { text: buildHealthOnboardingStartScript() };
  }

  if (action === "clear") {
    try {
      const result = await store.clear();
      return { text: result === "cleared" ? "onboarding profile cleared" : "onboarding profile not found" };
    } catch (error) {
      return { text: `onboarding store error: ${messageOf(error)}` };
    }
  }

  if (action === "consent") {
    const normalized = field?.trim().toLowerCase();
    if (normalized === "yes") {
      try {
        await store.acceptConsent();
        return {
          text: "onboarding consent saved: profile data stays local and is used only to improve health analysis",
        };
      } catch (error) {
        return { text: `onboarding store error: ${messageOf(error)}` };
      }
    }
    if (normalized === "no") {
      try {
        await store.clear();
        return { text: "onboarding declined: first analysis will use health records only" };
      } catch (error) {
        return { text: `onboarding store error: ${messageOf(error)}` };
      }
    }
    return { text: "invalid consent value: use yes or no" };
  }

  if (action !== "set" || !field || value == null) {
    return { text: buildHealthOnboardingHelp() };
  }

  try {
    const existing = await store.load();
    if (!existing?.consentAcceptedAt) {
      return { text: "onboarding consent required before storing profile data" };
    }
    const normalized = normalizeOnboardingField(field, value);
    if (!normalized) return { text: buildHealthOnboardingHelp() };
    if ("error" in normalized) return { text: normalized.error };
    await store.upsert(normalized.value);
    const [key, savedValue] = Object.entries(normalized.value)[0] ?? [];
    return { text: `onboarding profile updated: ${key}=${savedValue}` };
  } catch (error) {
    return { text: `onboarding store error: ${messageOf(error)}` };
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
  | { value: Partial<Pick<HealthUserProfile, "gender" | "age" | "heightCm" | "weightKg">> }
  | { error: string }
  | null {
  if (field === "gender") {
    const normalized = rawValue.trim().toLowerCase();
    if (["male", "男"].includes(normalized)) {
      return { value: { gender: "male" } };
    }
    if (["female", "女"].includes(normalized)) {
      return { value: { gender: "female" } };
    }
    return { error: "invalid gender: use male/female or 男/女" };
  }

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

function normalizeOnboardingField(
  field: string,
  rawValue: string,
):
  | { value: Partial<Pick<PendingOnboardingProfile, "gender" | "age" | "heightCm" | "weightKg">> }
  | { error: string }
  | null {
  return normalizeProfileField(field, rawValue);
}

function renderProfile(profile: HealthUserProfile): string {
  const lines = [`userId: ${profile.userId}`];
  if (profile.gender != null) lines.push(`gender: ${profile.gender}`);
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
    "/health onboarding show",
    "/health onboarding consent <yes|no>",
    "/health onboarding set <field> <value>",
    "/health onboarding clear",
  ].join("\n");
}

function buildHealthProfileHelp(): string {
  return [
    "supported fields: gender, age, heightCm, weightKg",
    `example set: /health profile set ${USER_ID_PATTERN.source.slice(1, 9)}... age 32`,
    "example show: /health profile show <userId>",
    "example clear: /health profile clear <userId>",
  ].join("\n");
}

function buildHealthOnboardingHelp(): string {
  return [
    "/health onboarding start",
    "/health onboarding show",
    "/health onboarding consent <yes|no>",
    "/health onboarding set <field> <value>",
    "/health onboarding clear",
    "supported fields: gender, age, heightCm, weightKg",
  ].join("\n");
}

function buildHealthOnboardingStartScript(): string {
  return [
    "先询问用户以下信息：性别、年龄、身高(cm)、体重(kg)。",
    "必须明确告知用户：这些信息只会保存在本地，用于和健康记录共同分析，以提供更准确的结果；用户也可以不提供。",
    "如果用户同意提供画像：",
    "1. 先执行 /health onboarding consent yes",
    "2. 再按实际回答依次执行 /health onboarding set gender|age|heightCm|weightKg ...",
    "如果用户拒绝提供画像：执行 /health onboarding consent no",
    "完成后你必须立即继续执行 /health_setup，不要停在“安装完成”。",
    "运行 /health_setup 后默认选择 3（官方 relay）。",
    "如果二维码需要跨聊天软件发送，不要转发 ASCII QR，改为返回手动配对字段。",
    "首次同步成功后，插件会自动把匹配成功信息和首次健康分析发回当前主 agent 会话。",
  ].join("\n");
}

function renderOnboarding(profile: PendingOnboardingProfile | null): string {
  if (!profile) return "onboarding profile not found";
  const lines = [`consentAcceptedAt: ${new Date(profile.consentAcceptedAt).toISOString()}`];
  if (profile.gender != null) lines.push(`gender: ${profile.gender}`);
  if (profile.age != null) lines.push(`age: ${profile.age}`);
  if (profile.heightCm != null) lines.push(`heightCm: ${profile.heightCm}`);
  if (profile.weightKg != null) lines.push(`weightKg: ${profile.weightKg}`);
  lines.push(`updatedAt: ${new Date(profile.updatedAt).toISOString()}`);
  return lines.join("\n");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
