# Token Eyes Cursor 单账号用量、TRAE OAuth、成本数据与花销卡片重修执行计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Do not use parallel agents on the same worktree. Every checkbox is a required gate, not a progress suggestion.

**Goal:** 修复 Token Eyes 安装版中的四个真实问题：成本环比口径与显示一致、自定义花销卡片完整可读、当前唯一 Cursor 账号用量不再错误显示为 0 且与 Cockpit Tools 同账号一致、TRAE 完成真正可用的官方 OAuth 与额度同步。

**Architecture:** 将“授权成功”和“额度同步成功”建模为两个不同状态。Cursor 与 TRAE 都必须保存账号身份、授权引用和最后一次真实额度快照；只有额度接口成功解析后才能显示用量与“同步成功”。Cockpit Tools 仅作为只读协议与结果对照，不能修改，也不能把其数据复制或硬编码进 Token Eyes。

**Tech Stack:** React 18、Vite 7、Vitest、Testing Library、Playwright、Tauri 2、Rust、Reqwest、Serde、Windows 系统浏览器 OAuth。

---

## 0. 最高优先级事实纠正

以下事实覆盖旧计划和旧报告中的相反描述：

1. **Cursor 当前只有一个需要检测的账号。** 不要求创建第二个 Cursor 账号，不得为了满足旧计划伪造第二个账号。
2. 用户提供的 Cockpit Tools Cursor 截图是为了证明：**相同 Cursor 账号在 Cockpit Tools 中能够显示正确的实时用量，而 Token Eyes 错误显示为 0。**
3. Cursor 本轮验收对象是这一个相同账号。验收时以脱敏邮箱、用户 ID、Auth ID 或用户确认的备注完成同账号核对。
4. TRAE 当前不是“只差截图”，而是 Token Eyes 点击链接后卡住、出现 404 或停留在等待状态，未完成授权，也没有同步出 Cockpit Tools 中已经存在的套餐与剩余次数。
5. Cockpit Tools 已经证明 Cursor 和 TRAE 的官方 OAuth 与额度检测在同一台机器、同一账号环境中可行。不得用“供应商不支持”“只能人工填写”“只能显示 0”作为完成结论。
6. 旧报告中的 `DONE_WITH_CONCERNS` 不代表完成。四项真实验收有任意一项失败，整体状态只能写 **FAIL / 未完成**。

## 1. 不可误解的结果定义

### 1.1 Cursor 的正确结果

同一个 Cursor 账号在 Cockpit Tools 和 Token Eyes 中连续刷新，Token Eyes 必须显示真实的：

- 账号标识或用户备注；
- 套餐名称；
- Total Usage；
- Auto + Composer Usage（官方响应存在该字段时）；
- API Usage（官方响应存在该字段时）；
- 重置时间或有效期；
- 最后成功同步时间。

**禁止结果：** 已授权但显示 `已连接 + 0`、接口 401 后仍保留成功状态、把缺失字段默认成 0、以 fixture 的 27% 等数值替代真实响应。

### 1.2 TRAE 的正确结果

从 Token Eyes 点击“连接 TRAE CN 账号”后必须形成完整闭环：

```text
生成官方授权会话
→ 用系统默认浏览器打开可访问的 TRAE 官方授权 URL
→ 用户确认授权
→ Token Eyes 收到或轮询到授权结果
→ 交换并安全保存令牌/会话引用
→ 查询官方套餐额度接口
→ UI 自动退出等待态
→ 显示套餐、已用/剩余次数、比例、重置时间和同步时间
```

仅完成其中一段不算完成。修改域名、打开网页、单元测试通过或显示“等待验证”都不是最终结果。

### 1.3 成本与花销卡片的正确结果

- 环比固定采用“本月至今 vs 上月同期”的增减率：`(本期 - 上期) / 上期 × 100%`。
- API、订阅、本月总成本分别使用各自的本期和上期原始账目，不能串字段。
- 自定义花销分组卡片在 1280、1440、1920 内容宽度下，组名、USD、CNY、本月、本年、总累计均完整可读；不能显示省略号、破折号或被相邻列遮挡。

---

## 2. 执行目录、边界与启动检查

**唯一执行工作树：**

```text
D:\04-AI-Project\010-Token eye\.worktrees\provider-api
```

**分支：**

```text
codex/token-eyes-provider-api
```

### 硬性边界

