# Installed Experience Root Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 根治 0.54.27 安装态中的小组件项目选择、使用趋势与真实指标、最近 30 天官方额外重置、排行榜同步重复统计和 1970 日期五类问题，并交付经过安装态端到端验收的新安装包。

**Architecture:** 本机账本仍是 Token 与费用的唯一事实来源；新增统一的真实数据边界接口，Codex 任务生命周期指标从 rollout 原始事件计算，不伪造其他 Agent 不提供的指标。排行榜上传后通过经过身份校验和节流的云端刷新立即发布快照，重置历史由签名公告源保存经 X 原始帖二次验证的 30 天事件。

**Tech Stack:** Node.js 本地 API、React/Vite、Vitest、Node test runner、Tauri 2/Rust、InsForge PostgreSQL RPC 与 Edge Functions、Playwright、Windows NSIS。

---

## File responsibility map

- `src/lib/local-api.js`: 本地用量边界、趋势查询、请求/任务记录 API 的统一事实层。
- `src/lib/rollout.js`: 解析 Codex `task_started`、`task_complete`、`turn_aborted` 与 Token 增量。
- `dashboard/src/hooks/use-usage-date-bounds.ts`: 为累计范围解析本机最早/最晚真实数据日期。
- `dashboard/src/hooks/use-request-usage-records.ts`: 保留服务端真实总数与指标覆盖率，不把 1000 条列表上限当总数。
- `dashboard/src/pages/DesktopWidgetPage.tsx`: 只负责桌面胶囊展示和快捷切换，不再承载项目配置。
- `dashboard/src/pages/WidgetsPage.jsx`: 承载桌面小组件项目搜索、勾选和默认最近活跃规则。
- `dashboard/edge-patches/tokentracker-codex-reset-collector.ts`: 发现、验证、分类和签名最近 30 天官方额外重置。
- `dashboard/edge-patches/tokentracker-leaderboard-refresh.ts`: 区分定时器和已登录用户刷新，并调用节流 RPC。
- `dashboard/src/pages/LeaderboardPage.jsx`: 云端汇总只显示云端已发布数据；本地待同步行只作为预览，不叠加人数和总量。
- `migrations/*`: 云端排行榜节流刷新 RPC。

### Task 1: Move project selection out of the desktop capsule

**Files:**
- Modify: `dashboard/src/pages/DesktopWidgetPage.tsx`
- Modify: `dashboard/src/pages/desktop-widget.css`
- Modify: `dashboard/src/pages/WidgetsPage.jsx`
- Modify: `dashboard/src/hooks/use-desktop-widget.ts`
- Modify: `dashboard/src/content/copy.csv`
- Test: `dashboard/src/pages/DesktopWidgetPage.test.tsx`
- Test: `dashboard/src/pages/WidgetsPage.test.jsx`
- Test: `dashboard/src/hooks/__tests__/use-desktop-widget.test.tsx`

- [ ] **Step 1: Write failing capsule regression tests**

Add assertions that the compact and expanded capsule contain no project filter/menu and that mode/agent controls still work:

```tsx
expect(screen.queryByRole("button", { name: copy("widget.projects.filter") })).not.toBeInTheDocument();
expect(screen.queryByRole("menu", { name: copy("widget.projects.filter") })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the capsule tests and verify RED**

Run:

```powershell
npm --prefix dashboard test -- DesktopWidgetPage.test.tsx
```

Expected: FAIL because the project filter button currently exists in the capsule.

- [ ] **Step 3: Write failing Widgets-page configuration tests**

Render the Windows Widgets page with Tauri commands mocked. Assert that project options are searchable, selected IDs persist through `update_desktop_widget_preferences`, and clearing selection restores the “最近 24 小时活跃项目” default.

- [ ] **Step 4: Run the Widgets-page tests and verify RED**

Run:

```powershell
npm --prefix dashboard test -- WidgetsPage.test.jsx
```

Expected: FAIL because the Widgets page currently has no desktop project configuration.

- [ ] **Step 5: Implement the minimal UI move**

Remove `projectMenuAnchor`, the project `PortalMenu`, and its corner button from `DesktopWidgetPage.tsx`. Add one compact settings block to `WidgetsPage.jsx` that reads existing desktop widget preferences and writes only `selectedProjectIds`; keep appearance, pin, mode, and agent quick controls unchanged.

- [ ] **Step 6: Verify focused tests GREEN**

Run:

```powershell
npm --prefix dashboard test -- DesktopWidgetPage.test.tsx WidgetsPage.test.jsx use-desktop-widget.test.tsx
```

Expected: all selected tests PASS and there is no horizontal overflow menu inside the native widget window.

### Task 2: Replace the Unix epoch with real local data bounds

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/api.ts`
- Create: `dashboard/src/hooks/use-usage-date-bounds.ts`
- Modify: `dashboard/src/lib/date-range.ts`
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Test: `test/local-api-usage-summary.test.js`
- Test: `test/local-api-spend-timeseries.test.js`
- Test: `dashboard/src/lib/date-range.test.ts`
- Test: `dashboard/src/pages/SpendPage.test.jsx`

