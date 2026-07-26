# R2 本地 API、CORS、Host 与端口安全验收

- 日期：2026-07-26
- 阶段：R2
- 基线提交：`d4b7bee439754b40b554ee2b7f848537f6b57014`
- 当前提交：`d4b7bee439754b40b554ee2b7f848537f6b57014`（未替用户提交）
- 修复前保护引用：`refs/codex-backups/repair-preflight-20260726`
- 结论：通过；独立规格审查与质量审查均为 Critical 0、Important 0、Minor 0。

## 已落实的安全契约

1. 本地服务只接受实际绑定的 loopback Host/端口；支持 `127.0.0.1`、`localhost`，仅在实际绑定 IPv6 时接受 `[::1]`。
2. Origin 使用精确白名单和动态 `Access-Control-Allow-Origin`，同时设置 `Vary: Origin`；拒绝通配符、恶意预检及恶意 GET/POST。
3. `GET /api/local-auth` 是唯一握手入口，随机令牌不进入 URL、日志或上游请求。
4. 所有 `/functions/*`、`/api/auth/*`、`/api/auth-bridge/verifier` 以及全部写请求均要求本地令牌。
5. 本地认证失败返回 `401` 和安全标记 `X-TokenTracker-Local-Auth-Required: 1`；Dashboard 只对带此标记的认证失败刷新令牌并重试一次，不重试普通业务 `401`。
6. Tauri 传输错误只允许重放 GET/HEAD；非幂等请求发生传输错误时绝不自动重放。
7. Dashboard 的 API、InsForge SDK 自定义 fetch、Skills、Wrapped、云同步、云偏好、原生 OAuth 回调和认证上下文统一接入本地认证 fetch。
8. 转发至 InsForge 的请求会剥离本地令牌和本地 CORS 头，避免令牌离开 loopback。
9. Vite 开发中间件代理 `/api/*` 到真实 CLI，本地函数 mock 保留，未知函数回落到 CLI。
10. 生产环境不能通过 `enforceRequestSecurity: false` 关闭安全校验；业务测试使用只在 Node 测试上下文可用、且不可通过网络触发的 Symbol 旁路。
11. 显式端口被占用时不会查找、终止或接管其他进程；Tauri 只复用自身持有的 child，自动选择空闲端口。
12. Tauri 启动流程用互斥锁覆盖检查、选端口、启动、发布状态和就绪探测，防止并发双启动及孤儿进程。
13. Tauri 就绪探测要求固定 Origin 的精确 CORS 回显、非空令牌、协议版本和能力集合；拒绝通配符和旧协议服务。
14. Native OAuth 写入标记失败时不会打开系统浏览器；原生回调 GET 会校验 HTTP 状态。

## TDD 与缺陷闭环

先以失败测试复现以下问题，再逐项实现并转绿：

- 恶意 Host/Origin、通配符 CORS、匿名 verifier 和无令牌写请求可达。
- 本地令牌可能被转发到云端。
- `Request` body 重用及非幂等请求网络错误重放。
- Vite 开发服务缺少真实本地握手。
- Skills 在 Tauri 动态端口下使用固定绝对地址。
- Tauri 可能接管外部进程、接受空令牌或并发双启动。
- Native OAuth 标记写入失败被吞掉。
- 部分响应异常时连接未可靠关闭。

所有新增回归测试均已转绿。

## 自动验证

| 验证项 | 结果 |
|---|---|
| R2 定向 Node 测试 | 59/59 通过 |
| R2 定向 Dashboard 测试 | 本地 32/32；独立复核扩展集 34/34 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 146/146 通过 |
| `npm test` | 1509 总计，1444 通过、57 失败、8 跳过；57 项均为已冻结的 R3/R4/R5 后续问题 |
| `npm --prefix dashboard test` | 92 文件中 89 通过、3 失败；711 测试中 700 通过、11 失败，8 个未处理异常；均归属 R3 冻结问题 |
| `npm --prefix dashboard run build` | 通过，3764 个模块完成构建；仅有动态/静态导入和 chunk 大小警告 |
| `git diff --check` | 通过；仅显示仓库既有换行符转换提示 |

全量失败数没有因 R2 增加；R2 引入的 TypeScript 错误已清零。当前 typecheck 和 lint 剩余错误均已登记到 R3。

## 真实浏览器与进程验证

使用隔离 HOME 启动真实 `node bin/tracker.js serve --no-sync --no-open --port <free>`，并通过真实浏览器验证：

- 恶意 Origin 请求在浏览器侧不可读；未认证当前会话请求返回 401。
- 完成握手后，带令牌的 auth-bridge PUT 返回 200。
- `/dashboard`、`/settings/basic`、`/settings/cost`、`/spend/usage`、`/spend/cost` 均能渲染真实内容，无页面异常，也没有本地认证 401 循环。
- `/settings` 正确重定向到 `/settings/basic`，`/spend` 正确重定向到 `/spend/usage`。
- 控制台和服务日志未出现令牌或令牌路径泄露。
- 隔离环境未配置云端且禁止外网时，`/api/auth/refresh` 出现预期的 502；该现象不是本地认证回归。
- 另一个程序占用显式端口时，CLI 拒绝接管且占用进程保持存活。
- 当前产品边界下 Limits 独立路由会重定向 Dashboard；本阶段未扩张产品边界。请求详情位于 Spend Usage，交由 R3 修复其筛选语义。

## 主要变更文件

### CLI 与本地服务

- `src/lib/local-api.js`
- `src/commands/serve.js`
- `test/helpers/local-api.cjs`
- `test/local-api-security.test.js`
- `test/local-api-handshake.test.js`
- `test/serve-bind-host.test.js`
- `test/serve-port-hint.test.js`
- `test/auth-relay-forbidden-headers.test.js`
- `test/token-plan-console-sessions.test.js`
- `test/vite-local-api-plugin.test.js`

### Dashboard

- `dashboard/vite.config.js`
- `dashboard/src/lib/local-api-auth.ts`
- `dashboard/src/lib/local-api-fetch.ts`
- `dashboard/src/lib/api.ts`
- `dashboard/src/lib/insforge-config.ts`
- `dashboard/src/lib/cloud-sync.ts`
- `dashboard/src/lib/cloud-sync-prefs.ts`
- `dashboard/src/lib/skills-api.ts`
- `dashboard/src/pages/WrappedPage.jsx`
- `dashboard/src/pages/NativeAuthCallbackPage.jsx`
- `dashboard/src/contexts/InsforgeAuthContext.jsx`
- `dashboard/src/App.jsx`
- 对应的新增或更新测试文件

### Tauri

- `src-tauri/src/commands.rs`

## 回滚说明

工作区含有大量用户原有未提交修改，禁止使用 `git reset --hard`、`git checkout --` 或整体覆盖回滚。需要撤销 R2 时，应以保护引用 `refs/codex-backups/repair-preflight-20260726` 为只读对照，只对上列 R2 文件逐个生成和审查反向补丁；用户原有修改必须保留。