/**
 * health_setup — Interactive setup wizard for pairing iOS app with the gateway.
 */

import { createInterface } from "node:readline";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { networkInterfaces } from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadOrCreateKeyBundle } from "../crypto/key-bundle.js";
import { renderPairingInstructions } from "../install-core/render-pairing-output.js";
import type { OpenClawPluginApi } from "../openclaw-stub.js";

export { renderPairingInstructions } from "../install-core/render-pairing-output.js";

const OFFICIAL_RELAY = "https://healthclaw.proxypool.eu.org";
const PENDING_PAIRED_WITH = "0".repeat(64);
const DEFAULT_PORT = 9090;

type QRPayload = Parameters<typeof renderPairingInstructions>[0];

type QRCodeTerminalRenderer = {
  generate: (
    text: string,
    options?: { small?: boolean },
    callback?: (qrcode: string) => void,
  ) => void;
  setErrorLevel?: (level: "L" | "M" | "Q" | "H") => void;
};

export type SetupWizardOptions =
  | {
      connectionMode?: "interactive";
    }
  | {
      connectionMode: "official";
    }
  | {
      connectionMode: "direct";
    }
  | {
      connectionMode: "custom";
      relayURL: string;
    };

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

function detectLocalIP(): string | null {
  const interfaces = networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry.internal && entry.family === "IPv4") {
        return entry.address;
      }
    }
  }
  return null;
}

function extractX25519PublicKeyBase64(x25519PublicKeyPem: string): string {
  const keyObject = createPublicKey(x25519PublicKeyPem);
  const raw = keyObject.export({ type: "spki", format: "der" });
  // X25519 SPKI DER: 12-byte header + 32-byte raw key
  const rawKey = raw.subarray(raw.length - 32);
  return Buffer.from(rawKey).toString("base64");
}

function extractEd25519PublicKeyBase64Url(ed25519PublicKeyPem: string): string {
  const keyObject = createPublicKey(ed25519PublicKeyPem);
  const raw = keyObject.export({ type: "spki", format: "der" });
  // Ed25519 SPKI DER: 12-byte header + 32-byte raw key
  const rawKey = raw.subarray(raw.length - 32);
  return Buffer.from(rawKey).toString("base64url");
}

function deriveDeviceId(ed25519PublicKeyPem: string): string {
  const keyObject = createPublicKey(ed25519PublicKeyPem);
  const raw = keyObject.export({ type: "spki", format: "der" });
  const rawKey = raw.subarray(raw.length - 32);
  return createHash("sha256").update(rawKey).digest("hex");
}

