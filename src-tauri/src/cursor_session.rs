//! Cursor Console Session Module
//!
//! Implements desktop-side commands for opening, verifying, and revoking
//! official Cursor console login sessions.
//!
//! Security invariants:
//! - Login happens on official Cursor pages; Token Eyes never sees credentials
//! - Session reference is a path pointer, not a cookie value
//! - Domain is restricted to official domains only
//! - No cookie, token, or credential data is ever logged or stored
//! - "Window opened" never equals "connected"; verification is explicit
//! - sessionFetch keeps desensitized quota in page memory; Rust reads it with
//!   eval_with_callback without granting the remote page native IPC

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const OFFICIAL_DOMAINS: &[&str] = &["cursor.com", "www.cursor.com", "authenticator.cursor.sh"];
const SESSION_REF_PREFIX: &str = "token-plan/cursor/session/";
const LOGIN_URL: &str = "https://www.cursor.com/settings";
const WINDOW_TITLE: &str = "Cursor 官方控制台登录 - Token Eyes";
const QUOTA_FETCH_TIMEOUT: Duration = Duration::from_secs(10);
const PERCENT_SCALE: f64 = 100.0;

/// The JS injected into the Cursor WebView via initialization_script.
///
/// It registers `window.__tokenEyesCursorQuotaFetch__` which, when called,
/// performs a same-origin fetch to Cursor usage summary API using the WebView's
/// cookies (`credentials: 'include'`) on cursor.com hosts only.
///
/// SECURITY: This script MUST NOT read document.cookie, localStorage,
/// sessionStorage, or any DOM content. It only calls the official API and
/// passes back quota numbers.
const SESSION_FETCH_JS: &str = r#"(function () {
  window.__tokenEyesCursorQuotaResult__ = null;

  function clampPercent(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }

  function parseResetAt(raw) {
    if (raw == null || raw === '') return '';
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      var ms = raw > 1e12 ? raw : raw * 1000;
      var ts = new Date(ms);
      return Number.isFinite(ts.getTime()) ? ts.toISOString() : '';
    }
    if (typeof raw === 'string' && raw.trim()) {
      var parsed = Date.parse(raw);
      return Number.isFinite(parsed) && parsed > 0 ? new Date(parsed).toISOString() : '';
    }
    return '';
  }

  function cursorPercentFromCentsUsedLimit(usedRaw, limitRaw) {
    var used = Number(usedRaw);
    var limit = Number(limitRaw);
    if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
    return clampPercent((used / limit) * 100);
  }

  function buildWindow(usedPercent, resetAt) {
    var percent = clampPercent(usedPercent);
    if (percent === null) return null;
    return {
      used_percent: percent,
      reset_at: parseResetAt(resetAt)
    };
  }

  function normalizeCursorUsageSummary(body) {
    var plan = body && body.individualUsage && body.individualUsage.plan && typeof body.individualUsage.plan === 'object'
      ? body.individualUsage.plan
      : null;
    var indOnDemand = body && body.individualUsage && body.individualUsage.onDemand && typeof body.individualUsage.onDemand === 'object'
      ? body.individualUsage.onDemand
      : null;
    var teamOnDemand = body && body.teamUsage && body.teamUsage.onDemand && typeof body.teamUsage.onDemand === 'object'
      ? body.teamUsage.onDemand
      : null;
    var billingCycleEnd = body && typeof body.billingCycleEnd === 'string' ? body.billingCycleEnd : null;
    var autoPercent = clampPercent(plan && plan.autoPercentUsed);
    var apiPercent = clampPercent(plan && plan.apiPercentUsed);

    var planPercent = clampPercent(plan && plan.totalPercentUsed);
    if (planPercent === null) {
      if (autoPercent !== null && apiPercent !== null) {
        planPercent = clampPercent((autoPercent + apiPercent) / 2);
      } else if (apiPercent !== null) {
        planPercent = apiPercent;
      } else if (autoPercent !== null) {
        planPercent = autoPercent;
      } else {
        var fromPlanCents = cursorPercentFromCentsUsedLimit(plan && plan.used, plan && plan.limit);
        if (fromPlanCents !== null) planPercent = fromPlanCents;
      }
    }

    if (planPercent === null) {
      var fromInd = cursorPercentFromCentsUsedLimit(indOnDemand && indOnDemand.used, indOnDemand && indOnDemand.limit);
      if (fromInd !== null) planPercent = fromInd;
    }
    if (planPercent === null) {
      var fromTeam = cursorPercentFromCentsUsedLimit(teamOnDemand && teamOnDemand.used, teamOnDemand && teamOnDemand.limit);
      if (fromTeam !== null) planPercent = fromTeam;
    }

    if (planPercent === 0) {
      var fromInd2 = cursorPercentFromCentsUsedLimit(indOnDemand && indOnDemand.used, indOnDemand && indOnDemand.limit);
      if (fromInd2 !== null && fromInd2 > 0) planPercent = fromInd2;
    }
    if (planPercent === 0) {
      var fromTeam2 = cursorPercentFromCentsUsedLimit(teamOnDemand && teamOnDemand.used, teamOnDemand && teamOnDemand.limit);
      if (fromTeam2 !== null && fromTeam2 > 0) planPercent = fromTeam2;
    }

    var limitType = body && typeof body.limitType === 'string' ? body.limitType : '';
    var membershipType = body && typeof body.membershipType === 'string' ? body.membershipType : '';
    var preferTeamPool = limitType === 'team' || membershipType === 'enterprise' || membershipType === 'team';
    if (preferTeamPool) {
      var teamHeadline = cursorPercentFromCentsUsedLimit(teamOnDemand && teamOnDemand.used, teamOnDemand && teamOnDemand.limit);
      if (teamHeadline !== null && (planPercent === null || planPercent === 0)) {
        planPercent = teamHeadline;
      }
    }

    return {
      membership_type: membershipType || null,
      primary_window: buildWindow(planPercent, billingCycleEnd),
      secondary_window: buildWindow(autoPercent, billingCycleEnd),
      tertiary_window: buildWindow(apiPercent, billingCycleEnd)
    };
  }

  function normalizeRateWindow(window) {
    if (!window || typeof window !== 'object' || Array.isArray(window)) return null;
    var usedPercent = clampPercent(window.used_percent);
    if (usedPercent === null) return null;
    return {
      limit_window_seconds: Number(window.limit_window_seconds),
      used_percent: Math.round(usedPercent),
      reset_at: parseResetAt(window.reset_at)
    };
  }

  function classifyWindow(window) {
    var seconds = Number(window && window.limit_window_seconds);
    if (!Number.isFinite(seconds)) return null;
    if (seconds === 18000) return 'rolling_5_hour';
    if (seconds === 604800) return 'rolling_weekly';
    return null;
  }

  function percentWindowToQuotaWindow(window, kind) {
    if (!window) return null;
    var usedPercent = clampPercent(window.used_percent);
    if (usedPercent === null) return null;
    var used = Math.round(usedPercent);
    return {
      kind: kind,
      unit: 'tokens',
      total: 100,
      used: used,
      remaining: Math.max(0, 100 - used),
      percentage: used,
      resets_at: parseResetAt(window.reset_at)
    };
  }

  function parseUsagePayload(payload) {
    var normalized = normalizeCursorUsageSummary(payload || {});
    var weekly = percentWindowToQuotaWindow(normalized.primary_window, 'rolling_weekly');
    var windowsByKind = {};
    if (weekly) windowsByKind.rolling_weekly = weekly;

    var rateLimit = payload && payload.rate_limit && typeof payload.rate_limit === 'object' ? payload.rate_limit : {};
    var primary = normalizeRateWindow(rateLimit.primary_window);
    var secondary = normalizeRateWindow(rateLimit.secondary_window);
    var candidates = [primary, secondary].filter(Boolean);
    for (var i = 0; i < candidates.length; i++) {
      var item = candidates[i];
      var kind = classifyWindow(item);
      if (!kind || windowsByKind[kind]) continue;
      var parsed = percentWindowToQuotaWindow(item, kind);
      if (parsed) windowsByKind[kind] = parsed;
    }

    // Never synthesize 5-hour windows from local assumptions; only include
    // rolling_5_hour when provider API explicitly returns that window.
    var quotaWindows = [];
    if (windowsByKind.rolling_5_hour) quotaWindows.push(windowsByKind.rolling_5_hour);
    if (windowsByKind.rolling_weekly) quotaWindows.push(windowsByKind.rolling_weekly);

    if (quotaWindows.length === 0) {
      return { error: 'structure_drift', error_code: 'no_quota_windows' };
    }

    var primaryWindow = windowsByKind.rolling_weekly || quotaWindows[quotaWindows.length - 1];
    return {
      total_quota: Number(primaryWindow.total),
      used_quota: Number(primaryWindow.used),
      remaining_quota: Number(primaryWindow.remaining),
      quota_windows: quotaWindows
    };
  }

  window.__tokenEyesCursorQuotaFetch__ = async function () {
    var host = window.location.hostname;
    if (host !== 'www.cursor.com' && host !== 'cursor.com') return;
    try {
      var resp = await fetch('/api/usage-summary', { method: 'GET', credentials: 'include', redirect: 'manual' });
      if (resp.status === 401 || resp.status === 403) {
        window.__tokenEyesCursorQuotaResult__ = {
          status: 'error', error: 'auth_required', error_code: String(resp.status)
        };
        return;
      }
      if (resp.status === 404) {
        window.__tokenEyesCursorQuotaResult__ = {
          status: 'error', error: 'structure_drift', error_code: 'no_quota_windows'
        };
        return;
      }
      if (!resp.ok) {
        window.__tokenEyesCursorQuotaResult__ = {
          status: 'error',
          error: resp.status >= 500 ? 'server_error' : 'http_error',
          error_code: String(resp.status)
        };
        return;
      }

      var payload = await resp.json();
      var parsed = parseUsagePayload(payload);
      if (parsed.error_code) {
        window.__tokenEyesCursorQuotaResult__ = {
          status: 'error',
          error: parsed.error || 'structure_drift',
          error_code: parsed.error_code
        };
        return;
      }

      window.__tokenEyesCursorQuotaResult__ = {
        status: 'success',
        total_quota: parsed.total_quota,
        used_quota: parsed.used_quota,
        remaining_quota: parsed.remaining_quota,
        quota_windows: parsed.quota_windows,
        provider_reported_at: new Date().toISOString()
      };
    } catch (_error) {
      window.__tokenEyesCursorQuotaResult__ = {
        status: 'error', error: 'network_error', error_code: 'network_error'
      };
    }
  };

  function scheduleCursorQuotaFetch() {
    var host = window.location.hostname;
    if ((host === 'www.cursor.com' || host === 'cursor.com') && window.__tokenEyesCursorQuotaFetch__) {
      window.__tokenEyesCursorQuotaFetch__();
    }
  }

  window.addEventListener('load', scheduleCursorQuotaFetch);
  var _pushState = history.pushState;
  history.pushState = function () {
    _pushState.apply(this, arguments);
    scheduleCursorQuotaFetch();
  };
  window.addEventListener('popstate', scheduleCursorQuotaFetch);
  scheduleCursorQuotaFetch();
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CursorQuotaWindowDto {
    pub kind: String,
    pub unit: String,
    pub total: f64,
    pub used: f64,
    pub remaining: f64,
    pub percentage: f64,
    pub resets_at: String,
}

