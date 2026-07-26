//! GLM / BigModel Console Session Module
//!
//! Implements desktop-side commands for opening, verifying, and revoking
//! official GLM (BigModel) console login sessions for account balance sync.
//!
//! Security invariants:
//! - Login happens on official BigModel page; Token Eyes never sees credentials
//! - Session reference is a path pointer, not a cookie value
//! - Domain is restricted to official BigModel domains only
//! - No cookie, token, or credential data is ever logged or stored
//! - "Window opened" never equals "connected"; verification is explicit
//! - sessionFetch keeps desensitized balance in page memory; Rust reads it with
//!   eval_with_callback without granting the remote page native IPC

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const OFFICIAL_DOMAINS: &[&str] = &[
    "www.bigmodel.cn",
    "open.bigmodel.cn",
    "bigmodel.cn",
];

const LOGIN_URL: &str = "https://www.bigmodel.cn/coding-plan/personal/usage";
const WINDOW_TITLE: &str = "GLM 官方控制台登录 - Token Eyes";
const BALANCE_FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// The JS injected into the GLM console WebView via initialization_script.
///
/// It registers `window.__tokenEyesGlmBalanceFetch__` which, when called, reads
/// the `bigmodel_token_production` cookie (GLM-specific, allowed per design) and
/// performs a same-session fetch to the official balance API. Only balance numbers
/// are stored in page memory for Rust to inspect through `eval_with_callback`.
///
/// SECURITY: The authorization value is used only inside the fetch call and MUST
/// NOT be written to `__tokenEyesGlmBalanceResult__`.
const SESSION_FETCH_JS: &str = r#"(function () {
  window.__tokenEyesGlmBalanceResult__ = null;
  window.__tokenEyesGlmBalanceFetch__ = async function () {
    if (window.location.hostname !== 'www.bigmodel.cn') return;
    try {
      var name = 'bigmodel_token_production=';
      var entry = document.cookie.split(';').map(function (v) { return v.trim(); }).find(function (v) { return v.startsWith(name); });
      var authorization = entry ? decodeURIComponent(entry.slice(name.length)) : '';
      if (!authorization) {
        window.__tokenEyesGlmBalanceResult__ = {
          status: 'error', error: 'auth_required', error_code: 'auth_required'
        };
        return;
      }
      var resp = await fetch('/api/biz/account/query-customer-account-report', {
        method: 'GET',
        credentials: 'include',
        redirect: 'manual',
        headers: { Authorization: authorization, Accept: 'application/json' }
      });
      if (resp.status === 401 || resp.status === 403) {
        window.__tokenEyesGlmBalanceResult__ = {
          status: 'error', error: 'auth_required', error_code: String(resp.status)
        };
        return;
      }
      if (!resp.ok) {
        window.__tokenEyesGlmBalanceResult__ = {
          status: 'error',
          error: resp.status >= 500 ? 'server_error' : 'http_error',
          error_code: String(resp.status)
        };
        return;
      }
      var payload = await resp.json();
      if ([1001, 1002].indexOf(Number(payload && payload.code)) !== -1) {
        window.__tokenEyesGlmBalanceResult__ = {
          status: 'error', error: 'auth_required', error_code: 'auth_required'
        };
        return;
      }
      var data = payload && payload.data;
      var balance = Number(data && data.balance);
      var available = Number(data && data.availableBalance);
      var credit = Number(data && data.creditBalance);
      if (![balance, available, credit].every(Number.isFinite)) {
        window.__tokenEyesGlmBalanceResult__ = {
          status: 'error', error: 'structure_drift', error_code: 'parse_error'
        };
        return;
      }
      window.__tokenEyesGlmBalanceResult__ = {
        status: 'success',
        balance: balance,
        available_balance: available,
        credit_balance: credit,
        currency: String((data && data.currency) || 'CNY'),
        provider_reported_at: new Date().toISOString()
      };
    } catch (_error) {
      window.__tokenEyesGlmBalanceResult__ = {
        status: 'error', error: 'network_error', error_code: 'network_error'
      };
    }
  };
  function scheduleGlmBalanceFetch() {
    if (window.location.hostname === 'www.bigmodel.cn' && window.__tokenEyesGlmBalanceFetch__) {
      window.__tokenEyesGlmBalanceFetch__();
    }
  }
  window.addEventListener('load', scheduleGlmBalanceFetch);
  var _pushState = history.pushState;
  history.pushState = function () {
    _pushState.apply(this, arguments);
    scheduleGlmBalanceFetch();
  };
  window.addEventListener('popstate', scheduleGlmBalanceFetch);
  scheduleGlmBalanceFetch();
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

