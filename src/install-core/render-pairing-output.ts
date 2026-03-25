export type PairingPayload = {
  v: 1;
  type: "healthclaw-pair";
  relayURL: string;
  gatewayDeviceId: string;
  gatewayPublicKeyBase64: string;
};

export function renderPairingInstructions(payload: PairingPayload, qrText?: string): string {
  const lines: string[] = [];

  if (qrText) {
    lines.push(qrText, "");
  }

  lines.push(
    "Note: This ASCII QR is terminal-local only. If you forward it through chat apps, scanning may fail.",
    "",
    "Manual pairing fallback:",
    `Relay URL: ${payload.relayURL}`,
    `Gateway Device ID: ${payload.gatewayDeviceId}`,
    `Gateway Public Key (Base64): ${payload.gatewayPublicKeyBase64}`,
    "",
    "Payload JSON:",
    JSON.stringify(payload, null, 2),
  );

  return lines.join("\n");
}
