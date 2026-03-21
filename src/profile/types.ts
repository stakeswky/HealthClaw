export type HealthUserProfile = {
  userId: string;
  age?: number;
  heightCm?: number;
  weightKg?: number;
  updatedAt: number;
};

export type ProfileClearResult = "cleared" | "not_found";
