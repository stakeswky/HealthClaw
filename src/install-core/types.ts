import type { SetupWizardOptions } from "../setup/setup-command.js";
import type { PendingOnboardingStore } from "../onboarding/PendingOnboardingStore.js";

export type InstallCoreOptions = {
  stateRoot: string;
  pluginConfig: Record<string, unknown>;
  relay: "official" | "custom" | "direct";
  relayURL?: string;
  consent: "yes" | "no";
  gender?: "male" | "female";
  age?: number;
  heightCm?: number;
  weightKg?: number;
};

export type InstallCoreDeps = {
  createPendingOnboardingStore?: (stateDir: string) => PendingOnboardingStore;
  runSetup?: (
    api: { pluginConfig: unknown; resolvePath(relativePath: string): string },
    options: SetupWizardOptions,
  ) => Promise<string>;
};
