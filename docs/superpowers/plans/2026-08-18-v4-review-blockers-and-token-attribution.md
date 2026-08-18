# V4 Review Blockers and Token Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `0.54.40-V4` 审查确认的前 8 项重要问题，并为每条可追踪 Token 用量写入可信的订阅/API 来源事实；无法确认的历史或新记录必须保持 `unknown`，绝不自动猜测为订阅或 API。

**Architecture:** 用请求/解析阶段产生的显式 `billing_mode` 和非敏感路由证据作为唯一高可信来源；聚合层只消费该事实，不从模型名推导财务结论。成本展示拆成 Token 用量、API 标价等价价值、真实现金支出三套账；订阅费只进入现金账，订阅 Token 的 API 标价只进入等价价值账。

**Tech Stack:** Node.js CommonJS、React、Vite、Tauri/Rust、`node:test`、Vitest/Testing Library、现有 Token Eyes 本地队列与 Tracker 配置。

---

## 0. 锁定范围与交付规则

### 必须修复的 8 项问题

1. DeepSeek Harness `total_tokens` 漏算 reasoning Token。
2. DeepSeek Harness 跨半小时/跨日用量全部归入最后一个时间桶。
3. 官方 API 实际现金支出使用生产端不会返回的 `official_api` 枚举，导致通路不可达。
4. Vite 构建及测试会读取用户真实 `relay-cookies.json`。
5. 每日模型明细缓存只按日期索引，可能跨账户、模式、服务地址或时区复用。
6. 多供应商余额并发刷新时，全局 `stale` 被最后完成的请求覆盖。
7. 小组件额度窗口全局排序后截断为 24 行，静默丢失真实窗口。
8. 没有 `quota_windows` 的套餐把有效期同时伪装成额度重置时间。

### 同轮新增能力

- 每条新产生或新解析的用量记录写入 `billing_mode`：`token_plan | api_key | unknown`。
- 汇总结果允许出现 `mixed`，但单条记录不得写入 `mixed`。
- 写入非敏感归属证据：provider、endpoint origin、账户/套餐引用、凭证引用、识别依据和可信度；禁止写入 API Key、Cookie、Authorization、完整查询参数。
- 旧记录没有确定证据时保持 `unknown`；不得用模型名、套餐名或“通常如此”批量改写。
- 用户之后可以批量校正未知记录，但本轮不实现交互式校正 UI；只保留数据契约和后续扩展点。

### 明确不做

- 不把 Token × API 公开单价当成真实现金支出。
- 不把订阅套餐的有效期当作额度重置时间。
- 不根据模型名称自动断言请求来自订阅或 API Key。
- 不保存任何明文凭证。
- 不在任务完成并确认已合并前清理功能分支、远端分支或工作树；合并后仍等待用户明确清理指令。

## 1. 统一数据与财务口径

### 1.1 单条用量归属

```js
const BILLING_MODES = Object.freeze({
  TOKEN_PLAN: "token_plan",
  API_KEY: "api_key",
  UNKNOWN: "unknown",
});

// 单条记录示意；字段名实施时应沿用现有 queue schema 命名风格。
const attribution = {
  billing_mode: "unknown",
  billing_mode_confidence: "explicit_runtime | provider_receipt | user_override | unavailable",
  provider_id: "openai",
  endpoint_origin: "https://api.openai.com",
  account_ref: null,
  plan_ref: null,
  credential_ref: null,
};
```

可信度优先级：

1. `explicit_runtime`：发起请求的运行时明确知道使用的是官方订阅会话还是 API Key。
2. `provider_receipt`：供应商账单或套餐额度变化能够与请求可靠关联。
3. `user_override`：用户对未知记录执行显式校正。
4. `unavailable`：没有充分证据，必须为 `unknown`。

模型关键词、套餐名称相似度只能用于提示用户，不能写成财务事实。

### 1.2 三套账

