import { describe, expect, it, vi } from "vitest";
import { createHealthCommand, registerHealthCommand } from "../commands/health-command.js";

const USER_ID = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("health command", () => {
  function makeDeps() {
    return {
      profileStore: {
        load: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ userId: USER_ID, gender: "male", age: 32, updatedAt: 1 }),
        clear: vi.fn().mockResolvedValue("cleared"),
      },
      pendingOnboardingStore: {
        load: vi.fn().mockResolvedValue(null),
        acceptConsent: vi.fn().mockResolvedValue({ consentAcceptedAt: 1, updatedAt: 1 }),
        upsert: vi.fn().mockResolvedValue({ consentAcceptedAt: 1, age: 32, updatedAt: 1 }),
        clear: vi.fn().mockResolvedValue("cleared"),
      },
      reportService: {
        generate: vi.fn().mockResolvedValue({
          status: "report",
          markdown: "# Health Report",
          warnings: [],
        }),
      },
      focusAreas: ["sleep"],
    };
  }

  it("returns root help for unknown subcommands", async () => {
    const command = createHealthCommand(makeDeps());
    const result = await command.handler({ args: "wat" });
    expect(result.text).toContain("/health report <userId> [day|week|month]");
    expect(result.text).toContain("/health onboarding show");
  });

  it("registers the /health command through api.registerCommand", () => {
    const api = {
      registerCommand: vi.fn(),
    };
    registerHealthCommand(api as never, makeDeps());
    expect(api.registerCommand).toHaveBeenCalledWith(expect.objectContaining({ name: "health" }));
  });

  it("shows a stored profile", async () => {
    const deps = makeDeps();
    deps.profileStore.load = vi.fn().mockResolvedValue({
      userId: USER_ID,
      gender: "male",
      age: 32,
      updatedAt: 1,
    });
    const command = createHealthCommand(deps);
    const result = await command.handler({ args: `profile show ${USER_ID}` });
    expect(result.text).toContain(`userId: ${USER_ID}`);
    expect(result.text).toContain("gender: male");
    expect(result.text).toContain("age: 32");
  });

  it("returns invalid period for unsupported report period", async () => {
    const command = createHealthCommand(makeDeps());
    const result = await command.handler({ args: `report ${USER_ID} year` });
    expect(result.text).toBe("invalid period: use day, week, or month");
  });

  it("defaults /health report to day and plugin-config focusAreas", async () => {
    const deps = makeDeps();
    const command = createHealthCommand(deps);
    const result = await command.handler({ args: `report ${USER_ID}` });
    expect(result.text).toContain("# Health Report");
    expect(deps.reportService.generate).toHaveBeenCalledWith({
      userId: USER_ID,
      period: "day",
      focusAreas: ["sleep"],
    });
  });

  it("creates a profile through profile set", async () => {
    const deps = makeDeps();
    const command = createHealthCommand(deps);
    const result = await command.handler({ args: `profile set ${USER_ID} age 32` });
    expect(result.text).toBe("profile updated: age=32");
  });

  it("normalizes chinese gender input to male", async () => {
    const deps = makeDeps();
    const command = createHealthCommand(deps);
    const result = await command.handler({ args: `profile set ${USER_ID} gender 男` });
    expect(result.text).toBe("profile updated: gender=male");
  });

  it("requires consent before storing onboarding profile fields", async () => {
    const deps = makeDeps();
    deps.pendingOnboardingStore.load = vi.fn().mockResolvedValue(null);
    const command = createHealthCommand(deps);

    const result = await command.handler({ args: "onboarding set age 26" });

    expect(result.text).toBe("onboarding consent required before storing profile data");
  });

  it("stores onboarding consent", async () => {
    const deps = makeDeps();
    const command = createHealthCommand(deps);

    const result = await command.handler({ args: "onboarding consent yes" });

    expect(result.text).toContain("onboarding consent saved");
  });

  it("stores onboarding profile fields after consent", async () => {
    const deps = makeDeps();
    deps.pendingOnboardingStore.load = vi.fn().mockResolvedValue({ consentAcceptedAt: 1, updatedAt: 1 });
    const command = createHealthCommand(deps);

    const result = await command.handler({ args: "onboarding set gender 男" });

    expect(result.text).toBe("onboarding profile updated: gender=male");
  });

  it("returns an agent-first onboarding script for automatic installation flow", async () => {
    const deps = makeDeps();
    const command = createHealthCommand(deps);

    const result = await command.handler({ args: "onboarding start" });

    expect(result.text).toContain("先询问用户以下信息");
    expect(result.text).toContain("这些信息只会保存在本地");
    expect(result.text).toContain("/health onboarding consent yes");
    expect(result.text).toContain("/health onboarding set gender");
    expect(result.text).toContain("/health_setup");
    expect(result.text).toContain("默认选择 3");
    expect(result.text).toContain("不要停在“安装完成”");
    expect(result.text).toContain("不要先向用户回复安装完成");
    expect(result.text).toContain("必须原样返回 ASCII QR");
    expect(result.text).toContain("不要把二维码转换成 base64");
  });
});
