# W03E-R3D Xiaomi MiMo Live Sync UI Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` for UI behavior changes and `superpowers:verification-before-completion` before reporting completion. Execute only this work order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已经通过 R3C 验证的小米 MiMo 官方额度同步接入现有 Token Plan 表单和状态展示，并完成 Windows Tauri 端到端验收。

**Architecture:** 不新增小米专属独立卡片。用户继续通过“新增/编辑套餐 → 服务商 → 套餐 → 检测方式”配置；UI 通过现有 API/Tauri wrapper 触发会话验证和刷新，统一展示 success、reauth_required、unsupported、failed 及上次成功数据。

**Tech Stack:** React 18、Vite、Vitest、`dashboard/src/lib/api.ts`、Node local API、Tauri 2 Windows build、copy registry。

---

## 0. 硬门禁

- [ ] W03E-R3B 结论为 READY。
- [ ] W03E-R3C adapter、refresh 和 API 测试全部通过。
- [ ] W03E-R3E 已完成，`cookie_scrape` 不再是用户可选入口。
- [ ] 当前 `TokenPlanSection.jsx` 的既有修改已经由主调度者验收，工作区没有另一 subagent 同时编辑该文件。

任一项不成立，停止并返回 BLOCKED。不得在 UI 中模拟成功来绕过后端门禁。

## 1. 开始前必读

- `CLAUDE.md`
- `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`
- `docs/dev-notes/token-plan-detection-contract.md`
- `src/lib/token-plan-refresh.js`
- `src/lib/local-api.js`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/lib/api.ts`
- `dashboard/src/content/copy.csv`
- `test/token-plan-console-sessions.test.js`
- R3C 新增的 provider adapter 测试

## 2. 允许修改的文件

- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/lib/api.ts`
- `dashboard/src/lib/api.test.ts`，如需要补 wrapper 测试
- `dashboard/src/content/copy.csv`
- `test/token-plan-console-sessions.test.js`，仅补端到端 API 状态契约
- `docs/test-reports/token-plan/xiaomi-mimo-live-sync-r3d-acceptance.md`

默认禁止修改：

- `src/lib/token-plan-providers/`
- `src/lib/token-plan-refresh.js`
- `src-tauri/`
- Spend、Dashboard、pricing edge patches、套餐价格、发布版本

如果后端或 Tauri 契约仍需变更，返回给 R3B/R3C 修正，不在本工单跨层重写。

## 3. 用户流程不变量

1. 不新增独立“小米控制台连接”卡片。
2. 官方账号入口只在 Token Plan 新增/编辑表单内出现。
3. 打开登录窗口后显示等待验证，不显示已连接。
4. 只有真实 quota 请求成功才显示同步成功。
5. 401/403 显示需要重新登录，并保留上次成功额度。
6. unsupported 明确说明当前不可同步，不显示成功样式。
7. failed 显示脱敏原因和上次尝试时间，不清空旧数据。
8. 不显示 Cookie 输入框，不要求用户粘贴 Cookie。
9. 所有新增用户文案进入 `dashboard/src/content/copy.csv`。
10. 浏览器/Web 模式不能调用 Tauri 时显示“仅桌面端支持”，不能伪造 session。

## 4. 状态展示矩阵

| `sync_status` | 主状态 | 用户操作 | 额度展示 |
|---|---|---|---|
| `not_configured` | 未配置 | 选择检测方式 | 保留手动数据 |
| `auth_required` | 需要连接账号 | 打开官方登录 | 保留旧数据 |
| `syncing` | 正在同步 | 禁用重复点击 | 保留旧数据 |
| `success` | 已同步 | 可手动刷新 | 展示新额度和 `last_synced_at` |
| `reauth_required` | 登录已失效 | 重新连接 | 展示上次成功额度 |
| `unsupported` | 暂不支持 | 可改用自定义 API | 展示上次成功额度，不显示成功 |
| `failed` | 同步失败 | 重试 | 展示上次成功额度和脱敏错误 |

若仓库现有状态枚举名称不同，使用数据模型已有值；不得创建只存在于 UI 的第二套状态。

## 5. Task 1：先写 UI 失败测试

在 `dashboard/src/components/settings/TokenPlanSection.test.jsx` 增加或强化测试：

- [ ] 小米套餐选择 `official_account` 后只显示表单内的官方连接操作。
- [ ] Web 模式无 Tauri runtime 时显示 desktop required，且不调用成功回调。
- [ ] `LoginStarted/AwaitingVerification` 不显示 connected 或 success。
- [ ] R3C 返回 success 时展示额度、同步时间和成功状态。
- [ ] 401/403 的 `reauth_required` 展示重新登录操作并保留旧额度。
- [ ] `unsupported` 不使用成功颜色、图标或文案。
- [ ] `failed` 显示脱敏错误且旧额度仍可见。
- [ ] 重复点击刷新在请求进行中被阻止。
- [ ] 不存在 Cookie 输入框或 `cookie_scrape` 选项。
- [ ] 新文案通过 copy key 获取。

运行：

```powershell
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx
```

预期：新增断言至少有一项因集成尚未完成而失败。

## 6. Task 2：补齐 API/Tauri wrapper 契约

先检查 `dashboard/src/lib/api.ts` 已有：

- `refreshTokenPlan`
- console session CRUD/verify
- `openXiaomiMimoConsoleLogin`
- `verifyXiaomiMimoConsoleSession`
- `deleteXiaomiMimoConsoleSession`

