//! Xiaomi MiMo Console Session Module
//!
//! Implements desktop-side commands for opening, verifying, and revoking
//! official Xiaomi MiMo console login sessions.
//!
//! Security invariants:
//! - Login happens on official Xiaomi page; Token Eyes never sees credentials
//! - Session reference is a path pointer, not a cookie value
//! - Domain is restricted to official Xiaomi domains only
//! - No cookie, token, or credential data is ever logged or stored
//! - "Window opened" never equals "connected"; verification is explicit
//! - sessionFetch keeps desensitized quota in page memory; Rust reads it with
//!   eval_with_callback without granting the remote page native IPC

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const OFFICIAL_DOMAINS: &[&str] = &[
    "platform.xiaomimimo.com",
    "mimo.mi.com",
    "xiaomimimo.com",
    // Xiaomi SSO / authentication domains needed for login flow
    "account.xiaomi.com",
    "passport.xiaomi.com",
    "api.account.xiaomi.com",
    "api.mi.com",
    "xiaomi.com",
    "mi.com",
];

const LOGIN_URL: &str = "https://platform.xiaomimimo.com/console/balance";
const WINDOW_TITLE: &str = "小米 MiMo 官方控制台登录 - Token Eyes";
const QUOTA_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// The JS injected into the Xiaomi MiMo console WebView via initialization_script.
///
/// It registers `window.__tokenEyesSessionFetch__` which, when called, performs a
/// same-session fetch to the official quota API using the WebView's cookies
/// (credentials: 'include'). The result (only quota numbers) is passed back to
/// page memory for Rust to inspect through `eval_with_callback`.
///
/// SECURITY: This script MUST NOT read document.cookie, localStorage,
/// sessionStorage, or any DOM content. It only calls the official API and
/// passes back quota numbers.
const SESSION_FETCH_JS: &str = r#"(function () {
  window.__tokenEyesQuotaResult__ = null;
  window.__tokenEyesSessionFetch__ = async function() {
    if (window.location.hostname !== 'platform.xiaomimimo.com') return;
    try {
      var resp = await fetch('/api/v1/tokenPlan/usage', { credentials: 'include' });
      if (resp.status === 401 || resp.status === 403) {
        window.__tokenEyesQuotaResult__ = {
          status: 'error', error: 'auth_required', error_code: String(resp.status)
        };
        return;
      }
      if (!resp.ok) {
        window.__tokenEyesQuotaResult__ = {
          status: 'error',
          error: resp.status >= 500 ? 'server_error' : 'http_error',
          error_code: String(resp.status)
        };
        return;
      }
      var json = await resp.json();
      var items = json && json.data && json.data.usage && json.data.usage.items;
      var planItem = Array.isArray(items)
        ? items.find(function (item) { return item.name === 'plan_total_token'; })
        : null;
      if (!planItem) {
        window.__tokenEyesQuotaResult__ = {
          status: 'error', error: 'structure_drift', error_code: 'parse_error'
        };
        return;
      }
      var total = Number(planItem.limit);
      var used = Number(planItem.used);
      if (!Number.isFinite(total) || !Number.isFinite(used) || total < 0 || used < 0) {
        window.__tokenEyesQuotaResult__ = {
          status: 'error', error: 'structure_drift', error_code: 'parse_error'
        };
        return;
      }
      window.__tokenEyesQuotaResult__ = {
        status: 'success',
        total: total,
        used: used,
        remaining: Math.max(0, total - used),
        expires_at: null,
        provider_reported_at: new Date().toISOString()
      };
    } catch (_error) {
      window.__tokenEyesQuotaResult__ = {
        status: 'error', error: 'network_error', error_code: 'network_error'
      };
    }
  };
  function scheduleMimoQuotaFetch() {
    if (window.location.hostname === 'platform.xiaomimimo.com' && window.__tokenEyesSessionFetch__) {
      window.__tokenEyesSessionFetch__();
    }
  }
  window.addEventListener('load', scheduleMimoQuotaFetch);
  var _pushState = history.pushState;
  history.pushState = function () {
    _pushState.apply(this, arguments);
    scheduleMimoQuotaFetch();
  };
  window.addEventListener('popstate', scheduleMimoQuotaFetch);
  scheduleMimoQuotaFetch();
})();
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStateCode {
    LoginStarted,
    AwaitingVerification,
    Connected,
    NotVerified,
    SessionNotFound,
    InvalidSessionRef,
    NonOfficialDomain,
    DesktopSessionNotVerified,
    ReauthRequired,
    Unsupported,
    Failed,
}

