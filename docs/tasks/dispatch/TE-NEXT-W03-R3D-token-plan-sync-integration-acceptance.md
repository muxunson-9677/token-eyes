# TE-NEXT-W03-R3D - 双检测方式统一同步状态与端到端验收

## 任务 ID

`TE-NEXT-W03-R3D`

## 所属模块

Token 套餐 / 双检测方式集成 / 端到端验收

## 派发对象

Claude Code

## 当前状态

已完成，2026-06-26 验收通过。

## 前置依赖

- `TE-NEXT-W03-R3A` 已定稿数据模型和接口契约。
- `TE-NEXT-W03-R3B` 已完成表单重构和小米入口内聚。
- `TE-NEXT-W03-R3C` 已完成自定义 API 检测配置与状态解析。

不允许跳过 B/C 直接执行本工单。

## 目标

把官网账号登录检测和自定义 API 检测落到同一套同步状态 UI 与本地 API 行为。

每条套餐记录需要展示：

- 总额度
- 已用额度
- 剩余额度
- 到期时间
- 检测方式
- 最后同步时间
- 同步状态
- 失败原因

检测失败时不得清空上次成功数据。

## 必读文件

1. `CLAUDE.md`
2. `上下文.md`
3. `docs/tasks/dispatch/TE-NEXT-W03-R3A-token-plan-detection-contract.md`
4. `docs/tasks/dispatch/TE-NEXT-W03-R3B-token-plan-form-provider-detection.md`
5. `docs/tasks/dispatch/TE-NEXT-W03-R3C-custom-api-detection-config.md`
6. `src/lib/local-api.js`
7. `src/lib/token-plan-refresh.js`
8. `src/lib/token-plan-custom-api.js`
9. `dashboard/src/components/settings/TokenPlanSection.jsx`
10. `dashboard/src/components/settings/TokenPlanSection.test.jsx`
11. `test/token-plans-api.test.js`
12. `test/token-plan-refresh.test.js`

## 允许修改的文件

- 修改：`src/lib/local-api.js`
- 修改：`src/lib/token-plan-refresh.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`test/token-plan-refresh.test.js`
- 修改：`test/token-plan-console-sessions.test.js`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在 copy 流程要求时修改
- 新增：`docs/test-reports/token-plan/2026-06-25-w03-r3-sync-acceptance.md`

## 集成规则

### 官网账号登录检测

官网账号登录检测只允许在小米套餐表单内部出现。状态来源必须是本地 API 和 Tauri 原生验证结果。

如果仍没有可复现的小米官网额度数据源：

- `sync_status` 必须是 `unsupported` 或 `failed`。
- 错误消息必须说明“当前没有可复现官方额度查询能力”。
- 不允许显示“同步成功”。

### 自定义 API 检测

自定义 API 检测使用 R3C 的配置和解析器。成功时写 `quota_source: "custom_api"`。

### 统一失败保护

以下状态不得覆盖上次成功额度：

- `failed`
- `reauth_required`
- `unsupported`
- `auth_required`

只允许 `success` 覆盖：

- `total_quota`
- `used_quota`
- `remaining_quota`
- `expires_at`
- `provider_reported_at`

## 实施步骤

- [x] 写 `test/token-plan-refresh.test.js` 失败测试：`failed` 不覆盖旧额度。
- [x] 写 `test/token-plan-refresh.test.js` 失败测试：`reauth_required` 不覆盖旧额度。
- [x] 写 `test/token-plan-refresh.test.js` 失败测试：`unsupported` 不显示为成功。
- [x] 写 `TokenPlanSection.test.jsx` 失败测试：官网账号检测和自定义 API 检测都使用同一组状态文案。
- [x] 写 `TokenPlanSection.test.jsx` 失败测试：没有检测配置时提示选择检测方式。
- [x] 写 `TokenPlanSection.test.jsx` 失败测试：失败记录仍展示上次成功的额度快照和失败原因。
- [x] 修改刷新器和本地 API，确保统一状态写回。
- [x] 修改 `TokenPlanSection.jsx`，统一展示检测方式、同步时间、状态和失败原因。
- [x] 新增验收报告 `docs/test-reports/token-plan/2026-06-25-w03-r3-sync-acceptance.md`。
- [x] 运行最终验证命令。

## 验证命令

```bash
node --test test/token-plan-custom-api.test.js test/token-plans-api.test.js test/token-plan-refresh.test.js test/token-plan-console-sessions.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

## 验收标准

1. 两种检测方式共用统一状态模型和展示。
2. 官网账号检测入口只在新增/编辑小米套餐表单内部出现。
3. 自定义 API 检测成功后可更新额度、到期时间和同步时间。
4. 检测失败、授权失效、不支持均不清空上次成功额度。
5. 没有检测配置时明确提示用户选择检测方式。
6. 不允许手动录入额度作为主路径。
7. 所有验证命令通过，并产出验收报告。

## 串行关系

本工单不可并行提前执行。必须等 R3B 和 R3C 完成后再做。