只补 R3B/R3C 确认但尚未暴露的最小 wrapper：

- [ ] 参数名与 Tauri command 的 camelCase 映射一致。
- [ ] 返回类型不使用 `any`，字段与 Rust/Node 契约一致。
- [ ] wrapper 不返回 Cookie、header 或原始响应。
- [ ] 没有 Tauri runtime 时抛出稳定错误供 UI 映射。
- [ ] 如新增 wrapper，先在 `dashboard/src/lib/api.test.ts` 写失败测试。

不要重写现有 fetch/auth 基础设施。

## 7. Task 3：实现最小 UI 状态机

在 `TokenPlanSection.jsx` 内复用现有表单和状态展示：

- [ ] 连接账号时先创建/选择 console session reference。
- [ ] 调用打开窗口后保持未连接状态。
- [ ] 用户完成登录并主动验证后，调用 R3B 安全验证边界。
- [ ] 验证通过后触发现有 `refreshTokenPlan` 或 R3C 指定入口。
- [ ] 用返回 record 更新当前套餐，不在前端自行计算官方额度。
- [ ] 失败只更新状态，不把表单额度改为 0 或空。
- [ ] 删除会话后 UI 回到需要认证状态。
- [ ] custom API 路径和手动套餐路径保持原行为。

实现以现有组件结构为准，不拆分新组件，除非当前文件中已经有对应单一职责组件模式。禁止顺手重构整个 TokenPlanSection。

## 8. Task 4：文案和可访问性

- [ ] 所有新增文案在 `dashboard/src/content/copy.csv` 注册。
- [ ] 状态不能只靠颜色区分，保留文本或图标标签。
- [ ] 按钮 loading/disabled 状态有可访问名称。
- [ ] 错误文案不包含 endpoint query、Cookie、token 或原始响应。
- [ ] 不出现“粘贴 Cookie”“Cookie 抓取”等用户入口。

验证：

```powershell
npm.cmd run validate:copy
npm.cmd run validate:ui-hardcode
```

## 9. Task 5：自动化回归

```powershell
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx api.test.ts
npm.cmd --prefix dashboard run typecheck
npm.cmd run validate:copy
npm.cmd run validate:ui-hardcode
node --test test/token-plan-console-sessions.test.js test/token-plan-refresh.test.js test/token-plans-api.test.js test/token-plan-xiaomi-mimo-provider.test.js
npm.cmd run dashboard:build
git diff --check
```

若 `api.test.ts` 不存在相关测试且本工单未修改 API wrapper，可以从第一条命令中去掉它，但必须在报告中说明。

## 10. Task 6：Windows Tauri 真实验收

Windows 前置：Rust toolchain、Node.js、WebView2 Runtime。不要要求 .NET SDK。

- [ ] 构建：`npx.cmd tauri build --no-bundle`。
- [ ] 启动 Token Eyes Tauri 应用。
- [ ] 在 Token Plan 表单选择 Xiaomi MiMo 套餐和官方账号检测。
- [ ] 打开官方登录窗口，确认此时仍未显示 connected。
- [ ] 用户手动完成登录后执行验证和刷新。
- [ ] 将 UI 显示额度与同一控制台页面可见额度对齐；记录数值是否一致，但不记录账号信息。
- [ ] 验证会话失效/删除后的 reauth 行为。
- [ ] 验证重启应用后 secret/session 的真实行为，不假设持久化。
- [ ] 验证 custom API 套餐未回归。

如果无法完成真实登录交互，不得写“端到端通过”；报告必须标记 BLOCKED，并区分自动化通过与人工链路未完成。

## 11. Task 7：验收报告

创建 `docs/test-reports/token-plan/xiaomi-mimo-live-sync-r3d-acceptance.md`，包含：

- commit/工作区基线描述，不包含无关 diff 内容
- R3B 契约版本和 R3C adapter 测试
- 自动化命令及通过/失败数量
- Windows Tauri 用户流程每一步结果
- success/reauth_required/unsupported/failed 展示矩阵
- 额度对齐结论
- 敏感信息检查
- 最终 `PASSED` 或 `BLOCKED`

报告不得把“build 通过”写成“真实同步通过”。

## 12. 禁止事项

- 不实现或重写 provider adapter。
- 不新增独立小米卡片。
- 不新增 Cookie 输入或抓取入口。
- 不把打开窗口当连接成功。
- 不用 mock 数据冒充人工端到端结果。
- 不清空上次成功额度。
- 不修改 Spend、Dashboard 或 pricing。
- 不硬编码 UI 文案。
- 不提交、reset 或清理共享工作区。

## 13. 完成标准

- R3B、R3C、R3E 门禁全部满足。
- UI 状态矩阵有自动化测试。
- 真实 Windows Tauri 链路完成，或明确 BLOCKED。
- unsupported/failed/reauth 不显示成功。
- 旧额度在失败时保留。
- 所有文案校验、typecheck、测试和 build 通过。
- 验收报告与实际结果一致。

## 14. 返回模板

```markdown
## W03E-R3D 结果
- 结论：PASSED / BLOCKED
- 自动化测试：
- Windows Tauri 真实链路：
- 额度与控制台对齐：

## 修改文件
- 路径与原因：

## 状态矩阵结果
- success：
- reauth_required：
- unsupported：
- failed：

## 验证
- 命令与结果：

## 安全与回归
- 是否出现 Cookie 输入：否
- 是否保留上次成功额度：是
- custom_api 是否通过：是 / 否

## 剩余风险
- 无；如有则逐项填写
```
