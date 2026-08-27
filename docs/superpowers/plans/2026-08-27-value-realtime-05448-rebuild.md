# Token Eyes 0.54.48 价值对比与实时会话重制实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在 codex/value-realtime-ui-05447 当前分支内生成一个可安装的 Token Eyes 0.54.48，使【价值对比】和【实时会话】恢复用户参考图的布局与信息密度，同时修正自然月费用、趋势、跨月混用和“本期实付”语义，其他页面保持 main 0.54.47。

**Architecture:** 保留现有 React 页面结构、local API 和全局定价规则，只在价值对比数据聚合、表格显示语义和两个新增页共享响应式样式中做外科式调整。费用统一按用户时区中的自然月边界直接计算；构成只读取所选数据月；趋势按六个自然月逐月计算。最终从已提交 SHA 构建生产安装包，并以安装后的真实应用完成两次相互独立的核对。

**Tech Stack:** Node.js CommonJS、React 18、Vitest/Testing Library、Node test runner、CSS、Tauri 2/Windows NSIS、项目既有 UI 验收脚本。

---

### Task 1: 锁定基线与依赖健康

**Files:**
- Read: CLAUDE.md
- Read: package.json
- Read: dashboard/package.json
- Preserve: design-qa.md
- Preserve: .codex-artifacts/

- [ ] **Step 1: 记录工作树身份和脏状态**

Run:

~~~powershell
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
~~~

Expected: worktree 为 D:\04-AI-Project\010-Token eye\.worktrees\value-realtime-ui-05447，分支为 codex/value-realtime-ui-05447，HEAD 包含规格提交 22eab27d；design-qa.md 和已有 .codex-artifacts 不被改写或清理。

- [ ] **Step 2: 验证依赖和相关测试基线**

Run:

~~~powershell
node --version
npm --version
Test-Path node_modules
Test-Path dashboard/node_modules
node --test test/value-realtime-local-api.test.js test/value-realtime-pages-style.test.js
npm --prefix dashboard test -- --run src/pages/ValueComparisonPage.test.jsx src/pages/RealtimeSessionsPage.test.jsx
~~~

Expected: 依赖目录存在；修改前相关测试全部通过。若失败，先记录为旧失败，不把它归因于本次调整。

### Task 2: RED——锁定自然月费用和禁止跨类别跨月混用

**Files:**
- Modify: test/value-realtime-local-api.test.js
- Test: test/value-realtime-local-api.test.js

- [ ] **Step 1: 把跨类别回退测试改为所选月严格隔离**

将现有 category fallback 场景保留 August Codex 当月数据和 July Claude/其他 AI 数据，但断言改为：

~~~js
assert.equal(otherAi.value, null);
assert.equal(otherAi.source_month, undefined);
assert.equal(otherAi.fallback_applied, undefined);
assert.equal(apiKey.value, null);
assert.equal(apiKey.source_month, undefined);
assert.equal(apiKey.fallback_applied, undefined);
assert.equal(observedApi.value, null);
assert.equal(observedApi.source_month, undefined);
assert.equal(observedApi.fallback_applied, undefined);
~~~

- [ ] **Step 2: 增加 Asia/Shanghai 自然月单次计费回归测试**

新增隔离临时数据测试：创建一个从 1970 年开始、每月 $12 的订阅账单，请求 range=month&month=2026-08&timezone=Asia%2FShanghai，断言：

~~~js
assert.equal(value.actual_spend.subscription_usd.value, 12);
assert.equal(value.actual_composition.find((row) => row.key === "subscription").value, 12);
assert.equal(value.monthly_trend.find((row) => row.bucket_start === "2026-08-01").actual_spend_usd, 12);
~~~

- [ ] **Step 3: 运行测试确认按预期失败**

Run:

~~~powershell
node --test --test-name-pattern "natural month|category fallback" test/value-realtime-local-api.test.js
~~~

Expected: FAIL；旧实现会把 July 与 August 混入，并可能把月订阅重复计入或按周分摊。

### Task 3: GREEN——统一自然月费用与构成数据口径

**Files:**
- Modify: src/lib/local-api.js:6690
- Test: test/value-realtime-local-api.test.js

- [ ] **Step 1: 头部费用直接按当前选择范围计算**

在价值对比 endpoint 内以 rangedSpendRecords 为唯一费用记录集合，沿用现有汇率与 computeSubscriptionCostForRange：

