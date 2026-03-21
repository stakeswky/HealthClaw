# HealthClaw

HealthClaw 是一个运行在 OpenClaw Gateway 上的健康数据插件。

给人类看的简短说明：

- iPhone 端会读取 HealthKit 健康摘要数据。
- 数据先在手机端加密，再通过 relay 发送到 Gateway。
- Gateway 上的 HealthClaw 插件只在本地解密、存储和分析这些健康数据。
- 初始化时会先询问用户的基础画像信息。用户可以选择不提供；如果不提供，后续分析会只基于健康记录。

---

## 给 AI Agent 的安装说明

下面这一部分不是写给普通用户看的，而是写给 OpenClaw / Codex / Claude Code / Gemini CLI 等 agent 执行的。

### 你的任务

你要在当前 OpenClaw Gateway 上安装并初始化 HealthClaw 插件，并让它进入如下流程：

1. 安装并启用插件
2. 询问用户：
   - 性别
   - 年龄
   - 身高（cm）
   - 体重（kg）
3. 明确告诉用户：
   - 这些信息只会保存在本地
   - 用途是和健康记录一起分析，以提供更准确的结果
   - 用户可以不提供；若不提供，分析会只基于健康记录
4. 把用户回答写入插件的 onboarding 本地存储
5. 运行 `/health_setup`
6. 向用户返回二维码或手动配对字段
7. 等待用户完成配对和首次同步
8. 插件自动把“匹配成功 + 首次健康分析”发回当前 OpenClaw 主 agent 会话

### 执行原则

- 严格按顺序执行，不要跳步
- 在真正运行 OpenClaw Gateway 的那台机器上执行
- 除非用户明确要求自建 relay，否则默认使用官方 relay：`https://healthclaw.proxypool.eu.org`
- 不要使用旧命令 `health:setup`，只使用 `/health_setup`
- 不要把 ASCII QR 当成跨聊天软件稳定可用的配对介质

---

## 安装步骤

### 1. 获取仓库

```bash
git clone https://github.com/stakeswky/HealthClaw.git
cd HealthClaw
```

### 2. 安装依赖并构建

```bash
npm install
npm run build
```

预期结果：

- `npm install` 成功
- `npm run build` 成功

### 3. 安装到 OpenClaw

推荐使用本地路径 link 安装：

```bash
~/.openclaw/bin/openclaw plugins install --link "$(pwd)"
~/.openclaw/bin/openclaw plugins enable health
```

然后写入最小插件配置：

```bash
~/.openclaw/bin/openclaw config set plugins.entries.health.config.relayUrl https://healthclaw.proxypool.eu.org
~/.openclaw/bin/openclaw config set plugins.entries.health.config.enableRelayPolling true --json
~/.openclaw/bin/openclaw config set plugins.entries.health.config.relayPollIntervalMs 30000 --json
```

### 4. 确认 Gateway 和插件状态

```bash
~/.openclaw/bin/openclaw gateway start
~/.openclaw/bin/openclaw plugins doctor
~/.openclaw/bin/openclaw plugins list
```

应至少确认：

- `health` 出现在插件列表中
- 状态为 `loaded`
- `plugins doctor` 无插件错误

---

## 初始化流程

### 1. 先向用户说明本地画像存储规则

你必须先明确告诉用户：

- 性别、年龄、身高、体重只保存在本地
- 它们只用于与健康记录共同分析，以得到更准确的结果
- 用户可以拒绝提供；拒绝后照常配对，但分析会只基于健康记录

### 2. 询问用户画像

依次询问：

- 性别
- 年龄
- 身高（cm）
- 体重（kg）

### 3. 把画像写入插件本地 onboarding 存储

如果用户同意提供画像，先记录 consent：

```text
/health onboarding consent yes
```

然后按实际回答写入：

```text
/health onboarding set gender male
/health onboarding set age 26
/health onboarding set heightCm 180
/health onboarding set weightKg 84
```

如果用户拒绝提供画像，则执行：

```text
/health onboarding consent no
```

可用的辅助命令：

```text
/health onboarding show
/health onboarding clear
```

### 4. 运行配对

初始化完成后执行：

```text
/health_setup
```

当 setup 询问连接模式时，默认选择官方 relay：

```text
3
```

预期结果：

- 插件生成或复用配对密钥
- 网关向 relay 注册成功
- 返回 ASCII QR
- 同时打印：
  - `Relay URL`
  - `Gateway Device ID`
  - `Gateway Public Key (Base64)`
  - `Payload JSON`
- 写入本地 `relay-config.json`

### 5. 二维码交付规则

ASCII QR 只保证“终端本地扫码”：

- 如果用户直接看运行 setup 的那个终端，可以让用户直接扫码
- 如果需要通过 Telegram、Slack、飞书、微信等聊天界面传递配对信息，不要把 ASCII QR 当成主交付物

跨聊天软件传递时，必须返回以下内容给用户：

- `Relay URL`
- `Gateway Device ID`
- `Gateway Public Key (Base64)`
- `Payload JSON`

结论：

- 本地终端场景：优先 ASCII QR
- 远程聊天场景：优先手动配对字段

### 6. 首次同步后的预期行为

用户完成配对并触发首次同步后，插件会自动：

1. 检查是否存在待绑定 onboarding 画像
2. 如果存在，就绑定到这个新用户
3. 用当日健康数据生成首份分析
4. 把“匹配成功 + 首次健康分析”注入当前 OpenClaw 主 agent 会话

如果用户没有提供画像，则自动退回为“仅基于健康记录”的通用分析。

---

## 验证

检查本地状态目录：

```bash
ls -la ~/.openclaw/health
ls -la ~/.openclaw/health/keys
cat ~/.openclaw/health/relay-config.json
```

检查日志：

```bash
tail -n 80 ~/.openclaw/logs/gateway.log
```

期望日志包括：

- `found persisted relay config`
- `loaded X25519 private key`
- `loaded persisted relay config and derived identity key`
- `relay polling started`

---

## 当前约束

- 本仓库只包含 OpenClaw 插件本体，不包含 iOS App 和 relay worker 代码
- 正确配对命令是 `/health_setup`
- 正确初始化流程是“先采集本地画像，再开始配对”
- 正确的远程兜底方式是“手动配对字段”，不是 PNG 二维码