/// Desensitized quota DTO returned to Rust. Contains only quota numbers.
/// MUST NOT contain cookie, header, token, or raw_response fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct XiaomiMimoQuotaDto {
    pub total_quota: f64,
    pub used_quota: f64,
    pub remaining_quota: f64,
    pub expires_at: Option<String>,
    pub provider_reported_at: String,
}

/// The structure Rust reads from page memory through `eval_with_callback`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuotaFetchResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_reported_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XiaomiMimoSessionStatus {
    pub connected: bool,
    pub session_ref: String,
    pub state_code: SessionStateCode,
    pub error_code: String,
    pub error_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota: Option<XiaomiMimoQuotaDto>,
}

impl Default for XiaomiMimoSessionStatus {
    fn default() -> Self {
        Self {
            connected: false,
            session_ref: String::new(),
            state_code: SessionStateCode::NotVerified,
            error_code: String::new(),
            error_message: String::new(),
            quota: None,
        }
    }
}

#[derive(Default)]
pub struct SessionState {
    active_session_ref: Option<String>,
    last_known_url: Option<String>,
    active_window_label: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure helpers (testable, no Tauri runtime needed)
// ---------------------------------------------------------------------------

/// Returns true when `session_ref` looks like a path reference, not a credential.
pub fn validate_session_ref(session_ref: &str) -> Result<(), &'static str> {
    if session_ref.is_empty() {
        return Err("session_ref cannot be empty");
    }
    if session_ref.contains("cookie")
        || session_ref.contains("Bearer")
        || session_ref.contains("sk-")
        || session_ref.contains("token=")
    {
        return Err("session_ref must be a path reference, not a credential value");
    }
    Ok(())
}

fn parse_quota_eval_result(raw: &str) -> Result<Option<QuotaFetchResult>, String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("Unable to parse MiMo quota result: {error}"))?;
    if value.is_null() {
        return Ok(None);
    }
    if !value.is_object() {
        return Err("MiMo quota result must be an object or null".to_string());
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("Invalid MiMo quota result: {error}"))
}

fn take_active_window_label(state: &mut SessionState, session_ref: &str) -> Option<String> {
    if state.active_session_ref.as_deref() != Some(session_ref) {
        return None;
    }
    state.active_session_ref = None;
    state.last_known_url = None;
    state.active_window_label.take()
}

/// Returns true when `url` belongs to one of the official Xiaomi MiMo domains.
///
/// Uses URL parsing to extract the host and validate it properly, rejecting:
/// - URLs where official domain appears only in query params or path
/// - URLs where official domain is a suffix of another domain (phishing)
/// - Non-url strings
pub fn is_official_xiaomi_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    for domain in OFFICIAL_DOMAINS {
        if host == *domain || host.ends_with(&format!(".{}", domain)) {
            return true;
        }
    }
    false
}

