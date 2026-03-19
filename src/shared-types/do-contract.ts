/**
 * Durable Object request/response contracts used by the relay Worker.
 * @module do-contract
 */

import type { AckHealthResponse, PollHealthMessage } from "./api.js";
import type { DeviceId, MessageId, TimestampMs } from "./device.js";
import type { EncryptedHealthEnvelope } from "./envelope.js";

/**
 * Store a new encrypted health envelope in the gateway queue.
 */
export interface DOStoreMessageRequest {
  action: "store";
  envelope: EncryptedHealthEnvelope;
  deviceId: DeviceId;
  ttlMs: number;
}

/**
 * Successful response after storing a queue item.
 */
export interface DOStoreMessageResponse {
  ok: true;
  messageId: MessageId;
  expiresAtMs: TimestampMs;
  currentCount: number;
  maxCount: number;
}

/**
 * Retrieve queued messages for a gateway.
 */
export interface DOPollRequest {
  action: "poll";
  limit: number;
  after?: MessageId;
}

/**
 * Successful poll response from the Durable Object.
 */
export interface DOPollResponse {
  ok: true;
  messages: PollHealthMessage[];
  hasMore: boolean;
}

/**
 * Delete queued messages after a successful gateway ACK.
 */
export interface DOAckRequest {
  action: "ack";
  gatewayId: DeviceId;
  messageIds: MessageId[];
}

/**
 * Successful ACK response from the Durable Object.
 */
export interface DOAckResponse extends AckHealthResponse {}

/**
 * Union of all supported Durable Object RPC requests.
 */
export type HealthRelayDORequest =
  | DOStoreMessageRequest
  | DOPollRequest
  | DOAckRequest;

/**
 * Union of all supported Durable Object RPC responses.
 */
export type HealthRelayDOResponse =
  | DOStoreMessageResponse
  | DOPollResponse
  | DOAckResponse;
