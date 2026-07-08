# TE-NEXT-W03A-R1 - 小米 MiMo 套餐目录契约修正

## 任务 ID

`TE-NEXT-W03A-R1`

## 所属模块

Token 套餐 / 小米 MiMo 核验数据返工

## 任务目标

修正 W03A 的两处数据语义错误和一处安全结论冲突，使目录可以被 W03B 安全消费：

1. 小米套餐额度是固定 `Credits`，不是固定 `Tokens`。
2. 小米 API Key 可用于模型推理，但不能授权读取套餐额度；额度同步授权方式必须是 `none`。
3. 产品不支持自动浏览器 Cookie 抓取，报告不得把它描述为可继续实施的解决路径。

本工单只修改 W03A 的报告和 JSON 目录，不修改产品代码、不增加凭证保管、不实现接口调用。

## 已确认事实

以下官方文档页可访问且显示月度/年度 Lite、Standard、Pro、Max 套餐及 Credit 额度：

- `https://mimo.mi.com/docs/zh-CN/price/token-plan`

2026-06-25 的独立页面复核确认，该页面包含：

- 月度 Standard：`11,000,000,000 (11B) Credits`；
- 年度 Standard：`132,000,000,000 (132B) Credits`；
- Lite、Pro、Max 以及 Credits 作为额度单位。

W03A 同时确认不存在官方文档化的额度读取 API；因此 API Key 不能视为 Token Plan 额度同步的账号授权。

## 开始前必读

1. `CLAUDE.md`
2. `docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md`
3. `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`
4. `docs/tasks/dispatch/TE-NEXT-W03A-xiaomi-mimo-plan-contract-discovery.md`
5. `docs/tasks/dispatch/TE-NEXT-W03B-token-plan-provider-catalog-and-form.md`
6. `docs/tasks/dispatch/TE-NEXT-W03C-token-plan-credential-vault-and-account-authorization.md`
7. `docs/tasks/dispatch/TE-NEXT-W03D-xiaomi-mimo-live-quota-adapter.md`

## 允许修改的文件

- 修改：`docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md`
- 修改：`src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`

不得修改 `src/`、`dashboard/`、`src-tauri/` 的产品代码、测试或现有其他工单。

## 必须修改

### 1. 修正全部套餐的额度类型

目录中 8 个套餐的：

```json
"kind": "fixed_tokens",
"unit": "credits"
```

必须统一改为：

```json
"kind": "credits",
"unit": "credits"
```

不得更改任意 `total`、`display`、`plan_id`、`official_evidence_url` 或月付/年付名称。

### 2. 修正额度同步授权结论

将目录的：

```json
"authorization": "api_key"
```

改为：

```json
"authorization": "none"
```

在 `notes` 中保留以下准确说明：小米 API Key 可用于模型推理调用，但没有官方文档化的额度查询能力，因此不能用于读取 `used_quota`、`remaining_quota`、`expires_at`。

同时修改报告的授权结论：

- 可以保留“模型推理支持 API Key”的事实；
- 必须明确“Token Plan 额度同步授权方式为 `none`”；
- 不得再写“结论：授权方式为 `api_key`”而没有限定用途。

### 3. 移除 Cookie 抓取推荐

修改报告“阻塞判定”和目录 `notes` 中的相关表述：

1. 删除“当前只能走 `cookie_scrape` 路径”的建议。
2. 删除要求用户确认是否接受 Cookie 抓取的事项。
3. 改为：

```text
小米 MiMo 当前没有可用于额度同步的官方授权接口。产品仅支持静态套餐目录与用户手工更新额度；不实现自动浏览器 Cookie 抓取。
```

不得增加“手动导入 Cookie”或“浏览器抓取”的替代描述。

## 验证

执行：

```powershell
$catalog = Get-Content -Raw -Encoding UTF8 src/lib/token-plan-catalog/xiaomi-mimo.catalog.json | ConvertFrom-Json

if ($catalog.account_access.official_quota_api -ne $false) {
  throw '官方额度 API 状态错误'
}

if ($catalog.account_access.authorization -ne 'none') {
  throw '额度同步授权方式必须为 none'
}

$invalidPlans = @($catalog.plans | Where-Object {
  $_.quota.kind -ne 'credits' -or $_.quota.unit -ne 'credits' -or [int64]$_.quota.total -le 0 -or -not $_.official_evidence_url
})

if ($invalidPlans.Count -ne 0) {
  throw "发现 $($invalidPlans.Count) 个无效套餐目录项"
}

Write-Output "目录验证通过：$($catalog.plans.Count) 个 Credits 套餐，额度同步授权为 none。"
```

预期输出：

```text
目录验证通过：8 个 Credits 套餐，额度同步授权为 none。
```

再执行：

```powershell
$cookieLines = @(rg -n -i 'cookie_scrape|Cookie 抓取|当前只能走' docs/dev-notes/xiaomi-mimo-plan-contract-2026-06-25.md src/lib/token-plan-catalog/xiaomi-mimo.catalog.json)
$unsafeCookieLines = @($cookieLines | Where-Object {
  $_ -notmatch '不实现自动浏览器 Cookie 抓取'
})

if ($unsafeCookieLines.Count -ne 0) {
  $unsafeCookieLines
  throw '发现自动 Cookie 抓取推荐或实现文案'
}

Write-Output 'Cookie 文案检查通过：仅保留明确禁用说明。'
```

预期：命中项只能是“不实现自动浏览器 Cookie 抓取”的禁用说明。若出现其他命中，必须删除会建议、接受、启用或实现自动 Cookie 抓取的文案后重新验证。

## 验收标准

1. 目录 JSON 可被 `ConvertFrom-Json` 解析。
2. 8 个套餐均为 `kind: "credits"`、`unit: "credits"`，且各自保留官方证据 URL。
3. `official_quota_api` 为 `false` 时，`authorization` 必须为 `none`。
4. 报告明确区分“模型推理 API Key”和“套餐额度同步授权”。
5. 报告与目录不再推荐、实现或接受自动浏览器 Cookie 抓取。
6. 不存在产品代码改动。

## 完成后报告

回复修改文件列表、两条验证命令的完整结果、目录套餐数量，以及确认 W03B 可开始、W03C/W03D 仍因没有官方额度 API 不可开始。