- [ ] **Step 1: Write failing local bounds tests**

Create queue rows beginning on `2026-02-14`, call `/functions/tokentracker-usage-bounds`, and expect:

```js
assert.deepEqual(body, {
  ok: true,
  available_from: "2026-02-14",
  available_to: "2026-07-29",
});
```

Also assert a total-range timeseries request uses those effective bounds and never returns a 1970 label.

- [ ] **Step 2: Run local API tests and verify RED**

Run:

```powershell
node --test test/local-api-usage-summary.test.js test/local-api-spend-timeseries.test.js
```

Expected: FAIL because `tokentracker-usage-bounds` does not exist and epoch input is not clamped.

- [ ] **Step 3: Write failing dashboard range tests**

Assert `resolveUsageDateRange("total", { availableFrom: "2026-02-14", availableTo: "2026-07-29" })` returns those dates and that SpendPage waits for bounds before requesting summary, trends, providers, and models.

- [ ] **Step 4: Run dashboard tests and verify RED**

Run:

```powershell
npm --prefix dashboard test -- date-range.test.ts SpendPage.test.jsx
```

Expected: FAIL because total still resolves to `1970-01-01`.

- [ ] **Step 5: Implement the bounds endpoint and hook**

Derive bounds from deduplicated queue rows. Return `null` bounds for an empty ledger. Use one shared hook on Dashboard and Spend pages so all parallel requests receive exactly the same effective range.

- [ ] **Step 6: Verify focused tests GREEN**

Run the commands from Steps 2 and 4. Expected: PASS, with no request whose `from` begins with `1970`.

### Task 3: Link success and latency to real Codex task events

**Files:**
- Modify: `src/lib/rollout.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/hooks/use-request-usage-records.ts`
- Modify: `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Test: `test/rollout-request-records.test.js`
- Test: `test/local-api-request-usage-records.test.js`
- Test: `dashboard/src/hooks/__tests__/use-request-usage-records.test.tsx`
- Test: `dashboard/src/ui/dashboard/components/RequestUsageLog.test.jsx`

- [ ] **Step 1: Write failing rollout lifecycle tests**

Use a synthetic rollout containing:

```json
{"timestamp":"2026-07-29T10:00:00.000Z","type":"event_msg","payload":{"type":"task_started","turn_id":"turn-1","started_at":"2026-07-29T10:00:00.000Z"}}
{"timestamp":"2026-07-29T10:00:03.000Z","type":"event_msg","payload":{"type":"task_complete","turn_id":"turn-1","duration_ms":3000,"time_to_first_token_ms":420}}
```

Expect one measured task with `status: "success"`, `latency_ms: 3000`, and `first_token_ms: 420`; add an aborted turn expecting `status: "aborted"`.

- [ ] **Step 2: Run parser tests and verify RED**

Run:

```powershell
node --test test/rollout-request-records.test.js
```

Expected: FAIL because lifecycle events are currently ignored.

- [ ] **Step 3: Write failing API and UI tests**

Assert totals contain the untruncated `record_count`, `measured_count`, `success_rate`, and `avg_latency_ms`. Assert the UI labels these as Codex task metrics and hides success/latency cards for aggregate-only agents instead of showing inert dashes.

- [ ] **Step 4: Run API/UI tests and verify RED**

Run:

```powershell
node --test test/local-api-request-usage-records.test.js
npm --prefix dashboard test -- use-request-usage-records.test.tsx RequestUsageLog.test.jsx
```

Expected: FAIL because the list limit is used as the count and metrics are null.

- [ ] **Step 5: Implement measured task aggregation**

Pair task lifecycle events by `turn_id`, aggregate Token deltas within the task window, and compute success/latency only from measured tasks. Preserve aggregate-only records for other sources, but mark their metric availability explicitly and never manufacture values.

- [ ] **Step 6: Verify focused tests GREEN**

Run Steps 2 and 4 commands. Expected: PASS; a 1000-row display limit no longer reports “1000 requests” when more records exist.

### Task 4: Backfill and continuously collect 30 days of official extra resets

**Files:**
- Modify: `dashboard/edge-patches/tokentracker-codex-reset-collector.ts`
- Modify: `src/lib/codex-reset-feed.js`
- Modify: `src/lib/codex-reset-monitor-service.js`
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/pages/ResetHistoryPage.tsx`
- Modify: `dashboard/src/content/copy.csv`
- Test: `test/codex-reset-collector-edge.test.js`
- Test: `test/codex-reset-feed.test.js`
- Test: `test/codex-reset-monitor-service.test.js`
- Test: `dashboard/src/pages/ResetHistoryPage.test.tsx`

