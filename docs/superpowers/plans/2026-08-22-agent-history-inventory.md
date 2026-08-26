# 真实 Agent 六个月历史清单实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让实时会话和价值对比页面只展示本机或 WSL 中被真实发现的 Agent，并以本地账本的最近六个月历史作为卡片与来源证据。

**Architecture:** 后端从现有 `queue.jsonl` 建立独立的六个月历史清单，并复用共享 Agent 注册表提供的显示名称。当前实时会话仍只由用户选择的范围驱动；历史清单不伪造实时会话、Token 或成本。目录发现仅提供“已检测到但无历史记录”的状态，禁止读取或返回会话正文。

**Tech Stack:** Node.js CommonJS、本地 `queue.jsonl`、共享 Agent 注册表、React、Vite、Node test。

---

### Task 1: 建立六个月历史清单聚合器

**Files:**
- Create: `src/lib/agent-history-inventory.js`
- Create: `test/agent-history-inventory.test.js`

- [x] **Step 1: 写入失败测试**

```js
const inventory = buildAgentHistoryInventory({
  rows: [
    { source: "codex", hour_start: "2026-08-20T01:00:00.000Z", total_tokens: 10 },
    { source: "workbuddy", hour_start: "2026-06-01T01:00:00.000Z", total_tokens: 20 },
  ],
  installedSources: ["trae"],
  now: new Date("2026-08-22T00:00:00.000Z"),
});
assert.deepEqual(inventory.map((item) => item.source), ["codex", "workbuddy", "trae"]);
assert.equal(inventory[0].agent_label, "Codex");
assert.equal(inventory[2].history_state, "installed_no_history");
assert.equal(inventory[2].total_tokens.value, null);
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/agent-history-inventory.test.js`
Expected: FAIL，因为 `buildAgentHistoryInventory` 尚不存在。

- [x] **Step 3: 实现最小聚合器**

仅保留六个月内、带已注册 source 的账本行；按 source 聚合，显示名称来自共享 Agent 注册表。已检测安装但没有账本行的 source 返回 `installed_no_history` 与 `null` 数值。

- [x] **Step 4: 运行测试确认通过**

Run: `node --test test/agent-history-inventory.test.js`
Expected: PASS，且未知 source、七个月前记录、提示词字段均不会进入结果。

### Task 2: 将历史清单接入本地实时会话 API

**Files:**
- Modify: `src/lib/local-api.js:5665-5680,6100-6120`
- Modify: `test/value-realtime-local-api.test.js`

- [x] **Step 1: 写入端到端失败测试**

```js
assert.deepEqual(
  realtime.agent_history.map((item) => [item.source, item.agent_label, item.history_state]),
  [["claude", "Claude Code", "historical_usage"], ["trae", "Trae", "installed_no_history"]],
);
assert.equal(JSON.stringify(realtime.agent_history).includes("prompt"), false);
```

- [x] **Step 2: 运行测试确认失败**

Run: `node --test test/value-realtime-local-api.test.js`
Expected: FAIL，因为 API 尚未返回 `agent_history`。

- [x] **Step 3: 接入账本与目录发现**

读取固定六个月范围的本地账本，调用现有目录检测得到已安装来源，将安全的 `agent_history` 附在实时 API 中。当前 `sessions` 继续只取用户选择范围的真实会话，不将历史记录伪装成“正在运行”。

- [x] **Step 4: 运行后端契约测试确认通过**

Run: `node --test test/agent-history-inventory.test.js test/value-realtime-local-api.test.js test/realtime-session-view-model.test.js`
Expected: PASS。

### Task 3: 用真实清单替换实时页卡片

**Files:**
- Modify: `dashboard/src/pages/RealtimeSessionsPage.jsx:38-64,207`
- Modify: `dashboard/src/pages/RealtimeSessionsPage.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [x] **Step 1: 写入前端失败测试**

```jsx
getRealtimeSessions.mockResolvedValue({ ...payload, agent_history: [
  { source: "codex", agent_label: "Codex", history_state: "historical_usage", total_tokens: metric(100) },
  { source: "trae", agent_label: "Trae", history_state: "installed_no_history", total_tokens: metric(null) },
] });
expect(await screen.findByText("Trae")).toBeInTheDocument();
expect(screen.queryByText(/^Agent \d+$/)).not.toBeInTheDocument();
```

- [x] **Step 2: 运行测试确认失败**

Run: `npm --prefix dashboard test -- RealtimeSessionsPage.test.jsx`
Expected: 先记录仓库现有 Vitest 配置阻断；如依赖可解析，测试因未消费 `agent_history` 失败。

- [x] **Step 3: 实现页面替换**

卡片使用 `agent_label`；`historical_usage` 显示六个月真实聚合值，`installed_no_history` 显示“已检测到，暂无可读历史记录”和 `—`。没有历史、也未检测安装的 Agent 不渲染。请求数继续兼容后端指标对象，避免显示 `NaN`。

- [x] **Step 4: 浏览器验收**

以生产构建在 1600×960 与 1280×900 验证：无 `Agent N`、历史来源显示正式名、安装无历史显示 `—`、实时会话不被历史数据污染、无横向溢出或隐私泄露。

### Task 4: 质量门与验收矩阵

**Files:**
- Modify: `docs/superpowers/specs/2026-08-22-value-realtime-provenance-design.md`

- [x] **Step 1: 更新验收矩阵**

加入“历史 Agent 名称、安装无历史、六个月边界、实时/历史分离、隐私白名单”五行。

- [x] **Step 2: 执行质量门**

Run: `node --test test/agent-history-inventory.test.js test/value-realtime-local-api.test.js test/realtime-session-view-model.test.js`
Run: `npm --prefix dashboard run typecheck`
Run: `npm --prefix dashboard run build`
Run: `git diff --check`
Expected: 全部退出码为 0；完整 `npm test` 的既有长运行阻断单独记录。
