import {
  createPrivateKey,
  sign,
  type KeyObject,
} from "node:crypto";
import type { PluginLogger } from "../openclaw-stub.js";
import type {
  DownstreamHealthAnalysis,
  PushDownstreamResponse,
} from "../shared-types/index.js";

const RAW_ED25519_PKCS8_PREFIX = Buffer.from(
  "302e020100300506032b657004220420",
  "hex",
);

export type DownstreamPushConfig = {
  relayUrl: string;
  gatewayDeviceId: string;
  gatewayEd25519PrivateKey: string;
};

export type DownstreamPushServiceDeps = {
  logger: PluginLogger;
  config: DownstreamPushConfig;
  fetchImpl?: typeof fetch;
};

export class DownstreamPushService {
  private readonly logger: PluginLogger;
  private readonly config: DownstreamPushConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly gatewayPrivateKey: KeyObject;

  constructor(deps: DownstreamPushServiceDeps) {
    this.logger = deps.logger;
    this.config = deps.config;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.gatewayPrivateKey = importEd25519PrivateKey(deps.config.gatewayEd25519PrivateKey);
  }

  async pushAnalysis(analysis: DownstreamHealthAnalysis): Promise<boolean> {
    const { relayUrl, gatewayDeviceId } = this.config;
    const url = `${relayUrl}/v1/health/downstream/${gatewayDeviceId}`;

    const signedAtMs = Date.now();
    const payload = `healthclaw-poll-v1\n${gatewayDeviceId}\n${signedAtMs}\nGET /v1/health/poll/${gatewayDeviceId}`;
    const signature = sign(null, Buffer.from(payload, "utf8"), this.gatewayPrivateKey).toString("base64url");

    const body = JSON.stringify({ message: analysis });

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-openclaw-gateway-device-id": gatewayDeviceId,
          "x-openclaw-gateway-signature": signature,
          "x-openclaw-gateway-signed-at-ms": String(signedAtMs),
        },
        body,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        this.logger.warn(`health: downstream push failed (${response.status}): ${text}`);
        return false;
      }

      const result = await response.json() as PushDownstreamResponse;
      this.logger.info(`health: downstream push ok (messageId=${result.messageId})`);
      return true;
    } catch (error) {
      this.logger.warn(`health: downstream push error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}

function importEd25519PrivateKey(base64Key: string): KeyObject {
  const raw = Buffer.from(base64Key, "base64");
  const pkcs8 = Buffer.concat([RAW_ED25519_PKCS8_PREFIX, raw]);
  return createPrivateKey({
    key: pkcs8,
    format: "der",
    type: "pkcs8",
  });
}
