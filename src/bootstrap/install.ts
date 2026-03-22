import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PendingOnboardingStore } from "../onboarding/PendingOnboardingStore.js";
import { runSetupWizardWithOptions, type SetupWizardOptions } from "../setup/setup-command.js";

export type BootstrapInstallOptions = {
  pluginPath: string;
  configPath: string;
  relay: "official" | "custom" | "direct";
  relayURL?: string;
  consent: "yes" | "no";
  gender?: "male" | "female";
  age?: number;
  heightCm?: number;
  weightKg?: number;
  restartDelayMs?: number;
};

type BootstrapConfig = Record<string, unknown>;

type BootstrapInstallDeps = {
  readConfig?: (configPath: string) => Promise<BootstrapConfig>;
  writeConfig?: (configPath: string, config: BootstrapConfig) => Promise<void>;
  createPendingOnboardingStore?: (stateDir: string) => PendingOnboardingStore;
  runSetup?: (
    api: { pluginConfig: unknown; resolvePath(relativePath: string): string },
    options: SetupWizardOptions,
  ) => Promise<string>;
  scheduleRestart?: (delayMs: number) => Promise<void> | void;
};

export async function runBootstrapInstall(
  options: BootstrapInstallOptions,
  deps: BootstrapInstallDeps = {},
): Promise<string> {
  const readConfig = deps.readConfig ?? readConfigFile;
  const writeConfig = deps.writeConfig ?? writeConfigFile;
  const config = await readConfig(options.configPath);
  const stateRoot = path.dirname(options.configPath);
  const pluginStateDir = path.join(stateRoot, "health");
  const nextConfig = mergeHealthPluginConfig(config, options.pluginPath);
  await writeConfig(options.configPath, nextConfig);

  const createStore = deps.createPendingOnboardingStore ?? ((stateDir: string) => new PendingOnboardingStore({ stateDir }));
  const pendingStore = createStore(pluginStateDir);
  if (options.consent === "yes") {
    await pendingStore.acceptConsent();
    await pendingStore.upsert({
      ...(options.gender != null ? { gender: options.gender } : {}),
      ...(options.age != null ? { age: options.age } : {}),
      ...(options.heightCm != null ? { heightCm: options.heightCm } : {}),
      ...(options.weightKg != null ? { weightKg: options.weightKg } : {}),
    });
  } else {
    await pendingStore.clear();
  }

  const pluginConfig = (
    nextConfig.plugins
    && typeof nextConfig.plugins === "object"
    && (nextConfig.plugins as Record<string, unknown>).entries
    && typeof (nextConfig.plugins as Record<string, unknown>).entries === "object"
    && ((nextConfig.plugins as Record<string, unknown>).entries as Record<string, unknown>).health
    && typeof ((nextConfig.plugins as Record<string, unknown>).entries as Record<string, unknown>).health === "object"
    && (((nextConfig.plugins as Record<string, unknown>).entries as Record<string, unknown>).health as Record<string, unknown>).config
    && typeof (((nextConfig.plugins as Record<string, unknown>).entries as Record<string, unknown>).health as Record<string, unknown>).config === "object"
      ? ((((nextConfig.plugins as Record<string, unknown>).entries as Record<string, unknown>).health as Record<string, unknown>).config as Record<string, unknown>)
      : {}
  );

  const api = {
    pluginConfig,
    resolvePath(relativePath: string) {
      return path.join(stateRoot, relativePath);
    },
  };
  const runSetup = deps.runSetup ?? runSetupWizardWithOptions;
  const setupOptions: SetupWizardOptions = options.relay === "official"
    ? { connectionMode: "official" }
    : options.relay === "direct"
      ? { connectionMode: "direct" }
      : { connectionMode: "custom", relayURL: options.relayURL ?? "" };
  const setupText = await runSetup(api, setupOptions);

  const scheduleRestart = deps.scheduleRestart ?? defaultScheduleRestart;
  await scheduleRestart(options.restartDelayMs ?? 1500);

  return setupText;
}

async function readConfigFile(configPath: string): Promise<BootstrapConfig> {
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw) as BootstrapConfig;
}

async function writeConfigFile(configPath: string, config: BootstrapConfig): Promise<void> {
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function mergeHealthPluginConfig(config: BootstrapConfig, pluginPath: string): BootstrapConfig {
  const normalizedPath = path.resolve(pluginPath);
  const plugins = config.plugins && typeof config.plugins === "object"
    ? { ...(config.plugins as Record<string, unknown>) }
    : {};

  const load = plugins.load && typeof plugins.load === "object"
    ? { ...(plugins.load as Record<string, unknown>) }
    : {};
  const currentPaths = Array.isArray(load.paths)
    ? (load.paths as unknown[]).filter((value): value is string => typeof value === "string")
    : [];
  load.paths = Array.from(new Set([...currentPaths, normalizedPath]));

  const entries = plugins.entries && typeof plugins.entries === "object"
    ? { ...(plugins.entries as Record<string, unknown>) }
    : {};
  const healthEntry = entries.health && typeof entries.health === "object"
    ? { ...(entries.health as Record<string, unknown>) }
    : {};
  const healthConfig = healthEntry.config && typeof healthEntry.config === "object"
    ? { ...(healthEntry.config as Record<string, unknown>) }
    : {};
  healthEntry.enabled = true;
  healthEntry.config = {
    relayUrl: "https://healthclaw.proxypool.eu.org",
    enableRelayPolling: true,
    relayPollIntervalMs: 30000,
    ...healthConfig,
  };
  entries.health = healthEntry;

  const installs = plugins.installs && typeof plugins.installs === "object"
    ? { ...(plugins.installs as Record<string, unknown>) }
    : {};
  installs.health = {
    source: "path",
    sourcePath: normalizedPath,
    installPath: normalizedPath,
    version: "2026.3.16",
    installedAt: new Date().toISOString(),
  };

  return {
    ...config,
    plugins: {
      ...plugins,
      load,
      entries,
      installs,
    },
  };
}

async function defaultScheduleRestart(delayMs: number): Promise<void> {
  const openclawBin = path.join(process.env.HOME ?? "", ".openclaw", "bin", "openclaw");
  const command = `sleep ${Math.max(1, Math.ceil(delayMs / 1000))}; "${openclawBin}" gateway restart >/dev/null 2>&1 || true`;
  const child = spawn("/bin/sh", ["-lc", command], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}
