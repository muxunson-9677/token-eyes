# Xiaomi MiMo Token 套餐授权同步设计

**日期：** 2026-06-28
**状态：** 已确认，待实施计划
**目标：** 用户选择 Agent 来源、MiMo 套餐和“官网账号登录检测”后，在官方窗口完成登录；Token Eyes 自动读取真实套餐额度、写入对应 Token 套餐记录并关闭登录窗口。

## 1. 已确认问题

当前实现存在三个相互独立的问题：

1. `GET /api/local-auth` 单独写响应，没有返回本地 API 其他 JSON 接口已有的 CORS 头。Tauri/Vite 页面跨 origin 获取本地认证令牌时被 WebView2 拦截，前端只能收到 `Failed to fetch`。真实 Chromium 已复现该错误。
2. 登录窗口加载的是远程小米域名，但 Tauri capability 只授权 `main` 窗口。注入脚本调用 `window.__TAURI__.invoke(...)` 无法可靠回传额度，现有验证流程最终会超时。
3. 前端仅在用户点击“验证”按钮时调用验证命令，没有登录完成后的自动检测循环，也没有在前置持久化失败时关闭或避免打开登录窗口。

现有自动化测试通过，但只覆盖当前手动验证流程，没有覆盖真实 CORS、远程 WebView 回传和自动完成行为。

## 2. 用户流程

1. 用户打开“新增 Token 套餐”。
2. 用户必须选择 Agent 来源、服务商“小米 MiMo”、具体套餐和“官网账号登录检测”。
3. 缺少任一必填项时，不打开登录窗口，并在表单内提示需要补全的字段。
4. Token Eyes 先通过本地 API 创建 `pending_login` 会话；创建失败时不打开窗口。
5. Token Eyes 打开小米官方控制台窗口，表单显示“等待登录”，无需用户再点击“验证”。
6. 用户在官方页面完成登录。Token Eyes 在同一 WebView 会话中调用 MiMo 套餐用量端点，只保留脱敏额度 DTO。
7. Token Eyes 自动把额度和会话绑定写入用户当前选择的套餐记录，刷新套餐列表，关闭新增表单。
8. 原生层确认额度同步成功后自动关闭小米登录窗口。

## 3. 采用方案

采用“同会话 fetch + Rust 安全读取 + 前端自动轮询”，不向远程小米页面开放 Tauri IPC。

### 3.1 本地 API 边界

- 为 `/api/local-auth` 补齐与其他本地 JSON 接口一致的 CORS 响应头，并保留 `Cache-Control: no-store`。
- `isAuthorizedLocalMutation` 接受开发环境 loopback origin，以及 Tauri 打包应用使用的受信任本地 origin；继续拒绝任意外部网站 origin。
- 先创建 console session，再打开登录窗口，避免本地 API 失败后遗留孤立窗口。
- 验证成功后由现有 console-session verify API 接收原生脱敏结果并更新会话状态。

### 3.2 Tauri/WebView2 边界

- 登录窗口仍只允许小米官方域名和登录所需的官方 SSO 域名。
- 初始化脚本不读取 `document.cookie`、`localStorage`、`sessionStorage`、DOM 或用户输入。
- 初始化脚本仅在 `platform.xiaomimimo.com` 调用相对路径 `/api/v1/tokenPlan/usage`，浏览器自动携带同会话 Cookie。
- 脚本把 `{ status, total, used, remaining, expires_at, provider_reported_at, error_code }` 保存到窗口内存变量，不调用 Tauri IPC。
- Rust 使用当前 Tauri 版本已有的 `eval_with_callback` 读取该内存变量并反序列化为 `QuotaFetchResult`。
- 成功结果映射为 `connected + quota` 后关闭登录窗口；未登录、页面仍加载或尚无结果时返回 `awaiting_verification`。
- 用户手动关闭窗口时返回 `session_not_found`，停止自动检测。

### 3.3 前端状态机

- `handleConnectXiaomiMimo` 负责一个完整授权事务：校验表单、创建 pending session、打开窗口、自动轮询、保存套餐、刷新 UI。
- 自动检测期间禁用重复连接操作，并显示明确的等待状态。
- 初次授权期间的 401/403 视为“仍待登录”，不立即显示会话过期；只有已有成功会话的后续刷新才映射为 `reauth_required`。
- 成功时使用用户已选择的 `form.source`、`provider_id`、`plan_id` 和套餐目录元数据，不再创建硬编码 `source: cursor`、`plan_id: custom` 的记录。
- 成功后只保留一个套餐写入路径，删除前后端重复自动创建记录的竞争条件。

## 4. 失败和回滚