~~~js
const actualSpendBySource = rangedSpendRecords.reduce((totalsBySource, record) => {
  const usd = computeSubscriptionCostForRange(
    record,
    range.from,
    range.to,
    Number(exchangeRates[String(record.currency || "USD").toUpperCase()] || 1),
  );
  totalsBySource[record.source] = (totalsBySource[record.source] || 0) + usd;
  return totalsBySource;
}, {});
const subscriptionActualUsd = Object.entries(actualSpendBySource)
  .filter(([source]) => source === "codex" || source === "cursor")
  .reduce((sum, [, value]) => sum + value, 0);
const otherAiActualUsd = Object.entries(actualSpendBySource)
  .filter(([source]) => source !== "codex" && source !== "cursor")
  .reduce((sum, [, value]) => sum + value, 0);
const actualSpendUsd = subscriptionActualUsd + otherAiActualUsd;
~~~

头部 actualSpend 与 actualComposition 都使用这组值，不再读取按日/周 series 聚合后的 totals。

- [ ] **Step 2: 构成只读当前数据月**

将 compositionMonths 收窄为当前 dataMonth：

~~~js
const compositionMonths = [dataMonth];
~~~

保留整个页面因当月完全无数据而切换 dataMonth 的现有语义，但禁止某一类别单独从更早月份补数。

- [ ] **Step 3: 六个月趋势逐自然月直接计算**

移除 readSpendTimeseries(..., "month") 后再按字符串归月的路径；对 sixMonthKeys 逐一使用项目现有自然月边界 helper 与 computeSubscriptionCostForRange 求和。没有账单记录时 actual 为 null，有记录时 actual 是该自然月直接求和。不得新增第二套时区算法。

- [ ] **Step 4: 运行 local API 全文件测试**

Run:

~~~powershell
node --test test/value-realtime-local-api.test.js
~~~

Expected: PASS，且新增自然月/跨类别断言通过。

### Task 4: RED——锁定“本期实付”语义和安全响应式阈值

**Files:**
- Modify: dashboard/src/pages/ValueComparisonPage.test.jsx
- Modify: test/value-realtime-pages-style.test.js

- [ ] **Step 1: 增加表格币种列语义测试**

构造 actual_value: null、tokens: 18256000 的套餐行，定位该行并断言：

~~~js
const row = screen.getByText("claude").closest("tr");
expect(within(row).getByText(copy("value.table.configureBill"))).toBeVisible();
expect(within(row).queryByText(/Token$/)).not.toBeInTheDocument();
~~~

Token 可以在其他辅助区域显示，但不得出现在“本期实付”币种列。

- [ ] **Step 2: 把大屏样式阈值锁定为内容宽度安全区**

静态样式测试改为查找：

~~~js
const blockStart = stylesheet.indexOf("@media (min-width: 1760px) and (min-height: 1040px)");
assert.ok(blockStart >= 0);
assert.doesNotMatch(stylesheet, /@media \(min-width: 1361px\) and \(min-height: 1040px\)/);
assert.match(stylesheet, /\.vr-head\s*\{[^}]*flex-wrap:\s*wrap/);
assert.match(stylesheet, /\.vr-controls\s*\{[^}]*flex-wrap:\s*wrap/);
assert.match(stylesheet, /\.vr-value-meta\s*\{[^}]*flex-wrap:\s*wrap[^}]*white-space:\s*normal/);
~~~

- [ ] **Step 3: 运行测试确认失败**

Run:

~~~powershell
npm --prefix dashboard test -- --run src/pages/ValueComparisonPage.test.jsx
node --test test/value-realtime-pages-style.test.js
~~~

Expected: FAIL；旧表格会在“本期实付”显示 Token，旧大屏阈值会在约 1586 CSS px 的 175% 缩放窗口触发。

### Task 5: GREEN——恢复参考图密度并避免缩放溢出

**Files:**
- Modify: dashboard/src/pages/ValueComparisonPage.jsx:194
- Modify: dashboard/src/pages/value-realtime-pages.css:1
- Test: dashboard/src/pages/ValueComparisonPage.test.jsx
- Test: dashboard/src/pages/RealtimeSessionsPage.test.jsx
- Test: test/value-realtime-pages-style.test.js

- [ ] **Step 1: 修正“本期实付”渲染**

将 actualValue 收窄为币种值或缺失状态：

~~~jsx
function actualValue(row) {
  if (row.actual != null) return `$${Number(row.actual).toFixed(2)}`;
  return <a className="vr-table-action" href="/spend/cost#subscriptions">{copy("value.action.configure_bill")}</a>;
}
~~~

