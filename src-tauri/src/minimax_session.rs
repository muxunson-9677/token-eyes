//! MiniMax official-console balance session.
//!
//! The WebView is restricted to official MiniMax hosts. Credentials stay in
//! the official page; Token Eyes only receives the numeric wallet snapshot.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const LOGIN_URL: &str = "https://platform.minimaxi.com/console/recharge-records";
const WINDOW_TITLE: &str = "MiniMax 官方控制台登录 - Token Eyes";
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

const SESSION_FETCH_JS: &str = r#"(function () {
  window.__tokenEyesMinimaxBalanceResult__ = null;
  window.__tokenEyesMinimaxBalanceFetch__ = async function () {
    if (!window.location.hostname.endsWith('minimaxi.com')) return;
    try {
      var response = await fetch('https://www.minimaxi.com/account/query_balance', {
        method: 'GET', credentials: 'include', headers: { Accept: 'application/json' }
      });
      if (response.status === 401 || response.status === 403) {
        window.__tokenEyesMinimaxBalanceResult__ = {
          status: 'error', error: 'auth_required', error_code: String(response.status)
        };
        return;
      }
      if (!response.ok) {
        window.__tokenEyesMinimaxBalanceResult__ = {
          status: 'error',
          error: response.status >= 500 ? 'server_error' : 'http_error',
          error_code: String(response.status)
        };
        return;
      }
      var payload = await response.json();
      if (Number(payload && payload.base_resp && payload.base_resp.status_code) === 1004) {
        window.__tokenEyesMinimaxBalanceResult__ = {
          status: 'error', error: 'auth_required', error_code: 'auth_required'
        };
        return;
      }
      var data = payload && payload.data ? payload.data : payload;
      var available = Number(data && data.available_amount);
      var cash = Number(data && (data.cash_balance ?? 0));
      var voucher = Number(data && (data.voucher_balance ?? 0));
      var credit = Number(data && (data.credit_balance ?? 0));
      if (![available, cash, voucher, credit].every(Number.isFinite)) {
        window.__tokenEyesMinimaxBalanceResult__ = {
          status: 'error', error: 'structure_drift', error_code: 'parse_error'
        };
        return;
      }
      window.__tokenEyesMinimaxBalanceResult__ = {
        status: 'success',
        balance: cash + voucher + credit,
        available_balance: available,
        credit_balance: credit,
        currency: String((data && data.currency) || 'CNY'),
        provider_reported_at: new Date().toISOString()
      };
    } catch (_error) {
      window.__tokenEyesMinimaxBalanceResult__ = {
        status: 'error', error: 'network_error', error_code: 'network_error'
      };
    }
  };
  function schedule() {
    if (window.__tokenEyesMinimaxBalanceFetch__) window.__tokenEyesMinimaxBalanceFetch__();
  }
  window.addEventListener('load', schedule);
  var pushState = history.pushState;
  history.pushState = function () { pushState.apply(this, arguments); schedule(); };
  window.addEventListener('popstate', schedule);
  schedule();
})();"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStateCode {
    LoginStarted,
    AwaitingVerification,
    Connected,
    SessionNotFound,
    InvalidSessionRef,
    ReauthRequired,
    Unsupported,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MiniMaxBalanceDto {
    pub balance: f64,
    pub available_balance: f64,
    pub credit_balance: f64,
    pub currency: String,
    pub provider_reported_at: String,
}

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
pub struct MiniMaxSessionStatus {
    pub connected: bool,
    pub session_ref: String,
    pub state_code: SessionStateCode,
    pub error_code: String,
    pub error_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub balance: Option<MiniMaxBalanceDto>,
}

#[derive(Default)]
pub struct MiniMaxSessionState {
    active_session_ref: Option<String>,
    active_window_label: Option<String>,
}

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

pub fn is_official_minimax_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    host == "minimaxi.com" || host.ends_with(".minimaxi.com")
}

pub fn parse_balance_eval_result(raw: &str) -> Result<Option<BalanceFetchResult>, String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("Unable to parse MiniMax balance result: {error}"))?;
    if value.is_null() {
        return Ok(None);
    }
    if !value.is_object() {
        return Err("MiniMax balance result must be an object or null".to_string());
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("Invalid MiniMax balance result: {error}"))
}

