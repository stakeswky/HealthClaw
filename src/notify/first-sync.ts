import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginLogger } from "../openclaw-stub.js";
import type { DailyHealthSummary, HealthPluginConfig, HealthFocusArea } from "../types.js";
import type { PendingOnboardingProfile } from "../onboarding/types.js";
import type { HealthUserProfile } from "../profile/types.js";
import type { HealthReportServiceResult } from "../report/types.js";

export type FirstSyncNotifierDeps = {
  stateDir: string;
  logger: PluginLogger;
  runtime?: unknown;
  config: HealthPluginConfig;
  pendingOnboardingStore?: {
    load(): Promise<PendingOnboardingProfile | null>;
    clear(): Promise<unknown>;
  };
  profileStore?: {
    upsert(input: Omit<HealthUserProfile, "updatedAt">): Promise<HealthUserProfile>;
  };
  reportService?: {
    generate(input: {
      userId: string;
      period: "day" | "week" | "month";
      focusAreas: HealthFocusArea[] | string[];
    }): Promise<HealthReportServiceResult>;
  };
};

type PairingState = {
  notifiedUsers: Record<string, { firstSeenAt: number; firstDate: string }>;
};

const INITIAL_STATE: PairingState = { notifiedUsers: {} };

export class FirstSyncNotifier {
  private readonly stateFile: string;
  private readonly logger: PluginLogger;
  private readonly runtime: unknown;
  private readonly config: HealthPluginConfig;
  private readonly pendingOnboardingStore;
  private readonly profileStore;
  private readonly reportService;

  constructor(deps: FirstSyncNotifierDeps) {
    this.stateFile = path.join(deps.stateDir, "pairing-state.json");
    this.logger = deps.logger;
    this.runtime = deps.runtime;
    this.config = deps.config;
    this.pendingOnboardingStore = deps.pendingOnboardingStore;
    this.profileStore = deps.profileStore;
    this.reportService = deps.reportService;
  }

  async maybeNotifyFirstSync(input: {
    userId: string;
    deviceId: string;
    deviceName?: string;
    summary: DailyHealthSummary;
    action: "created" | "merged";
  }): Promise<void> {
    const notifyCfg = this.config.notify;
    if (notifyCfg?.enabled === false) return;
    if (notifyCfg?.firstPairingMessage === false && notifyCfg?.firstReportMessage === false) return;

    const state = await this.loadState();
    if (state.notifiedUsers[input.userId]) return;

    const onboarding = await this.bindPendingOnboardingProfile(input.userId);
    const report = await this.generateFirstReport(input.userId);
    const text = buildFirstSyncMessage({
      summary: input.summary,
      report,
      onboarding,
      deviceName: input.deviceName ?? input.summary.deviceName,
      deviceId: input.deviceId,
      includePairingLine: notifyCfg?.firstPairingMessage !== false,
    });

    state.notifiedUsers[input.userId] = {
      firstSeenAt: Date.now(),
      firstDate: input.summary.date,
    };
    await this.saveState(state);

    this.logger.info(
      `health: first pairing confirmed for user=${input.userId} device=${input.deviceId}\n${text}`,
    );
    this.enqueueMainSessionEvent(text);
    await this.trySendMessage(text);
  }

  private async loadState(): Promise<PairingState> {
    try {
      const raw = await fs.readFile(this.stateFile, "utf8");
      const parsed = JSON.parse(raw);
      if (
        parsed
        && typeof parsed === "object"
        && parsed.notifiedUsers
        && typeof parsed.notifiedUsers === "object"
      ) {
        return parsed as PairingState;
      }
      return { notifiedUsers: { ...INITIAL_STATE.notifiedUsers } };
    } catch {
      return { notifiedUsers: { ...INITIAL_STATE.notifiedUsers } };
    }
  }

