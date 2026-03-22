#!/usr/bin/env node

import path from "node:path";
import { runBootstrapInstall } from "../dist/bootstrap/install.js";

function usage() {
  console.error(
    [
      "Usage:",
      "  node scripts/bootstrap-install.mjs --consent yes|no [--gender male|female] [--age N] [--height-cm N] [--weight-kg N]",
      "Optional:",
      "  --relay official|custom|direct",
      "  --relay-url <url>",
      "  --plugin-path <path>",
      "  --config-path <path>",
      "  --restart-delay-ms <ms>",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const parsed = {
    relay: "official",
    pluginPath: process.cwd(),
    configPath: path.join(process.env.HOME ?? "", ".openclaw", "openclaw.json"),
    restartDelayMs: 1500,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--consent" && next) {
      parsed.consent = next;
      i += 1;
    } else if (arg === "--gender" && next) {
      parsed.gender = next;
      i += 1;
    } else if (arg === "--age" && next) {
      parsed.age = Number(next);
      i += 1;
    } else if (arg === "--height-cm" && next) {
      parsed.heightCm = Number(next);
      i += 1;
    } else if (arg === "--weight-kg" && next) {
      parsed.weightKg = Number(next);
      i += 1;
    } else if (arg === "--relay" && next) {
      parsed.relay = next;
      i += 1;
    } else if (arg === "--relay-url" && next) {
      parsed.relayURL = next;
      i += 1;
    } else if (arg === "--plugin-path" && next) {
      parsed.pluginPath = path.resolve(next);
      i += 1;
    } else if (arg === "--config-path" && next) {
      parsed.configPath = path.resolve(next);
      i += 1;
    } else if (arg === "--restart-delay-ms" && next) {
      parsed.restartDelayMs = Number(next);
      i += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return parsed;
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.consent !== "yes" && options.consent !== "no") {
    usage();
    process.exit(1);
  }
  const text = await runBootstrapInstall(options);
  process.stdout.write(`${text}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  usage();
  process.exit(1);
}
