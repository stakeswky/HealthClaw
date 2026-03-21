export type PendingOnboardingProfile = {
  consentAcceptedAt: number;
  gender?: "male" | "female";
  age?: number;
  heightCm?: number;
  weightKg?: number;
  updatedAt: number;
};

export type PendingOnboardingClearResult = "cleared" | "not_found";