/// Desensitized quota DTO returned to Rust. Contains only quota numbers.
/// MUST NOT contain cookie, header, token, or raw_response fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CursorQuotaDto {
    pub total_quota: f64,
    pub used_quota: f64,
    pub remaining_quota: f64,
    pub quota_windows: Vec<CursorQuotaWindowDto>,
    pub provider_reported_at: String,
}

/// The structure Rust reads from page memory through `eval_with_callback`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct QuotaFetchResult {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_quota: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_quota: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remaining_quota: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota_windows: Option<Vec<CursorQuotaWindowDto>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_reported_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CursorSessionStatus {
    pub connected: bool,
    pub session_ref: String,
    pub state_code: SessionStateCode,
    pub error_code: String,
    pub error_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota: Option<CursorQuotaDto>,
}

impl Default for CursorSessionStatus {
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
pub struct CursorSessionState {
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
    if !session_ref.starts_with(SESSION_REF_PREFIX) {
        return Err("session_ref must start with token-plan/cursor/session/");
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

pub fn parse_quota_eval_result(raw: &str) -> Result<Option<QuotaFetchResult>, String> {
    let value: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("Unable to parse Cursor quota result: {error}"))?;
    if value.is_null() {
        return Ok(None);
    }
    if !value.is_object() {
        return Err("Cursor quota result must be an object or null".to_string());
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| format!("Invalid Cursor quota result: {error}"))
}

fn take_active_window_label(state: &mut CursorSessionState, session_ref: &str) -> Option<String> {
    if state.active_session_ref.as_deref() != Some(session_ref) {
        return None;
    }
    state.active_session_ref = None;
    state.last_known_url = None;
    state.active_window_label.take()
}

/// Returns true when `url` belongs to one of the official Cursor domains.
pub fn is_official_cursor_url(url: &str) -> bool {
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
pub fn map_quota_fetch_result_to_status(
    session_ref: &str,
    has_active_session: bool,
    window_exists: bool,
    result: Option<&QuotaFetchResult>,
) -> CursorSessionStatus {
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
            "等待 Cursor 控制台登录完成，请在窗口内登录后点击验证。",
        );
    };