- [ ] **Step 1: Write failing 30-day collector tests**

Seed the 13 independently verified X post IDs from `2071740419030053227` through `2082317452755751098`. Assert the collector retains all events still inside the rolling 30-day window, verifies author/post URL through X oEmbed, classifies `hard`, `banked`, or `mixed`, and excludes “准备重置” posts that do not confirm completion.

- [ ] **Step 2: Run collector/feed tests and verify RED**

Run:

```powershell
node --test test/codex-reset-collector-edge.test.js test/codex-reset-feed.test.js test/codex-reset-monitor-service.test.js
```

Expected: FAIL because discovery is restricted to 48 hours and the signed contract lacks reset kind/scope.

- [ ] **Step 3: Write failing history UI tests**

Assert each row displays exact local date/time, source `Tibo @thsottiaux · X`, reset type/scope, and an exact original-post link.

- [ ] **Step 4: Run history tests and verify RED**

Run:

```powershell
npm --prefix dashboard test -- ResetHistoryPage.test.tsx
```

Expected: FAIL because only title/summary/time are rendered.

- [ ] **Step 5: Implement verified historical backfill**

Use a rolling 30-day window, keep future timeline polling, verify every seeded or discovered ID against X before signing it, and preserve events in the feed until expiry. Do not accept reposts, screenshots, or third-party summaries as signed events.

- [ ] **Step 6: Deploy and verify the feed**

Run:

```powershell
npx @insforge/cli functions deploy tokentracker-codex-reset-collector --file dashboard/edge-patches/tokentracker-codex-reset-collector.ts
npx @insforge/cli functions invoke tokentracker-codex-reset-collector --method POST
```

Then fetch the public signed feed, verify its signature locally, and assert the expected in-window event count, exact timestamps, and source URLs.

### Task 5: Publish leaderboard snapshots immediately and stop local/cloud double counting

**Files:**
- Create: `migrations/<version>_add-throttled-leaderboard-refresh.sql`
- Modify: `dashboard/edge-patches/tokentracker-leaderboard-refresh.ts`
- Modify: `dashboard/src/lib/leaderboard-state-client.ts`
- Modify: `dashboard/src/hooks/use-leaderboard-participation-sync.ts`
- Modify: `dashboard/src/pages/LeaderboardPage.jsx`
- Test: `test/leaderboard-schema-contract.test.js`
- Test: `dashboard/src/lib/__tests__/leaderboard-state-client.test.ts`
- Test: `dashboard/src/hooks/__tests__/use-leaderboard-participation-sync.test.tsx`
- Test: `dashboard/src/pages/LeaderboardPage.test.jsx`

- [ ] **Step 1: Write failing frontend aggregation tests**

Given one stale cloud entry and one local pending preview, expect cloud participant/token/cost summaries to remain unchanged. The pending row may render with “待同步”, but it must not increment official aggregate cards.

- [ ] **Step 2: Run leaderboard UI tests and verify RED**

Run:

```powershell
npm --prefix dashboard test -- LeaderboardPage.test.jsx
```

Expected: FAIL because the page currently adds local pending tokens and one participant.

- [ ] **Step 3: Write failing publish-flow tests**

