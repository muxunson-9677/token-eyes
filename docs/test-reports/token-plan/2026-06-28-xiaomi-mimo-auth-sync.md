# 小米 MiMo Token 套餐授权同步验收记录

- 日期：2026-06-28
- 状态：自动化验证通过；真实账号登录验收待用户执行
- 范围：Token 套餐新增表单中的“小米 MiMo / 官网账号登录检测”

## 已实现

- 修复桌面 Dashboard 获取 `/api/local-auth` 时的 CORS，允许 loopback 与 Tauri 应用来源完成本地鉴权。
- 点击连接时先创建本地挂起会话，再打开小米官方登录窗口。
- 官方 WebView 使用自身登录态同源请求 `/api/v1/tokenPlan/usage`；Cookie 不读取、不回传、不持久化。
- Rust 只通过 `eval_with_callback` 读取页面内存中的脱敏额度 DTO，不向远程页面开放 Tauri IPC。
- React 自动轮询登录结果；成功后把额度写入用户已选择的 Agent/服务商/套餐记录，然后关闭登录窗口和新增套餐表单。
- 保存失败时保留同一登录窗口和会话，可直接重试；窗口关闭、超时或终止失败时清理挂起会话。
- 重试旧失败记录前先删除旧会话，避免残留记录持续覆盖新状态。
- 缺失、非数字或负数额度不会被标记为成功；允许服务商出现超额使用，剩余额度归零。

## 自动化验证

| 验证 | 结果 |
|---|---|
| Dashboard Vitest | 49 passed，0 failed |
| Node 本地 API 测试 | 50 passed，0 failed |
| Rust MiMo 会话测试 | 34 passed，0 failed |
| Dashboard TypeScript | 通过 |
| copy registry | 通过（仅既有 unused key 警告） |
| UI hardcode guardrail | 通过 |
| architecture guardrail | 通过 |
| 相关文件 `git diff --check` | 通过 |
| Dashboard production build | 通过 |
| `tauri build --no-bundle` | 通过 |

真实 Chromium CORS 探针从一个 loopback 页面跨源请求另一个端口的 `/api/local-auth`，结果为 HTTP 200，并取得 48 字符临时本地令牌；未再出现 `Failed to fetch`。

安全扫描只命中安全注释和测试断言。生产注入脚本中没有 `document.cookie`、`localStorage`、`sessionStorage`、`window.__TAURI__` 或 `invoke(...)`。

## 待用户验收

1. 打开设置 → Token 套餐 → 新增套餐。
2. 选择 Agent 来源、小米 MiMo 和实际套餐，检测方式选“官网账号登录检测”。
3. 点击连接，在官方窗口完成登录。
4. 确认额度自动写入 Token 套餐列表，且官方登录窗口自动关闭。

真实小米账号、验证码和服务商在线接口只能由用户在本机完成，因此本报告不把尚未执行的真实登录链路标记为通过。

## 2026-06-28 现场返工：旧本地服务被误复用

用户首次验收时仍出现 `Failed to fetch`，且登录窗口未打开。现场检查发现系统中残留了两个修复前启动的 Token Tracker 服务（7681、17680）；它们的 `/api/local-auth` 虽返回 200 和 token，但没有 CORS 响应头。Tauri 原健康检查只验证 `200 + JSON token`，因此误把旧服务当成可用服务。

修复后，Tauri 健康检查会发送 `Origin: http://tauri.localhost`，并要求响应同时满足：

- `Content-Type: application/json`
- `Cache-Control: no-store`
- `Access-Control-Allow-Origin: *`
- JSON 中包含 token

缺少当前 CORS 契约的旧服务会被拒绝，应用会在新的空闲端口启动当前代码。本机保留旧 7681/17680 服务作为干扰条件时，新 release 正确启动并选择了 7682。

追加验证：

- Rust 全量测试：36 passed，0 failed（新增旧服务拒绝与当前服务接受测试）。
- 新 release 构建通过。
- 在真实 Token Eyes WebView2 的 `http://tauri.localhost/settings` 页面上下文中：`local_server_status` 返回 7682，`/api/local-auth` 返回 200，带本地鉴权头的 POST 成功到达 API 并返回预期业务校验 400，而不是网络错误。
- 同一真实 WebView2 上下文调用 `open_xiaomi_mimo_console_login` 返回 `login_started`，CDP 观察到小米官方窗口 `https://platform.xiaomimimo.com/console/balance?...`；随后已通过删除命令关闭诊断窗口。

## 2026-06-28 现场返工：官方 Credits 被错误缩放为 0

用户完成真实登录后，套餐被标记为同步成功，但已用额度显示 0。通过用户保持打开的已登录 WebView2，仅提取脱敏额度字段并连续采样，官方接口三次稳定返回：

- `plan_total_token.limit = 11,000,000,000`
- `plan_total_token.used = 11,000,864,960`
- `plan_total_token.percent = 1`

根因是注入脚本把官方已是最终 Credits 单位的值再次除以 `100,000,000`，得到带小数的 `110 / 110.0086496`；本地 Token 套餐记录只接受安全整数，因此小数进一步被归零，却仍写入 `sync_status=success`。

修复内容：

- 删除错误的 `÷100,000,000`，原样保留官方 Credits 整数。
- 新增 Rust 回归测试，锁定注入脚本不得再出现该缩放常量。
- 使用本次官方接口真实返回值回写用户现有套餐记录，避免浪费本次登录。

修复后真实 Token Eyes 页面确认显示：总额度 `11,000,000,000`、已用额度 `11,000,864,960`、剩余额度 `0`。
