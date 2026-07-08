# 01 - 真实项目路径用量修复

## 中文简述
本工单修复“项目用量要链接真实项目路径，并能直观看到不同项目分别消耗多少 Token、花费多少钱”的缺口。当前后端已有字段，但前端仍按 GitHub 仓库卡片展示，不能满足用户需求。

## 第一性原理
- 用户要解决的问题：不用猜哪个项目在烧钱，直接看到真实本地项目路径、Token、费用、请求数、最近活跃时间。
- 数据来源：`tokentracker-project-usage-summary` 返回的 `project_path`、`project_name`、`billable_total_tokens`、`cost_usd`、`request_count`、`last_active_at`。
- 用户点击后发生什么：能打开或复制真实项目路径；若路径不可打开，也必须显示可复制路径。
- 不做的事：不恢复 GitHub 星标展示，不把 source-only fallback 伪装成真实项目路径。

## 缺漏证据
- 后端已返回项目路径和费用字段：[local-api.js](<D:/04-AI-Project/010-Token eye/src/lib/local-api.js>):4024。
- 前端仍拆 `owner/repo` 并请求 GitHub 元数据：[ProjectUsagePanel.jsx](<D:/04-AI-Project/010-Token eye/dashboard/src/ui/dashboard/components/ProjectUsagePanel.jsx>):181。
- 现有测试明确断言卡片不可点击：[ProjectUsagePanel.test.jsx](<D:/04-AI-Project/010-Token eye/dashboard/src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx>):25。

## 修复范围
- 修改 `dashboard/src/ui/dashboard/components/ProjectUsagePanel.jsx`。
- 修改 `dashboard/src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx`。
- 必要时补充 `dashboard/src/content/copy.csv` 文案。
- 如打开路径需要 API 支持，再修改 `src/lib/local-api.js`，但优先使用已有 native bridge 或复制路径，不做大范围新能力。

## 执行步骤
1. 写失败测试：输入包含 `project_path`、`project_name`、`billable_total_tokens`、`cost_usd`、`request_count`、`last_active_at` 的 entry，断言 UI 展示项目名、路径、Token、费用、请求数、最近活跃。
2. 写失败测试：有真实 `project_path` 时，卡片提供“打开路径”或“复制路径”操作；无真实路径时不展示虚假链接。
3. 移除或旁路 GitHub 星标依赖，不再把项目用量卡片渲染成 repo/stars 视图。
4. 实现最小 UI：项目名、路径、Token、费用、请求数、最近活跃时间、路径操作按钮。
5. 复跑测试并修复断言。

## 验收标准
- 项目用量卡片必须展示真实路径；没有路径时明确显示“未识别真实项目路径”或等价文案。
- 每个项目必须展示 Token 和 USD 成本。
- 不能再展示 GitHub 星标作为项目用量核心指标。
- 不能生成 `https://codex.ai`、`https://claude.ai` 这类虚假项目链接。
- `ProjectUsagePanel.test.jsx` 必须覆盖真实路径、无路径 fallback、费用展示、点击/复制行为。

## 验证命令
```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx --reporter=verbose
Push-Location dashboard
npx eslint "src/ui/dashboard/components/ProjectUsagePanel.jsx" "src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx"
Pop-Location
npm --prefix dashboard run build
```

## 上下文建议
可和 `02-request-log.md` 共用同一个前端上下文。建议先完成本工单，再在同一上下文继续做请求日志分页。

## 审查记录模板
```text
审查轮次：
反方问题：
涉及文件：
修复动作：
复查命令：
复查结果：
最终结论：
```

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况。

---

## 审查记录

### 第 1 轮

**反方问题：**
无阻断性问题。实现符合验收标准：
1. ✅ 项目用量卡片展示真实路径（project_path），无路径时显示 "no_path" fallback 文案
2. ✅ 每个项目展示 Token 和 USD 成本（$0.4567 格式）
3. ✅ 不再展示 GitHub 星标，测试断言确认无 stars 相关元素
4. ✅ 不生成 codex.ai / claude.ai 等虚假项目链接
5. ✅ 测试覆盖：真实路径、无路径 fallback、费用展示、复制路径行为
6. ✅ 12 个测试全部通过
7. ✅ ESLint 通过
8. ✅ 构建通过

**轻微发现（非阻断，可选优化）：**
- 只有"复制路径"功能，没有"打开路径"功能。但验收标准说"打开路径或复制路径"，二选一即可，因此不阻断。

**涉及文件：**
- `dashboard/src/ui/dashboard/components/ProjectUsagePanel.jsx`
- `dashboard/src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx`

**修复或打回动作：**
无需打回，通过审查。

**复查命令：**
```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx --reporter=verbose
Push-Location dashboard
npx eslint "src/ui/dashboard/components/ProjectUsagePanel.jsx" "src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx"
Pop-Location
npm --prefix dashboard run build
```

**复查结果：**
12 个测试全部通过，ESLint 通过，构建通过。

**最终结论：**
通过。