/// Maps a quota fetch result to a session status.
///
/// This is the pure function that determines the final status based on:
/// - Whether an active session exists
/// - Whether the WebView window still exists
/// - The result returned by the injected JS (success/error/timeout)
pub fn map_quota_fetch_result_to_status(
    session_ref: &str,
    has_active_session: bool,
    window_exists: bool,
    result: Option<&QuotaFetchResult>,
) -> XiaomiMimoSessionStatus {
    if validate_session_ref(session_ref).is_err() {
        return build_status(
            session_ref,
            false,
            SessionStateCode::InvalidSessionRef,
            "INVALID_SESSION_REF",
            "session_ref 格式无效",
        );
    }

    if !has_active_session {
        return build_status(
            session_ref,
            false,
            SessionStateCode::SessionNotFound,
            "SESSION_NOT_FOUND",
            "未找到对应的登录会话，请重新连接。",
        );
    }

    if !window_exists {
        return build_status(
            session_ref,
            false,
            SessionStateCode::SessionNotFound,
            "SESSION_NOT_FOUND",
            "登录窗口已关闭，请重新连接。",
        );
    }

    let Some(result) = result else {
        // Window exists but no result yet — user hasn't completed login
        // or the fetch hasn't returned.
        return build_status(
            session_ref,
            false,
            SessionStateCode::AwaitingVerification,
            "AWAITING_VERIFICATION",
            "等待小米控制台登录完成，请在窗口内登录后点击验证。",
        );
    };

    if result.status == "success" {
        let (Some(total), Some(used)) = (result.total, result.used) else {
            return build_status(
                session_ref,
                false,
                SessionStateCode::Unsupported,
                "UNSUPPORTED",
                "官方返回的额度字段缺失或格式无效。",
            );
        };
        if !total.is_finite() || !used.is_finite() || total < 0.0 || used < 0.0 {
            return build_status(
                session_ref,
                false,
                SessionStateCode::Unsupported,
                "UNSUPPORTED",
                "官方返回的额度字段缺失或格式无效。",
            );
        }
        let remaining = (total - used).max(0.0);
        let provider_reported_at = result
            .provider_reported_at
            .clone()
            .unwrap_or_else(|| String::new());
        return XiaomiMimoSessionStatus {
            connected: true,
            session_ref: session_ref.to_string(),
            state_code: SessionStateCode::Connected,
            error_code: String::new(),
            error_message: String::new(),
            quota: Some(XiaomiMimoQuotaDto {
                total_quota: total,
                used_quota: used,
                remaining_quota: remaining,
                expires_at: result.expires_at.clone(),
                provider_reported_at,
            }),
        };
    }

    // Error cases — map error_code to appropriate state
    let error_code = result.error_code.as_deref().unwrap_or("");
    match error_code {
        "401" | "403" | "auth_required" => build_status(
            session_ref,
            false,
            SessionStateCode::ReauthRequired,
            "REAUTH_REQUIRED",
            "登录已失效，请重新连接小米控制台。",
        ),
        "parse_error" | "structure_drift" => build_status(
            session_ref,
            false,
            SessionStateCode::Unsupported,
            "UNSUPPORTED",
            "官方返回结构无法识别，可能接口已变更。",
        ),
        "network_error" => build_status(
            session_ref,
            false,
            SessionStateCode::Failed,
            "NETWORK_ERROR",
            "网络请求失败，请检查网络后重试。",
        ),
        _ => {
            // 5xx or other HTTP errors
            if error_code.starts_with('5') {
                build_status(
                    session_ref,
                    false,
                    SessionStateCode::Failed,
                    "SERVER_ERROR",
                    "服务商暂时不可用，请稍后重试。",
                )
            } else {
                build_status(
                    session_ref,
                    false,
                    SessionStateCode::Failed,
                    "FETCH_FAILED",
                    "额度查询失败，请稍后重试。",
                )
            }
        }
    }
}

/// Maps a (window_state, native_verification_result, current_url) triple to a status.
///
/// `native_verification_passed` is only true when the native bridge has confirmed
/// that the user actually reached the console page. Until that happens the
/// session is never reported as connected.
pub fn map_login_state_to_status(
    session_ref: &str,
    native_verification_passed: bool,
    current_url: Option<&str>,
) -> XiaomiMimoSessionStatus {
    if validate_session_ref(session_ref).is_err() {
        return build_status(
            session_ref,
            false,
            SessionStateCode::InvalidSessionRef,
            "INVALID_SESSION_REF",
            "session_ref 格式无效",
        );
    }

    if !native_verification_passed {
        let url = current_url.unwrap_or("");
        if !url.is_empty() && !is_official_xiaomi_url(url) {
            return build_status(
                session_ref,
                false,
                SessionStateCode::NonOfficialDomain,
                "NON_OFFICIAL_DOMAIN",
                "会话跳转到非官方域名，已停止",
            );
        }
        return build_status(
            session_ref,
            false,
            SessionStateCode::AwaitingVerification,
            "AWAITING_VERIFICATION",
            "等待小米控制台登录完成",
        );
    }

    build_status(session_ref, true, SessionStateCode::Connected, "", "")
}