/// Desensitized balance DTO returned to Rust. Contains only balance numbers.
/// MUST NOT contain cookie, header, token, or raw_response fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GlmBalanceDto {
    pub balance: f64,
    pub available_balance: f64,
    pub credit_balance: f64,
    pub currency: String,
    pub provider_reported_at: String,
}

/// The structure Rust reads from page memory through `eval_with_callback`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BalanceFetchResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub balance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_balance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credit_balance: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_reported_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlmSessionStatus {
    pub connected: bool,
    pub session_ref: String,
    pub state_code: SessionStateCode,
    pub error_code: String,
    pub error_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub balance: Option<GlmBalanceDto>,
}

impl Default for GlmSessionStatus {
    fn default() -> Self {
        Self {
            connected: false,
            session_ref: String::new(),
            state_code: SessionStateCode::NotVerified,
            error_code: String::new(),
            error_message: String::new(),
            balance: None,
        }
    }
}

#[derive(Default)]
pub struct GlmSessionState {
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

pub fn parse_balance_eval_result(raw: &str) -> Result<Option<BalanceFetchResult>, String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("Unable to parse GLM balance result: {error}"))?;
    if value.is_null() {
        return Ok(None);
    }
    if !value.is_object() {
        return Err("GLM balance result must be an object or null".to_string());
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("Invalid GLM balance result: {error}"))
}

fn take_active_window_label(state: &mut GlmSessionState, session_ref: &str) -> Option<String> {
    if state.active_session_ref.as_deref() != Some(session_ref) {
        return None;
    }
    state.active_session_ref = None;
    state.last_known_url = None;
    state.active_window_label.take()
}

/// Returns true when `url` belongs to one of the official BigModel domains.
pub fn is_official_glm_url(url: &str) -> bool {
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

/// Maps a balance fetch result to a session status.
pub fn map_balance_fetch_result_to_status(
    session_ref: &str,
    has_active_session: bool,
    window_exists: bool,
    result: Option<&BalanceFetchResult>,
) -> GlmSessionStatus {
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
        return build_status(
            session_ref,
            false,
            SessionStateCode::AwaitingVerification,
            "AWAITING_VERIFICATION",
            "等待 GLM 控制台登录完成，请在窗口内登录后点击验证。",
        );
    };

    if result.status == "success" {
        let (Some(balance), Some(available_balance), Some(credit_balance)) =
            (result.balance, result.available_balance, result.credit_balance)
        else {
            return build_status(
                session_ref,
                false,
                SessionStateCode::Unsupported,
                "UNSUPPORTED",
                "官方返回的余额字段缺失或格式无效。",
            );
        };
        if !balance.is_finite() || !available_balance.is_finite() || !credit_balance.is_finite() {
            return build_status(
                session_ref,
                false,
                SessionStateCode::Unsupported,
                "UNSUPPORTED",
                "官方返回的余额字段缺失或格式无效。",
            );
        }
        let provider_reported_at = result
            .provider_reported_at
            .clone()
            .unwrap_or_else(|| String::new());
        let currency = result
            .currency
            .clone()
            .unwrap_or_else(|| "CNY".to_string());
        return GlmSessionStatus {
            connected: true,
            session_ref: session_ref.to_string(),
            state_code: SessionStateCode::Connected,
            error_code: String::new(),
            error_message: String::new(),
            balance: Some(GlmBalanceDto {
                balance,
                available_balance,
                credit_balance,
                currency,
                provider_reported_at,
            }),
        };
    }

    let error_code = result.error_code.as_deref().unwrap_or("");
    match error_code {
        "401" | "403" | "auth_required" => build_status(
            session_ref,
            false,
            SessionStateCode::ReauthRequired,
            "REAUTH_REQUIRED",
            "登录已失效，请重新连接 GLM 控制台。",
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
                    "余额查询失败，请稍后重试。",
                )
            }
        }
    }
}