- [ ] **Step 2: 调整共享响应式样式**

保留 2195×1164 参考图的大屏密度，把放大分支改为：

~~~css
.vr-head { flex-wrap: wrap; min-width: 0; }
.vr-controls { flex-wrap: wrap; justify-content: flex-end; }
.vr-value-meta { flex-wrap: wrap; white-space: normal; }

@media (min-width: 1760px) and (min-height: 1040px) {
  /* 原 1361px 大屏块中的字号、卡片高度和间距规则保持不变 */
}
~~~

不得改动全局 AppLayout、侧栏、定价算法或其他页面样式。

- [ ] **Step 3: 运行新增页相关测试**

Run:

~~~powershell
npm --prefix dashboard test -- --run src/pages/ValueComparisonPage.test.jsx src/pages/RealtimeSessionsPage.test.jsx
node --test test/value-realtime-pages-style.test.js
~~~

Expected: PASS。

### Task 6: 集成验证与功能提交

**Files:**
- Modify: docs/superpowers/plans/2026-08-27-value-realtime-05448-rebuild.md
- Create: .codex-artifacts/05448-rebuild/20260827-final/acceptance-matrix.md

- [ ] **Step 1: 运行交付前代码门**

Run:

~~~powershell
git diff --check
node --test test/value-realtime-local-api.test.js test/value-realtime-pages-style.test.js
npm --prefix dashboard test -- --run src/pages/ValueComparisonPage.test.jsx src/pages/RealtimeSessionsPage.test.jsx
npm --prefix dashboard run typecheck
npm --prefix dashboard run build
npm test
~~~

Expected: 全部 PASS；若有已记录的无关旧失败，必须写明准确测试名和原因，不能隐藏。

- [ ] **Step 2: 确认变更范围只落在计划文件**

Run:

~~~powershell
git status --short
git diff --stat
git diff -- src/lib/local-api.js dashboard/src/pages/ValueComparisonPage.jsx dashboard/src/pages/value-realtime-pages.css test/value-realtime-local-api.test.js test/value-realtime-pages-style.test.js dashboard/src/pages/ValueComparisonPage.test.jsx
~~~

Expected: 不包含 design-qa.md、用户已有 .codex-artifacts 或 0.54.47 旧页面实现。

- [ ] **Step 3: 提交功能变更**

Run:

~~~powershell
git add src/lib/local-api.js dashboard/src/pages/ValueComparisonPage.jsx dashboard/src/pages/value-realtime-pages.css test/value-realtime-local-api.test.js test/value-realtime-pages-style.test.js dashboard/src/pages/ValueComparisonPage.test.jsx docs/superpowers/plans/2026-08-27-value-realtime-05448-rebuild.md
git diff --cached --check
git commit -m "fix: align value realtime dashboards"
~~~

Expected: 提交成功，用户的 design-qa.md 不在提交中。

### Task 7: 第一审——开发/生产页面逐项匹配参考图

