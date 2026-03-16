// ============================================================================
// Health Plugin Types
// ============================================================================

/** iOS 设备上传的加密信封 */
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

/** 解密后的健康数据载荷 */
export type HealthDataPayload = {
  /** 数据所属日期，格式 YYYY-MM-DD */
  date: string;
  /** 用户标识（设备配对时分配） */
  userId: string;
  /** 步数 */
  steps?: number;
  /** 活动消耗卡路里（kcal） */
  activeCalories?: number;
  /** 静息心率（bpm） */
  restingHeartRate?: number;
  /** 平均心率（bpm） */
  averageHeartRate?: number;
  /** 最高心率（bpm） */
  maxHeartRate?: number;
  /** 心率变异性 HRV（ms） */
  heartRateVariability?: number;
  /** 睡眠时长（分钟） */
  sleepMinutes?: number;
  /** 深度睡眠时长（分钟） */
  deepSleepMinutes?: number;
  /** REM 睡眠时长（分钟） */
  remSleepMinutes?: number;
  /** 体重（kg） */
  weight?: number;
  /** 血氧饱和度（%） */
  bloodOxygen?: number;
  /** 步行距离（米） */
  walkingDistance?: number;
  /** 锻炼时长（分钟） */
  exerciseMinutes?: number;
  /** 站立小时数 */
  standHours?: number;
  /** 呼吸频率（次/分钟） */
  respiratoryRate?: number;
  /** 额外自定义指标 */
  custom?: Record<string, number>;
};

/** 存储在磁盘上的每日健康摘要（加密前的明文结构） */
export type DailyHealthSummary = HealthDataPayload & {
  /** 数据接收时间戳（ms） */
  receivedAt: number;
  /** 数据来源设备 */
  sourceDeviceId: string;
  /** 数据版本，用于未来 schema 迁移 */
  schemaVersion: 1;
  /** 该记录被合并更新的次数 */
  _mergeCount?: number;
  /** 最后一次合并来源设备 */
  _lastMergedFrom?: string;
  /** 最后一次合并时间戳 */
  _lastMergedAt?: number;
};

/** 磁盘上的加密文件格式 */
export type EncryptedHealthFile = {
  /** AES-256-GCM 加密后的 JSON（base64） */
  data: string;
  /** IV/nonce（base64，12 字节） */
  iv: string;
  /** auth tag（base64，16 字节） */
  tag: string;
  /** 加密时间戳 */
  encryptedAt: number;
};

/** 健康报告请求参数 */
export type HealthReportRequest = {
  userId: string;
  /** 起始日期 YYYY-MM-DD */
  startDate: string;
  /** 结束日期 YYYY-MM-DD */
  endDate: string;
  /** 关注领域 */
  focusAreas?: HealthFocusArea[];
  /** 报告语言 */
  language?: string;
};

/** 用户可配置的关注领域 */
export const HEALTH_FOCUS_AREAS = [
  "weight_loss",
  "fitness",
  "sleep",
  "heart_health",
  "general_wellness",
] as const;
export type HealthFocusArea = (typeof HEALTH_FOCUS_AREAS)[number];

/** 插件配置类型 */
export type HealthPluginConfig = {
  /** 每日报告时间，格式 HH:MM（24 小时制），默认 "08:00" */
  reportTime?: string;
  /** 关注领域 */
  focusAreas?: HealthFocusArea[];
  /** 数据保留天数，默认 90 */
  retentionDays?: number;
  /** 报告语言，默认 "zh-CN" */
  language?: string;
  /** 报告发送渠道（如 "telegram"），默认使用消息来源渠道 */
  reportChannel?: string;
  /** 是否启用每日自动报告，默认 true */
  dailyReport?: boolean;
};