```text
Token 用量账 = 按来源、模型、billing_mode 统计各 Token 分量

API 等价价值 = 输入费用 + 缓存读取费用 + 缓存写入费用
             + 输出费用 + 推理 Token 费用

真实现金支出 = 已支付订阅费 + 官方 API 实际账单 + 已记录其他 AI 支出
```

订阅价值指标：

```text
订阅节省价值 = max(0, 订阅通道 API 等价价值 - 订阅真实现金支出)
订阅价值倍率 = 订阅通道 API 等价价值 / 订阅真实现金支出
```

例如订阅真实支付 `$20`、Token 的 API 等价价值 `$30`：真实支出仍为 `$20`，等价价值 `$30`，节省价值 `$10`，价值倍率 `1.5x`。

若需要逐请求“订阅成本分摊”，只能作为分析字段：

```text
请求分摊成本 = 账期订阅费 × 请求 API 等价价值 / 账期订阅 API 等价总价值
```

该字段必须标注为 `allocated`，不得展示为供应商真实扣款。本轮不要求实现逐请求分摊。

## 2. 文件责任图

- `src/lib/usage-attribution.js`（新增）：统一 billing mode、证据净化、可信度和汇总规则。
- `src/lib/rollout.js`：解析器写入归属字段；修复 DeepSeek reasoning 总数和分桶。
- `src/lib/local-api.js`：聚合显式归属；旧记录无证据时返回 `unknown`；隔离 handler 持久目录。
- `src/lib/api-billing.js`：统一真实 API 账单的 wire enum/权威性字段。
- `dashboard/src/hooks/use-cost-accumulation.js`：严格分开等价价值与真实现金支出。
- `dashboard/src/hooks/use-provider-api-balances.js`：从全部账户状态派生全局 stale。
- `dashboard/src/ui/dashboard/components/DataDetails.jsx`：为每日明细缓存建立完整 scope key。
- `src/lib/widget-view-model.js`：不截断真实额度窗口，不伪造 resetAt。
- `dashboard/vite.config.js`：只在开发服务器真正启动时创建本地 API handler。
- `test/usage-attribution.test.js`（新增）：归属数据契约、净化和 unknown 策略。
- 现有对应测试：逐项增加失败测试，不新建重复测试体系。

---

### Task 1: 建立 Token 来源写入契约

**Files:**
- Create: `src/lib/usage-attribution.js`
- Create: `test/usage-attribution.test.js`
- Modify: `src/lib/rollout.js`
- Modify: `src/lib/local-api.js`
- Test: `test/billing-mode-derivation.test.js`

- [ ] **Step 1: 先写失败测试，锁定显式事实优先和未知不猜测**

```js
test("explicit billing mode is preserved with sanitized route evidence", () => {
  const result = normalizeUsageAttribution({
    billing_mode: "api_key",
    provider_id: "deepseek",
    endpoint: "https://api.deepseek.com/v1/chat?api_key=secret",
    credential_ref: "provider-api/deepseek/main/123",
  });
  assert.equal(result.billing_mode, "api_key");
  assert.equal(result.endpoint_origin, "https://api.deepseek.com");
  assert.equal(result.credential_ref, "provider-api/deepseek/main/123");
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("missing evidence remains unknown even when model name resembles a plan", () => {
  const result = normalizeUsageAttribution({ model: "mimo-coding-plan" });
  assert.equal(result.billing_mode, "unknown");
  assert.equal(result.billing_mode_confidence, "unavailable");
});
```

- [ ] **Step 2: 运行测试确认 RED**

Run: `node --test test/usage-attribution.test.js test/billing-mode-derivation.test.js`

Expected: FAIL，原因是统一归属模块尚不存在，且旧派生逻辑仍可能根据关键词判断。

- [ ] **Step 3: 实现最小归属模块**

模块必须只接受白名单字段，使用 `new URL(value).origin` 去除路径、查询和凭证；非法 URL 写 `null`。只规范显式 `token_plan/api_key/unknown`，其他值降级为 `unknown`。

- [ ] **Step 4: 在解析/队列写入边界接入，而不是只在 UI 查询时推断**

