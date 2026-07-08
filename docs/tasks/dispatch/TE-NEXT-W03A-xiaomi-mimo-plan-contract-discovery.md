# TE-NEXT-W03A - 小米 MiMo 套餐与官方额度能力核验

## 任务 ID

`TE-NEXT-W03A`

## 所属模块

Token 套餐 / 服务商接入前置核验

## 任务目标

为小米 MiMo 建立一份可审计的服务商能力结论：确认官方产品名称、官网域名、可选套餐、每个套餐的额度单位与数量、账号授权方式，以及能否用官方方式读取已用额度、剩余额度和到期时间。

本工单只产出核验报告和机器可读的目录输入，不修改产品代码、不接入未公开接口、不猜测套餐数量。

## 背景

当前设置页将 `source`、套餐名称和额度都作为自由输入。用户希望选择“小米”后自动出现 `Lite`、`Standard`、`Pro`、`Max` 等可用套餐，并自动带出总额度，例如“110 亿 Token”；同时希望绑定其官网账号后实时显示已使用、剩余和到期时间。

现有仓库的 `source` 代表 Agent（例如 `hermes`、`codex`），而小米 MiMo 是模型服务商。后续实现必须使用独立的 `provider_id`，不能把小米错误写成新的 Agent 来源。

截至本工单创建时，项目内不存在小米套餐目录或小米额度适配器；当前 `official_api` 与 `cookie_scrape` 都是占位失败路径。截图中的套餐名和“110 亿”只能视为用户示例，不能当作已确认的官方事实。

## 开始前必读

1. `CLAUDE.md`
2. `docs/token-eyes-dev-plan-v2.md` 第 5 节 H 和第 7 节
3. `src/lib/token-plan-refresh.js`
4. `src/lib/local-api.js` 中 `normalizeTokenPlanRecord`、`readTokenPlanRecords`、`upsertTokenPlanRecord`
5. `dashboard/src/components/settings/TokenPlanSection.jsx`
6. `docs/tasks/dispatch/TE-FULL-F04-token-plan-refresh-risk-acceptance.md`

## 核验范围与证据规则

1. 只接受小米官方域名、官方控制台、官方开发者文档、官方公告或可由账号所有者提供的官方套餐页面截图作为套餐与接口证据。
2. 每一项结论都必须记录证据链接、页面标题、访问日期和截图或原文定位。不可访问的登录后页面可记录“需用户登录后人工确认”，但不能填造内容。
3. 不使用搜索结果摘要、第三方博客、逆向接口、抓包得到的私有接口作为“官方支持”的依据。
4. 不要求用户交付账号密码、浏览器数据库、浏览器导出的完整 Cookie 或开发者工具网络日志。
5. 若官方没有授权接口，不得承诺“实时同步”；结论必须明确标为“无官方实时读取能力”。

## 必须产出

新增以下两个文件，均使用 UTF-8 中文：

- `docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md`
- `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`

目录文件在无法核验任何套餐时也必须存在，但使用空 `plans` 数组；不要写入示例套餐。

目录文件必须符合以下结构：

```json
{
  "provider_id": "xiaomi_mimo",
  "provider_name": "小米 MiMo",
  "official_site": "https://<已核验的官方域名>",
  "catalog_version": "YYYY-MM-DD",
  "evidence": [
    {
      "url": "https://<官方证据链接>",
      "title": "官方页面标题",
      "accessed_at": "YYYY-MM-DD"
    }
  ],
  "plans": [
    {
      "plan_id": "xiaomi_mimo_<官方套餐标识>",
      "display_name": "官方套餐名称",
      "quota": {
        "kind": "fixed_tokens|rolling_window|credits|unknown",
        "total": 0,
        "unit": "tokens|requests|credits|percent",
        "display": "官方原文额度"
      },
      "expires": {
        "kind": "fixed_date|subscription_period|provider_reported|unknown"
      },
      "official_evidence_url": "https://<该套餐官方证据链接>"
    }
  ],
  "account_access": {
    "official_quota_api": false,
    "authorization": "oauth|api_key|console_session|none",
    "usage_endpoint_documented": false,
    "fields_available": ["used_quota", "remaining_quota", "expires_at"],
    "notes": "中文结论"
  }
}
```

