> **Task 6 status (2026-07-19):** DONE_WITH_CONCERNS — see `docs/test-reports/provider-api/2026-07-19-final-adversarial-acceptance.md`. Cover-install done; Cursor/TRAE live E2E and MoM UI parity still open.
# Token Eyes 成本环比、花销卡片与 Cursor/TRAE 实时检测修复执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 核实并修正成本环比口径，彻底消除自定义花销卡片金额裁切，并使 Cursor、TRAE 多账号授权及实时用量与 Cockpit Tools 的同账号结果一致。

**Architecture:** 成本环比先从原始时间序列建立可审计的数据口径，再由纯函数生成文案；卡片布局以“金额完整可读”为硬约束做响应式布局；Cursor/TRAE 不再以“已保存授权”为成功，而以“账号身份已绑定且真实额度接口成功解析”为成功。所有供应商实现必须保存独立账号标识和独立授权引用，失败时保留真实错误，禁止回退为虚假的 `0` 或“已连接”。

**Tech Stack:** React 18、Vite 7、Vitest、Testing Library、Playwright、Tauri 2、Rust 1.85、Reqwest、Serde。

---

## 一、交接边界与现状

### 1. 唯一执行目录

本计划针对以下工作树，不要在主工作树重复实现：

```text
D:\04-AI-Project\010-Token eye\.worktrees\provider-api
```

分支：

```text
codex/token-eyes-provider-api
```

该工作树目前有未提交改动。接手者必须先执行：

```powershell
git -C "D:\04-AI-Project\010-Token eye\.worktrees\provider-api" status --short
git -C "D:\04-AI-Project\010-Token eye\.worktrees\provider-api" diff --stat
```

禁止使用 `git reset --hard`、`git checkout -- .` 或删除现有用户改动。

### 2. 本工单只处理四个结果

1. “较上月新增/减少”可被原始数据证明，时间区间口径明确。
2. 自定义花销卡片在支持的窗口宽度下完整显示名称和金额。
3. Cursor 多账号授权、独立绑定、实时额度刷新与 Cockpit Tools 同账号一致。
4. TRAE OAuth 不再 404，授权完成后显示真实套餐次数、剩余额度和重置时间。

不得顺手重构其他模块，不得修改本项目以外的软件或文件。

### 3. 当前已确认事实

- 环比公式位于 `dashboard/src/ui/dashboard/components/CostAccumulation.jsx:43`，当前按 `(本月 - 上月) / 上月 × 100%` 计算。
- 月份区间位于 `dashboard/src/lib/date-range.ts:99`。当前本月区间按完整自然月边界生成，接口没有未来数据时实际成为“本月至今”；上月则是完整自然月，二者不是严格同周期比较。
- 截图中的 `401.9%`、`405.8%` 数学上可能成立，但没有对当前月、上月原始账目进行逐条核账，不能判定为真实正确。
- 自定义花销卡片位于 `dashboard/src/ui/dashboard/components/CostAccumulation.jsx:193`，大屏强制四列，卡片内部再分三列，金额外层使用 `truncate`，这是文字裁切的直接原因。
- Cursor 已使用 `loginDeepControl`、`auth/poll`、`/api/usage-summary` 等方向，但当前只证明“存在代码”，没有证明真实账号响应正确解析；用户界面仍显示 `0`。
- TRAE 当前会把登录引导返回的 host 的路径强制改为 `/authorization`。如果 host 是 `api.trae.cn`，可能得到错误的 `https://api.trae.cn/authorization`，而用户提供的 Cockpit Tools 成功链接使用 `https://www.trae.cn/authorization?...`。
- 之前的测试偏向模拟 JSON、字符串和 CSS 类名断言，没有覆盖真实授权、真实响应字段和实际窗口裁切，因此不能作为完成证据。

### 4. 参考证据

用户提供的 Cockpit Tools 截图：