每个能确认运行通道的 adapter/parser 写入显式 `billing_mode`；不能确认的 parser 写 `unknown`。`local-api` 可以聚合旧字段，但不得把启发式结果升级成高可信事实。

- [ ] **Step 5: 验证 GREEN 和敏感信息扫描**

Run: `node --test test/usage-attribution.test.js test/billing-mode-derivation.test.js`

Run: `rg -n "api_key=|Authorization:|Bearer " test/.tmp .artifacts 2>$null`

Expected: 测试 PASS；生成证据中不存在凭证明文。

- [ ] **Step 6: 提交独立归属契约**

```bash
git add src/lib/usage-attribution.js src/lib/rollout.js src/lib/local-api.js test/usage-attribution.test.js test/billing-mode-derivation.test.js
git commit -m "feat: record trusted token billing attribution"
```

### Task 2: 修复 DeepSeek Harness reasoning Token 不变量

**Files:**
- Modify: `src/lib/rollout.js:5825-5842`
- Modify: `test/deepseek-harness-parser.test.js`

- [ ] **Step 1: 将现有错误预期改为正确求和，并增加纯 reasoning 用例**

```js
assert.equal(row.total_tokens, 200); // 120 + 30 + 0 + 40 + 10
assert.equal(row.reasoning_output_tokens, 10);

// 纯 reasoning 记录不能被丢弃。
assert.equal(reasoningOnly.total_tokens, 9);
assert.equal(reasoningOnly.reasoning_output_tokens, 9);
```

- [ ] **Step 2: 运行目标测试确认 RED**

Run: `node --test test/deepseek-harness-parser.test.js`

Expected: FAIL，旧实现返回 190，并丢弃纯 reasoning 记录。

- [ ] **Step 3: 最小修复总数公式**

```js
const total = input + cacheRead + cacheWrite + output + reasoning;
```

- [ ] **Step 4: 验证 parser、聚合和 billable 总数一致**

Run: `node --test test/deepseek-harness-parser.test.js test/usage-caliber-consistency.test.js`

Expected: PASS；每条记录满足所有 Token 分量之和等于 `total_tokens`。

- [ ] **Step 5: 提交**

```bash
git add src/lib/rollout.js test/deepseek-harness-parser.test.js
git commit -m "fix: include reasoning in harness token totals"
```

### Task 3: 修复 DeepSeek Harness 跨时间桶归档

**Files:**
- Modify: `src/lib/rollout.js:5855-5901`
- Modify: `src/lib/rollout.js:5957-5990`
- Modify: `test/deepseek-harness-parser.test.js`

- [ ] **Step 1: 写跨三个半小时桶和跨日失败测试**

测试必须构造同一模型在 `10:05`、`10:35`、`11:05` 三次累计用量，以及 `23:55`→次日 `00:05`；断言每个增量进入对应 UTC 半小时桶，而不是全部进入最后一个桶。

- [ ] **Step 2: 运行确认 RED**

Run: `node --test test/deepseek-harness-parser.test.js`

Expected: FAIL，旧实现只生成最后时间戳对应的桶。

- [ ] **Step 3: 将文件累计状态改为 `(model, bucketStart)` 维度**

`extractDeepSeekHarnessFileTotals` 返回每模型、每半小时桶的累计 totals；cursor 保存相同维度。追加解析时对每个桶分别 diff，禁止将模型总增量重新归入最后桶。

- [ ] **Step 4: 增加 cursor 版本并提供一次性可验证重扫**

旧 cursor 结构必须被识别为旧版本并触发 DeepSeek Harness 数据重建；不得将新旧状态直接混算。重建只作用于 `deepseek-harness` 来源。

- [ ] **Step 5: 验证首次导入、追加、跨日、重复同步幂等**

Run: `node --test test/deepseek-harness-parser.test.js test/usage-caliber-consistency.test.js`

Expected: PASS；第二次无变化同步新增 Token 为 0。

- [ ] **Step 6: 提交**

```bash
git add src/lib/rollout.js test/deepseek-harness-parser.test.js test/usage-caliber-consistency.test.js
git commit -m "fix: preserve harness token time buckets"
```