    if result.status == "success" {
        let (Some(total_quota), Some(used_quota), Some(remaining_quota), Some(quota_windows)) = (
            result.total_quota,
            result.used_quota,
            result.remaining_quota,
            result.quota_windows.clone(),
        ) else {
            return build_status(
                session_ref,
                false,
                SessionStateCode::Unsupported,
                "UNSUPPORTED",
                "官方返回的额度字段缺失或格式无效。",
            );
        };

        let numbers_ok = total_quota.is_finite()
            && used_quota.is_finite()
            && remaining_quota.is_finite()
            && total_quota >= 0.0
            && used_quota >= 0.0
            && remaining_quota >= 0.0;
        let windows_ok = !quota_windows.is_empty()
            && quota_windows.iter().all(|w| {
                w.total.is_finite()
                    && w.used.is_finite()
                    && w.remaining.is_finite()
                    && w.percentage.is_finite()
                    && w.total >= 0.0
                    && w.used >= 0.0
                    && w.remaining >= 0.0
                    && w.percentage >= 0.0
                    && w.percentage <= PERCENT_SCALE
                    && !w.kind.is_empty()
                    && !w.unit.is_empty()
            });

        if !numbers_ok || !windows_ok {
            return build_status(
                session_ref,
                false,
                SessionStateCode::Unsupported,
                "UNSUPPORTED",
                "官方返回的额度字段缺失或格式无效。",
            );
        }

        return CursorSessionStatus {
            connected: true,
            session_ref: session_ref.to_string(),
            state_code: SessionStateCode::Connected,
            error_code: String::new(),
            error_message: String::new(),
            quota: Some(CursorQuotaDto {
                total_quota,
                used_quota,
                remaining_quota,
                quota_windows,
                provider_reported_at: result.provider_reported_at.clone().unwrap_or_default(),
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
            "登录已失效，请重新连接 Cursor 控制台。",
        ),
        "parse_error" | "structure_drift" | "no_quota_windows" => build_status(
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
                    "额度查询失败，请稍后重试。",
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
) -> CursorSessionStatus {
    CursorSessionStatus {
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

/// Opens the Cursor official console login page in a new window.
#[tauri::command]
pub async fn open_cursor_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<CursorSessionStatus, String> {
    if let Err(reason) = validate_session_ref(&session_ref) {
        return Err(reason.to_string());
    }

    let window_label = format!("cursor_login_{}", uuid_simple());

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
    .on_navigation(|url| is_official_cursor_url(url.as_str()))
    .build()
    .map_err(|e| format!("Failed to open official console login window: {e}"))?;

    if let Some(state) = app.try_state::<Mutex<CursorSessionState>>() {
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
/// and queries the quota via the injected fetch JS.
#[tauri::command]
pub async fn verify_cursor_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<CursorSessionStatus, String> {
    if let Err(reason) = validate_session_ref(&session_ref) {
        return Err(reason.to_string());
    }

    let (has_active_session, window_label) =
        if let Some(state) = app.try_state::<Mutex<CursorSessionState>>() {
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

    window
        .eval(
            "if (window.__tokenEyesCursorQuotaFetch__) { window.__tokenEyesCursorQuotaResult__ = null; window.__tokenEyesCursorQuotaFetch__(); }",
        )
        .map_err(|error| format!("Unable to trigger Cursor quota fetch: {error}"))?;

    let poll_started = std::time::Instant::now();
    let mut result: Option<QuotaFetchResult> = None;
    while poll_started.elapsed() < QUOTA_FETCH_TIMEOUT {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        window
            .eval_with_callback(
                "window.__tokenEyesCursorQuotaResult__ || null",
                move |value| {
                    let _ = sender.send(value);
                },
            )
            .map_err(|error| format!("Unable to inspect Cursor login state: {error}"))?;

        let raw =
            tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(Duration::from_secs(2)))
                .await
                .map_err(|error| format!("Cursor quota callback task failed: {error}"))?
                .ok();

        if let Some(raw) = raw {
            if let Some(parsed) = parse_quota_eval_result(&raw)? {
                let settled =
                    parsed.status == "success" || parsed.error.as_deref().is_some_and(|e| !e.is_empty());
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

/// Deletes the active Cursor console session.
#[tauri::command]
pub async fn delete_cursor_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<(), String> {
    let window_label = if let Some(state) = app.try_state::<Mutex<CursorSessionState>>() {
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
// Unit tests (run with `cargo test cursor_session`)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_session_ref_accepts_path_style_reference() {
        assert!(validate_session_ref("token-plan/cursor/session/abc-123").is_ok());
    }

    #[test]
    fn validate_session_ref_rejects_empty() {
        assert!(validate_session_ref("").is_err());
    }

    #[test]
    fn validate_session_ref_rejects_non_cursor_prefix() {
        assert!(validate_session_ref("token-plan/codex/session/abc-123").is_err());
    }

    #[test]
    fn validate_session_ref_rejects_cookie_token_bearer_or_sk_prefix() {
        for bad in [
            "token-plan/cursor/session/cookie=abc",
            "token-plan/cursor/session/Bearer abc",
            "token-plan/cursor/session/sk-abcdef123",
            "token-plan/cursor/session/token=eyJhbGciOiJIUzI1NiJ9",
        ] {
            assert!(
                validate_session_ref(bad).is_err(),
                "expected rejection of {bad}"
            );
        }
    }

    #[test]
    fn allows_only_official_cursor_hosts() {
        assert!(is_official_cursor_url("https://www.cursor.com/settings"));
        assert!(is_official_cursor_url("https://cursor.com/api/usage-summary"));
        assert!(is_official_cursor_url("https://authenticator.cursor.sh/oauth/callback"));
        assert!(!is_official_cursor_url("https://cursor.com.evil.example/login"));
        assert!(!is_official_cursor_url("https://evil.example/?next=cursor.com"));
        assert!(!is_official_cursor_url("https://phishing.example.com/"));
    }

    #[test]
    fn initialization_script_keeps_quota_in_page_memory_without_remote_ipc() {
        let js = SESSION_FETCH_JS.to_lowercase();
        assert!(js.contains("__tokeneyescursorquotaresult__"));
        assert!(js.contains("__tokeneyescursorquotafetch__"));
        assert!(!js.contains("__tauri__"));
        assert!(!js.contains("invoke("));
        assert!(js.contains("host !== 'www.cursor.com' && host !== 'cursor.com'"));
        assert!(js.contains("/api/usage-summary"));
        assert!(
            js.contains("credentials: 'include'") || js.contains("credentials:'include'")
        );
    }

    #[test]
    fn initialization_script_uses_cursor_usage_summary_fields() {
        let js = SESSION_FETCH_JS.to_lowercase();
        assert!(js.contains("individualusage"));
        assert!(js.contains("totalpercentused"));
        assert!(js.contains("autopercentused"));
        assert!(js.contains("apipercentused"));
        assert!(js.contains("billingcycleend"));
        assert!(js.contains("rolling_weekly"));
    }

    #[test]
    fn initialization_script_does_not_force_rolling_5_hour_without_api_window() {
        let js = SESSION_FETCH_JS.to_lowercase();
        assert!(js.contains("never synthesize 5-hour windows"));
        assert!(js.contains("if (windowsbykind.rolling_5_hour)"));
    }

    #[test]
    fn parse_quota_eval_result_accepts_success_object() {
        let raw = r#"{"status":"success","total_quota":100,"used_quota":42,"remaining_quota":58,"quota_windows":[{"kind":"rolling_weekly","unit":"tokens","total":100,"used":42,"remaining":58,"percentage":42,"resets_at":"2026-07-08T01:00:00.000Z"}],"provider_reported_at":"2026-07-08T00:00:00.000Z"}"#;
        let parsed = parse_quota_eval_result(raw).unwrap().unwrap();
        assert_eq!(parsed.status, "success");
        assert_eq!(parsed.total_quota, Some(100.0));
        assert_eq!(parsed.used_quota, Some(42.0));
        assert_eq!(parsed.remaining_quota, Some(58.0));
        assert_eq!(parsed.quota_windows.as_ref().map(|x| x.len()), Some(1));
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
    fn maps_sanitized_quota_result() {
        let result = QuotaFetchResult {
            status: "success".into(),
            total_quota: Some(100.0),
            used_quota: Some(42.0),
            remaining_quota: Some(58.0),
            quota_windows: Some(vec![CursorQuotaWindowDto {
                kind: "rolling_weekly".into(),
                unit: "tokens".into(),
                total: 100.0,
                used: 42.0,
                remaining: 58.0,
                percentage: 42.0,
                resets_at: "2026-07-08T01:00:00.000Z".into(),
            }]),
            provider_reported_at: Some("2026-07-08T00:00:00.000Z".into()),
            error: None,
            error_code: None,
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/cursor/session/test",
            true,
            true,
            Some(&result),
        );
        assert!(status.connected);
        assert_eq!(status.state_code, SessionStateCode::Connected);
        let quota = status.quota.unwrap();
        assert_eq!(quota.total_quota, 100.0);
        assert_eq!(quota.used_quota, 42.0);
        assert_eq!(quota.remaining_quota, 58.0);
        assert_eq!(quota.quota_windows.len(), 1);
    }

    #[test]
    fn session_fetch_quota_returns_awaiting_when_no_login_yet() {
        let status = map_quota_fetch_result_to_status(
            "token-plan/cursor/session/uuid-1",
            true,
            true,
            None,
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::AwaitingVerification);
    }

    #[test]
    fn session_fetch_quota_returns_reauth_on_auth_required() {
        let result = QuotaFetchResult {
            status: "error".to_string(),
            total_quota: None,
            used_quota: None,
            remaining_quota: None,
            quota_windows: None,
            provider_reported_at: None,
            error: Some("auth_required".to_string()),
            error_code: Some("401".to_string()),
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/cursor/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::ReauthRequired);
    }

    #[test]
    fn session_fetch_quota_returns_unsupported_on_invalid_structure() {
        let result = QuotaFetchResult {
            status: "error".to_string(),
            total_quota: None,
            used_quota: None,
            remaining_quota: None,
            quota_windows: None,
            provider_reported_at: None,
            error: Some("structure_drift".to_string()),
            error_code: Some("no_quota_windows".to_string()),
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/cursor/session/uuid-1",
            true,
            true,
            Some(&result),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::Unsupported);
    }

    #[test]
    fn session_fetch_dto_does_not_contain_cookie_or_headers() {
        let result = QuotaFetchResult {
            status: "success".to_string(),
            total_quota: Some(100.0),
            used_quota: Some(42.0),
            remaining_quota: Some(58.0),
            quota_windows: Some(vec![CursorQuotaWindowDto {
                kind: "rolling_weekly".to_string(),
                unit: "tokens".to_string(),
                total: 100.0,
                used: 42.0,
                remaining: 58.0,
                percentage: 42.0,
                resets_at: "2026-07-10T01:00:00.000Z".to_string(),
            }]),
            provider_reported_at: Some("2026-07-08T00:00:00.000Z".to_string()),
            error: None,
            error_code: None,
        };
        let status = map_quota_fetch_result_to_status(
            "token-plan/cursor/session/uuid-1",
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
            "token-plan/cursor/session/uuid-1",
            false,
            SessionStateCode::LoginStarted,
            "LOGIN_STARTED",
            "官方控制台登录窗口已打开",
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::LoginStarted);
    }
}