fn build_status(
    session_ref: &str,
    connected: bool,
    state_code: SessionStateCode,
    error_code: &str,
    error_message: &str,
) -> XiaomiMimoSessionStatus {
    XiaomiMimoSessionStatus {
        connected,
        session_ref: session_ref.to_string(),
        state_code,
        error_code: error_code.to_string(),
        error_message: error_message.to_string(),
        quota: None,
    }
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}{:x}", duration.as_secs(), duration.subsec_nanos())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Opens the Xiaomi MiMo official console login page in a new window.
///
/// IMPORTANT: opening a window is NOT a successful login. This command only
/// returns `connected: false` and `state_code: LoginStarted`; the caller
/// must invoke `verify_xiaomi_mimo_console_session` to confirm the user
/// actually reached the console.
///
/// The window is created with:
/// - `initialization_script(SESSION_FETCH_JS)` — injects the quota fetch helper
/// - `on_navigation` — blocks navigation to non-official domains
#[tauri::command]
pub async fn open_xiaomi_mimo_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<XiaomiMimoSessionStatus, String> {
    if let Err(reason) = validate_session_ref(&session_ref) {
        return Err(reason.to_string());
    }

    let window_label = format!("xiaomi_mimo_login_{}", uuid_simple());

    let window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::External(
            LOGIN_URL
                .parse()
                .map_err(|e| format!("Invalid official login URL: {e}"))?,
        ),
    )
    .title(WINDOW_TITLE)
    .inner_size(960.0, 720.0)
    .resizable(true)
    .center()
    .initialization_script(SESSION_FETCH_JS)
    .on_navigation(|url| is_official_xiaomi_url(url.as_str()))
    .build()
    .map_err(|e| format!("Failed to open official console login window: {e}"))?;

    // Only remember that a login flow has been *started* for this ref;
    // do NOT mark the session as connected.
    if let Some(state) = app.try_state::<Mutex<SessionState>>() {
        if let Ok(mut guard) = state.lock() {
            guard.active_session_ref = Some(session_ref.clone());
            guard.last_known_url = Some(LOGIN_URL.to_string());
            guard.active_window_label = Some(window_label.clone());
        }
    }

    // The window is managed by Tauri; we don't need to hold the handle.
    drop(window);

    Ok(build_status(
        &session_ref,
        false,
        SessionStateCode::LoginStarted,
        "LOGIN_STARTED",
        "官方控制台登录窗口已打开，请在窗口内完成登录。",
    ))
}

/// Verifies whether the session reference has reached the official console
/// and queries the quota via the injected sessionFetch JS.
///
/// This command:
/// 1. Checks if an active session and window exist
/// 2. Reads the desensitized page-memory result through eval callback
/// 3. Maps the result to a session status with optional quota DTO
#[tauri::command]
pub async fn verify_xiaomi_mimo_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<XiaomiMimoSessionStatus, String> {
    if let Err(reason) = validate_session_ref(&session_ref) {
        return Err(reason.to_string());
    }

    // Read session state and window label
    let (has_active_session, window_label) =
        if let Some(state) = app.try_state::<Mutex<SessionState>>() {
            if let Ok(guard) = state.lock() {
                let has = guard.active_session_ref.as_deref() == Some(session_ref.as_str());
                (has, guard.active_window_label.clone())
            } else {
                (false, None)
            }
        } else {
            (false, None)
        };

    if !has_active_session {
        return Ok(build_status(
            &session_ref,
            false,
            SessionStateCode::SessionNotFound,
            "SESSION_NOT_FOUND",
            "未找到对应的登录会话，请重新连接。",
        ));
    }

    // Check if the WebView window still exists
    let window = window_label
        .as_deref()
        .and_then(|label| app.get_webview_window(label));

    let window_exists = window.is_some();

    if !window_exists {
        return Ok(build_status(
            &session_ref,
            false,
            SessionStateCode::SessionNotFound,
            "SESSION_NOT_FOUND",
            "登录窗口已关闭，请重新连接。",
        ));
    }

    let window = window.expect("window checked above");

    window
        .eval(
            "if (window.__tokenEyesSessionFetch__) { window.__tokenEyesQuotaResult__ = null; window.__tokenEyesSessionFetch__(); }",
        )
        .map_err(|error| format!("Unable to trigger MiMo quota fetch: {error}"))?;

    let poll_started = std::time::Instant::now();
    let mut result: Option<QuotaFetchResult> = None;
    while poll_started.elapsed() < QUOTA_FETCH_TIMEOUT {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .eval_with_callback("window.__tokenEyesQuotaResult__ || null", move |value| {
                let _ = sender.send(value);
            })
            .map_err(|error| format!("Unable to inspect MiMo login state: {error}"))?;

        let raw =
            tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(2)))
                .await
                .map_err(|error| format!("MiMo quota callback task failed: {error}"))?
                .ok();

        if let Some(raw) = raw {
            if let Some(parsed) = parse_quota_eval_result(&raw)? {
                let settled = parsed.status == "success"
                    || parsed.error.as_deref().is_some_and(|e| !e.is_empty());
                if settled {
                    result = Some(parsed);
                    break;
                }
            }
        }

        let _ = tauri::async_runtime::spawn_blocking(|| {
            std::thread::sleep(Duration::from_millis(300));
        })
        .await;
    }

    let status = map_quota_fetch_result_to_status(
        &session_ref,
        has_active_session,
        window_exists,
        result.as_ref(),
    );

    if status.connected {
        let _ = window.close();
    }

    Ok(status)
}

