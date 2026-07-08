# TE-NEXT-W03-R3：Token 套餐服务商内置检测方式重构调度

## 用户需求基线

本工单组以用户在 2026-06-25 确认的产品结构为准：

- 整个模块仍是 `Token 套餐`。
- 不要在主界面单独放一个“小米 MiMo 控制台连接”卡片。
- 小米 MiMo 只是在 `新增套餐` 表单里的一个服务商选项。
- 用户点击 `新增套餐` 后，在表单中选择：
  - `Agent 来源`
  - `服务商`
  - `套餐`
  - `检测方式`
- 检测方式必须支持两个并存方案：
  - 方案 1：官网账号登录检测。
  - 方案 2：自定义 API 检测。
- 两个方案都服务于“检测套餐状态 / 实时或准实时同步状态”，不是手动录入额度。

## 当前偏差

当前实现方向把“小米 MiMo 控制台连接”放成了 Token 套餐主界面的独立卡片。这不符合用户要求。

正确方向是：

- 服务商选择 `xiaomi_mimo` 后，表单内出现小米相关套餐和检测方式。
- 小米官网账号连接只作为该套餐记录的一种检测方式。
- 自定义 API 配置也作为该套餐记录的一种检测方式。

## 数据与 UI 目标

每条 Token 套餐记录最终应能表达：

| 字段 | 说明 |
|---|---|
| Agent 来源 | 哪个 Agent 使用该套餐，例如 Hermes |
| 服务商 | 例如 `xiaomi_mimo` |
| 套餐 | 例如 Lite / Standard / Pro / Max |
| 总额度 | 来自已核验目录或检测结果 |
| 已用额度 | 来自官网账号检测或自定义 API 检测 |
| 剩余额度 | 来自检测结果，或由总额度减已用额度计算并标明 |
| 到期时间 | 来自检测结果 |
| 检测方式 | `官网账号登录检测` 或 `自定义 API 检测` |
| 最后同步时间 | 最近一次检测成功或失败的时间 |
| 同步状态 | 未配置 / 等待授权 / 同步中 / 同步成功 / 同步失败 / 需重新授权 |
| 失败原因 | 可读中文原因 |

## 工单拆分

## 独立工单文件

本组工单已拆成 4 个可直接派发的独立文件：

| 任务ID | 工单文件 | 执行关系 |
|---|---|---|
| W03-R3A | `docs/tasks/dispatch/TE-NEXT-W03-R3A-token-plan-detection-contract.md` | 串行前置，先执行 |
| W03-R3B | `docs/tasks/dispatch/TE-NEXT-W03-R3B-token-plan-form-provider-detection.md` | 等 R3A 后可与 R3C 并行 |
| W03-R3C | `docs/tasks/dispatch/TE-NEXT-W03-R3C-custom-api-detection-config.md` | 等 R3A 后可与 R3B 并行 |
| W03-R3D | `docs/tasks/dispatch/TE-NEXT-W03-R3D-token-plan-sync-integration-acceptance.md` | 等 R3B/R3C 后串行执行 |

### W03-R3A：Token 套餐检测方式数据模型与接口契约

目标：

- 明确 Token 套餐记录的数据模型。
- 新增检测方式相关字段，但不保存明文敏感信息。
- 定义两种检测方式统一输出的状态结构。

建议字段：

```json
{
  "detection_method": "official_account | custom_api",
  "official_account": {
    "provider_home_url": "https://platform.xiaomimimo.com/token-plan",
    "account_binding_id": ""
  },
  "custom_api": {
    "api_key_ref": "",
    "api_format": "json | openai_compatible | custom_mapping",
    "request_url": "",
    "official_url": "",
    "response_mapping": {}
  },
  "sync_status": "not_configured | auth_required | syncing | success | failed | reauth_required",
  "last_synced_at": "",
  "last_error_code": "",
  "last_error_message": ""
}
```

验收：

- 数据模型文档清楚说明哪些字段可落盘，哪些必须走本机凭证引用。
- 本地 API 不接受明文 Cookie、账号密码、Bearer token 作为长期保存字段。
- 旧记录读取不丢失。

### W03-R3B：Token 套餐表单重构

目标：

- 移除主界面的独立“小米 MiMo 控制台连接”卡片。
- 在 `新增套餐` 表单中，当服务商选择 `xiaomi_mimo` 后显示：
  - 套餐下拉：Lite / Standard / Pro / Max，具体以已核验目录为准。
  - 检测方式选择：官网账号登录检测 / 自定义 API 检测。