fn build_status(
    session_ref: &str,
    connected: bool,
    state_code: SessionStateCode,
    error_code: &str,
    error_message: &str,
) -> GlmSessionStatus {
    GlmSessionStatus {
        connected,
        session_ref: session_ref.to_string(),
        state_code,
        error_code: error_code.to_string(),
        error_message: error_message.to_string(),
        balance: None,
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

/// Opens the GLM official console login page in a new window.
#[tauri::command]
pub async fn open_glm_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<GlmSessionStatus, String> {
    if let Err(reason) = validate_session_ref(&session_ref) {
        return Err(reason.to_string());
    }

    let window_label = format!("glm_login_{}", uuid_simple());

    // #3: stable, identity-independent WebView2 data dir → login cookies
    // persist across restarts so users log in once (see codex_session.rs).
    let session_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("webview-sessions")
        .join("glm");
    let _ = std::fs::create_dir_all(&session_data_dir);

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
    .data_directory(session_data_dir)
    .initialization_script(SESSION_FETCH_JS)
    .on_navigation(|url| is_official_glm_url(url.as_str()))
    .build()
    .map_err(|e| format!("Failed to open official console login window: {e}"))?;

    if let Some(state) = app.try_state::<Mutex<GlmSessionState>>() {
        if let Ok(mut guard) = state.lock() {
            guard.active_session_ref = Some(session_ref.clone());
            guard.last_known_url = Some(LOGIN_URL.to_string());
            guard.active_window_label = Some(window_label.clone());
        }
    }

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
/// and queries balance via the injected sessionFetch JS.
#[tauri::command]
pub async fn verify_glm_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<GlmSessionStatus, String> {
    if let Err(reason) = validate_session_ref(&session_ref) {
        return Err(reason.to_string());
    }

    let (has_active_session, window_label) =
        if let Some(state) = app.try_state::<Mutex<GlmSessionState>>() {
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

    // Re-trigger balance fetch on every verify poll — SPA logins may not reload the page.
    window
        .eval(
            "if (window.__tokenEyesGlmBalanceFetch__) { window.__tokenEyesGlmBalanceResult__ = null; window.__tokenEyesGlmBalanceFetch__(); }",
        )
        .map_err(|error| format!("Unable to trigger GLM balance fetch: {error}"))?;

    let poll_started = std::time::Instant::now();
    let mut result: Option<BalanceFetchResult> = None;
    while poll_started.elapsed() < BALANCE_FETCH_TIMEOUT {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .eval_with_callback(
                "window.__tokenEyesGlmBalanceResult__ || null",
                move |value| {
                    let _ = sender.send(value);
                },
            )
            .map_err(|error| format!("Unable to inspect GLM login state: {error}"))?;

        let raw =
            tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(2)))
                .await
                .map_err(|error| format!("GLM balance callback task failed: {error}"))?
                .ok();

        if let Some(raw) = raw {
            if let Some(parsed) = parse_balance_eval_result(&raw)? {
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

    let status = map_balance_fetch_result_to_status(
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

/// Deletes the active GLM console session.
#[tauri::command]
pub async fn delete_glm_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<(), String> {
    let window_label = if let Some(state) = app.try_state::<Mutex<GlmSessionState>>() {
        if let Ok(mut guard) = state.lock() {
            take_active_window_label(&mut guard, &session_ref)
        } else {
            None
        }
    } else {
        None
    };

    if let Some(label) = window_label {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.close();
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Unit tests (run with `cargo test glm_session`)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_session_ref_accepts_path_style_reference() {
        assert!(validate_session_ref("token-plan/glm/session/abc-123").is_ok());
    }

    #[test]
    fn validate_session_ref_rejects_empty() {
        assert!(validate_session_ref("").is_err());
    }

    #[test]
    fn validate_session_ref_rejects_cookie_token_bearer_or_sk_prefix() {
        for bad in [
            "token-plan/glm/session/cookie=abc",
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
    fn allows_only_bigmodel_console_hosts() {
        assert!(is_official_glm_url(
            "https://www.bigmodel.cn/coding-plan/personal/usage"
        ));
        assert!(is_official_glm_url("https://open.bigmodel.cn/login"));
        assert!(is_official_glm_url("https://account.bigmodel.cn/oauth"));
        assert!(!is_official_glm_url("https://bigmodel.cn.evil.example/login"));
        assert!(!is_official_glm_url("https://evil.example/?next=www.bigmodel.cn"));
        assert!(!is_official_glm_url("https://phishing.example.com/"));
    }

    #[test]
    fn is_official_glm_url_rejects_official_domain_as_suffix() {
        assert!(
            !is_official_glm_url("https://www.bigmodel.cn.evil.example/"),
            "reject official domain as suffix of evil domain"
        );
    }

    #[test]
    fn is_official_glm_url_accepts_subdomains_of_official_domains() {
        assert!(is_official_glm_url("https://api.open.bigmodel.cn/v1"));
        assert!(is_official_glm_url("https://console.www.bigmodel.cn/dashboard"));
    }

    #[test]
    fn initialization_script_keeps_balance_in_page_memory_without_remote_ipc() {
        let js = SESSION_FETCH_JS.to_lowercase();
        assert!(js.contains("__tokeneyesglmbalanceresult__"));
        assert!(js.contains("__tokeneyesglmbalancefetch__"));
        assert!(!js.contains("__tauri__"));
        assert!(!js.contains("invoke("));
        assert!(js.contains("www.bigmodel.cn"));
        assert!(js.contains("bigmodel_token_production"));
        assert!(js.contains("query-customer-account-report"));
    }

    #[test]
    fn initialization_script_reads_glm_production_cookie() {
        let js = SESSION_FETCH_JS.to_lowercase();
        assert!(js.contains("document.cookie"));
        assert!(js.contains("bigmodel_token_production"));
        assert!(js.contains("available_balance: available"));
    }

    #[test]
    fn parse_balance_eval_result_accepts_success_object() {
        let raw = r#"{"status":"success","balance":88.5,"available_balance":80.0,"credit_balance":8.5,"currency":"CNY","provider_reported_at":"2026-07-03T12:00:00.000Z"}"#;
        let parsed = parse_balance_eval_result(raw).unwrap().unwrap();
        assert_eq!(parsed.status, "success");
        assert_eq!(parsed.balance, Some(88.5));
        assert_eq!(parsed.available_balance, Some(80.0));
        assert_eq!(parsed.credit_balance, Some(8.5));
        assert_eq!(parsed.currency.as_deref(), Some("CNY"));
    }

    #[test]
    fn parse_balance_eval_result_treats_null_as_awaiting() {
        assert_eq!(parse_balance_eval_result("null").unwrap(), None);
    }

    #[test]
    fn parse_balance_eval_result_rejects_non_object_values() {
        assert!(parse_balance_eval_result("\"unexpected\"").is_err());
    }

    #[test]
    fn maps_sanitized_balance_result() {
        let result = BalanceFetchResult {
            status: "success".into(),
            balance: Some(88.5),
            available_balance: Some(80.0),
            credit_balance: Some(8.5),
            currency: Some("CNY".into()),
            provider_reported_at: Some("2026-07-03T12:00:00.000Z".into()),
            error: None,
            error_code: None,
        };
        let status = map_balance_fetch_result_to_status(
            "token-plan/glm/session/test",
            true,
            true,
            Some(&result),
        );
        assert!(status.connected);
        assert_eq!(status.state_code, SessionStateCode::Connected);
        let balance = status.balance.unwrap();
        assert_eq!(balance.available_balance, 80.0);
        assert_eq!(balance.balance, 88.5);
        assert_eq!(balance.credit_balance, 8.5);
        assert_eq!(balance.currency, "CNY");
    }

    #[test]
    fn session_fetch_balance_returns_awaiting_when_no_login_yet() {
        let status = map_balance_fetch_result_to_status(
            "token-plan/glm/session/uuid-1",
            true,
            true,
            None,
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::AwaitingVerification);
    }

    #[test]
    fn session_fetch_balance_returns_reauth_on_auth_required() {
        let result = BalanceFetchResult {
            status: "error".to_string(),
            balance: None,
            available_balance: None,
            credit_balance: None,
            currency: None,
            provider_reported_at: None,
            error: Some("auth_required".to_string()),
            error_code: Some("401".to_string()),
        };
        let status = map_balance_fetch_result_to_status(
            "token-plan/glm/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::ReauthRequired);
        assert!(status.balance.is_none());
    }

    #[test]
    fn session_fetch_balance_returns_unsupported_on_invalid_structure() {
        let result = BalanceFetchResult {
            status: "error".to_string(),
            balance: None,
            available_balance: None,
            credit_balance: None,
            currency: None,
            provider_reported_at: None,
            error: Some("structure_drift".to_string()),
            error_code: Some("parse_error".to_string()),
        };
        let status = map_balance_fetch_result_to_status(
            "token-plan/glm/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::Unsupported);
    }

    #[test]
    fn session_fetch_dto_does_not_contain_cookie_or_headers() {
        let result = BalanceFetchResult {
            status: "success".to_string(),
            balance: Some(88.5),
            available_balance: Some(80.0),
            credit_balance: Some(8.5),
            currency: Some("CNY".to_string()),
            provider_reported_at: Some("2026-07-03T12:00:00.000Z".to_string()),
            error: None,
            error_code: None,
        };
        let status = map_balance_fetch_result_to_status(
            "token-plan/glm/session/uuid-1",
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
    fn open_status_is_not_connected() {
        let status = build_status(
            "token-plan/glm/session/uuid-1",
            false,
            SessionStateCode::LoginStarted,
            "LOGIN_STARTED",
            "官方控制台登录窗口已打开",
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::LoginStarted);
    }
}