- Cursor 多账号实时用量：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-7c802e62-eaa3-47e6-a4db-fbe1548a734f.png`
- Cursor OAuth：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-b78054ee-2bae-44f5-98c6-f4512b4313d2.png`
- TRAE 实时额度：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-2a41817b-eeaf-4828-839d-716fab6f825e.png`
- TRAE OAuth：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-353ed59c-fc96-4991-9698-edf86b2d0201.png`

Cockpit Tools 参考仓库：

```text
https://github.com/jlcodes99/cockpit-tools
```

参考时必须完整追踪 OAuth URL、轮询、令牌持久化、账号唯一标识、请求头、额度响应解析和刷新，不允许只复制接口 URL。

---

## Task 1：建立不可伪造的失败基线

**Files:**

- Inspect: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx`
- Inspect: `dashboard/src/hooks/use-cost-accumulation.js`
- Inspect: `dashboard/src/lib/date-range.ts`
- Inspect: `src-tauri/src/cursor_session.rs`
- Inspect: `src-tauri/src/trae_session.rs`
- Create: `docs/test-reports/provider-api/2026-07-19-live-parity-baseline.md`

- [ ] **Step 1：记录现有自动测试基线**

Run:

```powershell
Set-Location "D:\04-AI-Project\010-Token eye\.worktrees\provider-api"
npm test -- --runInBand
npm --prefix dashboard test -- --run
cargo test --manifest-path src-tauri/Cargo.toml cursor_session -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml trae_session -- --nocapture
```

Expected: 记录每条命令的退出码。已有失败不得隐藏，写入基线报告。

- [ ] **Step 2：记录四个真实失败场景**

在安装版 Token Eyes 中记录：

1. 成本页面本月 API、本月订阅、本月总成本、累计成本的完整原始数值与环比文案。
2. 1280、1440、1920 三种内容宽度下自定义花销卡片截图。
3. 两个 Cursor 账号的账号标识、Token Eyes 用量、Cockpit Tools 用量和刷新时间。
4. TRAE 点击授权后的完整 URL、HTTP 状态、回调结果、Token Eyes 错误和 Cockpit Tools 对照值。

隐私要求：令牌、Cookie、JWT、Authorization、邮箱完整值必须脱敏；可以保留稳定哈希或末四位用于账号对照。

- [ ] **Step 3：写基线报告**

报告必须包含以下表格，不得写“已知问题”后跳过数值：

```markdown
| 场景 | Token Eyes 实际值 | Cockpit/原始接口值 | 是否一致 | 原始证据 |
|---|---:|---:|---|---|
| Cursor 账号 A Total Usage | 0% | 27% | 否 | 截图/脱敏 JSON |
| Cursor 账号 B Total Usage | 0% | 6% | 否 | 截图/脱敏 JSON |
| TRAE 剩余次数 | 0 | 75 | 否 | 截图/脱敏 JSON |
```

- [ ] **Step 4：提交基线报告**

```powershell
git add docs/test-reports/provider-api/2026-07-19-live-parity-baseline.md
git commit -m "test: capture provider live parity baseline"
```

---

## Task 2：核实并修正“较上月”数据口径

**Files:**

- Modify: `dashboard/src/lib/date-range.ts:99`
- Modify: `dashboard/src/lib/date-range.test.ts`
- Modify: `dashboard/src/hooks/use-cost-accumulation.js:36-95`
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx:43-145`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Create: `docs/test-reports/provider-api/2026-07-19-month-comparison-reconciliation.md`

- [ ] **Step 1：先确定并写死比较口径**

采用“本月至今 vs 上月同期”，例如 7 月 19 日比较 6 月 1 日至 6 月 19 日；不要再用本月至今比较完整上月。

边界规则：

```text
current = 本月 1 日 00:00:00 至当前时刻
previous = 上月 1 日 00:00:00 至上月相同日、相同时刻
如果上月没有相同日，则使用上月最后一天相同时刻
```

- [ ] **Step 2：写失败的日期区间测试**

在 `dashboard/src/lib/date-range.test.ts` 增加：