### Task 4: 打通官方 API 真实现金账并分开三套账

**Files:**
- Modify: `src/lib/api-billing.js`
- Modify: `dashboard/src/hooks/use-cost-accumulation.js`
- Modify: `test/api-billing-api.test.js`
- Modify: `dashboard/src/hooks/use-cost-accumulation.test.jsx`

- [ ] **Step 1: 写生产协议契约测试**

API billing DTO 必须显式区分：

```js
{
  billingSource: "api",
  spendAuthority: "official_invoice" | "local_list_price_estimate" | "unavailable",
  monthCostUsd: 7,
}
```

只有 `spendAuthority === "official_invoice"` 的金额可以进入真实现金账。

- [ ] **Step 2: 写三套账失败测试**

输入：订阅现金 `$20`、订阅 Token API 等价 `$30`、官方 API 账单 `$8`。断言：实际现金 `$28`、API 等价价值单独展示、订阅节省 `$10`，不得得到 `$58`。

- [ ] **Step 3: 运行确认 RED**

Run: `node --test test/api-billing-api.test.js`

Run: `npm --prefix dashboard test -- --run src/hooks/use-cost-accumulation.test.jsx`

- [ ] **Step 4: 统一后端和前端 wire contract**

删除前端对生产端不会产生的 `official_api` 字符串依赖。若供应商无法提供官方发票/扣款数据，返回 `unavailable`，现金覆盖度必须为 `partial`，不能用本地 Token 折价补齐。

- [ ] **Step 5: 验证缺失、部分、完整三种覆盖状态**

Expected: 本地标价只能进入 `monthApiEquivalentUsd`；官方账单才能进入 `monthOfficialApiSpendUsd`。

- [ ] **Step 6: 提交**

```bash
git add src/lib/api-billing.js dashboard/src/hooks/use-cost-accumulation.js test/api-billing-api.test.js dashboard/src/hooks/use-cost-accumulation.test.jsx
git commit -m "fix: separate actual spend from token equivalent value"
```

### Task 5: 隔离 Vite 构建和测试的 Cookie 持久目录

**Files:**
- Modify: `dashboard/vite.config.js:1249-1256`
- Modify: `src/lib/local-api.js:2245-2276`
- Modify: `test/usage-caliber-consistency.test.js`
- Modify: 所有直接创建 `createLocalApiHandler()` 的测试辅助函数

- [ ] **Step 1: 写构建期不得实例化 handler 的失败测试**

测试设置一个会在读取时抛错的用户 Cookie 路径，加载生产 Vite config；断言 build 配置生成过程不会访问该路径。

- [ ] **Step 2: 写测试目录隔离契约**

所有测试 handler 必须显式传入 `trackerDataDir`，并断言 resolved path 位于当前测试临时目录。测试结束后只删除自己创建的目录。

- [ ] **Step 3: 运行确认 RED**

Run: `node --test test/usage-caliber-consistency.test.js test/windows-bundled-runtime-smoke.test.cjs`

- [ ] **Step 4: 将 handler 创建移入 `configureServer`**

生产 build 读取 Vite 配置时不得创建本地 handler。开发服务器启动后才创建，并使用明确的开发持久目录。

- [ ] **Step 5: 让测试辅助函数默认拒绝真实用户目录**

测试环境缺少显式 `trackerDataDir` 时直接失败，不得回退到 `os.homedir()`。

- [ ] **Step 6: 验证日志和真实目录均未被读取**

Run: `npm run ci:local`

Expected: 输出中不再出现真实 `relay-cookies.json` 路径；用户 Cookie 文件的时间戳与内容哈希保持不变。

- [ ] **Step 7: 提交**

```bash
git add dashboard/vite.config.js src/lib/local-api.js test
git commit -m "test: isolate local api cookie persistence"
```

### Task 6: 为每日明细缓存增加完整作用域