  private async saveState(state: PairingState): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    await fs.writeFile(this.stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  private async trySendMessage(text: string): Promise<void> {
    const notifyCfg = this.config.notify;
    if (!notifyCfg?.target || !this.runtime || typeof this.runtime !== "object") return;
    const runtime = this.runtime as Record<string, unknown>;
    const send = runtime.runChannelAction;
    if (typeof send !== "function") return;

    try {
      await (send as Function)({
        channel: notifyCfg.channel,
        action: "sendMessage",
        target: notifyCfg.target,
        message: text,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`health: failed to send first sync notification: ${msg}`);
    }
  }

  private async bindPendingOnboardingProfile(
    userId: string,
  ): Promise<{ status: "bound" | "none" | "failed"; warning?: string }> {
    if (!this.pendingOnboardingStore || !this.profileStore) return { status: "none" };
    try {
      const pending = await this.pendingOnboardingStore.load();
      if (!pending?.consentAcceptedAt) return { status: "none" };
      const profileInput: Omit<HealthUserProfile, "updatedAt"> = {
        userId,
        ...(pending.gender != null ? { gender: pending.gender } : {}),
        ...(pending.age != null ? { age: pending.age } : {}),
        ...(pending.heightCm != null ? { heightCm: pending.heightCm } : {}),
        ...(pending.weightKg != null ? { weightKg: pending.weightKg } : {}),
      };
      const hasFields = Object.keys(profileInput).some((key) => key !== "userId");
      if (!hasFields) return { status: "none" };
      await this.profileStore.upsert(profileInput);
      await this.pendingOnboardingStore.clear();
      return { status: "bound" };
    } catch (error) {
      return {
        status: "failed",
        warning: `pending onboarding profile could not be bound: ${asMessage(error)}`,
      };
    }
  }

  private async generateFirstReport(userId: string): Promise<HealthReportServiceResult | null> {
    if (!this.reportService) return null;
    try {
      return await this.reportService.generate({
        userId,
        period: "day",
        focusAreas: this.config.focusAreas ?? ["general_wellness"],
      });
    } catch (error) {
      return {
        status: "error",
        errorMessage: asMessage(error),
        warnings: [],
      };
    }
  }

  private enqueueMainSessionEvent(text: string): void {
    if (!this.runtime || typeof this.runtime !== "object") return;
    const runtime = this.runtime as Record<string, unknown>;
    const system = runtime.system;
    const configApi = runtime.config;
    const enqueue = system && typeof system === "object"
      ? (system as { enqueueSystemEvent?: Function }).enqueueSystemEvent
      : undefined;
    const loadConfig = configApi && typeof configApi === "object"
      ? (configApi as { loadConfig?: Function }).loadConfig
      : undefined;
    if (typeof enqueue !== "function") return;
    const cfg = typeof loadConfig === "function" ? loadConfig() : undefined;
    enqueue(text, { sessionKey: resolveMainSessionKey(cfg) });
  }
}

function buildFirstSyncMessage(input: {
  summary: DailyHealthSummary;
  report: HealthReportServiceResult | null;
  onboarding: { status: "bound" | "none" | "failed"; warning?: string };
  deviceName: string | undefined;
  deviceId: string;
  includePairingLine?: boolean;
}): string {
  const lines: string[] = [];

  if (input.includePairingLine !== false) {
    lines.push(`已成功匹配 ${input.deviceName || `iPhone ${input.deviceId.slice(0, 8)}…`}。`);
  }
  if (input.onboarding.status === "bound") {
    lines.push("已绑定本地用户画像信息，以下分析会结合健康记录和画像信息。");
  } else {
    lines.push("用户未提供可用画像信息，以下分析仅基于健康记录。");
  }
  if (input.onboarding.warning) {
    lines.push(`注意：${input.onboarding.warning}`);
  }
  lines.push("这是首次健康分析：");

  if (input.report?.status === "report") {
    if (input.report.warnings.length > 0) {
      lines.push(...input.report.warnings);
    }
    lines.push(input.report.markdown);
    return lines.join("\n");
  }

  const metrics: Array<[string, number | undefined, string]> = [
    ["步数", input.summary.steps, ""],
    ["活动卡路里", input.summary.activeCalories, " kcal"],
    ["运动分钟", input.summary.exerciseMinutes, " min"],
    ["平均心率", input.summary.averageHeartRate, " bpm"],
    ["睡眠", input.summary.sleepMinutes, " min"],
  ];

  for (const [label, value, suffix] of metrics) {
    if (typeof value === "number" && !Number.isNaN(value)) {
      lines.push(`- ${label}：${value}${suffix}`);
    }
  }

  lines.push(`- 日期：${input.summary.date}`);
  return lines.join("\n");
}

function resolveMainSessionKey(cfg: unknown): string {
  const config = cfg && typeof cfg === "object" ? cfg as Record<string, unknown> : {};
  const session = config.session && typeof config.session === "object"
    ? config.session as Record<string, unknown>
    : undefined;
  if (session?.scope === "global") return "global";
  const agents = config.agents && typeof config.agents === "object"
    ? config.agents as Record<string, unknown>
    : undefined;
  const list = Array.isArray(agents?.list) ? agents.list as Array<Record<string, unknown>> : [];
  const defaultAgentId = (
    list.find((agent) => agent?.default === true)?.id
    ?? list[0]?.id
    ?? "main"
  );
  return `agent:${normalizeAgentId(typeof defaultAgentId === "string" ? defaultAgentId : "main")}:${normalizeMainKey(typeof session?.mainKey === "string" ? session.mainKey : "main")}`;
}

function normalizeAgentId(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "main";
  const normalized = trimmed
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/g, "")
    .replace(/-+$/g, "")
    .slice(0, 64);
  return normalized || "main";
}

function normalizeMainKey(value: string): string {
  const trimmed = value.trim().toLowerCase();
  return trimmed || "main";
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
