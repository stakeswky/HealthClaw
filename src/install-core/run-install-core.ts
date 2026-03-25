import path from "node:path";
import { PendingOnboardingStore } from "../onboarding/PendingOnboardingStore.js";
import { runSetupWizardWithOptions, type SetupWizardOptions } from "../setup/setup-command.js";
import type { InstallCoreDeps, InstallCoreOptions } from "./types.js";

export async function runInstallCore(
  options: InstallCoreOptions,
  deps: InstallCoreDeps = {},
): Promise<string> {
  const pluginStateDir = path.join(options.stateRoot, "health");
  const createStore = deps.createPendingOnboardingStore
    ?? ((stateDir: string) => new PendingOnboardingStore({ stateDir }));
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

  const api = {
    pluginConfig: options.pluginConfig,
    resolvePath(relativePath: string) {
      return path.join(options.stateRoot, relativePath);
    },
  };
  const runSetup = deps.runSetup ?? runSetupWizardWithOptions;
  const setupOptions: SetupWizardOptions = options.relay === "official"
    ? { connectionMode: "official" }
    : options.relay === "direct"
      ? { connectionMode: "direct" }
      : { connectionMode: "custom", relayURL: options.relayURL ?? "" };

  return runSetup(api, setupOptions);
}