```ts
it("compares month-to-date with the same elapsed period last month", () => {
  const ranges = getMonthComparisonRanges({
    now: new Date("2026-07-19T12:30:00+08:00"),
    timeZone: "Asia/Shanghai",
  });

  expect(ranges.current.start).toContain("2026-07-01");
  expect(ranges.current.end).toContain("2026-07-19");
  expect(ranges.previous.start).toContain("2026-06-01");
  expect(ranges.previous.end).toContain("2026-06-19");
});
```

Run:

```powershell
npm --prefix dashboard test -- src/lib/date-range.test.ts --run
```

Expected: FAIL，因为当前实现比较完整自然月。

- [ ] **Step 3：最小修改日期区间生成逻辑**

只修改 `getMonthComparisonRanges`，返回同周期区间；不要改变其他日期筛选器。

- [ ] **Step 4：为环比纯函数补齐边界测试**

覆盖：

```text
current=150, previous=100  => 新增 50.0%
current=50, previous=100   => 减少 50.0%
current=0, previous=0      => 与上月持平
current=50, previous=0     => 上月为 0，不显示无穷百分比，显示“本月新增金额”
```

环比的新增和减少均按用户要求使用绿色，但方向文案必须准确。

- [ ] **Step 5：对原始账目做 reconciliation**

将当前月同期和上月同期接口返回拆分为：

```text
API 成本
Token 套餐订阅成本
其他 AI 花销
总成本
```

逐项证明：

```text
总成本 = API 成本 + Token 套餐订阅成本 + 其他 AI 花销
```

检查同一条花销是否同时出现在 API、订阅或其他 AI 花销中。把脱敏明细、合计和最终百分比写入 reconciliation 报告。

- [ ] **Step 6：运行测试和构建**

```powershell
npm --prefix dashboard test -- src/lib/date-range.test.ts src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx --run
npm --prefix dashboard run build
```

Expected: PASS，且构建无 TypeScript/Vite 错误。

- [ ] **Step 7：提交**

```powershell
git add dashboard/src/lib/date-range.ts dashboard/src/lib/date-range.test.ts dashboard/src/hooks/use-cost-accumulation.js dashboard/src/ui/dashboard/components/CostAccumulation.jsx dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx docs/test-reports/provider-api/2026-07-19-month-comparison-reconciliation.md
git commit -m "fix: reconcile month-over-month cost comparison"
```

---

## Task 3：修复自定义花销卡片金额裁切且不反向膨胀

**Files:**

- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx:193-215`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Create: `dashboard/scripts/verify-cost-group-layout.mjs`
- Create: `docs/test-reports/provider-api/2026-07-19-cost-group-visual-acceptance.md`

- [ ] **Step 1：写失败的 DOM 契约测试**

断言金额容器不包含 `truncate`、`overflow-hidden` 或 `whitespace-nowrap`：

```jsx
expect(screen.getByText("USD 105.56").closest("div")).not.toHaveClass("truncate");
expect(screen.getByText("CNY 760.00")).toBeVisible();
```

Run:

```powershell
npm --prefix dashboard test -- src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx --run
```

Expected: FAIL，因为当前金额外层带 `truncate`。

- [ ] **Step 2：实施最小响应式修复**

要求：

- 删除金额容器的 `truncate`。
- 卡片网格使用能保证最小宽度的自适应列，例如 CSS Grid `repeat(auto-fit, minmax(240px, 1fr))`。
- 卡片内部仍保持紧凑，但金额允许换行，USD 与 CNY 各占一行。
- 卡片高度可以因内容增加一行，但不得恢复成此前的大卡片。
- 分组名称过长时允许名称省略，金额绝不省略。

- [ ] **Step 3：增加实际渲染尺寸检查**

`verify-cost-group-layout.mjs` 使用 Playwright 在 1280、1440、1920 三个宽度下：

1. 打开成本累积页面。
2. 找到 `[data-testid="compact-cost-group-grid"]`。
3. 对每个金额元素验证 `scrollWidth <= clientWidth`，或元素设置为允许换行且 `scrollHeight` 足够展示完整文本。
4. 截图到 `artifacts/cost-group-layout/`。

Run:

```powershell
npm --prefix dashboard run build
node dashboard/scripts/verify-cost-group-layout.mjs
```

Expected: 三种宽度均 PASS，截图中所有 USD/CNY 金额完整。

- [ ] **Step 4：提交**

```powershell
git add dashboard/src/ui/dashboard/components/CostAccumulation.jsx dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx dashboard/scripts/verify-cost-group-layout.mjs docs/test-reports/provider-api/2026-07-19-cost-group-visual-acceptance.md
git commit -m "fix: keep compact spend cards fully readable"
```

---

## Task 4：完整对齐 Cursor 多账号 OAuth 与实时用量

**Files:**

- Modify: `src-tauri/src/cursor_session.rs`
- Modify: `src-tauri/src/lib.rs`（仅当命令注册缺失）
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx` 或实际 Token 套餐表单组件
- Modify: `dashboard/src/lib/api.ts` 或实际 Tauri bridge 文件
- Create: `src-tauri/tests/fixtures/cursor/usage-summary-account-a.json`
- Create: `src-tauri/tests/fixtures/cursor/usage-summary-account-b.json`
- Create: `docs/test-reports/provider-api/2026-07-19-cursor-live-parity.md`

