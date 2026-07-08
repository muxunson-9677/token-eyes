# TE-NEXT-W03-R3 飞书进度表同步记录

## 同步目标

目标表：

- 飞书空间：Token Eyes 进度表
- 表名：V2.1工单
- 本地配置文件：`.env`
- 配置说明：`docs/feishu-setup.md`

## 本轮需要新增或更新的记录

| 任务ID | 模块ID | 所属模块 | 任务标题 | 任务归属 | 负责执行方 | 派发对象 | 状态 | 当前阶段 | 前置任务 | 工单文件 | 验收标准摘要 | 进度说明 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| W03-R3A | W03 | Token 套餐 | Token 套餐检测方式数据模型与接口契约 | Codex任务 | Codex | Codex | 待分派 | 设计 | W03-R2 | docs/tasks/dispatch/TE-NEXT-W03-R3A-token-plan-detection-contract.md | 明确官网账号检测与自定义 API 检测的统一数据模型 | 等待新对话开始后执行 |
| W03-R3B | W03 | Token 套餐 | Token 套餐表单重构与小米入口内聚 | Claude Code任务 | Claude Code | Claude Code | 待分派 | 前端实现 | W03-R3A | docs/tasks/dispatch/TE-NEXT-W03-R3B-token-plan-form-provider-detection.md | 移除独立小米卡片，把连接入口并入新增/编辑套餐表单 | 可在 W03-R3A 后派发 |
| W03-R3C | W03 | Token 套餐 | 自定义 API 检测配置与状态解析 | Claude Code任务 | Claude Code | Claude Code | 待分派 | 后端+前端实现 | W03-R3A | docs/tasks/dispatch/TE-NEXT-W03-R3C-custom-api-detection-config.md | 支持 API Key、API 格式、请求地址、官网链接并检测套餐状态 | 可在 W03-R3A 后与 W03-R3B 并行 |
| W03-R3D | W03 | Token 套餐 | 双检测方式统一同步状态与端到端验收 | Claude Code任务 | Claude Code | Claude Code | 待分派 | 集成验收 | W03-R3B,W03-R3C | docs/tasks/dispatch/TE-NEXT-W03-R3D-token-plan-sync-integration-acceptance.md | 两种检测方式共用额度、同步时间、失败原因展示 | 等 B/C 完成后执行 |

## 自动同步结果

自动同步未完成。

调用飞书开放平台获取 `tenant_access_token` 时返回：

```text
app secret invalid
```

判断：

- 当前 `.env` 中的 `FEISHU_APP_SECRET` 已失效，或不是当前 `Token Eyes 进度表` 对应应用的密钥。
- 本次没有把记录写入飞书，避免误写或使用错误应用。

## 补同步步骤

更新 `.env` 中有效的飞书应用密钥后，重新执行同步：

1. 获取 `tenant_access_token`。
2. 读取 `FEISHU_APP_TOKEN` / `FEISHU_TABLE_ID` 对应表记录。
3. 如果不存在 `W03-R3A` 至 `W03-R3D`，新增记录。
4. 如果已存在，按本文件表格更新状态和进度说明。

补同步完成后，把本文件中的“自动同步未完成”改为“已读回确认”。
