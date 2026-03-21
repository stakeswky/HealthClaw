type RuntimeLike = {
  runChannelAction?: (input: {
    channel?: string;
    action: string;
    target: string;
    message: string;
  }) => Promise<unknown>;
};

export type ReportDeliveryServiceOptions = {
  runtime?: unknown;
  notifyTarget?: string;
  notifyChannel?: string;
  reportChannel?: string;
};

export class ReportDeliveryService {
  private readonly runtime?: RuntimeLike;
  private readonly notifyTarget?: string;
  private readonly notifyChannel?: string;
  private readonly reportChannel?: string;

  constructor(opts: ReportDeliveryServiceOptions) {
    this.runtime = typeof opts.runtime === "object" && opts.runtime !== null
      ? opts.runtime as RuntimeLike
      : undefined;
    this.notifyTarget = opts.notifyTarget?.trim() || undefined;
    this.notifyChannel = opts.notifyChannel?.trim() || undefined;
    this.reportChannel = opts.reportChannel;
  }

  async send(message: string): Promise<"sent" | "undeliverable"> {
    if (!this.notifyTarget) return "undeliverable";

    let resolvedChannel: string | undefined;
    if (this.reportChannel !== undefined) {
      resolvedChannel = this.reportChannel.trim() || undefined;
      if (!resolvedChannel) return "undeliverable";
    } else {
      resolvedChannel = this.notifyChannel;
      if (!resolvedChannel) return "undeliverable";
    }

    const send = this.runtime?.runChannelAction;
    if (typeof send !== "function") return "undeliverable";

    try {
      await send({
        channel: resolvedChannel,
        action: "sendMessage",
        target: this.notifyTarget,
        message,
      });
      return "sent";
    } catch {
      return "undeliverable";
    }
  }
}
