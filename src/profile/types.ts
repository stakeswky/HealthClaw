export type HealthUserProfile = {
  userId: string;
  gender?: "male" | "female";
  age?: number;
  heightCm?: number;
  weightKg?: number;
  updatedAt: number;
};

export type ProfileClearResult = "cleared" | "not_found";