- 只允许修改 `D:\04-AI-Project\010-Token eye` 仓库内文件。
- 不得修改、删除、安装、卸载、覆盖或重新配置 Cockpit Tools、CC Switch 或其他软件。
- Cockpit Tools 只允许只读参考公开源码、用户截图及其运行结果。
- 不得清理、重置或覆盖工作树中已有的用户修改。
- 禁止 `git reset --hard`、`git checkout -- .`、递归删除工作树。
- 未完成真实验收前不得构建或交付最终安装包。

- [ ] **Step 1：读取规则与现状**

```powershell
Set-Location "D:\04-AI-Project\010-Token eye\.worktrees\provider-api"
Get-Content -Raw "..\..\CLAUDE.md"
Get-Content -Raw "..\..\docs\superpowers\plans\2026-07-19-cursor-single-account-trae-oauth-rework.md"
git status --short
git log --oneline -12
```

预期：明确保留所有既有修改，并识别旧提交 `ecf96a38`、`b3860ff0`、`d6213700`、`a1c6e51b`、`1fc4409a`、`76efa952` 的实际作用，不能因为提交存在就判断功能完成。

- [ ] **Step 2：记录重修前失败基线**

创建：

```text
docs/test-reports/provider-api/2026-07-19-rework-baseline.md
```

报告必须逐项记录：安装版成本卡原始文字、花销卡裁切截图、Cursor 同账号在 Token Eyes 与 Cockpit Tools 的值、TRAE 点击后的完整 URL/HTTP 状态/等待状态。敏感令牌、Cookie、完整邮箱必须脱敏。

参考证据：

```text
Cursor 正确用量：C:\Users\admin\AppData\Local\Temp\codex-clipboard-7c802e62-eaa3-47e6-a4db-fbe1548a734f.png
Cursor OAuth 形态：C:\Users\admin\AppData\Local\Temp\codex-clipboard-b78054ee-2bae-44f5-98c6-f4512b4313d2.png
TRAE 正确额度：C:\Users\admin\AppData\Local\Temp\codex-clipboard-2a41817b-eeaf-4828-839d-716fab6f825e.png
TRAE OAuth 形态：C:\Users\admin\AppData\Local\Temp\codex-clipboard-353ed59c-fc96-4991-9698-edf86b2d0201.png
旧失败报告：docs/test-reports/provider-api/2026-07-19-final-adversarial-acceptance.md
```

---

## 3. Task 1：修正成本环比并完成原始账目核对

**Files:**