**Files:**
- Modify: `dashboard/src/ui/dashboard/components/DataDetails.jsx:94-95`
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify: `dashboard/src/ui/dashboard/components/DataDetails.test.jsx`

- [ ] **Step 1: 写 A→B 同日切换失败测试**

同一天先在账户 A/本地/UTC 加载，再切到账户 B/云端/Asia/Shanghai；断言必须重新请求且不短暂展示 A 的明细。

- [ ] **Step 2: 运行确认 RED**

Run: `npm --prefix dashboard test -- --run src/ui/dashboard/components/DataDetails.test.jsx`

- [ ] **Step 3: 构造稳定 scope key**

```js
const cacheKey = JSON.stringify({
  day,
  accountId: accountId || "local",
  mode,
  baseUrl,
  timeZone,
  sources: [...sources].sort(),
});
```

loader 或 scope 改变时取消旧请求；旧响应不得覆盖新 scope。

- [ ] **Step 4: 验证同 scope 命中、跨 scope 隔离和竞态响应**

Expected: 相同 scope 同日只请求一次；任何 scope 字段变化均重新请求。

- [ ] **Step 5: 提交**

```bash
git add dashboard/src/ui/dashboard/components/DataDetails.jsx dashboard/src/pages/DashboardPage.jsx dashboard/src/ui/dashboard/components/DataDetails.test.jsx
git commit -m "fix: scope daily detail cache by account context"
```

### Task 7: 消除供应商余额 stale 竞态

**Files:**
- Modify: `dashboard/src/hooks/use-provider-api-balances.js:84-176`
- Modify: `dashboard/src/hooks/use-provider-api-balances.test.js`

- [ ] **Step 1: 写两种完成顺序的失败测试**

账户 A 失败、账户 B 成功；分别让 A 和 B 最后完成。两种情况下全局 `stale` 都必须为 `true`。缓存里任一账户为 stale 时，初始全局状态也必须为 stale。

- [ ] **Step 2: 运行确认 RED**

Run: `npm --prefix dashboard test -- --run src/hooks/use-provider-api-balances.test.js`

- [ ] **Step 3: 由完整账户集合派生 stale**

`refreshOne` 只更新对应账户，不直接覆盖全局 `stale`。`refreshAll` 汇总所有启用账户的最终结果；只有全部目标账户 `status === "synced"` 才能清除 stale。

- [ ] **Step 4: 验证成功/失败/超时/缓存四类组合**

Expected: 请求完成顺序不影响最终状态；失败账户的上次余额保留但明确为 stale。

- [ ] **Step 5: 提交**

```bash
git add dashboard/src/hooks/use-provider-api-balances.js dashboard/src/hooks/use-provider-api-balances.test.js
git commit -m "fix: aggregate provider balance freshness"
```

### Task 8: 保留全部真实套餐额度窗口

**Files:**
- Modify: `src/lib/widget-view-model.js:220-247`
- Modify: `test/windows-widget-contract.test.js`
- Modify: `dashboard/src/pages/DesktopWidgetPage.test.tsx`

- [ ] **Step 1: 写 10 套餐 × 3 窗口失败测试**

断言30个真实窗口全部存在，每个套餐三个窗口保持相邻且内部顺序稳定；不得出现套餐只有部分窗口。

- [ ] **Step 2: 运行确认 RED**

Run: `node --test test/windows-widget-contract.test.js`

Expected: FAIL，旧实现只返回24行。

- [ ] **Step 3: 移除数据层任意截断并按套餐原子分组**

数据层不得丢记录。若 UI 需要控制性能，应使用虚拟滚动或套餐级分页，但分页前后的总数和所有真实窗口必须可达。

- [ ] **Step 4: 验证小组件滚动到底可见最后一个真实窗口**

Run: `npm --prefix dashboard test -- --run src/pages/DesktopWidgetPage.test.tsx`

Expected: PASS；最后一项可通过真实滚动到达。

- [ ] **Step 5: 提交**

```bash
git add src/lib/widget-view-model.js test/windows-widget-contract.test.js dashboard/src/pages/DesktopWidgetPage.test.tsx
git commit -m "fix: preserve all widget quota windows"
```

