/**
 * health_setup / health:setup — Interactive setup wizard for pairing iOS app
 * with the gateway.
 */

import { createInterface } from "node:readline";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { networkInterfaces } from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadOrCreateKeyBundle } from "../crypto/key-bundle.js";
import type { OpenClawPluginApi } from "../openclaw-stub.js";

const OFFICIAL_RELAY = "https://healthclaw.proxypool.eu.org";
const PENDING_PAIRED_WITH = "0".repeat(64);
const DEFAULT_PORT = 9090;

interface QRPayload {
  v: 1;
  type: "healthclaw-pair";
  relayURL: string;
  gatewayDeviceId: string;
  gatewayPublicKeyBase64: string;
}

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

  for (const name of ["health_setup", "health:setup"] as const) {
    api.registerCommand({
      name,
      description: "Interactive setup wizard — generates a QR code for iOS app pairing",
      acceptsArgs: false,
      handler,
    });
  }
}

async function runSetupWizard(api: OpenClawPluginApi): Promise<string> {
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);

  log("🔧 HealthClaw — Setup Wizard\n");

  // Step 1: Load or create key bundle
  const stateDir = api.resolvePath("health");
  const keyDir = `${stateDir}/keys`;
  const cfg = api.pluginConfig as Record<string, unknown> | undefined;
  const deviceId = (cfg && typeof cfg.gatewayDeviceId === "string" && cfg.gatewayDeviceId)
    || process.env.HEALTHCLAW_DEVICE_ID
    || randomHex(32);

  log("Loading gateway key bundle...");
  const bundle = await loadOrCreateKeyBundle({ keyDir, deviceId });
  log(`  Device ID: ${bundle.deviceId}`);
  log(`  X25519 public key loaded.\n`);

  // Step 2: Choose connection mode
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    log("Choose connection mode:");
    log("  [1] Direct (public IP)");
    log("  [2] Custom relay");
    log("  [3] Official relay (default)\n");

    const choice = (await prompt(rl, "Enter choice [1/2/3]: ")).trim() || "3";

    let relayURL: string;

    if (choice === "1") {
      // Direct connection
      const ip = detectLocalIP();
      if (!ip) {
        return lines.join("\n") + "\n❌ Could not detect a local IP address. Use option 2 or 3 instead.";
      }
      relayURL = `http://${ip}:${DEFAULT_PORT}`;
      log(`\nUsing direct connection: ${relayURL}`);
    } else if (choice === "2") {
      // Custom relay
      const input = (await prompt(rl, "Enter relay URL: ")).trim();
      if (!input) {
        return lines.join("\n") + "\n❌ No URL provided.";
      }
      relayURL = input;
      log(`\nTesting connectivity to ${relayURL}...`);
      const result = await testRelayConnectivity(relayURL);
      log(`  ${result.message}`);
      if (!result.ok) {
        return lines.join("\n") + "\n❌ Relay is not reachable. Check the URL and try again.";
      }
    } else {
      // Official relay
      relayURL = OFFICIAL_RELAY;
      log(`\nUsing official relay: ${relayURL}`);
    }

    // Step 3: Register gateway with relay
    const gatewayDeviceId = deriveDeviceId(bundle.ed25519PublicKeyPem);
    const ed25519PubBase64Url = extractEd25519PublicKeyBase64Url(bundle.ed25519PublicKeyPem);

    log("\nRegistering gateway with relay...");
    const regResult = await registerGatewayWithRelay(
      relayURL,
      gatewayDeviceId,
      ed25519PubBase64Url,
      bundle.ed25519PrivateKeyPem,
    );
    if (!regResult.ok) {
      return lines.join("\n") + `\n❌ ${regResult.message}`;
    }
    log(`  ✓ ${regResult.message}`);

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
    log("\n📱 Scan this QR code with the HealthClaw iOS app:\n");

    let qrcode: typeof import("qrcode-terminal");
    try {
      qrcode = await import("qrcode-terminal");
    } catch {
      // Fallback: just print the JSON
      log("[qrcode-terminal not available — install it with: npm i qrcode-terminal]");
      log(`\nPayload JSON:\n${payloadJSON}`);
      return lines.join("\n");
    }

    const qrText = await new Promise<string>((resolve) => {
      qrcode.generate(payloadJSON, { small: true }, (text: string) => {
        resolve(text);
      });
    });

    log(qrText);

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
    log(`\n💾 Relay config saved to ${configPath}`);

    log("\n✅ Setup complete. The iOS app will auto-configure after scanning.");
    log(`\nRelay URL: ${relayURL}`);
    log(`Device ID: ${gatewayDeviceId}`);

    return lines.join("\n");
  } finally {
    rl.close();
  }
}

function randomHex(bytes: number): string {
  const array = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    array[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}