约束：

- 仅当官方证据明确给出总额度时，`quota.total` 才可为正数。
- “110 亿 Token”只有在官方证据明确给出相同数值和单位时才可写入；应存成 `11000000000` 与 `tokens`，并保留官方展示文本。
- 官方只说明速率限制、窗口百分比或赠送额度时，必须按真实语义填写 `kind` 和 `unit`，禁止转换成不存在的“总 Token”。
- 未公开的套餐总额度使用 `kind: "unknown"`、`total: 0`、`display: "官网未公布"`。
- `fields_available` 只能列出经过官方文档或登录后官方页面确认可读取的字段。

## 执行步骤

### 步骤 1：确认用户所指的小米产品

优先核对用户提供的官网地址或账号控制台地址。若用户未提供，搜索并比较小米官方 MiMo 产品、开放平台和开发者控制台，记录不能唯一确定产品的原因。

报告必须先给出以下确定项：

```markdown
## 产品标识

- 用户目标产品：
- 官方产品名称：
- 官方站点：
- 是否确认属于小米 MiMo：是 / 否 / 需用户确认
```

若“是否确认属于小米 MiMo”为“需用户确认”，仍可完成其余公开资料核验，但必须把后续接入标为阻塞，不能选择猜测的站点。

### 步骤 2：核验套餐目录

逐一核验 `Lite`、`Standard`、`Pro`、`Max` 是否为该官方产品的真实套餐名称。每个名称记录：是否存在、价格、币种、额度、额度单位、有效期规则和证据 URL。

报告表格固定使用以下列：

| 候选套餐 | 官方存在 | 官方名称 | 总额度 | 单位 | 有效期 | 证据 |
|---|---|---|---:|---|---|---|

不存在或无法核验的项写“未核验”，不要删除该行，也不要填写推测数量。

### 步骤 3：核验授权与额度读取方式

按下面优先级核验，记录请求所需的用户操作、授权范围、可返回字段、令牌有效期和是否有官方撤销入口：

1. 官方 OAuth、设备授权或官方登录回调。
2. 用户在官方控制台创建的只读 API Key 或访问令牌。
3. 官方文档明确允许的会话凭证导入。
4. 无官方方式。

禁止把“登录官网后浏览器页面能显示数据”推导为“存在可用 API”。只有文档或稳定官方页面明确提供的能力才可列为可自动刷新。

### 步骤 4：生成目录输入并自检

按“必须产出”的 JSON 结构生成目录文件，并执行：

```powershell
Get-Content -Raw -Encoding UTF8 src/lib/token-plan-catalog/xiaomi-mimo.catalog.json | ConvertFrom-Json | Out-Null
```

预期：命令退出码为 `0`。

再人工确认：每个 `plans` 项都有官方证据 URL，或目录完全为空；不存在示例数值、账号、Cookie、API Key 或密码。

## 验收标准

1. 报告能唯一说明目标是否为小米 MiMo；不能唯一说明时，明确给出需要用户提供的唯一信息。
2. `Lite`、`Standard`、`Pro`、`Max` 四项均有“已核验”或“未核验”结论。
3. 每一个正数额度都有一条官方证据；没有证据就不填正数。
4. 报告明确判断官方是否支持读取 `used_quota`、`remaining_quota`、`expires_at`。
5. 目录 JSON 可被 PowerShell 成功解析，且不含任何秘密信息。
6. 未修改 `src/`、`dashboard/`、`src-tauri/` 产品代码。

## 禁止事项

- 不在任何文件中保存密码、Cookie、访问令牌、二维码内容或账号标识。
- 不调用未公开接口、不要求绕过验证码或风控、不自动读取浏览器 Cookie。
- 不把第三方平台代理套餐、OpenRouter 定价或模型 API 按量价格当作小米订阅套餐。
- 不把 Agent `source` 与模型服务商混为同一个字段。

## 完成后报告

回复时必须包含：官方站点结论、套餐核验表、官方实时额度能力结论、目录文件路径、验证命令输出和是否阻塞。若阻塞，只说明需要用户提供的官网 URL 或登录后官方套餐页截图。