- [ ] **Step 1：完整阅读 Cockpit Tools Cursor 实现**

必须记录以下契约，而不是只抄 URL：

```text
challenge/PKCE 生成方式
loginDeepControl 完整查询参数
auth/poll 请求参数与轮询终止条件
返回令牌、JWT、用户 ID、Auth ID、邮箱的字段名
usage-summary 的完整请求头、Cookie 和 Authorization 形式
Total Usage、Auto+Composer、API Usage、resetAt 的响应路径
每个账号的存储键和刷新机制
```

把对照结论写入 Cursor parity 报告。

- [ ] **Step 2：抓取两份脱敏真实响应并建立 fixture**

使用用户已授权的两个账号，各抓取一次 `/api/usage-summary` 成功响应。必须删除令牌、Cookie、邮箱完整值，只保留解析需要的字段。

Fixture 至少包含：

```json
{
  "account_id": "stable-redacted-account-a",
  "plan": "pro",
  "total_usage_percent": 27,
  "auto_composer_percent": 20,
  "api_usage_percent": 72,
  "reset_at": "2026-08-06T22:31:00+08:00"
}
```

字段名必须以真实响应为准，以上只是验收数据，不允许硬编码虚构响应路径。

- [ ] **Step 3：写失败的 Rust 解析测试**

测试必须证明：

1. 两个 fixture 解析成两个不同 `account_id`。
2. Total Usage、分项用量和 resetAt 与 fixture 一致。
3. 缺失关键用量字段时返回错误，不回退为 `0`。
4. 授权成功但用量请求失败时状态为 `sync_failed`，不是 `connected`。

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml cursor_session -- --nocapture
```

Expected: 新测试先 FAIL。

- [ ] **Step 4：修复每账号独立持久化与套餐绑定**

存储键必须至少包含：

```text
provider = cursor
account_id = 官方返回的稳定账号唯一标识
session_ref = Token Eyes 本地生成的授权引用
display_name = 邮箱脱敏值或用户备注
```

Token 套餐只能保存 `session_ref`，不能用全局“当前 Cursor 账号”。新增同供应商账号不得覆盖已有授权，也不得让两条套餐引用同一个 session。

- [ ] **Step 5：修复实时用量映射**

输出模型必须能表达：

```rust
struct CursorQuotaSnapshot {
    account_id: String,
    total_usage_percent: f64,
    auto_composer_percent: Option<f64>,
    api_usage_percent: Option<f64>,
    reset_at: Option<String>,
    fetched_at: String,
}
```

如果现有公共 DTO 不支持这些字段，应做最小扩展；不得把不同维度强行压成 `used=0, remaining=0`。

- [ ] **Step 6：真实双账号验收**

安装版必须同时显示两个 Cursor 账号，并分别与 Cockpit Tools 对照：

```text
账号 A：Total Usage 27%，Auto+Composer 20%，API Usage 72%
账号 B：Total Usage 6%，Auto+Composer 1%，API Usage 39%
```

实际数值以验收时 Cockpit Tools 为准。允许刷新时间差造成小幅变化，但账号不能串号、覆盖或都显示 0。

- [ ] **Step 7：提交**

```powershell
git add src-tauri/src/cursor_session.rs src-tauri/src/lib.rs dashboard/src src-tauri/tests/fixtures/cursor docs/test-reports/provider-api/2026-07-19-cursor-live-parity.md
git commit -m "fix: sync Cursor quota per authorized account"
```

提交前检查 `git diff --cached --stat`，撤出与 Cursor 无关的文件。

---

## Task 5：完整对齐 TRAE OAuth 与套餐次数

**Files:**

- Modify: `src-tauri/src/trae_session.rs`
- Modify: `src-tauri/src/lib.rs`（仅当命令注册缺失）
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx` 或实际 Token 套餐表单组件
- Modify: `dashboard/src/lib/api.ts` 或实际 Tauri bridge 文件
- Create: `src-tauri/tests/fixtures/trae/login-guidance.json`
- Create: `src-tauri/tests/fixtures/trae/quota.json`
- Create: `docs/test-reports/provider-api/2026-07-19-trae-live-parity.md`

