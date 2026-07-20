# TRAE OAuth 重修失败基线（2026-07-20）

状态：FAIL / INCOMPLETE（修复前安装版）

## 真实安装版现象

- 用户在 TRAE CN 官方页面完成操作后，页面长期停留在“认证中…正在验证身份，请稍候……”。
- Token Eyes 未自动退出等待状态，也未得到真实套餐额度。
- 失败截图：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-5e3b2a18-d740-4341-b3de-7475b4419faf.png`。

## 代码基线与失败测试

修复前 `cargo test --manifest-path src-tauri/Cargo.toml --lib trae_session::tests -- --nocapture` 为 13/13 通过，但未覆盖真实失败路径。

新增测试后依次得到以下预期失败：

1. `accepts_fragment_callback_parameters`
   - 失败：`TRAE callback did not include authCodeInfo/AuthCode or refreshToken`
   - 证明回调只解析 query，不解析 fragment。
2. `pending_callback_page_forwards_browser_fragment_and_keeps_waiting`
   - 失败：`cannot find function callback_pending_html`
   - 证明空回调没有 fragment 桥接页面，监听器也会在首个请求后退出。
3. `installed_trae_context_drives_oauth_identity_fields`
   - 失败：`cannot find function login_context_from_values`
   - 证明实现没有读取已安装 TRAE 的产品与设备上下文。
4. `authorization_url_reuses_installed_trae_context`
   - 失败：`cannot find function build_authorization_url_with_context`
   - 证明授权 URL 使用硬编码版本和随机设备字段。
5. `token_exchange_reuses_the_same_oauth_identity`
   - 失败：`cannot find function auth_code_exchange_body`
   - 证明令牌交换再次生成随机设备字段，未复用授权身份。
6. `user_info_uses_cloudide_token_header_not_quota_authorization`
   - 失败：`cannot find function profile_auth_headers`
   - 证明 GetUserInfo 没有独立的认证头约束。
7. `keeps TRAE polling for the official 600-second OAuth lifetime`
   - 失败：`quotaConsoleAuthTimeoutMs is not a function`
   - 证明前端仅使用通用 5 分钟超时，短于官方 600 秒会话。
8. `windows_11_build_is_not_reported_as_windows_10`
   - 失败：`cannot find function normalize_windows_product_name`
   - 证明 Windows 11 会被注册表兼容字段误报为 Windows 10。
9. `callback_error_is_a_terminal_failed_status`
   - 失败：`cannot find function callback_failed`
   - 证明回调超时/失败没有受测的终止状态映射。

## 本机只读上下文（不含凭据）

- TRAE CN 安装目录：`E:\Users\admin\AppData\Local\Programs\Trae CN\`
- appVersion：`3.3.75`
- tronBuildVersion：`2.3.53679`
- quality：`stable`
- client ID：`ono9krqynydwx5`
- telemetry.machineId：存在（报告不记录原值）
- device ID 回退：`0`
- Windows build：`26200`（应作为 Windows 11 发送）

上述信息仅用于生成官方授权上下文；没有读取或记录 Cockpit Tools 的令牌。