- Modify: `dashboard/src/lib/date-range.ts:100-150`
- Modify: `dashboard/src/lib/date-range.test.ts`
- Modify: `dashboard/src/hooks/use-cost-accumulation.js:50-160`
- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx:44-160`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Create: `docs/test-reports/provider-api/2026-07-19-rework-month-comparison.md`

- [ ] **Step 1：写失败测试，锁死公式与区间**

测试必须覆盖：

```text
本期 6749.666167、上期 472.143724 → 新增 1329.6%
本期 6603.138389、上期 463.393724 → 新增 1325.0%
本期 < 上期 → “较上月减少 X%”
本期 = 上期 → “与上月持平”
上期 = 0 且本期 > 0 → 不显示 Infinity/NaN，显示“上月无基数”
```

日期测试必须证明 7 月 19 日当前时刻只比较 6 月 1 日到 6 月 19 日相同时刻，不能比较完整 6 月。

- [ ] **Step 2：运行测试并确认先失败**

```powershell
npm --prefix dashboard test -- --run dashboard/src/lib/date-range.test.ts dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx
```

预期：至少一个新增断言在旧实现上失败。若全部直接通过，说明测试没有覆盖安装版的 ratio/delta 错位，必须补充到能够复现旧安装版 1422%/1425% 的错误。

- [ ] **Step 3：只修正数据口径与 UI 数据绑定**

要求：

- `getMonthComparison()` 只返回增减率，不返回本期/上期比率。
- API 卡只使用 API 本期/上期；订阅卡只使用订阅本期/上期；总成本只使用总成本本期/上期。
- 环比标签放在 CNY 行，不得截断 USD/CNY 金额。
- 新增和减少都按用户既定要求使用绿色，但文字必须准确区分新增/减少。

- [ ] **Step 4：用安装版本地 API 原始记录核账**

报告必须包含：区间起止、每类账目逐项合计、本期、上期、公式、手算结果、UI 结果。手算结果和 UI 四舍五入后必须完全一致。

**Task 1 通过条件：** 安装版 UI 与原始账目计算一致。只有测试通过而安装版不一致时，本 Task 为 FAIL，不得提交“完成”状态。

---

## 4. Task 2：重做自定义花销卡片的可读布局

**Files:**

- Modify: `dashboard/src/ui/dashboard/components/CostAccumulation.jsx:185-225`
- Modify: `dashboard/src/ui/dashboard/components/__tests__/CostAccumulation.contract.test.jsx`
- Modify: `test/dashboard-layout-adjustments.test.js`
- Create: `dashboard/scripts/verify-cost-group-layout.mjs`
- Create: `docs/test-reports/provider-api/2026-07-19-rework-spend-cards.md`

- [ ] **Step 1：写真实数据布局测试**

测试数据必须使用足够长且不相同的值，例如：

```text
组名：AI 学习投入与长期订阅
本月：USD 1,234.56 / CNY 8,888.88
本年：USD 12,345.67 / CNY 88,888.88
总累计：USD 123,456.78 / CNY 888,888.88
```

断言：六个金额字符串均存在；金额节点不得具有 `truncate`、`text-overflow: ellipsis` 或会将文本裁掉的固定宽度。

- [ ] **Step 2：实现紧凑但不裁切的响应式布局**

要求：

- 外层卡片可以缩小，但内部金额列必须有最小可读宽度。
- 1280 宽度放不下三列时允许换为两列或单列，不能继续强行三列。
- 不允许通过减小到不可读字体、隐藏 CNY、显示 `…`、显示 `—` 来通过测试。
- 组名允许正常换行，不得只显示半截。

- [ ] **Step 3：对真实安装页截图验收**

使用真实本地数据，不使用单独 fixture 页面，分别在 1280、1440、1920 内容宽度截图。每张截图必须能人工读出所有组名和金额。

**Task 2 通过条件：** 三种宽度真实安装页全部无裁切，且 `npm test` 不新增 `dashboard-layout-adjustments` 回归。

---

## 5. Task 3：Cursor 当前单账号真实用量与 Cockpit Tools 对齐

**Files:**

- Modify: `src-tauri/src/cursor_session.rs`
- Modify: `src-tauri/src/lib.rs`（仅在命令注册确实缺失时）
- Modify: `dashboard/src/lib/api.ts:1570-1615`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx:1220-1565,2150-2555,3600-3660`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Modify: `src/lib/token-plan-catalog/index.js`（仅在字段映射确实需要时）
- Modify: `src/lib/subscriptions.js`（仅在持久化绑定缺失时）
- Create: `docs/test-reports/provider-api/2026-07-19-rework-cursor-single-account.md`

### 5.1 必须先完成只读协议追踪

- [ ] **Step 1：追踪 Cockpit Tools 的完整 Cursor 数据链路**

不能只抄 `https://cursor.com/api/usage-summary`。必须在报告中写明：

```text
授权入口与 PKCE/challenge 参数
轮询接口、间隔、成功字段和超时字段
令牌或 Cookie 的来源与刷新方式
调用 usage-summary 时实际使用的认证载体
必要请求头
账号唯一标识字段
套餐、Total、Auto+Composer、API、重置时间的响应字段路径
401/403/字段缺失时的状态转换
```

如果公开源码与运行行为不一致，以同机 Cockpit Tools 的脱敏网络/运行结果为准；不得修改 Cockpit Tools。

- [ ] **Step 2：先写三个失败测试**

必须覆盖：

1. 授权存在但 `usage-summary` 返回 401 时，UI 状态是“授权有效/用量同步失败或需重新授权”，不能是“同步成功 0%”。
2. 官方响应返回非零 Total/Auto/API 时，保存和 UI 显示相同非零数值。
3. 刷新时使用同一个账号绑定，不创建第二个账号，不覆盖为无账号的通用 `cursor` 记录。

- [ ] **Step 3：修复单账号绑定与认证载体**

实现必须满足：

- 账号记录包含稳定 `account_id` 与安全的 `session_ref`；套餐记录通过绑定 ID 指向该账号。
- 不把 access token、Cookie、JWT、Authorization 写入套餐 JSON、日志或前端状态。
- 额度请求必须使用与授权流程匹配的真实认证载体；不能拿一个可刷新的 token 去调用实际上依赖另一种 Cookie/JWT 的接口。
- 只有官方用量响应成功且必需字段解析完成后，`quota_sync_status=success`。
- 失败保留上一次成功快照并明确标记“最后更新失败”；从未成功过则显示错误，不显示 0。