- [ ] **Step 1：完整阅读 Cockpit Tools TRAE 实现**

记录：

```text
GetLoginGuidance 的请求和真实响应
授权页面固定域名或 host 选择规则
authorization 的完整查询参数
redirect_uri、state、challenge、device_id 和 public key 规则
授权码回调解析
令牌交换与刷新请求
额度端点、请求体、请求头
套餐名、总次数、已用/剩余次数、resetAt 的真实字段路径
```

- [ ] **Step 2：写失败的授权 URL 测试**

测试要求：即使登录引导接口来自 `api.trae.cn`，最终浏览器授权地址也必须使用 Cockpit Tools 实际成功的官方 Web 授权 host，且包含真实必需参数。

示例断言：

```rust
assert_eq!(url.host_str(), Some("www.trae.cn"));
assert_eq!(url.path(), "/authorization");
assert!(url.query_pairs().any(|(key, value)| key == "login_version" && value == "1"));
```

其他参数只能根据 Cockpit Tools 源码和真实成功链接补充，禁止猜测。

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml trae_session -- --nocapture
```

Expected: 当前实现先 FAIL，尤其是 API host 被直接改路径的情况。

- [ ] **Step 3：修复 host、查询参数与回调契约**

禁止继续执行以下错误模式：

```rust
let mut auth_url = Url::parse(login_host)?;
auth_url.set_path("/authorization");
```

应把“API 引导端点”和“浏览器授权端点”建模为不同职责，并根据真实 Cockpit/官方契约生成授权 URL。

- [ ] **Step 4：抓取脱敏真实额度响应并写解析测试**

Fixture 必须来自成功授权后的真实响应，至少能够证明：

```text
套餐 = 速通 Pro
总次数 = 100 或官方返回值
剩余次数 = 75 或官方返回值
已用比例 = 25% 或官方返回值
重置时间 = 官方返回时间
账号 ID = 稳定唯一标识
```

解析缺少关键字段时必须返回失败，不允许显示 `0 requests` 和“已连接”。

- [ ] **Step 5：完成真实授权验收**

验收顺序：

1. 点击“连接 TRAE CN 账号”。
2. 默认浏览器打开 `www.trae.cn/authorization...`，不得 404。
3. 浏览器已有登录状态时不额外要求重复登录；如果官方安全策略强制登录，必须明确提示这是官方要求。
4. 授权完成后 Token Eyes 自动结束轮询并关闭/更新授权界面。
5. Token Eyes 套餐次数、剩余次数、比例和重置时间与 Cockpit Tools 同账号一致。

- [ ] **Step 6：提交**

```powershell
git add src-tauri/src/trae_session.rs src-tauri/src/lib.rs dashboard/src src-tauri/tests/fixtures/trae docs/test-reports/provider-api/2026-07-19-trae-live-parity.md
git commit -m "fix: complete TRAE OAuth and quota sync"
```

提交前检查 `git diff --cached --stat`，撤出与 TRAE 无关的文件。

---

## Task 6：安装版端到端对抗性复验

**Files:**

- Create: `docs/test-reports/provider-api/2026-07-19-final-adversarial-acceptance.md`
- Modify: `任务工单.md` 或项目当前调整意见文档，只更新真实完成状态

- [x] **Step 1：运行完整自动验证**

```powershell
Set-Location "D:\04-AI-Project\010-Token eye\.worktrees\provider-api"
npm test
npm --prefix dashboard test -- --run
npm --prefix dashboard run build
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
```

Expected: 全部 PASS。若存在与本工单无关的预存失败，必须列出测试名和基线证据，不能写“忽略”。

- [x] **Step 2：构建新的 Windows 安装包**

按照项目现有 Tauri Windows 构建脚本执行，不使用旧 NSIS 临时目录。确认最终安装包位于：

```text
src-tauri\target\release\bundle\nsis\
```

- [ ] **Step 3：覆盖安装后复验** （安装已做；Cursor/TRAE/MoM UI 对齐未完成 — 见 final-adversarial-acceptance）

必须使用覆盖安装后的正式 EXE，而不是 Vite 开发页面，完成：

- 环比原始数据 reconciliation 与显示值一致。
- 成本四张总览卡片和所有自定义花销金额完整显示。
- Cursor 两个账号独立、实时、刷新后准确。
- TRAE OAuth 不 404，额度与 Cockpit Tools 一致。
- 授权失败、接口失败、解析失败均显示真实失败，不出现虚假 `0` 或虚假“已连接”。

- [x] **Step 4：写最终证据报告**

报告必须逐项写：

```text
要求
改动文件
自动测试命令和结果
安装版操作步骤
Token Eyes 实际结果
Cockpit/原始数据对照结果
截图路径
是否通过
```

没有真实截图或脱敏接口证据的 Cursor/TRAE 项目一律标记“未完成”，不得标记“代码已实现”。

- [ ] **Step 5：最终提交**

```powershell
git add docs/test-reports/provider-api/2026-07-19-final-adversarial-acceptance.md 任务工单.md
git commit -m "test: verify cost and provider parity end to end"
```

---

## 完成定义

以下条件必须同时满足，缺一项都不能宣布完成：

- [ ] 环比比较区间是“本月至今 vs 上月同期”，并完成原始账目核账。（账本已核；安装版 UI 仍显示 1422/1425% 而非 delta 1325/1329.6%）
- [ ] 截图中的 401.9%/405.8% 已被重新计算并由原始数据证明，或被纠正为真实数值。
- [ ] 自定义花销卡片在 1280、1440、1920 宽度无金额裁切。
- [ ] Cursor 至少两个账号独立授权、独立持久化、独立刷新，不覆盖、不串号。
- [ ] Cursor 用量与 Cockpit Tools 同账号一致，接口失败不会显示 0 和“已连接”。
- [ ] TRAE 授权 URL 不 404，授权回调成功，额度、比例和重置时间与 Cockpit Tools 一致。
- [ ] 自动测试、Dashboard 构建、Rust 测试通过。（dashboard+cargo --lib 通过；npm test/full cargo 仍有基线失败）
- [ ] 覆盖安装后的正式 EXE 已完成真实账号端到端复验。
- [x] 最终报告附带脱敏原始数据、命令输出和截图，不能只写结论。

## 禁止事项

- 不得修改、启动、停止、覆盖或删除 Token Eyes 项目以外的软件和文件。
- 不得修改 Cockpit Tools；只能只读参考其公开源码和用户提供的运行结果。
- 不得把“授权文件存在”当作“同步成功”。
- 不得把缺失字段默认成 0 后显示“已连接”。
- 不得用模拟数据测试代替真实账号验收。
- 不得只验证开发页面而跳过覆盖安装后的 EXE。
- 不得用缩小字体、省略号或隐藏溢出来掩盖金额裁切。

