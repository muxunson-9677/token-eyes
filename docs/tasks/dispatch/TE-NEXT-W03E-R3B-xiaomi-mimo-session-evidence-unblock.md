# W03E-R3B Xiaomi MiMo Session Evidence Unblock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:systematic-debugging` for the blocker investigation and `superpowers:test-driven-development` before any implementation. Execute only this work order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真实小米 MiMo 控制台登录态证据确认官方额度接口及安全调用边界，或者形成不可误解、不可继续实现的最终 BLOCKED 结论。

**Architecture:** 认证材料必须留在小米官方页面所属的桌面会话中。Token Eyes 只允许通过同会话 `sessionFetch` 或等价安全边界获取脱敏 quota DTO；不得读取、复制、记录或持久化 Cookie/token。打开窗口不等于登录成功，只有真实接口请求成功并满足契约才可标记 READY。

**Tech Stack:** Tauri 2、Rust、WebView2、Node/Rust tests、脱敏 JSON fixture、Markdown 契约文档。

---

## 0. 派发说明

复制本文件全文给一个独立 subagent。该 subagent 只做 R3B，不得顺手实现 R3C adapter、R3D UI 或 R3E 清理。

本工单有两个同样合格的终态：

- `READY`：真实证据和安全会话能力全部成立，可以派发 R3C。
- `BLOCKED`：缺少真实登录态、接口不稳定、会话不可安全调用或无法复现；此时不得写生产 adapter。

不允许第三种“先按猜测实现，后面再验证”的状态。

## 1. 当前基线

- W03E-R3A 契约结论为 `BLOCKED：缺少官方控制台登录态网络证据`。
- 当前 Rust 命令 `verify_xiaomi_mimo_console_session` 固定返回 `DesktopSessionNotVerified`，位置在 `src-tauri/src/xiaomi_mimo_session.rs`。
- 当前命令只记忆 `session_ref` 和 `last_known_url`，不会把“窗口已打开”当成 `connected`。
- 本地 console session API 已存在，包含创建、验证和删除。
- 社区源码或文章可作为线索，但不能独立支持 READY。

## 2. 开始前必读

- `CLAUDE.md`
- `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`
- `docs/tasks/dispatch/TE-NEXT-W03E-R3A-xiaomi-mimo-console-quota-contract.md`
- `docs/tasks/dispatch/TE-NEXT-W03E-R3A-rework-console-quota-contract-evidence.md`
- `src-tauri/src/xiaomi_mimo_session.rs`
- `src-tauri/src/lib.rs`
- `dashboard/src/lib/api.ts` 中 `XiaomiMimoSessionStatus` 和三个 Tauri wrapper
- `src/lib/local-api.js` 中 console session API
- `test/token-plan-console-sessions.test.js`

## 3. 前置检查

- [ ] 运行 `git status --short`，记录基线但不修改或清理现有工作区。
- [ ] 确认真实登录态证据是否可获得：用户可在官方窗口内手动完成登录，或已提供脱敏 HAR/网络记录。
- [ ] 如果没有真实登录交互，也没有脱敏证据，立即转入“BLOCKED 文档收口”，不要实现任何会话成功路径。
- [ ] 确认本工单不会要求用户把账号、密码、验证码、Cookie 或 token 发给 agent。

## 4. 允许修改的文件

仅在真实证据支持时允许修改：

- `src-tauri/src/xiaomi_mimo_session.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock`，仅当安全实现必需且依赖理由可证明
- `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`
- `test/fixtures/xiaomi-mimo-console/*.json`，仅存脱敏响应结构
- 与新增纯 Rust helper 同目录的精确测试文件；优先把测试留在现有模块内

默认禁止修改：