fn build_status(
    session_ref: &str,
    connected: bool,
    state_code: SessionStateCode,
    error_code: &str,
    error_message: &str,
) -> MiniMaxSessionStatus {
    MiniMaxSessionStatus {
        connected,
        session_ref: session_ref.to_string(),
        state_code,
        error_code: error_code.to_string(),
        error_message: error_message.to_string(),
        balance: None,
    }
}

pub fn map_balance_fetch_result_to_status(
    session_ref: &str,
    has_active_session: bool,
    window_exists: bool,
    result: Option<&BalanceFetchResult>,
) -> MiniMaxSessionStatus {
    if validate_session_ref(session_ref).is_err() {
        return build_status(
            session_ref,
            false,
            SessionStateCode::InvalidSessionRef,
            "INVALID_SESSION_REF",
            "会话引用格式无效。",
        );
    }
    if !has_active_session || !window_exists {
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
            "等待 MiniMax 控制台登录完成。",
        );
    };
    if result.status == "success" {
        let (Some(balance), Some(available_balance), Some(credit_balance)) = (
            result.balance,
            result.available_balance,
            result.credit_balance,
        ) else {
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
        return MiniMaxSessionStatus {
            connected: true,
            session_ref: session_ref.to_string(),
            state_code: SessionStateCode::Connected,
            error_code: String::new(),
            error_message: String::new(),
            balance: Some(MiniMaxBalanceDto {
                balance,
                available_balance,
                credit_balance,
                currency: result.currency.clone().unwrap_or_else(|| "CNY".to_string()),
                provider_reported_at: result.provider_reported_at.clone().unwrap_or_default(),
            }),
        };
    }
    match result.error_code.as_deref().unwrap_or("") {
        "401" | "403" | "auth_required" => build_status(
            session_ref,
            false,
            SessionStateCode::ReauthRequired,
            "REAUTH_REQUIRED",
            "登录已失效，请重新连接 MiniMax 控制台。",
        ),
        "parse_error" | "structure_drift" => build_status(
            session_ref,
            false,
            SessionStateCode::Unsupported,
            "UNSUPPORTED",
            "官方返回结构无法识别。",
        ),
        "network_error" => build_status(
            session_ref,
            false,
            SessionStateCode::Failed,
            "NETWORK_ERROR",
            "网络请求失败，请重试。",
        ),
        code if code.starts_with('5') => build_status(
            session_ref,
            false,
            SessionStateCode::Failed,
            "SERVER_ERROR",
            "MiniMax 服务暂时不可用。",
        ),
        _ => build_status(
            session_ref,
            false,
            SessionStateCode::Failed,
            "FETCH_FAILED",
            "余额查询失败。",
        ),
    }
}

fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{:x}{:x}", duration.as_secs(), duration.subsec_nanos())
}

#[tauri::command]
pub async fn open_minimax_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<MiniMaxSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    let window_label = format!("minimax_login_{}", uuid_simple());
    let window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::External(
            LOGIN_URL
                .parse()
                .map_err(|error| format!("Invalid MiniMax URL: {error}"))?,
        ),
    )
    .title(WINDOW_TITLE)
    .inner_size(960.0, 720.0)
    .resizable(true)
    .center()
    .initialization_script(SESSION_FETCH_JS)
    .on_navigation(|url| is_official_minimax_url(url.as_str()))
    .build()
    .map_err(|error| format!("Failed to open MiniMax console: {error}"))?;
    if let Some(state) = app.try_state::<Mutex<MiniMaxSessionState>>() {
        if let Ok(mut guard) = state.lock() {
            guard.active_session_ref = Some(session_ref.clone());
            guard.active_window_label = Some(window_label);
        }
    }
    drop(window);
    Ok(build_status(
        &session_ref,
        false,
        SessionStateCode::LoginStarted,
        "LOGIN_STARTED",
        "MiniMax 官方控制台登录窗口已打开。",
    ))
}

