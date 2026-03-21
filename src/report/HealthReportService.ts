import type { DailyHealthSummary } from "../types.js";
import type { HealthReportResult, MetricTrend, ReportPeriod } from "../tools/health-report.js";
import {
  METRICS_TO_ANALYZE,
  analyzeTrend,
  calculateDateRange,
  calculateTotalDays,
  detectAnomalies,
  generateMarkdownReport,
  generateRecommendations,
  splitDataIntoPeriods,
} from "../tools/health-report.js";
import type { HealthReportServiceInput, HealthReportServiceResult } from "./types.js";

type StoreLike = {
  getDateRangeOptimized(userId: string, startDate: string, endDate: string): Promise<DailyHealthSummary[]>;
};

type ProfileStoreLike = {
  load(userId: string): Promise<unknown>;
};

type BasicProfile = {
  gender?: "male" | "female";
  age?: number;
  heightCm?: number;
  weightKg?: number;
};

type HealthReportServiceDeps = {
  store: StoreLike;
  profileStore: ProfileStoreLike;
};

export class HealthReportService {
  private readonly store: StoreLike;
  private readonly profileStore: ProfileStoreLike;

  constructor(deps: HealthReportServiceDeps) {
    this.store = deps.store;
    this.profileStore = deps.profileStore;
  }

  async generate(input: HealthReportServiceInput): Promise<HealthReportServiceResult> {
    const userId = input.userId.toLowerCase();
    const { startDate, endDate } = calculateDateRange(input.period as ReportPeriod);
    const warnings: string[] = [];

    let data: DailyHealthSummary[];
    try {
      data = await this.store.getDateRangeOptimized(userId, startDate, endDate);
    } catch (error) {
      return {
        status: "error",
        errorMessage: asMessage(error),
        warnings,
      };
    }

    if (data.length === 0) {
      return { status: "no_data", warnings };
    }

    const { current, previous } = splitDataIntoPeriods(data, input.period);

    const trends: MetricTrend[] = [];
    for (const metric of METRICS_TO_ANALYZE) {
      const trend = analyzeTrend(current, previous, metric);
      if (trend) trends.push(trend);
    }

    const anomalies = detectAnomalies(data);
    const focusAreas = [...input.focusAreas];
    const recommendations = generateRecommendations(trends, anomalies, focusAreas);
    const totalDays = calculateTotalDays(startDate, endDate);
    const dataCompleteness = totalDays > 0 ? (data.length / totalDays) * 100 : 0;

    const result: HealthReportResult = {
      userId,
      period: input.period,
      startDate,
      endDate,
      summary: {
        daysWithData: data.length,
        totalDays,
        dataCompleteness,
      },
      trends,
      anomalies,
      recommendations,
    };

    let profileContextLines: string[] = [];
    try {
      const loadedProfile = await this.profileStore.load(userId);
      const profile = toBasicProfile(loadedProfile);
      profileContextLines = buildProfileContext(profile);
      const bmiValue = bmi(profile);
      if (bmiValue != null) {
        result.recommendations.unshift(
          `BMI context: ${bmiValue.toFixed(1)} (${bmiCategory(bmiValue)}). Keep nutrition and activity aligned with this target.`,
        );
      }
    } catch {
      warnings.push("Note: profile data was unavailable, generic analysis used.");
    }

    return {
      status: "report",
      markdown: appendProfileContext(generateMarkdownReport(result, focusAreas), profileContextLines),
      warnings,
    };
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toBasicProfile(value: unknown): BasicProfile {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return {
    gender: record.gender === "male" || record.gender === "female"
      ? record.gender
      : undefined,
    age: typeof record.age === "number" ? record.age : undefined,
    heightCm: typeof record.heightCm === "number" ? record.heightCm : undefined,
    weightKg: typeof record.weightKg === "number" ? record.weightKg : undefined,
  };
}

function buildProfileContext(profile: BasicProfile): string[] {
  const lines: string[] = [];
  if (profile.gender != null) {
    lines.push(`Gender: ${profile.gender}`);
  }
  if (profile.age != null) {
    lines.push(`Age: ${profile.age}`);
  }
  if (profile.heightCm != null && profile.weightKg != null) {
    const bmiValue = bmi(profile);
    if (bmiValue != null) {
      lines.push(`Height: ${profile.heightCm} cm`);
      lines.push(`Weight: ${profile.weightKg} kg`);
      lines.push(`BMI: ${bmiValue.toFixed(1)} (${bmiCategory(bmiValue)})`);
    }
  }
  return lines;
}

function appendProfileContext(markdown: string, lines: string[]): string {
  if (lines.length === 0) return markdown;
  return `${markdown}\n## Profile Context\n\n${lines.map((line) => `- ${line}`).join("\n")}\n`;
}

function bmi(profile: BasicProfile): number | null {
  if (profile.heightCm == null || profile.weightKg == null) return null;
  const heightMeters = profile.heightCm / 100;
  if (heightMeters <= 0) return null;
  return profile.weightKg / (heightMeters * heightMeters);
}

function bmiCategory(value: number): string {
  if (value < 18.5) return "underweight";
  if (value < 25) return "healthy";
  if (value < 30) return "overweight";
  return "obesity";
}
