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
2. 询问用户画像与免责声明
3. 运行一次性 bootstrap CLI
4. 向用户返回原样 ASCII QR 或手动配对字段
5. 脚本会在后台延迟重启 gateway
6. 等待用户完成配对和首次同步
7. 插件自动把“匹配成功 + 首次健康分析”发回当前 OpenClaw 主 agent 会话

### 执行原则

- 严格按顺序执行，不要跳步
- 在真正运行 OpenClaw Gateway 的那台机器上执行
- 除非用户明确要求自建 relay，否则默认使用官方 relay：`https://healthclaw.proxypool.eu.org`
- 不要在“插件安装成功”后停下，必须继续执行 bootstrap CLI
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

然后确保 OpenClaw 使用本地 gateway：

```bash
~/.openclaw/bin/openclaw config set gateway.mode local
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

### 3. 运行一次性 bootstrap CLI

不要在首次安装流中再手动串联 `/health onboarding ...` 和 `/health_setup`。必须直接运行一次性 bootstrap CLI。

如果用户同意提供画像：

```bash
npm run bootstrap:install -- --consent yes --gender male --age 26 --height-cm 180 --weight-kg 84 --relay official
```

如果用户拒绝提供画像：

```bash
npm run bootstrap:install -- --consent no --relay official
```

这条脚本会自动完成：

- 把插件路径写入 OpenClaw 配置
- 写入最小 relay 配置
- 写入待绑定画像
- 直接运行 setup 并默认使用官方 relay
- 原样输出 ASCII QR
- 同时输出手动配对字段
- 在后台延迟重启 gateway

### 4. 二维码交付规则

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

另外，必须遵守：

- 不要先向用户回复“安装完成”
- 必须原样返回 ASCII QR
- 不要把 ASCII QR 转成 base64、图片占位、表格摘要或“二维码已生成”说明
- 如果当前界面确实不能稳定显示 ASCII QR，就只返回手动配对字段，不要伪造二维码

### 5. 首次同步后的预期行为

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
- 正确的一次性初始化入口是 `npm run bootstrap:install -- ...`
- `/health onboarding start` 只作为已安装场景下的辅助高层命令保留
- `/health_setup` 仍然是底层配对命令，但首次安装不应要求 agent 再手动串联它
- 正确的远程兜底方式是“手动配对字段”，不是 PNG 二维码