### Task 9: 分离套餐有效期与额度重置时间

**Files:**
- Modify: `src/lib/widget-view-model.js:418-439`
- Modify: `test/windows-widget-contract.test.js`
- Modify: `dashboard/src/pages/DesktopWidgetPage.test.tsx`

- [ ] **Step 1: 写 fallback 分支失败测试**

只有 `expires_at`、没有 `quota_windows/reset_at` 的套餐必须得到：

```js
assert.equal(limit.resetAt, null);
assert.equal(limit.expiresAt, "2026-09-01T00:00:00.000Z");
```

- [ ] **Step 2: 运行确认 RED**

Run: `node --test test/windows-widget-contract.test.js`

- [ ] **Step 3: 缺少官方重置事实时保持 null**

删除 `resetAt: expiresAt` 映射。UI 显示“重置时间不可用”，并独立显示套餐有效期；不得合成重置日期。

- [ ] **Step 4: 验证四种组合**

覆盖：两者都有、只有 reset、只有 expires、两者都无。断言每个字段和文案严格对应自身事实。

- [ ] **Step 5: 提交**

```bash
git add src/lib/widget-view-model.js test/windows-widget-contract.test.js dashboard/src/pages/DesktopWidgetPage.test.tsx
git commit -m "fix: separate quota reset from plan expiry"
```

## 3. 旧数据迁移与兼容规则

- DeepSeek Harness：reasoning 总数和时间桶修复后，必须对该来源执行版本化重扫；重扫前后记录总量、桶数量和日期范围。
- 其他旧用量：有显式历史 `billing_mode` 的保留；无显式证据的一律为 `unknown`。
- 不允许仅凭当前存在某个订阅套餐，把同 source 的全部旧记录改成 `token_plan`。
- 不允许仅凭检测到 API Key，把全部旧记录改成 `api_key`。
- 聚合 API 必须返回 `unknown` Token 和等价价值，使总数守恒：

```text
all = token_plan + api_key + unknown
```

- 迁移必须可重复执行；第二次执行不得新增或重复计算用量。

## 4. 最终验证门禁

- [ ] 所有新增行为均保留“失败测试 → 最小实现 → 目标测试通过”证据。
- [ ] `node --test test/deepseek-harness-parser.test.js test/usage-attribution.test.js test/billing-mode-derivation.test.js test/usage-caliber-consistency.test.js test/api-billing-api.test.js test/windows-widget-contract.test.js`
- [ ] Dashboard 聚焦测试全部通过，且没有新的 React `act(...)` 警告。
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --lib`
- [ ] `npm run ci:local`
- [ ] `npm run tauri:build:ci`
- [ ] `git diff --check`
- [ ] 构建和测试未读取或修改真实用户 Cookie/凭证目录。
- [ ] 三套账以固定 fixture 验证：订阅 `$20`、订阅等价 `$30`、API 官方账单 `$8` → 真实现金 `$28`，订阅节省 `$10`。
- [ ] 旧数据 unknown 守恒；不得为了提高识别率减少 unknown。
- [ ] 功能分支、本地远端和目标分支提交关系已核验。
- [ ] 合并到 `0.54.40-V4` 后重新运行关键门禁。
- [ ] 合并后保留功能分支、远端分支和工作树，等待用户明确清理指令。

## 5. 完成定义

只有以下条件全部满足，任务才可汇报完成：

1. 前8项问题均有先失败后通过的回归测试。
2. 新用量记录携带可信 `billing_mode` 或明确 `unknown`，且证据字段不含秘密。
3. Token 总量在订阅、API、未知三类之间守恒。
4. API 等价价值、真实现金支出、订阅价值三者没有重复相加。
5. DeepSeek Harness 旧错误数据完成可验证、幂等的定向重建。
6. 全量门禁和生产构建通过。
7. 独立代码审查没有未解决的 Critical/Important。
8. 提交、推送、合并均经过明确状态核验；合并后不清理任何分支或工作树。
