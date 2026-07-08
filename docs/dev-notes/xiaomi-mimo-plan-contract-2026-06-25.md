# 小米 MiMo Token Plan 服务商能力核验报告

- 任务 ID：TE-NEXT-W03A
- 核验日期：2026-06-25
- 核验人：Claude Code
- 核验范围：官方产品名称、官网域名、可选套餐、额度单位与数量、授权方式、官方额度读取能力

---

## 产品标识

- 用户目标产品：小米 MiMo Token Plan（AI 编程场景订阅套餐）
- 官方产品名称：Xiaomi MiMo Token Plan
- 官方站点：
  - 文档站：https://mimo.mi.com/docs/ （mi.com 二级域名，小米官方）
  - 开放平台控制台：https://platform.xiaomimimo.com/ （xiaomimimo.com 域名，小米官方运营）
  - Token Plan 购买页：https://platform.xiaomimimo.com/token-plan
- 是否确认属于小米 MiMo：**是**

### 核验依据

1. `mimo.mi.com` 为小米集团官方域名（mi.com 是小米官方主域名）
2. 官方博客 https://mimo.xiaomi.com 发布的 MiMo-V2.5-Pro-UltraSpeed 公告
3. 官方 GitHub 组织：XiaomiMiMo（https://github.com/XiaomiMiMo/MiMo）
4. 官方文档明确标注 "Xiaomi MiMo API 开放平台"

---

## 套餐目录核验

以下数据基于 2026 年 5 月 27 日全面升级后的最新套餐体系（官方称为"Credits 用量焕新重置"，额度提升 5-8 倍，价格不变）。

