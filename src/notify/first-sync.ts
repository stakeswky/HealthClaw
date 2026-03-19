import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginLogger } from "../openclaw-stub.js";
import type { DailyHealthSummary, HealthPluginConfig } from "../types.js";

export type FirstSyncNotifierDeps = {
  stateDir: string;
  logger: PluginLogger;
  runtime?: unknown;
  config: HealthPluginConfig;
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

  constructor(deps: FirstSyncNotifierDeps) {
    this.stateFile = path.join(deps.stateDir, "pairing-state.json");
    this.logger = deps.logger;
    this.runtime = deps.runtime;
    this.config = deps.config;
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

    state.notifiedUsers[input.userId] = {
      firstSeenAt: Date.now(),
      firstDate: input.summary.date,
    };
    await this.saveState(state);

    const text = buildFirstSyncMessage(
      input.summary,
      input.deviceName ?? input.summary.deviceName,
      input.deviceId,
      notifyCfg?.firstPairingMessage !== false,
    );
    this.logger.info(
      `health: first pairing confirmed for user=${input.userId} device=${input.deviceId}\n${text}`,
    );
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
      return { ...INITIAL_STATE };
    } catch {
      return { ...INITIAL_STATE };
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
}

function buildFirstSyncMessage(
  summary: DailyHealthSummary,
  deviceName: string | undefined,
  deviceId: string,
  includePairingLine = true,
): string {
  const lines: string[] = [];

  if (includePairingLine) {
    lines.push(`已成功匹配 ${deviceName || `iPhone ${deviceId.slice(0, 8)}…`}。`);
  }
  lines.push("这是首次健康报告：");

  const metrics: Array<[string, number | undefined, string]> = [
    ["步数", summary.steps, ""],
    ["活动卡路里", summary.activeCalories, " kcal"],
    ["运动分钟", summary.exerciseMinutes, " min"],
    ["平均心率", summary.averageHeartRate, " bpm"],
    ["睡眠", summary.sleepMinutes, " min"],
  ];

  for (const [label, value, suffix] of metrics) {
    if (typeof value === "number" && !Number.isNaN(value)) {
      lines.push(`- ${label}：${value}${suffix}`);
    }
  }

  lines.push(`- 日期：${summary.date}`);
  return lines.join("\n");
}
