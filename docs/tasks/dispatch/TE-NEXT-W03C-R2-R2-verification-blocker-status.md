# TE-NEXT-W03C-R2-R2：小米 MiMo 控制台会话验证阻塞状态修正

## 背景

`W03C-R2-R1` 已经修复了两个关键问题：

- `npx tauri build --no-bundle` 可以通过，不再使用当前 Tauri 版本不存在的 `WebviewUrl::Html`。
- 打开小米 MiMo 官方控制台窗口不再直接标记为 `connected`。

但当前实现仍未达到 `W03C-R2-R1` 工单的验收语义：当 Tauri 侧无法读取外部 WebView 内页状态时，`verify_xiaomi_mimo_console_session` 应返回明确的 `desktop_session_not_verified` 阻塞状态，而不是继续返回 `awaiting_verification`。

用户需求仍以实时同步为准：不能把“等待验证”当成可继续实现实时同步的会话基础。

## 允许修改的文件

- `src-tauri/src/xiaomi_mimo_session.rs`
- `src/lib/local-api.js`
- `test/token-plan-console-sessions.test.js`
- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/content/copy.csv`
- `dashboard/src/content/i18n/zh/dashboard.json`，仅在文案同步流程要求时修改

不要修改 `W03D/W03E` 的额度探测或同步适配逻辑。

## 任务 1：无法真实验证时返回明确阻塞状态

当前问题：

```rust
let url = last_known_url.unwrap_or_default();
Ok(map_login_state_to_status(&session_ref, false, Some(&url)))
```

这会让 `verify_xiaomi_mimo_console_session` 返回 `awaiting_verification`，导致 UI 继续停留在“等待验证”，而不是明确说明桌面端当前没有真实会话验证能力。

要求：

- `open_xiaomi_mimo_console_login` 仍保持 `connected: false` 和 `state_code: login_started`。
- `verify_xiaomi_mimo_console_session` 在当前无法读取外部 WebView 内页状态时，必须返回：
  - `connected: false`
  - `state_code: desktop_session_not_verified`
  - `error_code: DESKTOP_SESSION_NOT_VERIFIED`
  - 中文错误信息，含义为“桌面端暂无法验证小米控制台登录状态，不能继续实时同步”
- 本地 API 收到 `desktop_session_not_verified` 后必须保持不连接，并记录失败/阻塞原因。
- 前端不能显示“已连接”，必须显示清晰的阻塞/失败文案。

## 任务 2：修正官方域名校验

当前问题：

```rust
OFFICIAL_DOMAINS.iter().any(|domain| url.contains(domain))
```

`contains()` 会误接受这类 URL：

- `https://platform.xiaomimimo.com.evil.example/`
- `https://evil.example/?next=platform.xiaomimimo.com`

要求：

- 使用 URL 解析后校验 `host`。
- 允许精确官方域名或官方父域的子域，例如：
  - `platform.xiaomimimo.com`
  - `mimo.mi.com`
  - `account.xiaomimimo.com`
- 必须拒绝把官方域名放在查询参数、路径或伪造后缀域名里的 URL。

## 任务 3：补测试

Rust 测试必须覆盖：

- `verify_xiaomi_mimo_console_session` 无法真实验证时对应的纯函数/状态构造返回 `desktop_session_not_verified`。
- `is_official_xiaomi_url` 拒绝 `https://platform.xiaomimimo.com.evil.example/`。
- `is_official_xiaomi_url` 拒绝 `https://evil.example/?next=platform.xiaomimimo.com`。
- `open` 状态仍不等于 `connected`。

Node/API 或前端测试必须覆盖：

- 收到 `desktop_session_not_verified` 后不会进入 `connected`。
- UI 不显示“已连接”，而显示桌面端无法验证/实时同步阻塞文案。

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

- Tauri 构建通过。
- 打开控制台窗口不会被当成连接成功。
- 当前无法真实验证控制台登录时，状态明确进入 `desktop_session_not_verified`，不能无限停在 `awaiting_verification`。
- 官方域名校验不再使用字符串包含匹配。
- 前端和 API 都不会把未验证会话当成可实时同步的授权基础。

## 对后续工单的影响

- 可以继续 `W03D-R2` 的人工 DevTools/HAR 探测，用来确认小米控制台真实额度数据来源。
- 不要开始 `W03E-R2`。
- 不要开始 `W03D-R2` 的生产适配器代码，除非已有真实可复现的数据来源，并且有能被应用内调用的授权会话能力。