async function registerGatewayWithRelay(
  relayURL: string,
  deviceId: string,
  ed25519PublicKeyBase64Url: string,
  ed25519PrivateKeyPem: string,
): Promise<{ ok: boolean; message: string }> {
  const signedAtMs = Date.now();
  const payload = `healthclaw-register-v1\n${deviceId}\n${signedAtMs}\ngateway\n${PENDING_PAIRED_WITH}`;
  const privateKey = createPrivateKey(ed25519PrivateKeyPem);
  const signature = sign(null, Buffer.from(payload, "utf8"), privateKey).toString("base64url");

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(new URL("/v1/health/register", relayURL), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceId,
        publicKey: ed25519PublicKeyBase64Url,
        role: "gateway",
        pairedWith: PENDING_PAIRED_WITH,
        signature,
        signedAtMs,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const result = await response.json() as { ok?: boolean; error?: string; message?: string };
    if (response.ok && result.ok) {
      return { ok: true, message: "Gateway registered with relay" };
    }
    return { ok: false, message: `Registration failed: ${result.message || result.error || response.status}` };
  } catch (err) {
    return { ok: false, message: `Registration request failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function testRelayConnectivity(url: string): Promise<{ ok: boolean; message: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    return {
      ok: response.status >= 200 && response.status < 500,
      message: `Relay responded with HTTP ${response.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `Cannot reach relay: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function registerSetupCommand(api: OpenClawPluginApi) {
  const handler = async () => {
    const text = await runSetupWizard(api);
    return { text };
  };

  api.registerCommand({
    name: "health_setup",
    description: "Interactive setup wizard — generates a QR code for iOS app pairing",
    acceptsArgs: false,
    handler,
  });
}

function resolveQRCodeRenderer(module: typeof import("qrcode-terminal")): QRCodeTerminalRenderer | null {
  const resolved = ((module as { default?: unknown }).default ?? module) as Partial<QRCodeTerminalRenderer>;
  if (typeof resolved.generate !== "function") {
    return null;
  }
  return resolved as QRCodeTerminalRenderer;
}

function translateConnectivityMessage(message: string): string {
  return message
    .replace("Relay responded with HTTP ", "Relay 返回 HTTP ")
    .replace("Cannot reach relay: ", "无法访问 Relay：");
}

function translateRegistrationMessage(message: string): string {
  return message
    .replace("Gateway registered with relay", "网关已成功注册到 Relay")
    .replace("Registration failed: ", "注册失败：")
    .replace("Registration request failed: ", "注册请求失败：");
}

async function runSetupWizard(api: OpenClawPluginApi): Promise<string> {
  return runSetupWizardWithOptions(api, { connectionMode: "interactive" });
}

export async function runSetupWizardWithOptions(
  api: Pick<OpenClawPluginApi, "pluginConfig" | "resolvePath">,
  options: SetupWizardOptions,
): Promise<string> {
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);

  log("🔧 HealthClaw 安装向导\n");

  // Step 1: Load or create key bundle
  const stateDir = api.resolvePath("health");
  const keyDir = `${stateDir}/keys`;
  const cfg = api.pluginConfig as Record<string, unknown> | undefined;
  const deviceId = (cfg && typeof cfg.gatewayDeviceId === "string" && cfg.gatewayDeviceId)
    || process.env.HEALTHCLAW_DEVICE_ID
    || randomHex(32);

  log("正在加载网关密钥...");
  const bundle = await loadOrCreateKeyBundle({ keyDir, deviceId });
  log(`  Device ID：${bundle.deviceId}`);
  log("  已加载 X25519 公钥。\n");

  let relayURL: string;

  if (options.connectionMode === "interactive" || options.connectionMode == null) {
    // Step 2: Choose connection mode
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      log("请选择连接方式：");
      log("  [1] 直连（公网 IP）");
      log("  [2] 自定义 Relay");
      log("  [3] 官方 Relay（默认）\n");

      const choice = (await prompt(rl, "请输入选项 [1/2/3]：")).trim() || "3";
      if (choice === "1") {
        const ip = detectLocalIP();
        if (!ip) {
          return lines.join("\n") + "\n❌ 无法检测到本机 IP，请改用选项 2 或 3。";
        }
        relayURL = `http://${ip}:${DEFAULT_PORT}`;
        log(`\n已使用直连：${relayURL}`);
      } else if (choice === "2") {
        const input = (await prompt(rl, "请输入 Relay URL：")).trim();
        if (!input) {
          return lines.join("\n") + "\n❌ 未提供 Relay URL。";
        }
        relayURL = input;
        log(`\n正在测试 ${relayURL} 的连通性...`);
        const result = await testRelayConnectivity(relayURL);
        log(`  ${translateConnectivityMessage(result.message)}`);
        if (!result.ok) {
          return lines.join("\n") + "\n❌ Relay 无法访问，请检查 URL 后重试。";
        }
      } else {
        relayURL = OFFICIAL_RELAY;
        log(`\n已使用官方 Relay：${relayURL}`);
      }
    } finally {
      rl.close();
    }
  } else if (options.connectionMode === "official") {
    relayURL = OFFICIAL_RELAY;
    log(`\n已使用官方 Relay：${relayURL}`);
  } else if (options.connectionMode === "direct") {
    const ip = detectLocalIP();
    if (!ip) {
      return lines.join("\n") + "\n❌ 无法检测到本机 IP，请改用选项 2 或 3。";
    }
    relayURL = `http://${ip}:${DEFAULT_PORT}`;
    log(`\n已使用直连：${relayURL}`);
  } else if (options.connectionMode === "custom") {
    relayURL = options.relayURL.trim();
    if (!relayURL) {
      return lines.join("\n") + "\n❌ 未提供 Relay URL。";
    }
    log(`\n正在测试 ${relayURL} 的连通性...`);
    const result = await testRelayConnectivity(relayURL);
    log(`  ${translateConnectivityMessage(result.message)}`);
    if (!result.ok) {
      return lines.join("\n") + "\n❌ Relay 无法访问，请检查 URL 后重试。";
    }
  } else {
    return lines.join("\n") + "\n❌ 不支持的连接方式。";
  }

    // Step 3: Register gateway with relay
    const gatewayDeviceId = deriveDeviceId(bundle.ed25519PublicKeyPem);
    const ed25519PubBase64Url = extractEd25519PublicKeyBase64Url(bundle.ed25519PublicKeyPem);

    log("\n正在向 Relay 注册网关...");
    const regResult = await registerGatewayWithRelay(
      relayURL,
      gatewayDeviceId,
      ed25519PubBase64Url,
      bundle.ed25519PrivateKeyPem,
    );
    if (!regResult.ok) {
      return lines.join("\n") + `\n❌ ${translateRegistrationMessage(regResult.message)}`;
    }
    log(`  ✓ ${translateRegistrationMessage(regResult.message)}`);

    // Step 4: Build QR payload
    const gatewayPublicKeyBase64 = extractX25519PublicKeyBase64(bundle.x25519PublicKeyPem);

    const payload: QRPayload = {
      v: 1,
      type: "healthclaw-pair",
      relayURL,
      gatewayDeviceId,
      gatewayPublicKeyBase64,
    };

    const payloadJSON = JSON.stringify(payload);

    // Step 5: Render QR in terminal
    log("\n📱 请使用 HealthClaw iOS App 扫描下面的二维码：\n");

    let qrcodeModule: typeof import("qrcode-terminal");
    try {
      qrcodeModule = await import("qrcode-terminal");
    } catch {
      log(renderPairingInstructions(
        payload,
        "[未检测到 qrcode-terminal，请执行：npm i qrcode-terminal]",
      ));
      return lines.join("\n");
    }

    const qrcode = resolveQRCodeRenderer(qrcodeModule);
    if (!qrcode) {
      log(renderPairingInstructions(
        payload,
        "[qrcode-terminal 已加载，但未找到 generate() 导出]",
      ));
      return lines.join("\n");
    }

    if (typeof qrcode.setErrorLevel === "function") {
      qrcode.setErrorLevel("M");
    }

    const qrText = await new Promise<string>((resolve) => {
      try {
        qrcode.generate(payloadJSON, { small: true }, (text: string) => {
          resolve(text);
        });
      } catch (error) {
        resolve(`[qrcode-terminal 生成失败：${error instanceof Error ? error.message : String(error)}]`);
      }
    });

    log(renderPairingInstructions(payload, qrText));

    // Step 6: Persist relay config for auto-start on next launch
    const relayConfig = {
      relayUrl: relayURL,
      gatewayDeviceId,
      ed25519PrivateKeyPath: "keys/ed25519_private.pem",
      configuredAt: Date.now(),
    };
    const configPath = path.join(stateDir, "relay-config.json");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(relayConfig, null, 2), "utf8");
    log(`\n💾 Relay 配置已保存到 ${configPath}`);

    log("\n✅ 初始化完成。扫码后 iOS App 会自动完成配对。");
    log(`\nRelay URL：${relayURL}`);
    log(`Device ID：${gatewayDeviceId}`);

    return lines.join("\n");
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}
