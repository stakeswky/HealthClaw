/**
 * API Request/Response types for Cloudflare Worker Relay endpoints
 * @module api
 */

import type {
  DeviceId,
  MessageId,
  TimestampMs,
} from "./device.js";
import type { EncryptedHealthEnvelope } from "./envelope.js";

/**
 * Upload health data request
 */
export interface UploadHealthRequest {
  /** Encrypted health envelope */
  envelope: EncryptedHealthEnvelope;
}

/**
 * Upload health data success response
 */
export interface UploadHealthResponse {
  /** Success flag */
  ok: true;
  /** Worker-generated message ID */
  messageId: MessageId;
  /** Message expiration timestamp */
  expiresAtMs: TimestampMs;
}

/**
 * Poll health data query parameters
 */
export interface PollHealthParams {
  /** Maximum number of messages to return */
  limit?: number;
  /** Cursor: messageId from last response */
  after?: MessageId;
}

/**
 * Individual message in poll response
 */
export interface PollHealthMessage {
  /** Message ID */
  messageId: MessageId;
  /** Encrypted health envelope */
  envelope: EncryptedHealthEnvelope;
  /** Receipt timestamp */
  receivedAtMs: TimestampMs;
}

/**
 * Poll health data success response
 */
export interface PollHealthResponse {
  /** Success flag */
  ok: true;
  /** Array of messages */
  messages: PollHealthMessage[];
  /** Whether more messages exist */
  hasMore: boolean;
}

/**
 * Acknowledge health data request
 */
export interface AckHealthRequest {
  /** Gateway device ID */
  gatewayId: DeviceId;
  /** Array of message IDs to acknowledge */
  messageIds: MessageId[];
}

/**
 * Acknowledge health data success response
 */
export interface AckHealthResponse {
  /** Success flag */
  ok: true;
  /** Number of messages acknowledged */
  acknowledged: number;
  /** Number of messages not found */
  notFound: number;
}

/**
 * Maximum messages per ACK request
 */
export const MAX_ACK_MESSAGES = 100 as const;

/**
 * Default poll limit
 */
export const DEFAULT_POLL_LIMIT = 20 as const;

/**
 * WebSocket inbound message from client
 */
export type WsInboundMessage =
  | { type: "pong"; ts: TimestampMs };

/**
 * WebSocket outbound message from server
 */
export type WsOutboundMessage =
  | { type: "health.envelope"; messageId: MessageId; envelope: EncryptedHealthEnvelope; receivedAtMs: TimestampMs }
  | { type: "ping"; ts: TimestampMs };

/**
 * WebSocket ping interval (30 seconds)
 */
export const WS_PING_INTERVAL_MS = 30000;

/**
 * WebSocket idle timeout (5 minutes)
 */
export const WS_IDLE_TIMEOUT_MS = 300000;

/**
 * Health relay error codes
 */
export type HealthRelayErrorCode =
  | "invalid_envelope"
  | "invalid_signature"
  | "signature_expired"
  | "device_not_registered"
  | "pairing_mismatch"
  | "rate_limited"
  | "storage_full"
  | "payload_too_large"
  | "internal_error";

/**
 * Health relay error response
 */
export interface HealthRelayErrorResponse {
  /** Error flag */
  ok: false;
  /** Error code */
  error: HealthRelayErrorCode;
  /** Optional error message */
  message?: string;
  /** Retry after milliseconds (for rate limiting) */
  retryAfterMs?: number;
}

/**
 * Generic API response union type
 */
export type HealthApiResponse<T> = T | HealthRelayErrorResponse;

/**
 * Retry configuration for client-side
 */
export interface RetryConfig {
  /** Maximum retry attempts */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffMultiplier: number;
  /** Jitter factor (0-1) */
  jitterFactor: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
  jitterFactor: 0.2,
} as const;

/**
 * Rate limit constants
 */
export const RATE_LIMITS = {
  GLOBAL_IP: { limit: 100, windowMs: 60 * 1000 }, // 100 req/min
  DEVICE_UPLOAD: { limit: 60, windowMs: 60 * 1000 }, // 60 req/min
  GATEWAY_POLL: { limit: 30, windowMs: 60 * 1000 }, // 30 req/min
  DEVICE_REGISTER: { limit: 5, windowMs: 60 * 60 * 1000 }, // 5 req/hour
  WEBSOCKET_MESSAGE: { limit: 10, windowMs: 1000 }, // 10 msg/sec
} as const;

/**
 * Storage limits
 */
export const STORAGE_LIMITS = {
  /** Maximum messages per Gateway */
  MAX_MESSAGES_PER_GATEWAY: 1000,
  /** Maximum envelope size in bytes */
  MAX_ENVELOPE_SIZE_BYTES: 256 * 1024, // 256 KB
  /** Default message TTL in milliseconds */
  DEFAULT_MESSAGE_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
} as const;