//! Cursor Console Session Module
//!
//! Implements desktop-side commands for opening, verifying, and revoking
//! official Cursor console login sessions.
//!
//! Security invariants:
//! - Login happens on official Cursor pages; Token Eyes never sees credentials
//! - Session reference is a path pointer, not a cookie value
//! - Domain is restricted to official domains only
//! - No cookie, token, or credential data is ever logged
//! - Each authorized account is stored only in Token Eyes app data under its
//!   opaque session reference so quota refresh survives an app restart
//! - "Window opened" never equals "connected"; verification is explicit
//! - sessionFetch keeps desensitized quota in page memory; Rust reads it with
//!   eval_with_callback without granting the remote page native IPC

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const OFFICIAL_DOMAINS: &[&str] = &["cursor.com", "www.cursor.com", "authenticator.cursor.sh"];
const SESSION_REF_PREFIX: &str = "token-plan/cursor/session/";
const LOGIN_URL: &str = "https://cursor.com/loginDeepControl";
const POLL_URL: &str = "https://api2.cursor.sh/auth/poll";
const USAGE_URL: &str = "https://cursor.com/api/usage-summary";
const OAUTH_TOKEN_URL: &str = "https://api2.cursor.sh/oauth/token";
const GET_USER_META_URL: &str = "https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta";
/// Official Cursor desktop OAuth client id (same as Cockpit Tools).
const CURSOR_AUTH_CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const CURSOR_ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS: i64 = 5 * 60;
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
    SyncFailed,
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

/// Per-account Cursor quota snapshot aligned with Cockpit Total / Auto+Composer / API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CursorQuotaSnapshot {
    pub account_id: String,
    pub display_name: String,
    pub plan_name: String,
    pub total_usage_percent: f64,
    pub auto_composer_percent: Option<f64>,
    pub api_usage_percent: Option<f64>,
    pub reset_at: Option<String>,
    pub fetched_at: String,
}

/// Desensitized quota DTO returned to the dashboard bridge.
/// MUST NOT contain cookie, header, token, or raw_response fields.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CursorQuotaDto {
    pub account_id: String,
    pub display_name: String,
    pub plan_name: String,
    pub total_usage_percent: f64,
    pub auto_composer_percent: Option<f64>,
    pub api_usage_percent: Option<f64>,
    pub reset_at: Option<String>,
    pub subscription_expires_at: Option<String>,
    pub fetched_at: String,
    pub total_quota: f64,
    pub used_quota: f64,
    pub remaining_quota: f64,
    pub quota_windows: Vec<CursorQuotaWindowDto>,
    pub provider_reported_at: String,
}

/// Persisted per-account binding metadata (no secrets).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CursorAccountMeta {
    pub provider: String,
    pub account_id: String,
    pub session_ref: String,
    pub display_name: String,
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
    pending_oauth: Option<PendingCursorOAuth>,
    connected_access_tokens: HashMap<String, String>,
}

#[derive(Clone)]
struct PendingCursorOAuth {
    session_ref: String,
    uuid: String,
    verifier: String,
}