**Files:**
- Create: .codex-artifacts/05448-rebuild/20260827-final/design-qa.md
- Create: .codex-artifacts/05448-rebuild/20260827-final/screenshots/*.png
- Read: C:\Users\admin\AppData\Local\Temp\codex-clipboard-41f46182-cf14-4784-b53c-4de24246dcae.png
- Read: C:\Users\admin\AppData\Local\Temp\codex-clipboard-fea22289-0008-4f9d-a8e8-a544b85672cc.png

- [ ] **Step 1: 启动当前提交的真实 local API + 生产 dashboard**

Run:

~~~powershell
node bin/tracker.js serve --no-sync --port 7693
~~~

Expected: 127.0.0.1:7693 提供当前 HEAD 的生产 dashboard，不使用旧 server 或 mock 数据。

- [ ] **Step 2: 在三个关键 CSS 视口核对两个页面**

用现有 UI 验收脚本依次检查 2195×1164、1586×932、1586×1040：标题与筛选器、三张 KPI 卡、构成/表格双列、趋势/折叠区、实时会话主卡/Agent 条/分析区；记录 scrollWidth/clientWidth、每个主要卡片 rect、遮挡和横向滚动。

Expected: 2195×1164 与参考图结构和密度一致；两个 1586 宽视口不触发错误放大、不重叠、不出现页面级横向滚动；数据事实允许不同于参考截图固定数值。

- [ ] **Step 3: 第一审不通过即纠偏并重跑完整第一审**

只修改本计划列出的新增页文件；每次改动后重跑 Task 5 测试、dashboard build 和全部三个视口的两个页面。所有参考图验收行都通过前不得进入打包。

### Task 8: 0.54.47 旧页面回归对比

**Files:**
- Read: scripts/acceptance/ 下现有 0.54.47/0.54.48 路由审计脚本
- Create: .codex-artifacts/05448-rebuild/20260827-final/old-page-audit.json

- [ ] **Step 1: 对 15 个旧页面和 3 个重定向做 A/B**

使用已保留的 main 0.54.47 URL 服务与当前构建，在相同视口、主题和数据快照下运行仓库现有路由清单审计。

Expected: 旧页面 DOM/关键截图/路由行为无新增差异；仅【价值对比】和【实时会话】允许变化。

- [ ] **Step 2: 发现旧页差异时阻断**

若差异来自本次共享样式或数据改动，回到 Task 5 做局部修正并重跑 Task 6、7、8；不得把旧页差异列为“可接受”。

### Task 9: 从已提交 SHA 构建 0.54.48 安装包并证明来源

**Files:**
- Create: .codex-artifacts/05448-rebuild/20260827-final/runtime-manifest.json
- Create: .codex-artifacts/05448-rebuild/20260827-final/provenance.json
- Create: .codex-artifacts/05448-rebuild/20260827-final/sha256.txt

- [ ] **Step 1: 确认版本与干净 Git archive 构建输入**

Run:

~~~powershell
git rev-parse HEAD
git status --short
rg -n "0\.54\.48" package.json TokenTrackerBar/project.yml src-tauri/tauri.conf.json src-tauri/Cargo.toml
~~~

Expected: 所有实际 Windows/Tauri 版本位置为 0.54.48；只允许保留未纳入构建的用户脏文件。

- [ ] **Step 2: 按仓库既有 clean archive 流程构建**

Run:

~~~powershell
npm run tauri:build:ci
~~~

Expected: NSIS 0.54.48 EXE 生成成功；记录精确 HEAD、构建时间、manifest、安装包绝对路径、大小和 SHA-256。

- [ ] **Step 3: 验证安装包内资源来自同一 HEAD**

比对源码 SHA、runtime manifest、打包 dashboard 资源清单和安装包 hash。Expected: 源码、manifest、安装资源和安装包来源一致，未混入旧 dashboard dist。

### Task 10: 安装后第二审——从最终制品重新走真实用户旅程

**Files:**
- Create: .codex-artifacts/05448-rebuild/20260827-final/installed-ui-audit-round-1.json
- Create: .codex-artifacts/05448-rebuild/20260827-final/installed-ui-audit-round-2.json
- Create: .codex-artifacts/05448-rebuild/20260827-final/installed-screenshots/*.png

- [ ] **Step 1: 备份当前数据并安装精确候选 EXE**

使用用户已授权的备份/必要卸载安装范围，保留现有 .tokentracker 数据和旧安装备份，安装 Task 9 的精确 SHA-256 制品。

Expected: 安装后 manifest/文件 hash 与候选制品一致，应用版本显示 0.54.48。

- [ ] **Step 2: 独立核对第一轮**

从开始菜单/安装目录启动真实应用，以普通鼠标键盘打开【价值对比】和【实时会话】，检查默认状态、月份/范围切换、Agent 切换、折叠展开、导航离开返回、刷新/重启持久化，以及三个关键窗口/缩放尺寸。

Expected: 参考图布局、修正后的自然月数据语义和无横向溢出全部成立；OAuth/网页登录不执行并明确标为延期范围。

- [ ] **Step 3: 独立核对第二轮**

完全退出应用和 backend，再从最终安装入口重新启动，不复用第一轮截图或结论；重新检查两个新增页和旧页面路由审计，并重新记录几何、截图和数据事实。

Expected: 第二轮独立通过。任何肉眼可见偏差、旧页回归、manifest 不一致或交互失败都回到相应 Task 修复，重新构建并从 Task 10 Step 1 开始。

- [ ] **Step 4: 最终提交与交付**

Run:

~~~powershell
git status --short
git log -3 --oneline
Get-FileHash -Algorithm SHA256 "<最终安装包绝对路径>"
~~~

Expected: 功能提交存在；用户脏文件保持原样；只有在两轮安装版核对均通过后，才提供可复制的绝对安装包路径和 SHA-256，并准确声明 OAuth 延期范围。
