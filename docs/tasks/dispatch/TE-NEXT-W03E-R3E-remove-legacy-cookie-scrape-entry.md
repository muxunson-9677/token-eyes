# W03E-R3E Remove Legacy Cookie Scrape Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` before implementation and `superpowers:verification-before-completion` before reporting completion. Execute only this work order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 Token Plan 用户界面移除旧 `cookie_scrape` 选择和误导文案，同时保留后端对历史记录的安全兼容。

**Architecture:** `detection_method` 是新记录的唯一检测主路径；UI 仅提供 `not_configured`、`official_account`、`custom_api` 对应流程。旧 `refresh_method=cookie_scrape` 可以继续被后端读取和拒绝，但编辑旧记录时必须安全归一化，不能重新保存为用户可选路径。

**Tech Stack:** React 18、Vitest、TokenPlanSection、copy registry；不修改 Node/Tauri 生产逻辑。

---

## 0. 派发和并行边界

本工单可与 R3B、PM-FEISHU-01 并行，因为文件范围不同；不得与 R3D 或任何其他编辑 `TokenPlanSection.jsx`、其测试、`copy.csv` 的任务并行。

当前这些文件已有未提交修改。开始前必须读取实际内容并保留既有工作，禁止 reset、checkout、整文件覆盖或批量格式化。

## 1. 开始前必读

- `CLAUDE.md`
- `docs/dev-notes/token-plan-detection-contract.md`
- `docs/tasks/dispatch/TE-NEXT-W03-R3B-token-plan-form-provider-detection.md`
- `docs/tasks/dispatch/TE-NEXT-W03-R3D-token-plan-sync-integration-acceptance.md`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/content/copy.csv`
- `src/lib/token-plan-refresh.js` 中 legacy `cookie_scrape` 分支，只读确认，不修改
- `test/token-plan-refresh.test.js` 中 legacy 测试，只读确认，不修改

## 2. 允许修改的文件

- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/content/copy.csv`
- 可选：与 TokenPlanSection 直接关联、已存在的 copy registry 测试

禁止修改：

- `src/lib/token-plan-refresh.js`
- `src/lib/local-api.js`
- `src-tauri/`
- `dashboard/src/lib/api.ts`
- Spend、Dashboard、pricing、套餐目录、发布配置

## 3. 必须保持的兼容行为

- 后端仍能读取历史 `refresh_method=cookie_scrape` 记录。
- 后端旧分支继续明确失败/风险提示，不能突然把历史记录当成成功。
- 编辑历史记录时表单不得崩溃、空白或出现无 label 的选择值。
- 用户保存历史记录后，不再写回 `cookie_scrape`。
- 不删除数据库/config 中的历史字段，不做全量迁移。
- `official_account` 和 `custom_api` 检测方式不受影响。
- 手动套餐继续可以手动录入额度。

## 4. 目标 UI 行为

| 场景 | 期望 |
|---|---|
| 新增套餐 | 看不到 `cookie_scrape` |
| 编辑普通旧记录 | 保持原行为 |
| 编辑 `refresh_method=cookie_scrape` 旧记录 | 安全归一化为 `manual` 或由现有 detection_method 决定的合法路径 |
| 保存旧记录 | payload 不包含 `refresh_method=cookie_scrape` |
| Xiaomi MiMo 官方账号 | 走 `detection_method=official_account`，不出现 Cookie 提示 |
| 自定义 API | 走 `detection_method=custom_api`，不出现 Cookie 提示 |
| 后端直接读历史记录 | 兼容逻辑仍存在，本工单不删除 |

如果现有表单已经完全以 `detection_method` 驱动，可直接隐藏整个 legacy refresh method UI；不要为了保留旧设计而创造第二个刷新方式选择器。

## 5. Task 1：先写失败测试

在 `dashboard/src/components/settings/TokenPlanSection.test.jsx` 增加精确测试：

