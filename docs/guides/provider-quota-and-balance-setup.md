# 供应商额度与余额检测配置指南

> 适用版本:0.54.40-V3 及以上。本文面向最终用户,按「你要看什么数据」分三部分:
>
> 1. **API 余额**(账户里还有多少钱)——设置 → 成本 → 供应商 API 余额
> 2. **Token 套餐额度**(订阅套餐用了多少)——设置 → Token 套餐
> 3. **官方限额**(Claude/Codex 等 CLI 的 5h/周限额)——「限额」页,自动检测
>
> 隐私说明:所有凭据只保存在你自己电脑的系统凭据库(Windows 凭据管理器 / macOS 钥匙串)中,Token Eyes 只调用各家官方「余额/用量查询」接口,不代理任何模型调用,也不上传密钥。

---

## 1. API 余额检测(设置 → 成本 → 供应商 API)

点「新增」,在「API 模式」里选择对应供应商,填入凭据后「测试」即可。各家凭据获取方式:

### 1.1 DeepSeek

| 项目 | 内容 |
|---|---|
| 需要什么 | DeepSeek 开放平台 API Key |
| 获取步骤 | [platform.deepseek.com](https://platform.deepseek.com/) → 左侧「API Keys」→ 创建 API Key(`sk-` 开头) |
| 界面配置 | API 模式选 **DeepSeek**,粘贴 API Key,保存 → 测试 |
| 展示字段 | 可用余额(`balance_infos` 按币种合并)、币种 |
| 常见错误 | `401 未授权`:Key 复制不完整或已删除;余额为 0 且新账号:未充值属正常 |

### 1.2 阿里云(千问 / 百炼)

| 项目 | 内容 |
|---|---|
| 需要什么 | 阿里云 AccessKey ID + AccessKey Secret(**建议 RAM 子账号 + 只读权限**) |
| 获取步骤 | [RAM 控制台](https://ram.console.aliyun.com/) → 创建 RAM 用户(仅编程访问)→ 授权策略 **AliyunBSSReadOnlyAccess** → 创建 AccessKey |
| 界面配置 | API 模式选 **Alibaba Cloud / Qwen**,分别填入 AccessKey ID / Secret,保存 → 测试 |
| 展示字段 | 账户可用余额(`Data.AvailableAmount`)、币种(CNY) |
| 注意 | 查询的是**阿里云账户级余额**(BSS 计费中心),不是百炼单产品余额;主账号 AccessKey 权限过大,强烈建议用只读 RAM 子账号 |
| 常见错误 | `InvalidAccessKeyId`:ID 抄错;`Forbidden`:RAM 用户没授 BSS 只读权限 |

### 1.3 火山引擎(豆包 / Ark)

| 项目 | 内容 |
|---|---|
| 需要什么 | 火山引擎 Access Key ID + Secret Access Key(**建议子用户 + 账单只读**) |
| 获取步骤 | [火山引擎控制台](https://console.volcengine.com/) → 访问控制 IAM → 新建子用户 → 授权 **BillingReadOnlyAccess** → 密钥管理里创建 AK/SK |
| 界面配置 | API 模式选 **Volcengine / Doubao**,分别填入 AK / SK,保存 → 测试 |
| 展示字段 | 可用余额(`Result.AvailableBalance`)、币种(CNY) |
| 注意 | 查询的是火山引擎账户余额(QueryBalanceAcct),豆包/Ark 的按量消费从该余额扣减 |
| 常见错误 | 签名失败:AK/SK 有一个填错;`AccessDenied`:子用户缺账单只读授权 |

### 1.4 Moonshot(Kimi 开放平台)

| 项目 | 内容 |
|---|---|
| 需要什么 | Moonshot 开放平台 API Key |
| 获取步骤 | [platform.moonshot.cn](https://platform.moonshot.cn/) → API Key 管理 → 新建 |
| 界面配置 | API 模式选 **Kimi**,粘贴 API Key |
| 展示字段 | 可用余额(`data.available_balance`) |

### 1.5 智谱 GLM / MiniMax / 小米 MiMo(官方控制台授权)

这三家没有公开的「余额查询 API Key」,采用**官方控制台登录授权**:

1. API 模式选择对应供应商,保存配置。
2. 点「测试」→ 桌面端会弹出该供应商官网登录窗口。
3. 用你的账号正常登录(支持扫码/短信),登录成功后窗口自动关闭,余额同步显示。

登录态只保存在桌面应用本地;失效后重新点「测试」再登录一次即可。

### 1.6 其他供应商(自定义模式)

任何提供「GET 余额查询接口 + Bearer/Header 鉴权」的供应商都可以用**自定义**模式接入:填请求 URL、鉴权方式、响应字段路径(如 `data.balance`)。出于安全,系统会拒绝把密钥拼进 URL 的配置,也不允许配置模型调用类端点。

---

## 2. Token 套餐额度检测(设置 → Token 套餐)

「新增套餐」→ 选择供应商 → 按下表接入。凡是「本机登录态」方式,只要你在该工具里登录过,Token Eyes 就能自动读到,无需再填任何东西。

| 供应商 | 检测方式 | 你需要做什么 |
|---|---|---|
| 智谱 GLM Coding Plan | Coding Plan API Key | 在 [bigmodel.cn](https://open.bigmodel.cn/) 获取 Coding Plan 专用 Key 填入;或用官网登录同步 |
| **ZCode(新)** | **本机登录态** | 在本机 ZCode CLI 里登录过即可,自动读取 `~/.zcode` 凭据并查询官方套餐余额 |
| Kimi | 本机登录态 / 控制台 | 本机 Kimi CLI 登录过即可 |
| MiniMax | 官方控制台登录 | 点「连接并同步」扫码登录 |
| 阿里云百炼 | API Key | 填百炼 API Key |
| Codex / Claude / Cursor | 本机登录态 / 官网登录 | CLI/IDE 登录过即可;Cursor 也可点「连接并同步」走官网 |
| Trae / 小米 MiMo | 官方控制台登录(桌面端) | 桌面端弹窗登录 |

### ZCode 说明与排查

- 数据来源:官方 `zcode-plan/billing/balance` 接口,按模型汇总「总额度 / 已用 / 剩余」,重置时间取各模型周期最早的一个。
- 凭据:读取本机 `~/.zcode/v2/credentials.json` 中的登录令牌(ZCode 自己加密存储,Token Eyes 只在刷新时解密使用,不落盘、不上传)。
- 报「未检测到 ZCode 本地登录」:先在终端运行 ZCode 并完成登录。
- 报「无法解密本地凭据」:设置过 `ZCODE_CREDENTIAL_SECRET` 环境变量的话,确保 Token Eyes 运行环境里也能读到同一变量;仍失败可设 `TOKENTRACKER_ZCODE_JWT` 环境变量直接提供令牌(高级用法)。
- 报「登录已失效」:在 ZCode 里重新登录后刷新。

---

## 3. 官方限额检测(「限额」页)

以下工具在本机登录过即自动显示,无需配置:Claude、Codex、Cursor、Kimi、Gemini、Kiro、Antigravity、GitHub Copilot、Grok,以及本轮新增的 **Zed**。

### Zed 说明与排查

- 显示内容:**Token 消费**(本计费周期已用/上限,来自 Zed 订阅的 token spend 额度)与**编辑预测**(edit predictions 次数),以及套餐名(Pro/Free)。
- 凭据来源:Zed 编辑器登录后保存在系统凭据库的令牌(macOS 钥匙串 `zed.dev` / Windows 凭据管理器 `zed:url=https://zed.dev`),Token Eyes 只读、不修改。
- 不显示:先在 Zed 编辑器里 Sign in;Linux 下暂不支持自动读取,可设 `TOKENTRACKER_ZED_USER_ID` + `TOKENTRACKER_ZED_ACCESS_TOKEN` 环境变量。
- 报「Not signed in to Zed」:令牌过期,在 Zed 编辑器里重新登录。

---

## 常见问题

**Q:填了 Key 之后显示「不支持」?**
该供应商对应字段(如月消费/累计消费)官方接口不提供,属正常;卡片会明确标出哪些字段不支持。

**Q:余额多久刷新一次?**
默认 5 分钟自动刷新,可在配置里改(60 秒 ~ 24 小时);也可手动点「刷新」。

**Q:删除配置后密钥还在吗?**
删除配置会同时从系统凭据库删除对应密钥;也可以单独点密钥旁的撤销按钮只删密钥保留配置。