| 失败点 | 行为 |
|---|---|
| 必填项缺失 | 不创建会话、不打开窗口，显示表单校验错误 |
| 获取本地认证令牌失败 | 不打开窗口，显示可定位的本地 API 错误 |
| 创建 pending session 失败 | 不打开窗口，不写套餐 |
| 打开原生窗口失败 | 删除刚创建的 pending session；不写套餐 |
| 用户关闭登录窗口 | 停止轮询，把会话标为失败/待重连，不写成功套餐 |
| 登录等待超时 | 停止本轮轮询，保留 pending/失败状态并允许重试 |
| MiMo 返回结构变化 | 显示 unsupported，不把目录额度冒充实时额度 |
| 网络或服务端错误 | 显示脱敏错误；已有套餐的上次成功额度保持不变 |
| 套餐保存失败 | 不显示授权成功；关闭登录窗口前必须确认套餐已写入 |

失败路径不得把额度改为 0，不得清空已有 `last_synced_at`，不得打印原始响应或认证信息。

## 5. 安全约束

- Cookie 和认证令牌只存在于 WebView2 会话容器中。
- Rust、Node、React、日志和套餐配置均不得接收或持久化 Cookie。
- 远程小米页面不获得 Tauri command capability。
- 回传对象只允许额度数字、时间、枚举状态和脱敏错误码。
- 非小米官方域名导航继续被阻止。
- 不增加 Cookie 粘贴、DevTools 抓取或自定义脚本入口。

## 6. 预计修改范围

主要文件：

- `src/lib/local-api.js`：本地认证 CORS、受信任 Tauri origin、console session 状态写入。
- `test/token-plan-console-sessions.test.js`：真实响应头、origin 和会话状态回归测试。
- `src-tauri/src/xiaomi_mimo_session.rs`：移除远程 IPC 回传依赖，使用 `eval_with_callback`，成功自动关窗。
- `src-tauri/src/lib.rs`：若旧 quota-result command 被移除，取消注册。
- `dashboard/src/lib/api.ts`：补齐 quota 返回类型，不改变通用 API 基础设施。
- `dashboard/src/components/settings/TokenPlanSection.jsx`：必填校验、事务顺序、自动轮询、单一路径写套餐。
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`：授权状态机与回滚测试。
- `dashboard/src/content/copy.csv`：仅在确有新增用户文案时更新。

不修改 Spend、Dashboard、pricing、provider catalog 配额或发布版本。

## 7. TDD 与验证

实施必须先增加失败测试并确认失败原因正确，再写最小生产代码。

自动化验证至少包括：

1. `/api/local-auth` 从 Vite loopback origin 可跨 origin 读取，并带 `no-store`。
2. 受信任 Tauri origin 可执行本地 mutation，外部 origin 仍被拒绝。
3. Rust 能解析成功、401/403、网络错误、结构变化和空结果。
4. 远程脚本不包含 Cookie/Storage/DOM 读取或 Tauri invoke。
5. 成功额度关闭登录窗口；等待状态和失败状态不关窗或按定义回滚。
6. 未选择 Agent 来源时不创建 session、不打开窗口。
7. 调用顺序严格为 `create session -> open window -> poll verify -> save selected plan`。
8. 自动成功后写入所选 source/plan、刷新记录并关闭表单。
9. 用户关窗、超时、保存失败均不生成成功记录。
10. 现有 custom API、手工套餐和套餐目录行为不回归。

验证命令：

```powershell
npm.cmd --prefix dashboard run test -- TokenPlanSection.test.jsx api.test.ts --run
node --test test/token-plan-console-sessions.test.js test/token-plans-api.test.js
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
npm.cmd --prefix dashboard run typecheck
npm.cmd run validate:copy
npm.cmd run validate:ui-hardcode
npm.cmd run validate:guardrails
npm.cmd run dashboard:build
npx.cmd tauri build --no-bundle
git diff --check
```

## 8. Windows 人工验收

自动化和构建通过后，必须由用户在 Windows WebView2 环境执行真实账号验收：

1. 选择 Agent 来源、MiMo Standard 月付和官网账号登录检测。
2. 点击连接，确认无 `Failed to fetch`，且不需要手动点验证。
3. 在官方窗口完成登录。
4. 确认窗口自动关闭。
5. 确认 Token 套餐列表出现且 source、套餐名称、总额、已用、剩余与官方页面一致。
6. 重新连接或模拟过期，确认失败不会清空上次成功额度。

没有完成真实账号验收时，最终报告只能写“自动化通过，真实登录待验收”，不能声称端到端通过。

## 9. 工作量

- 复杂度：中等。
- 生产代码和测试：预计 2–4 小时。
- Windows 真实登录验收：预计 10–20 分钟，取决于登录验证码和 MiMo 页面响应。
- 主要风险：远程 WebView2 的异步脚本回调时序，以及 MiMo 未文档化额度接口的响应结构变化。

该任务适合单个 subagent 串行完成，不应拆给多个 agent 同时编辑共享的 `TokenPlanSection.jsx`、`local-api.js` 和 `xiaomi_mimo_session.rs`。