- 方案 1 区域显示“跳转官网登录 / 连接账号 / 检测状态”入口。
- 方案 2 区域显示 API Key、API 格式、请求地址、官网链接输入项和检测按钮。

验收：

- Token 套餐主界面没有独立小米连接卡片。
- 小米相关连接入口只在新增/编辑小米套餐记录时出现。
- 选择其他服务商时不显示小米专属内容。
- 所有中文 UI 文案进入 `dashboard/src/content/copy.csv`。

### W03-R3C：自定义 API 检测配置

目标：

- 支持用户为套餐配置自定义 API 检测。
- 用户输入：
  - API Key
  - API 格式
  - 请求地址
  - 官网链接
- 提供“检测套餐状态”按钮。
- 检测结果映射为统一状态字段：总额度、已用额度、剩余额度、到期时间。

安全要求：

- API Key 不得明文写入普通配置文件。
- 如果当前项目还没有本机安全凭证库，先保存 `api_key_ref`，并把凭证保存能力作为阻塞或子任务明确说明，不允许假装已安全保存。
- 请求失败必须显示失败原因。

验收：

- API Key 明文不会出现在接口响应、日志、测试快照、前端列表。
- 自定义 API 返回 fixture 能被解析为套餐状态。
- 请求失败、格式错误、映射缺失都有清晰中文错误。

### W03-R3D：两种检测方式统一同步与验收

目标：

- 方案 1 和方案 2 共用统一的同步状态展示。
- 每条套餐记录显示：
  - 总额度
  - 已用额度
  - 剩余额度
  - 到期时间
  - 检测方式
  - 最后同步时间
  - 同步状态
  - 失败原因
- 方案 1 使用官网账号授权后的真实数据源。
- 方案 2 使用用户提供的 API 配置。

前置：

- `W03-R3B` 完成表单整合。
- `W03-R3C` 完成自定义 API 检测。
- 方案 1 需要已有可复现的小米官网/控制台数据源；若没有，只能显示“官网账号检测暂阻塞”，不能伪造同步成功。

验收：

- 两种检测方式都能落到同一套状态 UI。
- 没有检测配置时提示用户选择检测方式。
- 检测失败时不清空上次成功数据。
- 不允许手动录入作为主路径。

## 执行顺序与并行

推荐顺序：

1. `W03-R3A`
2. `W03-R3B` 与 `W03-R3C` 可并行
3. `W03-R3D`

并行规则：

- `W03-R3A` 是前置，必须先完成。
- `W03-R3B` 与 `W03-R3C` 可以交给两个 Claude Code 对话并行执行。
- `W03-R3D` 不可并行，必须等 B/C 完成，并且方案 1 的数据源探测有明确结论。

## 飞书同步状态

本工单应新增到飞书 `Token Eyes 进度表 / V2.1工单`：

| 任务ID | 所属模块 | 任务标题 | 任务归属 | 负责执行方 | 状态 | 当前阶段 | 前置任务 | 工单文件 | 验收标准摘要 |
|---|---|---|---|---|---|---|---|---|---|
| W03-R3A | Token 套餐 | Token 套餐检测方式数据模型与接口契约 | Codex任务 | Codex | 待分派 | 设计 | W03-R2 | docs/tasks/dispatch/TE-NEXT-W03-R3A-token-plan-detection-contract.md | 明确官网账号检测与自定义 API 检测的统一数据模型 |
| W03-R3B | Token 套餐 | Token 套餐表单重构与小米入口内聚 | Claude Code任务 | Claude Code | 待分派 | 前端实现 | W03-R3A | docs/tasks/dispatch/TE-NEXT-W03-R3B-token-plan-form-provider-detection.md | 移除独立小米卡片，把连接入口并入新增/编辑套餐表单 |
| W03-R3C | Token 套餐 | 自定义 API 检测配置与状态解析 | Claude Code任务 | Claude Code | 待分派 | 后端+前端实现 | W03-R3A | docs/tasks/dispatch/TE-NEXT-W03-R3C-custom-api-detection-config.md | 支持 API Key/API格式/请求地址/官网链接并检测套餐状态 |
| W03-R3D | Token 套餐 | 双检测方式统一同步状态与端到端验收 | Claude Code任务 | Claude Code | 待分派 | 集成验收 | W03-R3B,W03-R3C | docs/tasks/dispatch/TE-NEXT-W03-R3D-token-plan-sync-integration-acceptance.md | 两种检测方式共用额度、同步时间、失败原因展示 |

当前自动同步阻塞：飞书 API 返回 `app secret invalid`，需要更新 `.env` 中飞书应用密钥后补同步。
