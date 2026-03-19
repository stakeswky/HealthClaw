// ============================================================================
// Health Plugin Types
// ============================================================================

import { HEALTH_FOCUS_AREAS } from "./shared-types/index.js";
import type {
  DailyHealthSummary as SharedDailyHealthSummary,
  EncryptedHealthEnvelope,
  EncryptedHealthFile as SharedEncryptedHealthFile,
  HealthDataPayload as SharedHealthDataPayload,
  HealthFocusArea as SharedHealthFocusArea,
  HealthPluginConfig as SharedHealthPluginConfig,
  HealthReportRequest as SharedHealthReportRequest,
  PollHealthMessage,
  UploadHealthRequest,
} from "./shared-types/index.js";

/**
 * Legacy direct-upload envelope still used by the plugin's standalone HTTP handler.
 * Relay-driven ingestion should use `RelayHealthEnvelope`.
 */
export type HealthDataEnvelope = {
  /** 发送设备的 deviceId（已配对） */
  deviceId: string;
  /** Ed25519 签名（对 encryptedPayload 签名） */
  signature: string;
  /** 设备的 Ed25519 公钥（hex） */
  publicKey: string;
  /** ECDH 临时公钥（X25519，hex），用于派生共享密钥 */
  ephemeralPublicKey: string;
  /** AES-256-GCM 加密后的健康数据（base64） */
  encryptedPayload: string;
  /** AES-256-GCM nonce/IV（base64，12 字节） */
  nonce: string;
  /** 信封创建时间戳（ms） */
  timestamp: number;
};

/** Canonical relay envelope from shared-types. */
export type RelayHealthEnvelope = EncryptedHealthEnvelope;
/** Canonical relay upload request from shared-types. */
export type RelayUploadHealthRequest = UploadHealthRequest;
/** Canonical relay poll message from shared-types. */
export type RelayPollHealthMessage = PollHealthMessage;

/** 解密后的健康数据载荷 */
export type HealthDataPayload = SharedHealthDataPayload;

/** 存储在磁盘上的每日健康摘要（加密前的明文结构） */
export type DailyHealthSummary = SharedDailyHealthSummary & {
  /** 该记录被合并更新的次数 */
  _mergeCount?: number;
  /** 最后一次合并来源设备 */
  _lastMergedFrom?: string;
  /** 最后一次合并时间戳 */
  _lastMergedAt?: number;
};

/** 磁盘上的加密文件格式 */
export type EncryptedHealthFile = SharedEncryptedHealthFile;

/** 健康报告请求参数 */
export type HealthReportRequest = SharedHealthReportRequest;

/** 用户可配置的关注领域 */
export { HEALTH_FOCUS_AREAS };
export type HealthFocusArea = SharedHealthFocusArea;

/** 插件配置类型 */
export type HealthPluginConfig = SharedHealthPluginConfig;
