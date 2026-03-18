/**
 * health:setup — Interactive setup wizard for pairing iOS app with gateway.
 *
 * Generates a QR code in the terminal that the iOS app can scan
 * to complete pairing in one step.
 */

import { createInterface } from "node:readline";
import { createPublicKey } from "node:crypto";
import { networkInterfaces } from "node:os";
import { loadOrCreateKeyBundle } from "../crypto/key-bundle.js";
import type { OpenClawPluginApi } from "../openclaw-stub.js";

const OFFICIAL_RELAY = "https://health-relay.openclaw.workers.dev";
const DEFAULT_PORT = 9090;

interface QRPayload {
  v: 1;
  type: "openclaw-health-pair";
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
  api.registerCommand({
    name: "health:setup",
    description: "Interactive setup wizard — generates a QR code for iOS app pairing",
    acceptsArgs: false,
    handler: async () => {
      const text = await runSetupWizard(api);
      return { text };
    },
  });
}

async function runSetupWizard(api: OpenClawPluginApi): Promise<string> {
  const lines: string[] = [];
  const log = (msg: string) => lines.push(msg);

  log("🔧 OpenClaw Health — Setup Wizard\n");

  // Step 1: Load or create key bundle
  const stateDir = api.resolvePath("health");
  const keyDir = `${stateDir}/keys`;
  const cfg = api.pluginConfig as Record<string, unknown> | undefined;
  const deviceId = (cfg && typeof cfg.gatewayDeviceId === "string" && cfg.gatewayDeviceId)
    || process.env.OPENCLAW_DEVICE_ID
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

    // Step 3: Build QR payload
    const gatewayPublicKeyBase64 = extractX25519PublicKeyBase64(bundle.x25519PublicKeyPem);

    const payload: QRPayload = {
      v: 1,
      type: "openclaw-health-pair",
      relayURL,
      gatewayDeviceId: bundle.deviceId,
      gatewayPublicKeyBase64,
    };

    const payloadJSON = JSON.stringify(payload);

    // Step 4: Render QR in terminal
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
    log("\n✅ Setup complete. The iOS app will auto-configure after scanning.");
    log(`\nRelay URL: ${relayURL}`);
    log(`Device ID: ${bundle.deviceId}`);

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
