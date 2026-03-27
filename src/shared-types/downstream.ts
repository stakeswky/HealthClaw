/**
 * Downstream health analysis types — Gateway → Relay → iOS
 * @module downstream
 */

import type { DeviceId, MessageId, TimestampMs } from "./device.js";

// ============================================================================
// Analysis Payload
// ============================================================================

export interface DownstreamMetricTrend {
  metric: string;
  direction: "increasing" | "decreasing" | "stable";
  changePercent: number;
  currentValue: number | null;
  previousValue: number | null;
}

export interface DownstreamAnomaly {
  metric: string;
  type: "high" | "low" | "missing";
  severity: "info" | "warning" | "critical";
  value: number | null;
  message: string;
}

export interface DownstreamHealthAnalysis {
  type: "health_analysis";
  period: "day" | "week" | "month";
  startDate: string;
  endDate: string;
  language: string;
  trends: DownstreamMetricTrend[];
  anomalies: DownstreamAnomaly[];
  recommendations: string[];
  generatedAtMs: TimestampMs;
}

// ============================================================================
// API Types
// ============================================================================

export interface PushDownstreamRequest {
  gatewayId: DeviceId;
  message: DownstreamHealthAnalysis;
}

export interface PushDownstreamResponse {
  ok: true;
  messageId: MessageId;
  expiresAtMs: TimestampMs;
}

export interface DownstreamMessage {
  messageId: MessageId;
  message: DownstreamHealthAnalysis;
  pushedAtMs: TimestampMs;
}

export interface PollDownstreamResponse {
  ok: true;
  messages: DownstreamMessage[];
}

export interface AckDownstreamRequest {
  deviceId: DeviceId;
  messageIds: MessageId[];
}

export interface AckDownstreamResponse {
  ok: true;
  acknowledged: number;
}

// ============================================================================
// Storage
// ============================================================================

export interface StoredDownstreamMessage {
  messageId: MessageId;
  message: DownstreamHealthAnalysis;
  pushedAtMs: TimestampMs;
  expiresAtMs: TimestampMs;
}

export const DOWNSTREAM_LIMITS = {
  maxMessagesPerGateway: 10,
  maxMessageSizeBytes: 64 * 1024,
} as const;
