# TE-NEXT-W03-R3B - Token 套餐表单重构与小米入口内聚

## 任务 ID

`TE-NEXT-W03-R3B`

## 所属模块

Token 套餐 / 设置页表单 / 服务商目录

## 派发对象

Claude Code

## 当前状态

待派发，必须等待 `TE-NEXT-W03-R3A` 完成。

## 前置依赖

- `TE-NEXT-W03-R3A` 已确定 `detection_method`、`detection_config`、`sync_status` 契约。

## 目标

移除 Token 套餐主界面的独立“小米 MiMo 控制台连接”卡片，把小米入口内聚到新增/编辑套餐表单中。

正确流程固定为：

1. 点击 `新增套餐`。
2. 选择 `Agent 来源`。
3. 选择 `服务商`。
4. 选择该服务商下的 `套餐`。
5. 选择 `检测方式`。

## 必读文件

1. `CLAUDE.md`
2. `上下文.md`
3. `docs/tasks/dispatch/TE-NEXT-W03-R3A-token-plan-detection-contract.md`
4. `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json`
5. `dashboard/src/components/settings/TokenPlanSection.jsx`
6. `dashboard/src/components/settings/TokenPlanSection.test.jsx`
7. `dashboard/src/lib/api.ts`
8. `dashboard/src/content/copy.csv`

## 允许修改的文件

- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/lib/api.ts`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在 copy 流程要求时修改

不得修改：

- `src/lib/local-api.js` 的核心检测解析逻辑，除非 R3A 契约字段缺失且需要最小补齐。
- `src/lib/token-plan-catalog/xiaomi-mimo.catalog.json` 的已核验套餐事实。

## UI 结构要求

当用户选择 `provider_id: "xiaomi_mimo"` 时，表单内显示：

- 套餐下拉：只允许目录中的 Lite / Standard / Pro / Max 月付或年付项。
- 基础信息自动带出：套餐名称、总额度、额度单位、目录版本、额度来源。
- 检测方式选择：
  - `official_account`：官网账号登录检测。
  - `custom_api`：自定义 API 检测。

官网账号登录检测入口必须在该套餐表单内部，不得作为主界面独立卡片出现。

## 禁止事项

- 不新增“小米 MiMo 控制台连接”独立卡片。
- 不新增全局小米账号入口。
- 不把“打开官网窗口成功”显示为“已连接”。
- 不让用户在主路径手动填写已用额度、剩余额度、到期时间。
- 不为小米服务商显示未经核验的 `custom` 套餐选项。

## 实施步骤

- [ ] 写 `TokenPlanSection.test.jsx` 失败测试：主界面不出现独立“小米 MiMo 控制台连接”卡片。
- [ ] 写 `TokenPlanSection.test.jsx` 失败测试：点击新增套餐，选择 `xiaomi_mimo` 后显示目录套餐下拉和检测方式选择。
- [ ] 写 `TokenPlanSection.test.jsx` 失败测试：选择其他服务商时不显示小米官网账号登录检测入口。
- [ ] 写 `TokenPlanSection.test.jsx` 失败测试：选择小米套餐后自动带出目录总额度、额度单位和目录来源。
- [ ] 修改 `TokenPlanSection.jsx`，把官网账号登录入口移动到新增/编辑表单内。
- [ ] 修改 `TokenPlanSection.jsx`，按 R3A 契约写入 `detection_method` 和 `detection_config.official_account.account_binding_id`。
- [ ] 修改 `copy.csv`，补齐新增中文文案。
- [ ] 运行验证命令。

## 验证命令

```bash
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
```

## 验收标准

1. Token 套餐主界面没有独立小米连接卡片。
2. 小米相关连接入口只出现在新增/编辑小米套餐记录的表单内部。
3. `provider_id: "xiaomi_mimo"` 时只展示已核验目录套餐。
4. 检测方式选择写入 R3A 契约字段。
5. 所有新增中文 UI 文案进入 `copy.csv`。
6. 不改动自定义 API 检测解析实现，该部分由 R3C 负责。

## 并行关系

本工单可与 `TE-NEXT-W03-R3C-custom-api-detection-config.md` 并行执行。

合并前需要与 R3C 对齐 `TokenPlanSection.jsx` 中自定义 API 区域的字段名，最终由 R3D 做端到端整合。