- `src/lib/token-plan-refresh.js`
- `src/lib/local-api.js`
- `src/lib/token-plan-providers/`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/content/copy.csv`
- Spend、Dashboard、pricing、发布配置

如果安全会话能力必须跨越上述边界，停止并在 BLOCKED 报告中写明所需架构变更，不要自行扩大范围。

## 5. READY 契约的最低字段

契约文档必须记录以下内容，缺一项不得 READY：

| 字段 | 要求 |
|---|---|
| `endpoint` | 真实请求 URL；允许省略不影响复现的动态 query value |
| `method` | GET / POST 等真实方法 |
| `request_shape` | 非敏感 header 名称、query/body 字段名；不记录认证值 |
| `response_shape` | total、used、remaining、expiry、provider timestamp 的真实路径与类型 |
| `auth_boundary` | 认证保留在何处；明确 Token Eyes 不导出 Cookie/token |
| `quota_fetch_owner` | `tauri_webview`、`native_http` 或其他经证明的运行时所有者 |
| `callable_boundary` | 后续 R3C 可调用的命令/函数签名和返回 DTO |
| `status_mapping` | 200、401、403、404、429、5xx、结构漂移如何映射 |
| `plan_mapping` | 官方返回如何对应 `provider_id=xiaomi_mimo` 和具体 `plan_id` |
| `evidence_time` | 真实探测日期和环境，不含个人信息 |

建议的脱敏 DTO 只包含：

```json
{
  "total_quota": 0,
  "used_quota": 0,
  "remaining_quota": 0,
  "expires_at": "",
  "provider_reported_at": ""
}
```

不要为了匹配建议 DTO 而改写真实含义。若官方单位不是 token 或字段语义不同，契约必须明确说明并保持原始单位语义。

## 6. 任务 1：取得真实网络证据

- [ ] 在 Token Eyes 创建的官方小米 MiMo WebView 窗口中由用户手动登录。
- [ ] 观察余额/套餐页面实际产生的网络请求，不输入或记录用户凭证。
- [ ] 记录 endpoint、method、非敏感字段名、响应状态码和响应 JSON 结构。
- [ ] 重复刷新至少两次，确认它不是一次性页面 bootstrap 偶然数据。
- [ ] 退出或使会话失效后再请求一次，确认 401/403 或实际失效行为。
- [ ] 若只能看到 DOM 文本而没有稳定接口，结论保持 BLOCKED。
- [ ] 若证据来自用户提供的 HAR，先生成字段白名单 JSON，再删除或拒绝保留原始 HAR。

严禁把以下内容写入 fixture、日志、文档或返回消息：

- `Cookie` / `Set-Cookie` 的值
- `Authorization` / `Bearer` 的值
- service token、session id、user id、手机号、邮箱
- 完整请求头转储
- 账号、密码、验证码

## 7. 任务 2：验证安全 sessionFetch 边界

在写实现前先证明以下问题：

- [ ] 请求是否能在原小米 WebView 会话内发出，而不是把 Cookie 复制到 Node/Rust。
- [ ] Tauri/Rust 是否只接收已裁剪的 quota DTO，而不是原始页面或完整响应头。
- [ ] 页面导航到非官方域名时是否立即拒绝执行。
- [ ] `session_ref` 是否仍然只是路径式引用，不包含凭证。
- [ ] 关闭窗口或删除会话后，命令是否返回 session not found/reauth，而不是使用陈旧状态。
- [ ] 页面脚本、CSP、跨域限制和 WebView2 实际行为是否在目标 Windows 环境验证过。

如果不能同时满足这些条件，记录具体限制并保持 BLOCKED。

## 8. 任务 3：测试优先实现最小会话能力（仅 READY 路径）

只有任务 1 和任务 2 已经证明可行才执行本节。

- [ ] 先在 `src-tauri/src/xiaomi_mimo_session.rs` 的测试模块中加入失败测试，覆盖：未登录、非官方域名、会话不存在、成功 quota DTO、401/403、响应字段缺失。
- [ ] 运行 `cargo test xiaomi_mimo_session`，确认新增测试因能力缺失而失败，而不是语法错误。
- [ ] 实现最小安全命令或纯 helper；复用现有 `SessionState`、域名校验和状态 DTO。
- [ ] 成功状态只能由真实 quota 请求成功触发，不能只检查 URL，也不能只检查窗口存在。
- [ ] 命令返回值不得包含 Cookie、header、原始 HTML 或用户标识。
- [ ] 运行新增测试直到通过。
- [ ] 不在本工单注册 Node provider adapter。

若必须新增状态码，保持 snake_case 序列化，并同步纯 Rust 测试；不要为了 UI 文案修改 dashboard。

## 9. 任务 4：更新契约结论

更新 `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`：

- [ ] 在开头明确写最终结论 `READY` 或 `BLOCKED`。
- [ ] 列出本轮新增的一手证据和探测日期。
- [ ] 对 READY 填满第 5 节全部字段。
- [ ] 对 BLOCKED 写明缺失证据、已尝试路径、为什么不能安全实现、解除阻塞所需的最小输入。
- [ ] 区分“接口线索存在”和“Token Eyes 可安全调用”两个判断。
- [ ] 删除任何可能误导为已经同步成功的措辞。

## 10. 验证命令

```powershell
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
npm.cmd run validate:guardrails
rg -n "cookie|authorization|set-cookie|bearer|secret|password|phone|email" docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md test/fixtures/xiaomi-mimo-console src-tauri/src/xiaomi_mimo_session.rs -i
git diff --check
```

敏感词扫描出现命中不代表自动失败，但必须逐条解释：允许函数名、字段名和脱敏占位符；不允许真实值。

如果修改了 Tauri 生产代码，再运行：

```powershell
npx.cmd tauri build --no-bundle
```

Windows 验证只要求 Rust + Node.js + WebView2 Runtime，不要把 .NET SDK 加入前置条件。

## 11. 禁止事项

- 不得用 mock 或人工填写额度证明官方同步成功。
- 不得把第三方文章或开源代码当成官方登录态证据。
- 不得复制外部浏览器 Cookie 到 Token Eyes。
- 不得持久化 Cookie/token/Authorization。
- 不得把打开窗口、URL 为官方域名或存在 `session_ref` 当成 connected。
- 不得实现 R3C provider adapter。
- 不得修改 UI 来掩盖 blocker。
- 不得提交或清理共享工作区。

## 12. 完成标准

READY 必须同时满足：

- 真实登录态请求可重复。
- 安全调用边界可执行。
- 关键失败状态有测试。
- 契约字段完整。
- 敏感信息未落盘。
- 所有指定验证通过。

否则结论必须是 BLOCKED；BLOCKED 也是本工单的合格交付。

## 13. 返回模板

```markdown
## W03E-R3B 结果
- 结论：READY / BLOCKED
- 是否完成真实登录态探测：是 / 否
- quota_fetch_owner：
- callable_boundary：
- 后续 R3C 是否可派发：是 / 否

## 证据
- endpoint/method：
- 响应字段：
- 失效会话行为：
- 脱敏 fixture：

## 修改文件
- 路径与原因：

## 验证
- 命令与结果：

## 安全检查
- 是否保存或输出 Cookie/token/个人信息：否

## 阻塞项
- 仅 BLOCKED 时填写解除阻塞所需的最小条件：
```