/// Deletes the active Xiaomi MiMo console session.
#[tauri::command]
pub async fn delete_xiaomi_mimo_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<(), String> {
    let window_label = if let Some(state) = app.try_state::<Mutex<SessionState>>() {
        if let Ok(mut guard) = state.lock() {
            take_active_window_label(&mut guard, &session_ref)
        } else {
            None
        }
    } else {
        None
    };

    // Close the login window if it's still open
    if let Some(label) = window_label {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests (run with `cargo test xiaomi_mimo_session`)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_session_ref_accepts_path_style_reference() {
        assert!(validate_session_ref("token-plan/xiaomi_mimo/session/abc-123").is_ok());
        assert!(validate_session_ref("token-plan/xiaomi_mimo/session/uuid-9f8e").is_ok());
    }

    #[test]
    fn validate_session_ref_rejects_empty() {
        assert!(validate_session_ref("").is_err());
    }

    #[test]
    fn validate_session_ref_rejects_cookie_token_bearer_or_sk_prefix() {
        for bad in [
            "token-plan/xiaomi_mimo/session/cookie=abc",
            "token-plan/Bearer/session/abc",
            "session/sk-abcdef123",
            "session/token=eyJhbGciOiJIUzI1NiJ9",
        ] {
            assert!(
                validate_session_ref(bad).is_err(),
                "expected rejection of {bad}"
            );
        }
    }

    #[test]
    fn is_official_xiaomi_url_accepts_console_and_documents() {
        assert!(is_official_xiaomi_url(
            "https://platform.xiaomimimo.com/console/balance"
        ));
        assert!(is_official_xiaomi_url("https://mimo.mi.com/console"));
        assert!(is_official_xiaomi_url(
            "https://account.xiaomimimo.com/login"
        ));
    }

    #[test]
    fn is_official_xiaomi_url_rejects_phishing_and_unknown_hosts() {
        for bad in [
            "https://xiaomimimo-login.evil.example/console",
            "https://example.com",
            "https://github.com/login",
            "not a url at all",
        ] {
            assert!(!is_official_xiaomi_url(bad), "expected rejection of {bad}");
        }
    }

    #[test]
    fn is_official_xiaomi_url_rejects_official_domain_as_suffix() {
        assert!(
            !is_official_xiaomi_url("https://platform.xiaomimimo.com.evil.example/"),
            "reject official domain as suffix of evil domain"
        );
        assert!(
            !is_official_xiaomi_url("https://mimo.mi.com.attacker.net/login"),
            "reject official domain as suffix of attacker domain"
        );
    }

    #[test]
    fn is_official_xiaomi_url_rejects_official_domain_in_query_params() {
        assert!(
            !is_official_xiaomi_url("https://evil.example/?next=platform.xiaomimimo.com"),
            "reject official domain in query param"
        );
        assert!(
            !is_official_xiaomi_url("https://malicious.com/redirect?url=mimo.mi.com"),
            "reject official domain in query param value"
        );
        assert!(
            !is_official_xiaomi_url("https://evil.com/path/platform.xiaomimimo.com"),
            "reject official domain in path"
        );
    }

    #[test]
    fn is_official_xiaomi_url_accepts_subdomains_of_official_domains() {
        assert!(
            is_official_xiaomi_url("https://account.xiaomimimo.com/login"),
            "accept account.xiaomimimo.com"
        );
        assert!(
            is_official_xiaomi_url("https://api.mimo.mi.com/v1/balance"),
            "accept api.mimo.mi.com"
        );
        assert!(
            is_official_xiaomi_url("https://console.platform.xiaomimimo.com/dashboard"),
            "accept console.platform.xiaomimimo.com"
        );
    }

    // -----------------------------------------------------------------------
    // sessionFetch tests (R3B-Rework-2)
    // -----------------------------------------------------------------------

    #[test]
    fn initialization_script_keeps_quota_in_page_memory_without_remote_ipc() {
        let js = SESSION_FETCH_JS.to_lowercase();
        assert!(js.contains("__tokeneyesquotaresult__"));
        assert!(!js.contains("__tauri__"));
        assert!(!js.contains("invoke("));
        assert!(js.contains("platform.xiaomimimo.com"));
    }

    #[test]
    fn initialization_script_preserves_provider_credit_units() {
        let js = SESSION_FETCH_JS.to_lowercase();
        assert!(js.contains("var total = number(planitem.limit);"));
        assert!(js.contains("var used = number(planitem.used);"));
        assert!(!js.contains("100000000"));
    }

    #[test]
    fn parse_quota_eval_result_accepts_success_object() {
        let raw = r#"{"status":"success","total":11000000000,"used":100,"remaining":10999999900,"expires_at":null,"provider_reported_at":"2026-06-28T00:00:00.000Z"}"#;
        let parsed = parse_quota_eval_result(raw).unwrap().unwrap();
        assert_eq!(parsed.status, "success");
        assert_eq!(parsed.total, Some(11_000_000_000.0));
        assert_eq!(parsed.used, Some(100.0));
    }

    #[test]
    fn parse_quota_eval_result_treats_null_as_awaiting() {
        assert_eq!(parse_quota_eval_result("null").unwrap(), None);
    }

    #[test]
    fn parse_quota_eval_result_rejects_non_object_values() {
        assert!(parse_quota_eval_result("\"unexpected\"").is_err());
    }

    #[test]
    fn taking_active_window_label_clears_matching_session_after_preserving_label() {
        let mut state = SessionState {
            active_session_ref: Some("token-plan/xiaomi_mimo/session/uuid-1".to_string()),
            last_known_url: Some(LOGIN_URL.to_string()),
            active_window_label: Some("xiaomi-window".to_string()),
        };

        let label = take_active_window_label(&mut state, "token-plan/xiaomi_mimo/session/uuid-1");

        assert_eq!(label.as_deref(), Some("xiaomi-window"));
        assert_eq!(state.active_session_ref, None);
        assert_eq!(state.last_known_url, None);
        assert_eq!(state.active_window_label, None);
    }

    #[test]
    fn session_fetch_quota_returns_not_verified_when_window_closed() {
        // has_active_session=true but window_exists=false → SessionNotFound
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,  // has_active_session
            false, // window_exists
            None,  // no result
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::SessionNotFound);
    }

    #[test]
    fn session_fetch_quota_returns_awaiting_when_no_login_yet() {
        // has_active_session=true, window_exists=true, result=None
        // → AwaitingVerification (user hasn't logged in / fetch hasn't returned)
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            true,
            None,
        );
        assert!(!status.connected, "window opened must not be connected");
        assert_eq!(status.state_code, SessionStateCode::AwaitingVerification);
        assert!(!status.error_message.is_empty());
    }

    #[test]
    fn session_fetch_quota_returns_connected_with_dto_on_success() {
        let result = QuotaFetchResult {
            status: "success".to_string(),
            total: Some(100.0),
            used: Some(30.0),
            remaining: Some(70.0),
            expires_at: None,
            provider_reported_at: Some("2026-06-27T12:00:00Z".to_string()),
            error: None,
            error_code: None,
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(status.connected);
        assert_eq!(status.state_code, SessionStateCode::Connected);
        assert_eq!(status.error_code, "");
        assert!(status.quota.is_some());
        let quota = status.quota.unwrap();
        assert_eq!(quota.total_quota, 100.0);
        assert_eq!(quota.used_quota, 30.0);
        assert_eq!(quota.remaining_quota, 70.0);
        assert_eq!(quota.provider_reported_at, "2026-06-27T12:00:00Z");
    }

    #[test]
    fn session_fetch_quota_rejects_missing_non_finite_or_negative_values() {
        for (total, used) in [
            (None, Some(30.0)),
            (Some(100.0), None),
            (Some(f64::NAN), Some(30.0)),
            (Some(100.0), Some(-1.0)),
        ] {
            let result = QuotaFetchResult {
                status: "success".to_string(),
                total,
                used,
                remaining: None,
                expires_at: None,
                provider_reported_at: Some("2026-06-27T12:00:00Z".to_string()),
                error: None,
                error_code: None,
            };
            let status = map_quota_fetch_result_to_status(
                "token-plan/xiaomi_mimo/session/uuid-invalid",
                true,
                true,
                Some(&result),
            );
            assert!(!status.connected);
            assert_eq!(status.state_code, SessionStateCode::Unsupported);
            assert!(status.quota.is_none());
        }
    }

    #[test]
    fn session_fetch_quota_clamps_overage_remaining_to_zero() {
        let result = QuotaFetchResult {
            status: "success".to_string(),
            total: Some(11_000_000_000.0),
            used: Some(11_000_864_960.0),
            remaining: Some(-864_960.0),
            expires_at: None,
            provider_reported_at: Some("2026-06-27T12:00:00Z".to_string()),
            error: None,
            error_code: None,
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-overage",
            true,
            true,
            Some(&result),
        );
        assert!(status.connected);
        assert_eq!(status.quota.unwrap().remaining_quota, 0.0);
    }

    #[test]
    fn session_fetch_quota_returns_reauth_on_401() {
        let result = QuotaFetchResult {
            status: "error".to_string(),
            total: None,
            used: None,
            remaining: None,
            expires_at: None,
            provider_reported_at: None,
            error: Some("auth_required".to_string()),
            error_code: Some("401".to_string()),
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::ReauthRequired);
        assert_eq!(status.error_code, "REAUTH_REQUIRED");
        assert!(status.quota.is_none(), "old quota must not be cleared here");
    }

    #[test]
    fn session_fetch_quota_returns_reauth_on_403() {
        let result = QuotaFetchResult {
            status: "error".to_string(),
            total: None,
            used: None,
            remaining: None,
            expires_at: None,
            provider_reported_at: None,
            error: Some("auth_required".to_string()),
            error_code: Some("403".to_string()),
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::ReauthRequired);
    }

    #[test]
    fn session_fetch_quota_returns_failed_on_network_error() {
        let result = QuotaFetchResult {
            status: "error".to_string(),
            total: None,
            used: None,
            remaining: None,
            expires_at: None,
            provider_reported_at: None,
            error: Some("network_error".to_string()),
            error_code: Some("network_error".to_string()),
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "NETWORK_ERROR");
        assert!(status.quota.is_none());
    }

    #[test]
    fn session_fetch_quota_returns_failed_on_5xx() {
        let result = QuotaFetchResult {
            status: "error".to_string(),
            total: None,
            used: None,
            remaining: None,
            expires_at: None,
            provider_reported_at: None,
            error: Some("server_error".to_string()),
            error_code: Some("503".to_string()),
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "SERVER_ERROR");
    }

    #[test]
    fn session_fetch_quota_returns_unsupported_on_invalid_structure() {
        let result = QuotaFetchResult {
            status: "error".to_string(),
            total: None,
            used: None,
            remaining: None,
            expires_at: None,
            provider_reported_at: None,
            error: Some("structure_drift".to_string()),
            error_code: Some("parse_error".to_string()),
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::Unsupported);
        assert_eq!(status.error_code, "UNSUPPORTED");
    }

    #[test]
    fn session_fetch_dto_does_not_contain_cookie_or_headers() {
        let result = QuotaFetchResult {
            status: "success".to_string(),
            total: Some(100.0),
            used: Some(30.0),
            remaining: Some(70.0),
            expires_at: None,
            provider_reported_at: Some("2026-06-27T12:00:00Z".to_string()),
            error: None,
            error_code: None,
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        let json = serde_json::to_string(&status).unwrap().to_lowercase();
        for forbidden in [
            "cookie",
            "authorization",
            "bearer",
            "token=",
            "header",
            "raw_response",
            "set-cookie",
        ] {
            assert!(
                !json.contains(forbidden),
                "DTO leaked forbidden field '{forbidden}': {json}"
            );
        }
    }

    #[test]
    fn initialization_script_does_not_read_cookie_or_dom() {
        let js = SESSION_FETCH_JS.to_lowercase();
        for forbidden in [
            "document.cookie",
            "localstorage",
            "sessionstorage",
            "getcookie",
            "document.getelementbyid",
            "document.queryselector",
            "document.getelementsby",
        ] {
            assert!(
                !js.contains(forbidden),
                "SESSION_FETCH_JS contains forbidden DOM/cookie access '{forbidden}'"
            );
        }
        // Verify it does call fetch with credentials:include (same-session)
        assert!(
            js.contains("credentials: 'include'") || js.contains("credentials:'include'"),
            "SESSION_FETCH_JS must use credentials: 'include' for same-session fetch"
        );
    }

    #[test]
    fn session_fetch_quota_returns_session_not_found_when_no_active_session() {
        let status = map_quota_fetch_result_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            false, // no active session
            false,
            None,
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::SessionNotFound);
    }

    #[test]
    fn session_fetch_quota_returns_invalid_for_bad_session_ref() {
        let status = map_quota_fetch_result_to_status("session/cookie=abc", true, true, None);
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::InvalidSessionRef);
    }

    // -----------------------------------------------------------------------
    // Legacy tests (preserved from original)
    // -----------------------------------------------------------------------

    #[test]
    fn map_login_state_to_status_returns_login_started_when_window_just_opened() {
        let status = map_login_state_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            false,
            Some("https://platform.xiaomimimo.com/console/balance"),
        );
        assert!(!status.connected, "window opened must not be connected");
        assert_eq!(status.state_code, SessionStateCode::AwaitingVerification);
        assert!(!status.error_message.is_empty());
    }

    #[test]
    fn map_login_state_to_status_rejects_non_official_domain() {
        let status = map_login_state_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            false,
            Some("https://phishing.example.com/"),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::NonOfficialDomain);
        assert!(status.error_message.contains("官方"));
    }

    #[test]
    fn map_login_state_to_status_marks_connected_only_after_native_verification() {
        let status = map_login_state_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            true,
            Some("https://platform.xiaomimimo.com/console/balance"),
        );
        assert!(status.connected);
        assert_eq!(status.state_code, SessionStateCode::Connected);
        assert_eq!(status.error_code, "");
    }

    #[test]
    fn map_login_state_to_status_rejects_invalid_session_ref() {
        let status =
            map_login_state_to_status("token-plan/xiaomi_mimo/session/sk-bogus", true, None);
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::InvalidSessionRef);
    }

    #[test]
    fn build_status_returns_desktop_session_not_verified_with_correct_fields() {
        let status = build_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            false,
            SessionStateCode::DesktopSessionNotVerified,
            "DESKTOP_SESSION_NOT_VERIFIED",
            "桌面端暂无法验证小米控制台登录状态，不能继续实时同步。",
        );
        assert!(!status.connected);
        assert_eq!(
            status.state_code,
            SessionStateCode::DesktopSessionNotVerified
        );
        assert_eq!(status.error_code, "DESKTOP_SESSION_NOT_VERIFIED");
        assert!(status.error_message.contains("桌面端"));
        assert!(status.error_message.contains("无法验证"));
        assert!(status.error_message.contains("实时同步"));
    }

    #[test]
    fn open_status_is_not_connected() {
        let status = build_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            false,
            SessionStateCode::LoginStarted,
            "LOGIN_STARTED",
            "官方控制台登录窗口已打开",
        );
        assert!(!status.connected, "open must never return connected");
        assert_eq!(status.state_code, SessionStateCode::LoginStarted);
    }

    #[test]
    fn status_messages_do_not_leak_cookie_or_token_fields() {
        let status = map_login_state_to_status(
            "token-plan/xiaomi_mimo/session/uuid-1",
            false,
            Some("https://phishing.example.com/"),
        );
        let msg = format!("{status:?}");
        for forbidden in ["cookie=", "Bearer ", "authorization", "token="] {
            assert!(
                !msg.to_lowercase().contains(&forbidden.to_lowercase()),
                "status leaked {forbidden}: {msg}"
            );
        }
    }
}