- [ ] **Step 4：同账号实时对账**

操作顺序：

1. 用户在 Cockpit Tools 打开当前 Cursor 账号并刷新。
2. 记录脱敏账号标识、Total、Auto+Composer、API、重置时间、刷新时间。
3. 60 秒内在 Token Eyes 对同一个账号点击刷新。
4. 比较两边数据。

精确验收：

```text
账号：必须确认相同
Total Usage：绝对误差 ≤ 1 个百分点
Auto + Composer：绝对误差 ≤ 1 个百分点
API Usage：绝对误差 ≤ 1 个百分点
重置时间：误差 ≤ 2 分钟，或能证明官方返回粒度更粗
刷新完成：≤ 10 秒
```

若 Cockpit 数值在刷新期间变化，立即连续刷新两边并记录时间，不得选择性使用旧截图。

**Task 3 通过条件：** 当前这一个 Cursor 账号完成同账号、同时间窗口的非零真实对账。测试 fixture、解析函数测试、显示“已连接”都不能代替此验收。

---

## 6. Task 4：完成 TRAE 官方 OAuth 与真实额度闭环

**Files:**

- Modify: `src-tauri/src/trae_session.rs`
- Modify: `src-tauri/src/lib.rs`（仅在命令注册确实缺失时）
- Modify: `dashboard/src/lib/api.ts:1590-1615`
- Modify: `dashboard/src/components/settings/TokenPlanSection.jsx:1220-1565,2360-2555,3625-3660`
- Modify: `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- Modify: `src/lib/token-plan-catalog/trae.catalog.json`（仅在官方套餐字段映射错误时）
- Create: `docs/test-reports/provider-api/2026-07-19-rework-trae-oauth.md`

### 6.1 先追踪，不允许猜 URL

- [ ] **Step 1：只读追踪 Cockpit Tools TRAE 完整链路**

报告必须列出并脱敏保存：

```text
GetLoginGuidance 请求与响应中决定授权 URL 的字段
浏览器实际打开的完整 host、path 和所有参数名
state/challenge/PKCE/client_id/redirect_uri 的生成与校验规则
授权完成的回调或轮询接口
AuthCode 交换令牌的接口、方法、请求体和成功字段
令牌刷新接口与过期规则
额度查询接口、请求头和套餐字段路径
剩余次数、总次数、百分比、套餐、重置时间字段路径
```

不得只因为单元测试期望 `www.trae.cn/authorization` 就硬编码该地址。真实 URL 必须由官方 guidance 和 Cockpit 成功流程共同证明。

- [ ] **Step 2：写端到端状态机失败测试**

覆盖以下状态：

```text
idle → opening_browser → waiting_authorization → exchanging_token → syncing_quota → success
```

以及错误状态：

```text
authorization_url_invalid
browser_open_failed
authorization_timeout
state_mismatch
token_exchange_failed
quota_sync_failed
reauth_required
```

任何错误都必须退出无限等待态并显示可操作错误；不得把失败写成 0 requests。

- [ ] **Step 3：实现系统浏览器 OAuth 闭环**

要求：

- 使用 Windows 系统默认浏览器，复用浏览器已有登录状态；不得强制内嵌白屏窗口再次登录。
- 如果官方流程只能轮询，则按官方有效期轮询并在成功/超时后停止；如果使用 localhost callback，则必须验证 `state` 并及时关闭监听器。
- 授权完成后 Token Eyes UI 自动离开等待状态，不要求用户手工刷新。
- Token 仅保存于 Tauri 后端安全存储/账号目录，前端只持有 `session_ref` 和脱敏账号信息。
- 额度解析失败不得保存 `sync_status=success`，不得显示 0。

- [ ] **Step 4：与 Cockpit Tools 同账号实时对账**

在 Cockpit Tools 和 Token Eyes 中刷新同一个 TRAE 账号，60 秒内比较：

```text
套餐名称：完全一致
总次数与剩余次数：完全一致
已用百分比：绝对误差 ≤ 1 个百分点
重置时间：误差 ≤ 2 分钟
Token Eyes 授权页面：HTTP 2xx，不是 404
从点击连接到完成额度同步：正常网络下 ≤ 60 秒；超时必须明确失败而非永久等待
```

用户历史截图中的“速通 Pro、剩余 75 次、25%”是流程样例，不得硬编码；验收使用执行当时 Cockpit Tools 的最新真实值。

**Task 4 通过条件：** 用户亲自完成一次真实 TRAE 授权，Token Eyes 自动返回成功状态并与 Cockpit Tools 同账号最新额度一致。

---

## 7. Task 5：安装版端到端对抗性验收

**Files:**

- Create: `docs/test-reports/provider-api/2026-07-19-rework-final-acceptance.md`
- Modify: 当前项目调整意见/进度文档，只更新真实状态

- [ ] **Step 1：运行自动测试**

```powershell
Set-Location "D:\04-AI-Project\010-Token eye\.worktrees\provider-api"
npm test
npm --prefix dashboard test -- --run
npm --prefix dashboard run build
cargo test --manifest-path src-tauri/Cargo.toml --lib -- --nocapture
```

验收规则：

- Dashboard 与 Rust lib 必须全部通过。
- 全量 `npm test` 不得比重修前基线多任何失败；本轮触及的测试必须全部通过。
- 旧报告中的新增 `workspace and cards expose the approved layered surface hierarchy` 回归必须消失。
- 不得用“与本任务无关”掩盖本轮新增失败。

- [ ] **Step 2：四项硬门全部通过后才构建安装包**

构建前必须确认：

```text
[PASS] 环比原始账目 = UI
[PASS] 真实自定义花销卡片三种宽度完整显示
[PASS] 当前单个 Cursor 账号与 Cockpit Tools 实时对账
[PASS] TRAE 真人 OAuth 与 Cockpit Tools 实时额度对账
```

任意一项不是 PASS：停止，不构建最终安装包，不写“完成”。

- [ ] **Step 3：基于干净、可复现提交构建 NSIS**

安装包只能由已提交的明确 HEAD 构建，报告记录：HEAD、路径、大小、SHA256、构建时间。不得把未提交工作树混入安装包。

- [ ] **Step 4：覆盖安装后重复四项硬门**

必须在正式安装版 EXE 中重新执行，不得用 Vite 页面、fixture 页面或 Rust 单测代替。

- [ ] **Step 5：编写最终报告**

最终报告每项必须包含：

```text
要求
修改文件
自动测试命令与结果
安装版操作步骤
Token Eyes 实际值
Cockpit/原始账目实际值
两边刷新时间
脱敏账号匹配依据
截图/脱敏 JSON 路径
PASS 或 FAIL
```

最终状态只允许：

- `PASS`：四项硬门全部通过；或
- `FAIL / INCOMPLETE`：列出仍失败的门和下一步。

禁止 `DONE_WITH_CONCERNS`、`代码已完成但待真人验证`、`测试通过所以完成` 等模糊状态。

---

## 8. 明确禁止事项

- 不得再次把 Cursor 写成双账号需求。
- 不得创建第二个假 Cursor 账号或使用 fixture 账号通过验收。
- 不得把 Cockpit Tools 截图中的百分比、TRAE 75 次等数值硬编码到 Token Eyes。
- 不得把“授权文件存在”等同于“额度同步成功”。
- 不得在 401、403、字段缺失、解析失败时显示 `已连接 + 0`。
- 不得只修改 TRAE 域名或路径后宣称 OAuth 完成。
- 不得只验证授权页面打开而跳过 callback/poll、token exchange 和 quota sync。
- 不得用模拟 JSON、fixture 页面、组件测试截图代替安装版真人账号验收。
- 不得修改本项目以外的软件或文件。
- 不得在真实验收失败时请求合并、PR、打包或发布。

## 9. 完成定义

以下条件必须同时满足：

- [ ] 环比采用本月至今 vs 上月同期，UI 与原始账目手算一致。
- [ ] 自定义花销卡片在 1280/1440/1920 的正式安装页中完整显示全部文字和金额。
- [ ] 当前唯一 Cursor 账号在 Token Eyes 中不再显示假 0，且与 Cockpit Tools 同账号实时用量误差符合阈值。
- [ ] TRAE 授权 URL 可访问，系统浏览器授权成功，Token Eyes 自动完成令牌交换与额度同步。
- [ ] TRAE 套餐、剩余/总次数、比例、重置时间与 Cockpit Tools 同账号实时结果一致。
- [ ] 所有本轮目标测试通过，全量测试没有新增失败。
- [ ] 安装包由可复现的已提交 HEAD 构建。
- [ ] 覆盖安装后的正式 EXE 重复验收仍全部 PASS。
- [ ] 最终报告包含真实脱敏数据、时间戳和截图，不只包含代码提交或测试数量。

只要缺少任意一项，本计划仍为未完成。