#[derive(Debug, Deserialize)]
struct CursorPollResponse {
    #[serde(alias = "accessToken")]
    access_token: Option<String>,
    #[serde(alias = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(alias = "authId")]
    auth_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct StoredCursorTokens {
    access_token: String,
    refresh_token: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    account_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CursorRefreshTokenResponse {
    #[serde(alias = "accessToken")]
    access_token: Option<String>,
    #[serde(alias = "refreshToken")]
    refresh_token: Option<String>,
    #[serde(default, alias = "shouldLogout")]
    should_logout: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CursorUserMetaResponse {
    email: Option<String>,
    workos_id: Option<String>,
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
    let suffix = &session_ref[SESSION_REF_PREFIX.len()..];
    if suffix.is_empty()
        || suffix.len() > 80
        || !suffix
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
    {
        return Err("session_ref must end with a safe account identifier");
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

fn account_dir(app: &AppHandle, session_ref: &str) -> Result<PathBuf, String> {
    validate_session_ref(session_ref).map_err(str::to_string)?;
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|_| "Unable to resolve Token Eyes app-data directory".to_string())?
        .join("cursor-accounts")
        .join(&session_ref[SESSION_REF_PREFIX.len()..]))
}

fn token_path(dir: &Path) -> PathBuf {
    dir.join("auth.json")
}

fn meta_path(dir: &Path) -> PathBuf {
    dir.join("meta.json")
}

fn load_tokens(dir: &Path) -> Result<StoredCursorTokens, String> {
    let raw = fs::read_to_string(token_path(dir))
        .map_err(|_| "Cursor authorization was not found".to_string())?;
    serde_json::from_str(&raw).map_err(|_| "Stored Cursor authorization is invalid".to_string())
}

fn save_tokens(dir: &Path, tokens: &StoredCursorTokens) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|_| "Unable to create Cursor account storage".to_string())?;
    let raw = serde_json::to_vec(tokens)
        .map_err(|_| "Unable to encode Cursor authorization".to_string())?;
    fs::write(token_path(dir), raw).map_err(|_| "Unable to save Cursor authorization".to_string())
}

fn load_account_meta(dir: &Path) -> Option<CursorAccountMeta> {
    let raw = fs::read_to_string(meta_path(dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_account_meta(dir: &Path, meta: &CursorAccountMeta) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|_| "Unable to create Cursor account storage".to_string())?;
    let raw = serde_json::to_vec(meta)
        .map_err(|_| "Unable to encode Cursor account metadata".to_string())?;
    fs::write(meta_path(dir), raw).map_err(|_| "Unable to save Cursor account metadata".to_string())
}

fn redact_email(email: &str) -> String {
    let email = email.trim();
    if email.is_empty() {
        return String::new();
    }
    let Some((local, domain)) = email.split_once('@') else {
        return format!("{}***", email.chars().take(3).collect::<String>());
    };
    let prefix: String = local.chars().take(3).collect();
    format!("{prefix}***@{domain}")
}

fn decode_cursor_access_token_payload(access_token: &str) -> Option<serde_json::Value> {
    let payload = access_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| {
            let normalized = payload.replace('-', "+").replace('_', "/");
            let padded = match normalized.len() % 4 {
                2 => format!("{normalized}=="),
                3 => format!("{normalized}="),
                _ => normalized,
            };
            base64::engine::general_purpose::STANDARD.decode(padded)
        })
        .ok()?;
    serde_json::from_slice(&decoded).ok()
}

pub fn extract_cursor_account_id(access_token: &str) -> Option<String> {
    let value = decode_cursor_access_token_payload(access_token)?;
    let subject = value.get("sub")?.as_str()?;
    let trimmed = subject.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn access_token_needs_refresh_at(access_token: &str, now: i64) -> bool {
    let Some(exp) = decode_cursor_access_token_payload(access_token)
        .and_then(|value| value.get("exp").and_then(serde_json::Value::as_i64))
    else {
        return true;
    };
    exp <= now + CURSOR_ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS
}

fn should_exchange_refresh_token_at(
    access_token: &str,
    force_refresh: bool,
    has_refresh_token: bool,
    now: i64,
) -> bool {
    has_refresh_token && (force_refresh || access_token_needs_refresh_at(access_token, now))
}

fn should_exchange_refresh_token(
    access_token: &str,
    force_refresh: bool,
    has_refresh_token: bool,
) -> bool {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0);
    should_exchange_refresh_token_at(access_token, force_refresh, has_refresh_token, now)
}

#[derive(Debug, PartialEq, Eq)]
enum CursorAuthAction {
    RefreshAndRetry,
    RequireLogin,
    ReturnFailure,
}

fn next_cursor_auth_action(
    error: &str,
    has_refresh_token: bool,
    already_retried: bool,
) -> CursorAuthAction {
    if error != "REAUTH_REQUIRED" {
        return CursorAuthAction::ReturnFailure;
    }
    if has_refresh_token && !already_retried {
        CursorAuthAction::RefreshAndRetry
    } else {
        CursorAuthAction::RequireLogin
    }
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
                account_id: String::new(),
                display_name: String::new(),
                plan_name: String::new(),
                total_usage_percent: used_quota,
                auto_composer_percent: None,
                api_usage_percent: None,
                reset_at: quota_windows
                    .first()
                    .map(|window| window.resets_at.clone())
                    .filter(|value| !value.is_empty()),
                subscription_expires_at: quota_windows
                    .first()
                    .map(|window| window.resets_at.clone())
                    .filter(|value| !value.is_empty()),
                fetched_at: result.provider_reported_at.clone().unwrap_or_default(),
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

pub fn build_cursor_browser_login_url(challenge: &str, uuid: &str) -> String {
    format!("{LOGIN_URL}?challenge={challenge}&uuid={uuid}&mode=login")
}

fn create_cursor_oauth_values() -> (String, String, String) {
    let mut verifier_bytes = [0_u8; 32];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut uuid_bytes = [0_u8; 16];
    rand::thread_rng().fill_bytes(&mut uuid_bytes);
    let uuid = uuid_bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    (uuid, verifier, challenge)
}

pub fn build_cursor_session_cookie(access_token: &str) -> Option<String> {
    let value = decode_cursor_access_token_payload(access_token)?;
    let subject = value.get("sub")?.as_str()?;
    let user_id = subject.rsplit('|').next().unwrap_or(subject);
    if !user_id.starts_with("user_") {
        return None;
    }
    Some(format!(
        "WorkosCursorSessionToken={user_id}%3A%3A{access_token}"
    ))
}

fn pick_percent(value: Option<&serde_json::Value>, keys: &[&str]) -> Option<f64> {
    let obj = value?.as_object()?;
    for key in keys {
        let Some(raw) = obj.get(*key) else {
            continue;
        };
        if let Some(number) = raw.as_f64() {
            if number.is_finite() {
                return Some(number);
            }
        }
        if let Some(text) = raw.as_str() {
            if let Ok(parsed) = text.trim().parse::<f64>() {
                if parsed.is_finite() {
                    return Some(parsed);
                }
            }
        }
    }
    None
}

fn plan_usage_ratio(plan: Option<&serde_json::Value>) -> Option<f64> {
    let used = pick_percent(plan, &["used", "totalSpend", "total_spend"])?;
    let limit = pick_percent(plan, &["limit"])?;
    (limit > 0.0).then_some((used / limit) * PERCENT_SCALE)
}

fn quota_window(kind: &str, used: f64, reset_at: &str) -> CursorQuotaWindowDto {
    let used = used.clamp(0.0, PERCENT_SCALE);
    CursorQuotaWindowDto {
        kind: kind.to_string(),
        unit: "percent".to_string(),
        total: PERCENT_SCALE,
        used,
        remaining: PERCENT_SCALE - used,
        percentage: used,
        resets_at: reset_at.to_string(),
    }
}

fn quota_dto_from_snapshot(snapshot: CursorQuotaSnapshot) -> CursorQuotaDto {
    let used = snapshot.total_usage_percent.clamp(0.0, PERCENT_SCALE);
    let reset_at = snapshot.reset_at.clone().unwrap_or_default();
    let mut quota_windows = vec![
        quota_window("total", used, &reset_at),
        // Keep rolling_weekly as an alias so existing TokenServiceList priority still works.
        quota_window("rolling_weekly", used, &reset_at),
    ];
    if let Some(auto_used) = snapshot.auto_composer_percent {
        quota_windows.push(quota_window("auto_composer", auto_used, &reset_at));
    }
    if let Some(api_used) = snapshot.api_usage_percent {
        quota_windows.push(quota_window("api", api_used, &reset_at));
    }
    CursorQuotaDto {
        account_id: snapshot.account_id.clone(),
        display_name: snapshot.display_name.clone(),
        plan_name: snapshot.plan_name.clone(),
        total_usage_percent: used,
        auto_composer_percent: snapshot.auto_composer_percent,
        api_usage_percent: snapshot.api_usage_percent,
        reset_at: snapshot.reset_at.clone(),
        subscription_expires_at: snapshot.reset_at.clone(),
        fetched_at: snapshot.fetched_at.clone(),
        total_quota: PERCENT_SCALE,
        used_quota: used,
        remaining_quota: PERCENT_SCALE - used,
        quota_windows,
        provider_reported_at: snapshot.fetched_at,
    }
}

/// Parse Cockpit-aligned usage-summary fields into a per-account snapshot.
/// Missing critical Total Usage fields return an error — never invent connected 0%.
pub fn parse_cursor_quota_snapshot(
    payload: &serde_json::Value,
    account_id: &str,
) -> Result<CursorQuotaSnapshot, String> {
    let account_id = account_id.trim();
    if account_id.is_empty() {
        return Err("missing Cursor account_id".to_string());
    }

    let individual_usage = payload
        .get("individualUsage")
        .or_else(|| payload.get("individual_usage"))
        .ok_or_else(|| "missing individualUsage".to_string())?;
    let plan = individual_usage
        .get("plan")
        .or_else(|| payload.get("planUsage"))
        .or_else(|| payload.get("plan_usage"))
        .unwrap_or(individual_usage);

    // Match Cockpit read_usage_percent: prefer explicit percent fields; only if
    // those are absent fall back to used/limit. Explicit 0 stays 0 (do not
    // overwrite with used/limit, which can sit at ceiling while percent is lower).
    let total_direct = pick_percent(Some(plan), &["totalPercentUsed", "total_percent_used"]);
    let auto_direct = pick_percent(Some(plan), &["autoPercentUsed", "auto_percent_used"]);
    let api_direct = pick_percent(Some(plan), &["apiPercentUsed", "api_percent_used"]);
    let total_ratio = plan_usage_ratio(Some(plan));
    let total = total_direct.or(total_ratio).ok_or_else(|| {
        "missing critical usage fields (totalPercentUsed / used+limit)".to_string()
    })?;

    let reset_at = payload
        .get("billingCycleEnd")
        .or_else(|| payload.get("billing_cycle_end"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let plan_name = payload
        .get("membershipType")
        .or_else(|| payload.get("membership_type"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown")
        .to_string();

    Ok(CursorQuotaSnapshot {
        account_id: account_id.to_string(),
        display_name: String::new(),
        plan_name,
        total_usage_percent: total.clamp(0.0, PERCENT_SCALE),
        auto_composer_percent: auto_direct.map(|value| value.clamp(0.0, PERCENT_SCALE)),
        api_usage_percent: api_direct.map(|value| value.clamp(0.0, PERCENT_SCALE)),
        reset_at,
        fetched_at: chrono_like_now(),
    })
}

fn chrono_like_now() -> String {
    // Keep dependency surface small: RFC3339 via js_sys-free system time formatting.
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let secs = (millis / 1000) as i64;
    let millis_part = (millis % 1000) as u32;
    format_utc_rfc3339(secs, millis_part)
}

fn format_utc_rfc3339(secs: i64, millis: u32) -> String {
    // Simplified UTC formatter sufficient for fetched_at display/tests.
    let days = secs.div_euclid(86_400);
    let time_of_day = secs.rem_euclid(86_400) as u32;
    let hour = time_of_day / 3600;
    let minute = (time_of_day % 3600) / 60;
    let second = time_of_day % 60;
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

fn civil_from_days(days: i64) -> (i32, u32, u32) {
    // Howard Hinnant civil_from_days algorithm.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

pub fn parse_cursor_usage_summary(payload: &serde_json::Value) -> Option<CursorQuotaDto> {
    let account_id = payload
        .pointer("/_fixture/account_id")
        .and_then(|value| value.as_str())
        .or_else(|| payload.get("account_id").and_then(|value| value.as_str()))
        .unwrap_or("cursor-account");
    parse_cursor_quota_snapshot(payload, account_id)
        .ok()
        .map(quota_dto_from_snapshot)
}

/// Auth may succeed while usage fails — that is sync_failed, never connected.
pub fn map_cursor_auth_usage_outcome(
    session_ref: &str,
    _account_id: Option<&str>,
    usage: Result<CursorQuotaSnapshot, String>,
) -> CursorSessionStatus {
    match usage {
        Ok(snapshot) => CursorSessionStatus {
            connected: true,
            session_ref: session_ref.to_string(),
            state_code: SessionStateCode::Connected,
            error_code: String::new(),
            error_message: String::new(),
            quota: Some(quota_dto_from_snapshot(snapshot)),
        },
        Err(error) => build_status(
            session_ref,
            false,
            SessionStateCode::SyncFailed,
            "SYNC_FAILED",
            &format!("Cursor 授权可用，但用量同步失败: {error}"),
        ),
    }
}

async fn exchange_cursor_refresh_token(
    client: &reqwest::Client,
    refresh_token: &str,
) -> Result<CursorRefreshTokenResponse, String> {
    let response = client
        .post(OAUTH_TOKEN_URL)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "client_id": CURSOR_AUTH_CLIENT_ID,
            "refresh_token": refresh_token,
        }))
        .send()
        .await
        .map_err(|error| format!("Cursor token 刷新失败: {error}"))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取 Cursor token 刷新响应失败: {error}"))?;
    if matches!(status, 401 | 403) {
        return Err("Cursor refresh token 已过期或无效".to_string());
    }
    if status != 200 {
        return Err(format!("Cursor token 刷新接口返回异常状态码: {status}"));
    }
    serde_json::from_str(&body).map_err(|error| format!("解析 Cursor token 刷新响应失败: {error}"))
}

async fn fetch_cursor_user_meta(
    client: &reqwest::Client,
    access_token: &str,
) -> Option<CursorUserMetaResponse> {
    let response = client
        .post(GET_USER_META_URL)
        .header("Authorization", format!("Bearer {access_token}"))
        .header("Accept", "application/json")
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({}))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().await.ok()
}

async fn fetch_usage_summary_payload(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<serde_json::Value, String> {
    let cookie = build_cursor_session_cookie(access_token)
        .ok_or_else(|| "无法从 accessToken 解析 WorkOS 用户 ID".to_string())?;
    let response = client
        .get(USAGE_URL)
        .header("Accept", "application/json")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        )
        .header("Cookie", cookie)
        .send()
        .await
        .map_err(|error| format!("Cursor 用量查询失败: {error}"))?;
    let status = response.status().as_u16();
    if matches!(status, 401 | 403) {
        return Err("REAUTH_REQUIRED".to_string());
    }
    if status != 200 {
        return Err(format!("USAGE_FETCH_FAILED:{status}"));
    }
    response
        .json()
        .await
        .map_err(|error| format!("解析 Cursor 用量响应失败: {error}"))
}

struct CursorAuthBundle {
    access_token: String,
    refresh_token: String,
    account_id: String,
    display_name: String,
}

async fn refresh_cursor_auth_bundle(
    client: &reqwest::Client,
    mut access_token: String,
    mut refresh_token: String,
    known_account_id: Option<String>,
    force_refresh: bool,
) -> Result<CursorAuthBundle, String> {
    if should_exchange_refresh_token(
        &access_token,
        force_refresh,
        !refresh_token.trim().is_empty(),
    ) {
        match exchange_cursor_refresh_token(client, &refresh_token).await {
            Ok(token_response) => {
                if token_response.should_logout {
                    return Err("REAUTH_REQUIRED".to_string());
                }
                if let Some(next_access) = token_response
                    .access_token
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                {
                    access_token = next_access;
                }
                if let Some(next_refresh) = token_response
                    .refresh_token
                    .map(|value| value.trim().to_string())
                    .filter(|value| !value.is_empty())
                {
                    refresh_token = next_refresh;
                }
            }
            Err(error) if error.contains("过期") || error.contains("无效") => {
                return Err("REAUTH_REQUIRED".to_string());
            }
            Err(_) => {
                // Keep existing access token; usage fetch may still succeed.
            }
        }
    }

    let mut account_id = known_account_id
        .filter(|value| !value.trim().is_empty())
        .or_else(|| extract_cursor_account_id(&access_token))
        .unwrap_or_default();
    let mut display_name = String::new();
    if let Some(meta) = fetch_cursor_user_meta(client, &access_token).await {
        if let Some(email) = meta
            .email
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            display_name = redact_email(&email);
        }
        if account_id.is_empty() {
            if let Some(workos_id) = meta
                .workos_id
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
            {
                account_id = if workos_id.contains('|') {
                    workos_id
                } else {
                    format!("auth0|{workos_id}")
                };
            }
        }
    }
    if account_id.is_empty() {
        return Err("INVALID_ACCESS_TOKEN".to_string());
    }
    if display_name.is_empty() {
        display_name = account_id
            .split('|')
            .next_back()
            .unwrap_or(account_id.as_str())
            .chars()
            .take(12)
            .collect::<String>()
            + "…";
    }

    Ok(CursorAuthBundle {
        access_token,
        refresh_token,
        account_id,
        display_name,
    })
}

async fn fetch_cursor_quota(
    client: &reqwest::Client,
    session_ref: &str,
    access_token: &str,
    refresh_token: &str,
    known_account_id: Option<String>,
) -> Result<(CursorSessionStatus, Option<CursorAuthBundle>), String> {
    let auth = match refresh_cursor_auth_bundle(
        client,
        access_token.to_string(),
        refresh_token.to_string(),
        known_account_id.clone(),
        false,
    )
    .await
    {
        Ok(bundle) => bundle,
        Err(error) if error == "REAUTH_REQUIRED" => {
            return Ok((
                build_status(
                    session_ref,
                    false,
                    SessionStateCode::ReauthRequired,
                    "REAUTH_REQUIRED",
                    "Cursor 授权已失效，请重新连接。",
                ),
                None,
            ));
        }
        Err(error) if error == "INVALID_ACCESS_TOKEN" => {
            return Ok((
                build_status(
                    session_ref,
                    false,
                    SessionStateCode::Unsupported,
                    "INVALID_ACCESS_TOKEN",
                    "Cursor 授权成功，但账号标识格式无法识别。",
                ),
                None,
            ));
        }
        Err(error) => return Err(error),
    };

    let mut active_auth = auth;
    let mut already_retried = false;
    loop {
        match fetch_usage_summary_payload(client, &active_auth.access_token).await {
            Ok(payload) => {
                let usage_result = parse_cursor_quota_snapshot(&payload, &active_auth.account_id)
                    .map(|mut snapshot| {
                        snapshot.display_name = active_auth.display_name.clone();
                        snapshot
                    });
                let status = map_cursor_auth_usage_outcome(
                    session_ref,
                    Some(&active_auth.account_id),
                    usage_result,
                );
                return Ok((status, Some(active_auth)));
            }
            Err(error) => match next_cursor_auth_action(
                &error,
                !active_auth.refresh_token.trim().is_empty(),
                already_retried,
            ) {
                CursorAuthAction::RefreshAndRetry => {
                    let refreshed = refresh_cursor_auth_bundle(
                        client,
                        active_auth.access_token.clone(),
                        active_auth.refresh_token.clone(),
                        known_account_id
                            .clone()
                            .or_else(|| Some(active_auth.account_id.clone())),
                        true,
                    )
                    .await;
                    match refreshed {
                        Ok(next_auth) => {
                            active_auth = next_auth;
                            already_retried = true;
                        }
                        Err(refresh_error) if refresh_error == "REAUTH_REQUIRED" => {
                            return Ok((
                                build_status(
                                    session_ref,
                                    false,
                                    SessionStateCode::ReauthRequired,
                                    "REAUTH_REQUIRED",
                                    "Cursor 授权已失效，请重新连接。",
                                ),
                                Some(active_auth),
                            ));
                        }
                        Err(refresh_error) => return Err(refresh_error),
                    }
                }
                CursorAuthAction::RequireLogin => {
                    return Ok((
                        build_status(
                            session_ref,
                            false,
                            SessionStateCode::ReauthRequired,
                            "REAUTH_REQUIRED",
                            "Cursor 授权已失效，请重新连接。",
                        ),
                        Some(active_auth),
                    ));
                }
                CursorAuthAction::ReturnFailure => {
                    let status = map_cursor_auth_usage_outcome(
                        session_ref,
                        Some(&active_auth.account_id),
                        Err(error),
                    );
                    return Ok((status, Some(active_auth)));
                }
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Opens Cursor's PKCE login in the user's default browser. This intentionally
/// avoids an isolated embedded WebView cookie jar, which caused a permanent
/// blank window and forced users to sign in again.
#[tauri::command]
pub async fn open_cursor_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<CursorSessionStatus, String> {
    if let Err(reason) = validate_session_ref(&session_ref) {
        return Err(reason.to_string());
    }

    let (uuid, verifier, challenge) = create_cursor_oauth_values();
    let auth_url = build_cursor_browser_login_url(&challenge, &uuid);
    app.opener()
        .open_url(&auth_url, None::<String>)
        .map_err(|error| format!("无法在默认浏览器打开 Cursor 授权页: {error}"))?;

    if let Some(state) = app.try_state::<Mutex<CursorSessionState>>() {
        if let Ok(mut guard) = state.lock() {
            guard.active_session_ref = Some(session_ref.clone());
            guard.last_known_url = Some(auth_url);
            guard.active_window_label = None;
            guard.pending_oauth = Some(PendingCursorOAuth {
                session_ref: session_ref.clone(),
                uuid,
                verifier,
            });
        }
    }

    Ok(build_status(
        &session_ref,
        false,
        SessionStateCode::LoginStarted,
        "LOGIN_STARTED",
        "已在默认浏览器打开 Cursor 官方授权页；浏览器已登录时可直接确认。",
    ))
}

/// Polls Cursor's official PKCE endpoint once and queries quota after the
/// browser authorization completes. The React caller already polls this
/// command, so one request per invocation keeps cancellation responsive.
#[tauri::command]
pub async fn verify_cursor_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<CursorSessionStatus, String> {
    if let Err(reason) = validate_session_ref(&session_ref) {
        return Err(reason.to_string());
    }

    let (pending, connected_access_token) =
        if let Some(state) = app.try_state::<Mutex<CursorSessionState>>() {
            if let Ok(guard) = state.lock() {
                (
                    guard
                        .pending_oauth
                        .clone()
                        .filter(|item| item.session_ref == session_ref),
                    guard.connected_access_tokens.get(&session_ref).cloned(),
                )
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

    let account_directory = account_dir(&app, &session_ref)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("创建 Cursor 授权客户端失败: {error}"))?;

    async fn persist_connected_cursor_account(
        app: &AppHandle,
        account_directory: &Path,
        session_ref: &str,
        auth: &CursorAuthBundle,
    ) -> Result<(), String> {
        save_tokens(
            account_directory,
            &StoredCursorTokens {
                access_token: auth.access_token.clone(),
                refresh_token: auth.refresh_token.clone(),
                account_id: Some(auth.account_id.clone()),
            },
        )?;
        save_account_meta(
            account_directory,
            &CursorAccountMeta {
                provider: "cursor".to_string(),
                account_id: auth.account_id.clone(),
                session_ref: session_ref.to_string(),
                display_name: auth.display_name.clone(),
            },
        )?;
        if let Some(state) = app.try_state::<Mutex<CursorSessionState>>() {
            if let Ok(mut guard) = state.lock() {
                guard.pending_oauth = None;
                guard
                    .connected_access_tokens
                    .insert(session_ref.to_string(), auth.access_token.clone());
                guard.active_session_ref = Some(session_ref.to_string());
                guard.last_known_url = None;
            }
        }
        Ok(())
    }

    // A newly started OAuth flow must win over cached credentials. Otherwise
    // reconnecting this plan can silently keep returning the previous account.
    if pending.is_none() {
        let known_account_id = load_account_meta(&account_directory).map(|meta| meta.account_id);
        if let Some(access_token) = connected_access_token {
            let refresh_token = load_tokens(&account_directory)
                .map(|tokens| tokens.refresh_token)
                .unwrap_or_default();
            let (status, auth) = fetch_cursor_quota(
                &client,
                &session_ref,
                &access_token,
                &refresh_token,
                known_account_id,
            )
            .await?;
            if status.connected {
                if let Some(auth) = auth.as_ref() {
                    persist_connected_cursor_account(&app, &account_directory, &session_ref, auth)
                        .await?;
                }
            } else if let Some(auth) = auth.as_ref() {
                // Keep refreshed tokens even when usage sync fails so the next
                // retry does not depend on a stale access token.
                let _ = save_tokens(
                    &account_directory,
                    &StoredCursorTokens {
                        access_token: auth.access_token.clone(),
                        refresh_token: auth.refresh_token.clone(),
                        account_id: Some(auth.account_id.clone()),
                    },
                );
            }
            return Ok(status);
        }
        if let Ok(tokens) = load_tokens(&account_directory) {
            let (status, auth) = fetch_cursor_quota(
                &client,
                &session_ref,
                &tokens.access_token,
                &tokens.refresh_token,
                known_account_id.or(tokens.account_id),
            )
            .await?;
            // Presence of auth.json alone is never treated as connected.
            if status.connected {
                if let Some(auth) = auth.as_ref() {
                    persist_connected_cursor_account(&app, &account_directory, &session_ref, auth)
                        .await?;
                }
            } else if let Some(auth) = auth.as_ref() {
                let _ = save_tokens(
                    &account_directory,
                    &StoredCursorTokens {
                        access_token: auth.access_token.clone(),
                        refresh_token: auth.refresh_token.clone(),
                        account_id: Some(auth.account_id.clone()),
                    },
                );
            }
            return Ok(status);
        }
    }

    let Some(pending) = pending else {
        return Ok(build_status(
            &session_ref,
            false,
            SessionStateCode::SessionNotFound,
            "SESSION_NOT_FOUND",
            "未找到对应的登录会话，请重新连接。",
        ));
    };

    let poll_url = format!(
        "{POLL_URL}?uuid={}&verifier={}",
        pending.uuid, pending.verifier
    );
    let response = client
        .get(&poll_url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("Cursor 授权状态查询失败: {error}"))?;
    if response.status().as_u16() == 404 {
        return Ok(build_status(
            &session_ref,
            false,
            SessionStateCode::AwaitingVerification,
            "AWAITING_VERIFICATION",
            "等待在默认浏览器完成 Cursor 官方授权。",
        ));
    }
    if !response.status().is_success() {
        return Ok(build_status(
            &session_ref,
            false,
            SessionStateCode::Failed,
            "OAUTH_POLL_FAILED",
            "Cursor 官方授权状态查询失败，请重试。",
        ));
    }
    let poll: CursorPollResponse = response
        .json()
        .await
        .map_err(|error| format!("解析 Cursor 授权响应失败: {error}"))?;
    let Some(access_token) = poll.access_token else {
        return Ok(build_status(
            &session_ref,
            false,
            SessionStateCode::AwaitingVerification,
            "AWAITING_VERIFICATION",
            "等待在默认浏览器完成 Cursor 官方授权。",
        ));
    };
    let refresh_token = poll.refresh_token.unwrap_or_default();
    let known_account_id = poll
        .auth_id
        .filter(|value| !value.trim().is_empty() && !value.contains('@'));
    let (status, auth) = fetch_cursor_quota(
        &client,
        &session_ref,
        &access_token,
        &refresh_token,
        known_account_id,
    )
    .await?;
    if status.connected {
        if let Some(auth) = auth.as_ref() {
            persist_connected_cursor_account(&app, &account_directory, &session_ref, auth).await?;
        }
        return Ok(status);
    }
    if let Some(auth) = auth.as_ref() {
        let _ = save_tokens(
            &account_directory,
            &StoredCursorTokens {
                access_token: auth.access_token.clone(),
                refresh_token: auth.refresh_token.clone(),
                account_id: Some(auth.account_id.clone()),
            },
        );
        let _ = save_account_meta(
            &account_directory,
            &CursorAccountMeta {
                provider: "cursor".to_string(),
                account_id: auth.account_id.clone(),
                session_ref: session_ref.clone(),
                display_name: auth.display_name.clone(),
            },
        );
    }
    Ok(status)
}

/// Deletes the active Cursor console session.
#[tauri::command]
pub async fn delete_cursor_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<(), String> {
    if let Ok(dir) = account_dir(&app, &session_ref) {
        let _ = fs::remove_dir_all(dir);
    }
    if let Some(state) = app.try_state::<Mutex<CursorSessionState>>() {
        if let Ok(mut guard) = state.lock() {
            if guard
                .pending_oauth
                .as_ref()
                .is_some_and(|item| item.session_ref == session_ref)
            {
                guard.pending_oauth = None;
            }
            guard.connected_access_tokens.remove(&session_ref);
            let _ = take_active_window_label(&mut guard, &session_ref);
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
    fn validate_session_ref_rejects_nested_or_unsafe_account_identifiers() {
        assert!(validate_session_ref("token-plan/cursor/session/account/other").is_err());
        assert!(validate_session_ref("token-plan/cursor/session/account..other").is_err());
    }

    #[test]
    fn browser_oauth_url_uses_cursor_pkce_flow_instead_of_embedded_settings_window() {
        let url = build_cursor_browser_login_url("challenge-123", "uuid-456");
        assert_eq!(
            url,
            "https://cursor.com/loginDeepControl?challenge=challenge-123&uuid=uuid-456&mode=login"
        );
    }

    #[test]
    fn builds_usage_cookie_from_cursor_access_token_subject() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"sub":"auth0|user_example"}"#);
        let token = format!("header.{payload}.signature");
        assert_eq!(
            build_cursor_session_cookie(&token).as_deref(),
            Some("WorkosCursorSessionToken=user_example%3A%3Aheader.eyJzdWIiOiJhdXRoMHx1c2VyX2V4YW1wbGUifQ.signature")
        );
    }

    #[test]
    fn cursor_access_token_refresh_decision_matches_cockpit_five_minute_threshold() {
        let now = 1_800_000_000_i64;
        let token_with_exp = |exp: i64| {
            let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(format!(r#"{{"sub":"auth0|user_example","exp":{exp}}}"#));
            format!("header.{payload}.signature")
        };

        assert!(!access_token_needs_refresh_at(
            &token_with_exp(now + 301),
            now
        ));
        assert!(access_token_needs_refresh_at(
            &token_with_exp(now + 300),
            now
        ));
        assert!(access_token_needs_refresh_at(
            "header.invalid.signature",
            now
        ));
    }

    #[test]
    fn forced_cursor_retry_exchanges_an_unexpired_access_token() {
        let now = 1_800_000_000_i64;
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(format!(
            r#"{{"sub":"auth0|user_example","exp":{}}}"#,
            now + 3600
        ));
        let token = format!("header.{payload}.signature");

        assert!(!should_exchange_refresh_token_at(&token, false, true, now));
        assert!(should_exchange_refresh_token_at(&token, true, true, now));
        assert!(!should_exchange_refresh_token_at(&token, true, false, now));
    }

    #[test]
    fn cursor_usage_unauthorized_requests_only_one_refresh_retry() {
        assert_eq!(
            next_cursor_auth_action("REAUTH_REQUIRED", true, false),
            CursorAuthAction::RefreshAndRetry
        );
        assert_eq!(
            next_cursor_auth_action("REAUTH_REQUIRED", true, true),
            CursorAuthAction::RequireLogin
        );
        assert_eq!(
            next_cursor_auth_action("USAGE_FETCH_FAILED:500", true, false),
            CursorAuthAction::ReturnFailure
        );
    }

    #[test]
    fn parses_cursor_usage_summary_into_weekly_quota() {
        let payload = serde_json::json!({
            "individualUsage": { "plan": { "totalPercentUsed": 42 } },
            "billingCycleEnd": "2026-07-21T08:57:00.000Z"
        });
        let quota = parse_cursor_usage_summary(&payload).expect("quota");
        assert_eq!(quota.used_quota, 42.0);
        assert_eq!(quota.remaining_quota, 58.0);
        assert_eq!(quota.total_usage_percent, 42.0);
        assert!(quota
            .quota_windows
            .iter()
            .any(|window| window.kind == "rolling_weekly"));
    }

    #[test]
    fn parses_cursor_usage_summary_numeric_strings_and_submeters() {
        let payload = serde_json::json!({
            "individualUsage": {
                "plan": {
                    "totalPercentUsed": "27",
                    "autoPercentUsed": "20",
                    "apiPercentUsed": "72"
                }
            },
            "billingCycleEnd": "2026-08-06T22:31:00.000Z"
        });
        let quota = parse_cursor_usage_summary(&payload).expect("quota");
        assert_eq!(quota.used_quota, 27.0);
        assert_eq!(quota.auto_composer_percent, Some(20.0));
        assert_eq!(quota.api_usage_percent, Some(72.0));
        assert!(quota
            .quota_windows
            .iter()
            .any(|window| window.kind == "total" && window.used == 27.0));
        assert!(quota
            .quota_windows
            .iter()
            .any(|window| window.kind == "auto_composer" && window.used == 20.0));
        assert!(quota
            .quota_windows
            .iter()
            .any(|window| window.kind == "api" && window.used == 72.0));
    }

    #[test]
    fn parses_cursor_usage_summary_when_plan_wrapper_is_absent() {
        let payload = serde_json::json!({
            "individualUsage": { "totalPercentUsed": 31 }
        });
        let quota = parse_cursor_usage_summary(&payload).expect("quota");
        assert_eq!(quota.used_quota, 31.0);
    }

    #[test]
    fn explicit_zero_total_percent_is_not_overwritten_by_used_limit_ratio() {
        // Cockpit keeps explicit totalPercentUsed=0; used/limit can be at ceiling.
        let payload = serde_json::json!({
            "individualUsage": {
                "plan": {
                    "totalPercentUsed": 0,
                    "used": "2000",
                    "limit": "2000"
                }
            },
            "billingCycleEnd": "2026-08-06T22:31:00.000Z"
        });
        let quota = parse_cursor_usage_summary(&payload).expect("quota");
        assert_eq!(quota.used_quota, 0.0);
        assert_eq!(quota.remaining_quota, 100.0);
    }

    #[test]
    fn uses_total_spend_ratio_only_when_percent_field_absent() {
        let payload = serde_json::json!({
            "individualUsage": {
                "plan": {
                    "totalSpend": "19.4",
                    "limit": "20"
                }
            },
            "billingCycleEnd": "2026-08-06T22:31:00.000Z"
        });
        let quota = parse_cursor_usage_summary(&payload).expect("quota");
        assert_eq!(quota.used_quota, 97.0);
        assert_eq!(quota.remaining_quota, 3.0);
    }

    #[test]
    fn used_field_wins_over_total_spend_when_percent_absent() {
        // Cockpit pick_number walks keys in order; used comes before totalSpend.
        let payload = serde_json::json!({
            "individualUsage": {
                "plan": {
                    "used": 0,
                    "totalSpend": "19.4",
                    "limit": "20"
                }
            }
        });
        let quota = parse_cursor_usage_summary(&payload).expect("quota");
        assert_eq!(quota.used_quota, 0.0);
    }

    #[test]
    fn parses_cursor_snake_case_total_spend_when_percent_absent() {
        let payload = serde_json::json!({
            "individualUsage": {
                "plan": {
                    "total_spend": "17.6",
                    "limit": "20"
                }
            }
        });
        let quota = parse_cursor_usage_summary(&payload).expect("quota");
        assert!((quota.used_quota - 88.0).abs() < 0.000_001);
    }

    #[test]
    fn plan_without_percent_or_ratio_is_rejected() {
        let payload = serde_json::json!({
            "individualUsage": {
                "plan": { "enabled": true },
                "onDemand": { "used": "270", "limit": "1000" }
            },
            "billingCycleEnd": "2026-08-06T22:31:00.000Z"
        });
        assert!(parse_cursor_usage_summary(&payload).is_none());
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
        assert!(is_official_cursor_url(
            "https://cursor.com/api/usage-summary"
        ));
        assert!(is_official_cursor_url(
            "https://authenticator.cursor.sh/oauth/callback"
        ));
        assert!(!is_official_cursor_url(
            "https://cursor.com.evil.example/login"
        ));
        assert!(!is_official_cursor_url(
            "https://evil.example/?next=cursor.com"
        ));
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
        assert!(js.contains("credentials: 'include'") || js.contains("credentials:'include'"));
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
        let status =
            map_quota_fetch_result_to_status("token-plan/cursor/session/uuid-1", true, true, None);
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

    fn load_usage_fixture(name: &str) -> (String, serde_json::Value) {
        let path = format!(
            "{}/tests/fixtures/cursor/{}",
            env!("CARGO_MANIFEST_DIR"),
            name
        );
        let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
        let value: serde_json::Value =
            serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {path}: {e}"));
        let account_id = value
            .pointer("/_fixture/account_id")
            .and_then(|v| v.as_str())
            .unwrap_or_else(|| panic!("fixture {name} missing _fixture.account_id"))
            .to_string();
        let mut usage = value;
        if let Some(obj) = usage.as_object_mut() {
            obj.remove("_fixture");
        }
        (account_id, usage)
    }

    #[test]
    fn fixture_accounts_parse_to_distinct_account_ids_and_usage_percents() {
        let (account_a, usage_a) = load_usage_fixture("usage-summary-account-a.json");
        let (account_b, usage_b) = load_usage_fixture("usage-summary-account-b.json");
        assert_ne!(account_a, account_b);

        let snap_a = parse_cursor_quota_snapshot(&usage_a, &account_a).expect("account a");
        let snap_b = parse_cursor_quota_snapshot(&usage_b, &account_b).expect("account b");

        assert_eq!(snap_a.account_id, account_a);
        assert_eq!(snap_b.account_id, account_b);

        // Fixture files on disk are the source of truth for these assertions.
        // usage-summary-account-a.json: totalPercentUsed / autoPercentUsed / apiPercentUsed.
        assert!((snap_a.total_usage_percent - 29.095652173913045).abs() < 0.000_001);
        assert_eq!(snap_a.auto_composer_percent, Some(22.73));
        assert!((snap_a.api_usage_percent.unwrap() - 71.53333333333333).abs() < 0.000_001);
        assert_eq!(snap_a.reset_at.as_deref(), Some("2026-08-06T14:31:29.000Z"));

        assert_eq!(snap_b.total_usage_percent, 6.0);
        assert_eq!(snap_b.auto_composer_percent, Some(1.0));
        assert_eq!(snap_b.api_usage_percent, Some(39.0));
        assert_eq!(snap_b.reset_at.as_deref(), Some("2026-08-13T09:08:00.000Z"));

        // Do not crush dimensions into used=0/remaining=0 placeholders.
        assert!(snap_a.total_usage_percent > 0.0);
        assert!(snap_b.total_usage_percent > 0.0);
        assert_ne!(snap_a.total_usage_percent, snap_b.total_usage_percent);
    }

    #[test]
    fn missing_critical_usage_fields_return_error_not_zero_connected() {
        let payload = serde_json::json!({
            "membershipType": "pro",
            "billingCycleEnd": "2026-08-06T14:31:29.000Z",
            "individualUsage": { "plan": { "enabled": true } }
        });
        let err = parse_cursor_quota_snapshot(&payload, "auth0|user_missing")
            .expect_err("missing percents must error");
        assert!(
            err.contains("missing") || err.contains("NO_QUOTA"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn exposes_billing_cycle_end_as_subscription_validity() {
        let payload = serde_json::json!({
            "membershipType": "pro",
            "billingCycleEnd": "2026-08-22T04:17:12Z",
            "individualUsage": {
                "plan": { "totalPercentUsed": 60 }
            }
        });
        let snapshot = parse_cursor_quota_snapshot(&payload, "auth0|user_validity")
            .expect("snapshot");
        let quota = quota_dto_from_snapshot(snapshot);

        assert_eq!(
            quota.subscription_expires_at.as_deref(),
            Some("2026-08-22T04:17:12Z")
        );
    }

    #[test]
    fn does_not_prefer_plan_used_limit_ratio_over_explicit_total_percent() {
        // Live Cursor responses can have used==limit (cents/units at ceiling)
        // while totalPercentUsed remains the Cockpit Total Usage value.
        let payload = serde_json::json!({
            "billingCycleEnd": "2026-08-06T14:31:29.000Z",
            "individualUsage": {
                "plan": {
                    "used": 2000,
                    "limit": 2000,
                    "totalPercentUsed": 29.1,
                    "autoPercentUsed": 22.7,
                    "apiPercentUsed": 71.5
                }
            }
        });
        let snap = parse_cursor_quota_snapshot(&payload, "auth0|user_ratio").expect("snap");
        assert!((snap.total_usage_percent - 29.1).abs() < 0.000_001);
    }

    #[test]
    fn auth_ok_but_usage_fail_maps_to_sync_failed_not_connected() {
        let status = map_cursor_auth_usage_outcome(
            "token-plan/cursor/session/acct-a",
            Some("auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398"),
            Err("USAGE_FETCH_FAILED".into()),
        );
        assert!(!status.connected);
        assert_eq!(status.state_code, SessionStateCode::SyncFailed);
        assert_eq!(status.error_code, "SYNC_FAILED");
        assert!(status.quota.is_none());
    }

    #[test]
    fn stored_account_meta_keeps_provider_account_session_and_display_name() {
        let meta = CursorAccountMeta {
            provider: "cursor".into(),
            account_id: "auth0|user_01KWTPZG4VW30ZF6MKZ2XXM398".into(),
            session_ref: "token-plan/cursor/session/337134d1-f7b1-4fc4-beba-de5bbe030d69".into(),
            display_name: "eve***@hotmail.com".into(),
        };
        let encoded = serde_json::to_string(&meta).expect("encode");
        let decoded: CursorAccountMeta = serde_json::from_str(&encoded).expect("decode");
        assert_eq!(decoded.provider, "cursor");
        assert_eq!(decoded.account_id, meta.account_id);
        assert_eq!(decoded.session_ref, meta.session_ref);
        assert_eq!(decoded.display_name, meta.display_name);
        assert!(!encoded.contains("access_token"));
        assert!(!encoded.contains("refresh_token"));
    }
}
