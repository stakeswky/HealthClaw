import { describe, expect, it, vi } from "vitest";
import { ReportDeliveryService } from "../report/ReportDeliveryService.js";

describe("ReportDeliveryService", () => {
  it("uses reportChannel override when provided", async () => {
    const runChannelAction = vi.fn().mockResolvedValue(undefined);
    const service = new ReportDeliveryService({
      runtime: { runChannelAction },
      notifyTarget: "target-1",
      notifyChannel: "telegram",
      reportChannel: "slack",
    });

    const result = await service.send("# Report");

    expect(result).toBe("sent");
    expect(runChannelAction).toHaveBeenCalledWith({
      channel: "slack",
      action: "sendMessage",
      target: "target-1",
      message: "# Report",
    });
  });

  it("treats invalid explicit reportChannel as undeliverable without fallback", async () => {
    const runChannelAction = vi.fn();
    const service = new ReportDeliveryService({
      runtime: { runChannelAction },
      notifyTarget: "target-1",
      notifyChannel: "telegram",
      reportChannel: "",
    });

    const result = await service.send("# Report");

    expect(result).toBe("undeliverable");
    expect(runChannelAction).not.toHaveBeenCalled();
  });
});