#[tauri::command]
pub async fn verify_minimax_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<MiniMaxSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    let (has_active_session, window_label) =
        if let Some(state) = app.try_state::<Mutex<MiniMaxSessionState>>() {
            if let Ok(guard) = state.lock() {
                (
                    guard.active_session_ref.as_deref() == Some(session_ref.as_str()),
                    guard.active_window_label.clone(),
                )
            } else {
                (false, None)
            }
        } else {
            (false, None)
        };
    let window = window_label
        .as_deref()
        .and_then(|label| app.get_webview_window(label));
    let Some(window) = window else {
        return Ok(map_balance_fetch_result_to_status(
            &session_ref,
            has_active_session,
            false,
            None,
        ));
    };
    window.eval("if (window.__tokenEyesMinimaxBalanceFetch__) { window.__tokenEyesMinimaxBalanceResult__ = null; window.__tokenEyesMinimaxBalanceFetch__(); }")
        .map_err(|error| format!("Unable to trigger MiniMax balance fetch: {error}"))?;
    let started = std::time::Instant::now();
    let mut result = None;
    while started.elapsed() < FETCH_TIMEOUT {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .eval_with_callback(
                "window.__tokenEyesMinimaxBalanceResult__ || null",
                move |value| {
                    let _ = sender.send(value);
                },
            )
            .map_err(|error| format!("Unable to inspect MiniMax login state: {error}"))?;
        let raw = tauri::async_runtime::spawn_blocking(move || {
            receiver.recv_timeout(Duration::from_secs(2))
        })
        .await
        .map_err(|error| format!("MiniMax callback task failed: {error}"))?
        .ok();
        if let Some(raw) = raw {
            if let Some(parsed) = parse_balance_eval_result(&raw)? {
                if parsed.status == "success"
                    || parsed
                        .error
                        .as_deref()
                        .is_some_and(|value| !value.is_empty())
                {
                    result = Some(parsed);
                    break;
                }
            }
        }
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(300)))
            .await
            .ok();
    }
    let status =
        map_balance_fetch_result_to_status(&session_ref, has_active_session, true, result.as_ref());
    if status.connected {
        let _ = window.close();
    }
    Ok(status)
}

#[tauri::command]
pub async fn delete_minimax_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<(), String> {
    let window_label = if let Some(state) = app.try_state::<Mutex<MiniMaxSessionState>>() {
        if let Ok(mut guard) = state.lock() {
            if guard.active_session_ref.as_deref() == Some(session_ref.as_str()) {
                guard.active_session_ref = None;
                guard.active_window_label.take()
            } else {
                None
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn success_result() -> BalanceFetchResult {
        BalanceFetchResult {
            status: "success".to_string(),
            balance: Some(120.0),
            available_balance: Some(88.5),
            credit_balance: Some(10.0),
            currency: Some("CNY".to_string()),
            provider_reported_at: Some("2026-07-14T00:00:00Z".to_string()),
            error: None,
            error_code: None,
        }
    }

    #[test]
    fn restricts_navigation_to_official_minimax_hosts() {
        assert!(is_official_minimax_url(LOGIN_URL));
        assert!(is_official_minimax_url(
            "https://www.minimaxi.com/account/query_balance"
        ));
        assert!(!is_official_minimax_url(
            "https://minimaxi.com.evil.example/login"
        ));
        assert!(!is_official_minimax_url(
            "https://evil.example/?next=minimaxi.com"
        ));
    }

    #[test]
    fn initialization_script_queries_official_wallet_without_exposing_credentials() {
        let js = SESSION_FETCH_JS.to_lowercase();
        assert!(js.contains("www.minimaxi.com/account/query_balance"));
        assert!(js.contains("available_amount"));
        assert!(!js.contains("document.cookie"));
        assert!(!js.contains("localstorage"));
        assert!(!js.contains("__tauri__"));
    }

    #[test]
    fn maps_valid_wallet_snapshot_to_connected_balance() {
        let status = map_balance_fetch_result_to_status(
            "provider-api/minimax/abc",
            true,
            true,
            Some(&success_result()),
        );
        assert!(status.connected);
        assert_eq!(status.balance.unwrap().available_balance, 88.5);
    }

    #[test]
    fn never_marks_window_open_as_connected() {
        let status =
            map_balance_fetch_result_to_status("provider-api/minimax/abc", true, true, None);
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::AwaitingVerification);
    }

    #[test]
    fn rejects_secret_like_session_references() {
        assert!(validate_session_ref("provider-api/minimax/cookie=abc").is_err());
        assert!(validate_session_ref("provider-api/minimax/token=abc").is_err());
    }
}
