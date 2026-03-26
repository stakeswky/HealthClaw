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
    "注意：ASCII 二维码只保证当前终端本地扫码可用，转发到聊天软件后可能无法识别。",
    "",
    "手动配对备用信息：",
    `Relay URL：${payload.relayURL}`,
    `网关 Device ID：${payload.gatewayDeviceId}`,
    `网关公钥（Base64）：${payload.gatewayPublicKeyBase64}`,
    "",
    "Payload JSON：",
    JSON.stringify(payload, null, 2),
  );

  return lines.join("\n");
}