| 候选套餐 | 官方存在 | 官方名称 | 总额度 | 单位 | 有效期 | 证据 |
|---|---|---|---:|---|---|---|
| Lite | 是 | Lite | 4,100,000,000 | Credits | 月付/年付 | [官方文档 - Token Plan](https://mimo.mi.com/docs/zh-CN/price/token-plan) |
| Standard | 是 | Standard | 11,000,000,000 | Credits | 月付/年付 | [官方文档 - Token Plan](https://mimo.mi.com/docs/zh-CN/price/token-plan) |
| Pro | 是 | Pro | 38,000,000,000 | Credits | 月付/年付 | [官方文档 - Token Plan](https://mimo.mi.com/docs/zh-CN/price/token-plan) |
| Max | 是 | Max | 82,000,000,000 | Credits | 月付/年付 | [官方文档 - Token Plan](https://mimo.mi.com/docs/zh-CN/price/token-plan) |

### 月度套餐定价

| 套餐 | 人民币定价 | 美元定价 | 月度 Credit 额度 |
|---|---:|---:|---:|
| Lite | ¥39/月 | $6/月 | 4.1B (41亿) |
| Standard | ¥99/月 | $16/月 | 11B (110亿) |
| Pro | ¥329/月 | $50/月 | 38B (380亿) |
| Max | ¥659/月 | $100/月 | 82B (820亿) |

### 年度套餐定价

| 套餐 | 人民币定价 | 美元定价 | 年度 Credit 额度 |
|---|---:|---:|---:|
| Lite | ¥411.84/年 | $63.36/年 | 49.2B (492亿) |
| Standard | ¥1045.44/年 | $168.96/年 | 132B (1320亿) |
| Pro | ¥3474.24/年 | $528.00/年 | 456B (4560亿) |
| Max | ¥6959.04/年 | $1056.00/年 | 984B (9840亿) |

### 重要说明：额度单位是 Credits，不是 Tokens

小米 MiMo Token Plan 使用 **Credits** 作为额度单位，**不是直接的 Token 数量**。不同模型按不同比例消耗 Credits：

| 模型 | 输入（命中缓存） | 输入（未命中缓存） | 输出 |
|---|---:|---:|---:|
| mimo-v2.5-pro | 2.5 Credits / Token | 300 Credits / Token | 600 Credits / Token |
| mimo-v2.5 | 2 Credits / Token | 100 Credits / Token | 200 Credits / Token |
| mimo-v2.5-asr | — | 30M Credits / 小时 | — |
| mimo-v2.5-tts 系列 | 限时免费 | 限时免费 | 限时免费 |

因此，**不能将 Credits 直接等同于 Token 数量**。"110 亿 Token" 的说法是不准确的——Standard 套餐是 110 亿 Credits，按不同模型消耗比例折算成 Token 数量会有很大差异。

### 其他套餐规则

- **夜间优惠**：北京时间 0:00-8:00 消耗系数 0.8x
- **首购优惠**：首次购买享 88 折
- **连续包年**：相比连续包月享 88 折
- **补差价升级**：支持在套餐有效期内补差价升级到更高档套餐
- **自动续费**：支持自动续费功能
- **额度耗尽**：套餐额度用完后停止服务，不会自动转按量计费
- **支持模型**：mimo-v2.5-pro、mimo-v2.5、mimo-v2.5-asr、mimo-v2.5-tts 系列等共 9 款模型

---

## 授权与额度读取方式核验

### 1. 授权方式

| 方式 | 官方支持 | 说明 |
|---|---|---|
| OAuth | 否 | 官方文档未提及 OAuth 授权流程 |
| API Key | 是 | 支持在控制台创建 API Key（格式：sk-xxxxx 用于按量付费，tp-xxxxx 用于 Token Plan） |
| 控制台会话（Cookie/Session） | 间接支持 | 需登录控制台后在网页查看，无官方文档化的会话凭证导入方式 |
| 其他 | 否 | 需使用小米账号登录开放平台 |

**注意区分：**
- **模型推理授权方式**：`api_key`（API Key 用于调用模型推理接口）
- **Token Plan 额度同步授权方式**：`none`（无官方文档化的额度查询 API，API Key 不能用于读取套餐额度）

### 2. 额度读取能力

按优先级逐一核验：

#### 优先级 1：官方 OAuth / 设备授权 / 登录回调

- 官方文档中未发现任何 OAuth 2.0 授权、设备码授权或第三方登录回调机制。
- **结论：不支持。**

#### 优先级 2：官方只读 API Key / 访问令牌查询额度

- 官方 API 文档（https://mimo.mi.com/docs/）仅包含模型推理接口（Chat Completions、Audio 等）的 OpenAI/Anthropic 兼容协议。
- 未发现任何文档化的 REST API 端点（如 `/usage`、`/quota`、`/billing`）用于查询账户余额、已用额度、剩余额度或到期时间。
- API Key 仅用于调用模型推理接口，不具备查询账户信息的权限范围。
- **结论：无官方文档化的额度查询 API。**

#### 优先级 3：官方文档明确允许的会话凭证导入

- 官方文档提到"在用量信息页面，您可以按照日期查看、导出账号的模型 Tokens 用量及请求次数详细数据"（位置：控制台 → 用量信息）。
- 但这是网页端人工查看功能，没有任何官方文档说明支持通过导入 Cookie/Session 来程序化读取。
- **结论：无官方文档化的会话凭证导入方式。**

#### 优先级 4：登录后控制台人工查看

- 登录 https://platform.xiaomimimo.com/#/console/plan-manage 可在"订阅管理"页面查看当前套餐的额度、用量和有效期。
- 登录 https://platform.xiaomimimo.com/#/console/usage 可查看详细的 Token 消耗和请求统计数据，支持按日期筛选和导出。
- 这是人工操作，不属于可程序化自动刷新的官方能力。
- **结论：仅支持登录后人工查看，不支持程序化自动读取。**

### 官方实时额度能力结论

| 字段 | 官方是否支持自动读取 | 说明 |
|---|---|---|
| used_quota（已用额度） | 否 | 无官方 API，仅可登录控制台人工查看 |
| remaining_quota（剩余额度） | 否 | 无官方 API，仅可登录控制台人工查看 |
| expires_at（到期时间） | 否 | 无官方 API，仅可登录控制台人工查看 |

**最终结论：无官方实时读取能力。**

- `official_quota_api`: **false**
- `authorization`: **none**（Token Plan 额度同步无官方授权方式；API Key 仅用于模型推理调用，不能用于查询额度）
- `usage_endpoint_documented`: **false**
- `fields_available`: `[]`（空数组，无可通过官方 API 读取的字段）

---

## 证据清单

| 证据 URL | 页面标题 | 访问日期 | 内容摘要 |
|---|---|---|---|
| https://mimo.mi.com/docs/zh-CN/price/token-plan | Token Plan - 小米 MiMo 文档 | 2026-06-25 | 官方 Token Plan 定价与套餐详情，包含 Lite/Standard/Pro/Max 四档套餐的 Credit 额度、定价、消耗规则 |
| https://platform.xiaomimimo.com/token-plan | Xiaomi MiMo Token Plan | 2026-06-25 | Token Plan 购买页面，展示四档套餐价格与额度 |
| https://mimo.mi.com/docs/zh-CN/quick-start/summary/first-api-call | 首次调用 API - 小米 MiMo 文档 | 2026-06-25 | API 接入指南，说明 API Key 获取方式和两种使用模式（按量付费 / Token Plan） |
| https://mimo.mi.com/docs/zh-CN/api/guidance/rate-limit | 速率限制 - 小米 MiMo 文档 | 2026-06-25 | 限流说明，列出 RPM/TPM 限制，未提及额度查询 API |
| https://mimo.xiaomi.com/blog/mimo-tilert-1000tps | MiMo-V2.5-Pro-UltraSpeed 官方博客 | 2026-06-25 | 小米官方博客发布的技术公告，佐证 mimo.xiaomi.com 为小米官方域名 |

---

## 阻塞判定

### 是否阻塞后续接入？

**不阻塞静态套餐目录录入，但阻塞自动刷新功能实现。**

- ✅ 静态套餐信息（套餐名、定价、Credit 总额度）有充分官方证据，可录入目录供用户选择。
- ❌ 自动刷新已用额度、剩余额度、到期时间的功能**无法实现**，因为小米没有提供官方 API。
- 🚫 小米 MiMo 当前没有可用于额度同步的官方授权接口。产品仅支持静态套餐目录与用户手工更新额度；不实现自动浏览器 Cookie 抓取。

### 后续可用路径

当前仅支持：
1. 用户从目录中选择套餐，自动带出总额度
2. 用户手工录入已用额度、剩余额度和到期时间

暂无官方支持的自动刷新路径。

---

## 附注：关于"110 亿 Token"的澄清

用户示例中提到的"110 亿 Token"需要澄清：

1. Standard 套餐的官方额度是 **110 亿 Credits**，不是 110 亿 Tokens。
2. Credits 与 Tokens 的换算比例因模型而异：
   - 用 mimo-v2.5（1x 基准），在缓存命中率较高的场景下，可能接近 110 亿 Token 的量级
   - 用 mimo-v2.5-pro（2x-3x 消耗），实际可用 Token 数量会明显减少
3. 因此，目录中 `quota.total` 存储的是 **Credits 数量**，`quota.unit` 为 `"credits"`，`quota.display` 保留官方原文"11,000,000,000（11B）Credits"。
4. 不建议将 Credits 硬折算成 Token 数量后展示给用户，因为这会产生误导。
