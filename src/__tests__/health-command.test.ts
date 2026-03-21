import { describe, expect, it, vi } from "vitest";
import { createHealthCommand, registerHealthCommand } from "../commands/health-command.js";

const USER_ID = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";

describe("health command", () => {
  function makeDeps() {
    return {
      profileStore: {
        load: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ userId: USER_ID, age: 32, updatedAt: 1 }),
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
      age: 32,
      updatedAt: 1,
    });
    const command = createHealthCommand(deps);
    const result = await command.handler({ args: `profile show ${USER_ID}` });
    expect(result.text).toContain(`userId: ${USER_ID}`);
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
});