- [ ] 新增套餐表单中没有可见的 `cookie_scrape` 选项或对应文案。
- [ ] `REFRESH_METHOD_OPTIONS` 或渲染结果不再包含 `cookie_scrape`。
- [ ] 加载 `refresh_method=cookie_scrape` 的历史记录后可以正常打开编辑表单。
- [ ] 历史记录若没有 detection_method，表单按现有兼容规则落到合法状态，不显示无效 select value。
- [ ] 保存历史记录时请求 payload 不包含 `refresh_method=cookie_scrape`。
- [ ] `official_account` 和 `custom_api` 选项仍可选择和保存。
- [ ] 不出现 Cookie 输入框或“粘贴 Cookie”操作。

运行：

```powershell
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx
```

预期：至少一项新增测试因旧入口仍存在而失败。

## 6. Task 2：做最小 UI 修改

- [ ] 从用户可见 refresh method options 中移除 `cookie_scrape`。
- [ ] 检查 refresh method selector 是否仍有存在价值；若 detection method 已完全替代它，隐藏旧 selector，但不要删除后端字段。
- [ ] 在“记录 → 表单”归一化边界处理旧 `cookie_scrape`，不要在每个 render 分支重复判断。
- [ ] 保存 payload 使用现有合法 refresh method/detection method 组合。
- [ ] 不改额度计算、状态展示、会话调用或 custom API 配置结构。
- [ ] 不重构 TokenPlanSection 的其他区域。

优先最小修改。不要新增 legacy migration service、feature flag 或新的配置层。

## 7. Task 3：清理仅由本次修改产生的文案孤儿

- [ ] 搜索 `settings.token_plan.refresh_method.cookie_scrape` 及所有 Cookie 抓取文案引用。
- [ ] 如果 copy key 已无任何代码或测试引用，从 `dashboard/src/content/copy.csv` 删除对应行。
- [ ] 如果 key 仍服务历史记录只读说明，保留但确保 UI 不把它当可选主路径。
- [ ] 不顺手删除其他预先存在的未使用文案。
- [ ] 所有新增或替换文案仍走 copy registry。

验证：

```powershell
rg -n "cookie_scrape|Cookie 抓取|粘贴 Cookie" dashboard/src/components/settings dashboard/src/content/copy.csv -i
npm.cmd run validate:copy
npm.cmd run validate:ui-hardcode
```

允许测试名称或明确的“不可见”断言命中；生产 UI 不得留下可选入口。

## 8. Task 4：回归

```powershell
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx
npm.cmd --prefix dashboard run typecheck
npm.cmd run validate:copy
npm.cmd run validate:ui-hardcode
npm.cmd run dashboard:build
node --test test/token-plan-refresh.test.js test/token-plans-api.test.js
git diff --check
```

后两项 Node 测试用于证明后端历史兼容未被间接破坏；本工单不应修改这些 Node 文件。

## 9. 禁止事项

- 不删除后端 `cookie_scrape` 兼容分支。
- 不迁移或批量重写用户已有配置。
- 不新增 Cookie 输入、导入或抓取实现。
- 不修改 R3B 会话验证、R3C adapter、R3D 状态展示。
- 不清理相邻旧代码或重排整个组件。
- 不硬编码文案。
- 不提交、reset 或清理共享工作区。

## 10. 完成标准

- UI 中无法选择 `cookie_scrape`。
- 旧记录仍可打开和保存。
- 保存 payload 不再产生 `cookie_scrape`。
- 官方账号、自定义 API、手动路径测试通过。
- 后端 legacy 兼容分支保持不变。
- copy、typecheck、测试和 build 全部通过。
- diff 仅涉及允许文件。

## 11. 返回模板

```markdown
## W03E-R3E 结果
- 结论：COMPLETED / BLOCKED
- 用户可见 cookie_scrape 入口：已移除
- 后端历史兼容：已保留

## 修改文件
- 路径与原因：

## 旧记录行为
- 打开：
- 归一化：
- 保存 payload：

## 验证
- 命令与结果：

## 边界
- 是否修改 Node/Tauri 生产代码：否
- 是否执行提交：否
```