Assert a successful state upload calls authenticated leaderboard refresh, while refresh failure leaves the state pending and visible for retry. Assert the Edge function rejects anonymous callers, accepts a valid user session, and uses a server-side throttled refresh RPC.

- [ ] **Step 4: Run publish-flow tests and verify RED**

Run:

```powershell
npm --prefix dashboard test -- leaderboard-state-client.test.ts use-leaderboard-participation-sync.test.tsx
node --test test/leaderboard-schema-contract.test.js
```

Expected: FAIL because upload and snapshot publication are currently disconnected and the refresh Edge function only accepts the scheduler secret.

- [ ] **Step 5: Implement and apply the cloud fix**

Create a service-only RPC that skips a refresh when the requested periods have a sufficiently fresh complete snapshot and otherwise calls `refresh_leaderboard_snapshots`. Verify the Edge function’s bearer token with InsForge auth before invoking the service RPC. Keep scheduler-secret behavior unchanged.

Run:

```powershell
npx @insforge/cli db migrations up <exact-new-migration-file>
npx @insforge/cli functions deploy tokentracker-leaderboard-refresh --file dashboard/edge-patches/tokentracker-leaderboard-refresh.ts
```

- [ ] **Step 6: Verify production state end to end**

Upload the current local compact state through the installed app flow, wait for publication, then assert:

```text
public snapshot generated_at > upload captured_at - throttle window
participant count is not incremented by a local preview
current authenticated user has one row
aggregate total equals the published rows
```

### Task 6: Token correctness and display provenance

**Files:**
- Modify: `dashboard/src/pages/SpendPage.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `scripts/audit-token-correctness.cjs`
- Test: `test/token-audit.test.js`
- Test: `dashboard/src/pages/SpendPage.test.jsx`

- [ ] **Step 1: Write failing audit/display tests**

Assert the audit reports deduplicated totals, raw row count, unique bucket count, malformed rows, invariant delta, and real covered date range. Assert the UI identifies cumulative Token as local-ledger data and shows its covered range/update time.

- [ ] **Step 2: Verify RED**

Run:

```powershell
node --test test/token-audit.test.js
npm --prefix dashboard test -- SpendPage.test.jsx
```

- [ ] **Step 3: Implement minimal provenance**

Keep 8.022B as the current deduplicated ledger total, expose the real data window, and avoid claiming unsupported request-level precision. Do not alter Token arithmetic merely to make the number look larger.

- [ ] **Step 4: Verify GREEN and run the live audit**

Run:

```powershell
npm run audit:tokens
```

Expected: no malformed rows; API total equals the sum of deduplicated source totals; any legacy invariant delta is surfaced explicitly.

### Task 7: Version, package, install, and perform installed-state acceptance

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `dashboard/package.json`
- Modify: `dashboard/package-lock.json`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `TokenTrackerWin/TokenTrackerWin.csproj`
- Modify: `TokenTrackerBar/project.yml`

- [ ] **Step 1: Run focused suites and full builds**

Run all tests listed above, then:

```powershell
npm test
npm --prefix dashboard test
npm --prefix dashboard run build
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 2: Bump the release version consistently**

Advance from `0.54.27` to the next patch version in every package/native manifest and assert the version consistency tests pass.

- [ ] **Step 3: Build the NSIS installer**

Run the repository release build command from `CLAUDE.md`; verify the resulting installer exists under `src-tauri/target/release/bundle/nsis/`.

- [ ] **Step 4: Install into an isolated QA directory**

Install the new package without overwriting the currently running user copy. Start the packaged executable and verify the embedded server, app shell, and widget native window.

- [ ] **Step 5: Execute Playwright/native acceptance**

Verify all of the following against the packaged build:

```text
1. Capsule has no project selector and cannot become trapped in a menu.
2. Widgets page can search/select projects and the capsule updates.
3. Total usage trend loads with a real first date and never shows 1970.
4. Codex task success/latency use real measured lifecycle data; unsupported agents are truthful.
5. Reset history shows all currently in-window verified events with exact source/time.
6. Leaderboard shows one logical current-user row and no local/cloud aggregate double count.
7. Token total matches the live ledger audit and shows its data window.
```

- [ ] **Step 6: Deliver only after installed-state evidence is captured**

Record installer path, packaged version, live endpoint checks, screenshots, and any remaining limitations. A passing unit suite without packaged acceptance is not completion.
