# TE-NEXT-W03C-R2-R1：小米 MiMo 控制台会话返工

## 返工结论

`W03C-R2` 当前不能放行，不能继续 `W03D-R2` 或 `W03E-R2`。

阻断原因有两类：

1. 原生构建失败：`npx tauri build --no-bundle` 在 `src-tauri/src/xiaomi_mimo_session.rs` 报错，当前 Tauri 版本没有 `WebviewUrl::Html`。
2. 产品逻辑失败：`open_xiaomi_mimo_console_login` 打开窗口后立刻返回 `connected: true`，没有等待用户真实登录，也没有验证是否进入小米控制台。

本返工工单只修 `W03C-R2`。修完前不允许开始 D/E。

## 必须遵守的用户需求

- 用户要实时看到小米 MiMo Token Plan 状态。
- 本工单必须建立真实的官方控制台授权会话。
- 不允许用“打开窗口成功”替代“登录成功”。
- 不允许用手动录入替代实时同步。

## 开始前必读

1. `CLAUDE.md`
2. `docs/tasks/dispatch/TE-NEXT-W03-R2-live-quota-dispatch-order.md`
3. `docs/tasks/dispatch/TE-NEXT-W03C-R2-xiaomi-mimo-console-session-auth.md`
4. `src-tauri/src/xiaomi_mimo_session.rs`
5. `src-tauri/src/lib.rs`
6. `src-tauri/src/commands.rs`
7. `src/lib/local-api.js`
8. `test/token-plan-console-sessions.test.js`
9. `dashboard/src/components/settings/TokenPlanSection.jsx`

## 允许修改的文件

- `src-tauri/src/xiaomi_mimo_session.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src/lib/local-api.js`
- `test/token-plan-console-sessions.test.js`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/lib/api.ts`
- `dashboard/src/content/copy.csv`
- `dashboard/src/content/i18n/zh/dashboard.json`，仅在文案同步流程要求时修改

不要修改 W03D/W03E，不要写额度探测逻辑。

## 任务 1：修复 Tauri 原生编译

当前错误：

```text
error[E0599]: no variant, associated function, or constant named `Html` found for enum `WebviewUrl`
src\xiaomi_mimo_session.rs:147:21
```

要求：

- 不再使用当前 Tauri crate 不支持的 `WebviewUrl::Html`。
- 使用当前项目 Tauri 版本支持的外部 URL 打开方式，目标是官方地址 `https://platform.xiaomimimo.com/console/balance`。
- 如果仍需要安全说明页，在 dashboard 内做一个普通设置页提示，再由按钮打开官方控制台窗口；不要依赖不存在的原生 HTML Webview URL 变体。
- 所有中文文案必须进入 `copy.csv`，不能硬编码在 React UI。

验证：

```powershell
npx tauri build --no-bundle
```

预期：原生构建通过。

## 任务 2：禁止“打开窗口即连接成功”

当前错误行为：

```rust
guard.active_session_ref = Some(session_ref.clone());
Ok(build_session_status(&session_ref, true, "", ""))
```

这段逻辑不能保留。打开窗口只代表“登录流程已启动”，不能代表“已连接”。

正确状态流：

- 打开窗口成功：返回 `connected: false`，`error_code: "LOGIN_STARTED"` 或等价状态。
- 用户完成登录并且能访问控制台：才允许返回 `connected: true`。
- 用户关闭窗口、停留在登录页、跳到非官方域名或无法访问控制台：必须返回 `connected: false` 和中文原因。

实现要求：

- `open_xiaomi_mimo_console_login` 只负责打开官方控制台登录窗口，不写入 `active_session_ref`。
- `verify_xiaomi_mimo_console_session` 必须执行真实验证，不能只检查内存里的 `active_session_ref`。
- 真实验证至少要确认当前受控会话可以访问小米控制台页面，而不是只存在一个引用字符串。

如果当前 Tauri API 无法直接读取控制台页面状态，本工单必须返回 `desktop_session_not_verified`，并把 C-R2 标记为阻塞，不能假装 connected。

## 任务 3：补足原生会话测试或可验证替代

新增或补充测试，覆盖：

1. `open_xiaomi_mimo_console_login` 不返回 `connected: true`。
2. 未验证会话时，`verify_xiaomi_mimo_console_session` 返回未连接。
3. 非官方域名不可作为登录完成条件。
4. `session_ref` 中包含 `cookie`、`Bearer`、`token=`、`sk-` 时被拒绝。
5. 错误信息不包含 Cookie、token、Authorization。

如果 Rust 原生命令难以在 CI 中测试，应抽出纯函数测试，例如：

- `validate_session_ref`
- `is_official_xiaomi_url`
- `map_login_state_to_status`

运行：

```powershell
cd src-tauri
cargo test xiaomi_mimo_session
cd ..
```

预期：测试通过。

## 任务 4：修正本地 API 的连接状态语义

当前 Node 测试允许 POST 后直接 `status: "connected"`。这与真实授权要求不一致。

正确语义：

- 创建会话元数据后状态应为 `pending_login` 或 `login_started`。
- 只有原生验证成功后，状态才变为 `connected`。
- `verify` 不能无条件更新 `last_verified_at` 为成功；必须接收原生验证结果。
- 如果网页环境没有原生能力，创建连接必须返回 `desktop_required`，不能写入成功记录。

补充 `test/token-plan-console-sessions.test.js`：

- POST 创建后不是 `connected`。
- verify 在没有原生验证成功时返回失败状态。
- 只有注入的原生验证 mock 返回成功时，session 才变成 `connected`。

## 任务 5：修正前端文案和流程

前端按钮和状态必须区分：

- `未连接`
- `登录中`
- `等待验证`
- `已连接`
- `连接失败`

不能在用户点击按钮后立即显示“已连接”。

前端测试必须覆盖：

- 点击连接后显示“等待小米控制台登录完成”或等价文案。
- 未验证前不显示“已连接”。
- 原生验证成功后才显示“已连接”。
- 网页环境显示“仅桌面端支持”。

## 最终验证

必须运行：

```powershell
cd src-tauri
cargo test xiaomi_mimo_session
cd ..
node --test test/token-plan-console-sessions.test.js test/token-plans-api.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

## 验收标准

- Tauri 原生构建通过。
- 打开官方窗口不再等于连接成功。
- 只有真实验证控制台会话成功后才显示 `connected`。
- 网页环境不会伪造连接。
- API 响应和日志不泄露 Cookie、token、Authorization。
- 所有最终验证通过。

## 执行顺序影响

本工单完成前：

- 不要开始 `W03D-R2` 的应用内探测。
- 不要开始 `W03E-R2`。
- 如果需要并行，只能让另一个代理做 `W03D-R2` 的人工 DevTools/HAR 探测准备，但不能写生产适配器。
