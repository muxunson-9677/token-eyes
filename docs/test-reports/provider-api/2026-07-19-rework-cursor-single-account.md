# Cursor 当前单账号用量重修记录

状态：FAIL/INCOMPLETE（代码级回归已通过；等待同一真实账号的安装版授权与 60 秒实时对比）

## 失败基线

- 既有安装版授权文件存在 `access_token` 与 `refresh_token`，JWT `sub` 脱敏后为 `auth0|user_01KWTPZ…`，JWT 到期时间为 `2026-09-17T10:40:19Z`。
- 使用 Cockpit Tools 相同的 Cookie 规则对既有 Token Eyes 访问令牌发起只读 `GET https://cursor.com/api/usage-summary`，返回 HTTP 401。
- 旧界面在失败链路中不能提供可验收的套餐名称、Total Usage、Auto + Composer Usage、API Usage、重置时间和最后同步时间完整组合。
- 既有单元测试基线为：`cargo test cursor_session --lib` 33/33 通过，Cursor 前端筛选测试 1/1 通过；这说明既有测试没有覆盖安装版失败。

## Cockpit Tools 实现链路（只读研究）

源码基准：`jlcodes99/cockpit-tools` main 分支，读取时间 2026-07-19。

1. 授权会话：32 字节随机 verifier，经 SHA-256 得到 challenge；打开 `https://cursor.com/loginDeepControl?challenge=...&uuid=...&mode=login`。
2. 轮询：每 2 秒请求 `https://api2.cursor.sh/auth/poll?uuid=...&verifier=...`，最长 300 秒；成功响应读取 `accessToken`、`refreshToken`、`authId`。
3. 刷新策略：只有 JWT `exp <= 当前时间 + 300 秒` 时才调用 `POST https://api2.cursor.sh/oauth/token`，而不是授权后立即刷新。
4. 账号字段：`GetUserMeta` 使用 Bearer，读取 email/workosId；账号绑定优先使用 `auth_id`，令牌仅作回退。
5. usage-summary 认证载体：不使用 Bearer；从 JWT `sub` 取末段 `user_*`，请求头为：
   - `Accept: application/json`
   - `Cookie: WorkosCursorSessionToken={user_id}%3A%3A{access_token}`
   - `User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)`
6. 响应解析：`individualUsage.plan.totalPercentUsed`、`autoPercentUsed`、`apiPercentUsed`；Total 缺失时才回退 `used / limit * 100`；重置时间来自 `billingCycleEnd`；套餐来自 `membershipType`。
7. 错误状态：401/403、字段缺失或解析失败记录配额同步错误，不生成“已连接 + 0”；既有成功快照与本次失败状态分开保存。

参考源码：

- https://github.com/jlcodes99/cockpit-tools/blob/main/crates/cockpit-core/src/modules/cursor_oauth.rs
- https://github.com/jlcodes99/cockpit-tools/blob/main/crates/cockpit-core/src/modules/cursor_account.rs
- https://github.com/jlcodes99/cockpit-tools/blob/main/src/types/cursor.ts
- https://github.com/jlcodes99/cockpit-tools/blob/main/src/pages/CursorAccountsPage.tsx

## 失败测试（先红后绿）

### Rust

命令：

```powershell
cargo test cursor_access_token_refresh_decision_matches_cockpit_five_minute_threshold --lib
```

红灯：编译失败，`access_token_needs_refresh_at` 不存在，证明当前实现没有 Cockpit 的 5 分钟刷新判定。

修复后：1/1 通过。

### Dashboard

命令：

```powershell
npm --prefix dashboard test -- --run src/components/settings/TokenPlanSection.test.jsx -t "shows Cursor plan"
```

红灯：找不到同账号脱敏邮箱，且套餐、Auth ID、三项用量、重置时间无法形成完整验收视图。

修复后：1/1 通过。

## 最小修复

- 与 Cockpit 对齐：JWT 距到期不足或等于 300 秒时才刷新访问令牌，避免 OAuth 刚完成就无条件换成 usage-summary 不接受的令牌。
- JWT 解码同时兼容 URL-safe 无填充与补填充形式。
- 原生 DTO 增加脱敏显示名、provider 套餐名，并继续携带账号 ID、Total/Auto/API、重置时间、抓取时间。
- Dashboard 保存并分别展示脱敏账号、脱敏 Auth ID、套餐、Total Usage、Auto + Composer Usage、API Usage、重置时间和最后同步时间。
- 401/403、缺字段、解析失败仍保持 `connected=false`，分别映射 `reauth_required`、`sync_failed` 或 `unsupported`，不写入成功 0 值。

## 当前测试结果

```text
cargo test cursor_session --lib
34 passed; 0 failed

npm --prefix dashboard test -- --run src/components/settings/TokenPlanSection.test.jsx
65 passed; 0 failed
```

## 尚未完成的真实安装版验收

- 只连接当前一个 Cursor 账号，不创建第二个账号。
- 同账号依据：Token Eyes 脱敏邮箱/Auth ID 与 Cockpit Tools 当前账号卡片逐项匹配。
- 在 60 秒内连续刷新并记录两边刷新时间。
- 比较套餐名称、Total Usage、Auto + Composer Usage、API Usage、重置时间、最后同步时间。
- 三项百分比绝对误差均不超过 1 个百分点；重置时间误差不超过 2 分钟；刷新响应不超过 10 秒。
- 保存两边安装版截图路径与原始值。
