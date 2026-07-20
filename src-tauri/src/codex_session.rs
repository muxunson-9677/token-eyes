//! Token Eyes orchestration for the official Codex browser login flow.
//!
//! Authentication is owned by OpenAI's `codex app-server`. Token Eyes opens
//! the returned official URL in the system browser and stores only a binding
//! reference plus sanitized authorization/rate-limit state.

use crate::codex_app_server::{AppServerClient, LoginCompletion, SanitizedRateLimits};
use crate::codex_oauth::{
    complete_oauth, fetch_usage, load_tokens, save_tokens, start_oauth_listener, CodexUsageWindow,
    PendingCodexOAuth,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const SESSION_REF_PREFIX: &str = "token-plan/codex/session/";
const MAX_SESSION_SUFFIX_LEN: usize = 80;
const PERCENT_SCALE: f64 = 100.0;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SessionStateCode {
    LoginStarted,
    AwaitingVerification,
    Authorized,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QuotaSyncStatus {
    Idle,
    Success,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodexQuotaWindowDto {
    pub kind: String,
    pub unit: String,
    pub total: f64,
    pub used: f64,
    pub remaining: f64,
    pub percentage: f64,
    pub resets_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodexQuotaDto {
    pub total_quota: f64,
    pub used_quota: f64,
    pub remaining_quota: f64,
    pub quota_windows: Vec<CodexQuotaWindowDto>,
    pub provider_reported_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodexSessionStatus {
    pub connected: bool,
    pub authorized: bool,
    pub session_ref: String,
    pub state_code: SessionStateCode,
    pub quota_sync_status: QuotaSyncStatus,
    pub error_code: String,
    pub error_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quota: Option<CodexQuotaDto>,
}

impl Default for CodexSessionStatus {
    fn default() -> Self {
        Self {
            connected: false,
            authorized: false,
            session_ref: String::new(),
            state_code: SessionStateCode::NotVerified,
            quota_sync_status: QuotaSyncStatus::Idle,
            error_code: String::new(),
            error_message: String::new(),
            quota: None,
        }
    }
}

#[derive(Default)]
pub struct CodexSessionState {
    active_session_ref: Option<String>,
    account_dir: Option<PathBuf>,
    login_id: Option<String>,
    authorized: bool,
    client: Option<AppServerClient>,
    pending_oauth: HashMap<String, PendingCodexOAuth>,
}

pub fn validated_session_suffix(session_ref: &str) -> Result<&str, &'static str> {
    let suffix = session_ref
        .strip_prefix(SESSION_REF_PREFIX)
        .ok_or("session_ref must start with token-plan/codex/session/")?;
    if suffix.is_empty() || suffix.len() > MAX_SESSION_SUFFIX_LEN {
        return Err("session_ref suffix length is invalid");
    }
    if !suffix
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("session_ref suffix contains invalid characters");
    }
    let lowercase = suffix.to_ascii_lowercase();
    if lowercase.contains("cookie")
        || lowercase.contains("bearer")
        || lowercase.starts_with("sk-")
        || lowercase.contains("token")
    {
        return Err("session_ref must be a binding reference, not a credential value");
    }
    Ok(suffix)
}

pub fn validate_session_ref(session_ref: &str) -> Result<(), &'static str> {
    validated_session_suffix(session_ref).map(|_| ())
}

fn account_dir(app: &AppHandle, session_ref: &str) -> Result<PathBuf, String> {
    let suffix = validated_session_suffix(session_ref).map_err(str::to_string)?;
    let root = app
        .path()
        .app_data_dir()
        .map_err(|_| "Unable to resolve Token Eyes application data directory".to_string())?
        .join("codex-accounts");
    Ok(root.join(suffix))
}

fn ensure_client(
    state: &mut CodexSessionState,
    session_ref: &str,
    account_dir: &Path,
) -> Result<bool, String> {
    if state.active_session_ref.as_deref() == Some(session_ref) && state.client.is_some() {
        return Ok(false);
    }
    state.client = None;
    state.login_id = None;
    state.authorized = false;
    state.active_session_ref = None;
    state.account_dir = None;

    let client = AppServerClient::start(account_dir)?;
    state.client = Some(client);
    state.active_session_ref = Some(session_ref.to_string());
    state.account_dir = Some(account_dir.to_path_buf());
    Ok(true)
}

fn basic_status(
    session_ref: &str,
    state_code: SessionStateCode,
    error_code: &str,
    error_message: &str,
) -> CodexSessionStatus {
    CodexSessionStatus {
        connected: false,
        authorized: false,
        session_ref: session_ref.to_string(),
        state_code,
        quota_sync_status: QuotaSyncStatus::Idle,
        error_code: error_code.to_string(),
        error_message: error_message.to_string(),
        quota: None,
    }
}

pub fn map_rate_limits_to_quota(
    rate_limits: &SanitizedRateLimits,
) -> Result<CodexQuotaDto, String> {
    let mut quota_windows = Vec::new();
    for window in &rate_limits.windows {
        if !matches!(window.kind.as_str(), "rolling_5_hour" | "rolling_weekly")
            || !window.used_percent.is_finite()
        {
            continue;
        }
        let used = window.used_percent.clamp(0.0, PERCENT_SCALE);
        quota_windows.push(CodexQuotaWindowDto {
            kind: window.kind.clone(),
            unit: "tokens".to_string(),
            total: PERCENT_SCALE,
            used,
            remaining: PERCENT_SCALE - used,
            percentage: used,
            resets_at: if window.resets_at > 0 {
                window.resets_at.to_string()
            } else {
                String::new()
            },
        });
    }
    if quota_windows.is_empty() {
        return Err("Codex returned no supported quota windows".to_string());
    }
    let primary = quota_windows
        .iter()
        .find(|window| window.kind == "rolling_weekly")
        .or_else(|| quota_windows.last())
        .expect("quota windows checked above");
    Ok(CodexQuotaDto {
        total_quota: primary.total,
        used_quota: primary.used,
        remaining_quota: primary.remaining,
        quota_windows,
        provider_reported_at: String::new(),
    })
}

fn authorized_status(session_ref: &str) -> CodexSessionStatus {
    CodexSessionStatus {
        connected: true,
        authorized: true,
        session_ref: session_ref.to_string(),
        state_code: SessionStateCode::Authorized,
        quota_sync_status: QuotaSyncStatus::Idle,
        error_code: String::new(),
        error_message: String::new(),
        quota: None,
    }
}

fn quota_status(session_ref: &str, quota: CodexQuotaDto) -> CodexSessionStatus {
    CodexSessionStatus {
        connected: true,
        authorized: true,
        session_ref: session_ref.to_string(),
        state_code: SessionStateCode::Connected,
        quota_sync_status: QuotaSyncStatus::Success,
        error_code: String::new(),
        error_message: String::new(),
        quota: Some(quota),
    }
}

fn oauth_windows_to_quota(windows: &[CodexUsageWindow]) -> Result<CodexQuotaDto, String> {
    let limits = SanitizedRateLimits {
        windows: windows
            .iter()
            .map(|window| crate::codex_app_server::SanitizedRateLimitWindow {
                kind: window.kind.clone(),
                used_percent: window.used_percent,
                resets_at: window.resets_at,
            })
            .collect(),
    };
    map_rate_limits_to_quota(&limits)
}

async fn stored_oauth_quota(
    storage: &Path,
    session_ref: &str,
) -> Result<Option<CodexSessionStatus>, String> {
    let Some(tokens) = load_tokens(storage)? else {
        return Ok(None);
    };
    let windows = fetch_usage(&tokens).await?;
    Ok(Some(quota_status(
        session_ref,
        oauth_windows_to_quota(&windows)?,
    )))
}

fn quota_error_status(session_ref: &str) -> CodexSessionStatus {
    CodexSessionStatus {
        connected: true,
        authorized: true,
        session_ref: session_ref.to_string(),
        state_code: SessionStateCode::Authorized,
        quota_sync_status: QuotaSyncStatus::Error,
        error_code: "QUOTA_SYNC_FAILED".to_string(),
        error_message: "授权已完成，但额度同步暂时失败，可稍后重试。".to_string(),
        quota: None,
    }
}

fn reauth_status(session_ref: &str) -> CodexSessionStatus {
    basic_status(
        session_ref,
        SessionStateCode::ReauthRequired,
        "REAUTH_REQUIRED",
        "Codex 官网授权已失效，请重新连接。",
    )
}

fn open_flow(
    app: &AppHandle,
    session_ref: &str,
) -> Result<(CodexSessionStatus, Option<String>), String> {
    let storage = account_dir(app, session_ref)?;
    let managed = app.state::<Mutex<CodexSessionState>>();
    let mut state = managed
        .lock()
        .map_err(|_| "Codex session state is unavailable".to_string())?;
    ensure_client(&mut state, session_ref, &storage)?;

    let already_authorized = state
        .client
        .as_mut()
        .ok_or_else(|| "Codex app-server is unavailable".to_string())?
        .read_account_authorized(true)?;
    if already_authorized {
        state.authorized = true;
        state.login_id = None;
        return Ok((authorized_status(session_ref), None));
    }

    let started = state
        .client
        .as_mut()
        .expect("client initialized above")
        .start_browser_login()?;
    state.login_id = Some(started.login_id);
    state.authorized = false;
    Ok((
        basic_status(
            session_ref,
            SessionStateCode::LoginStarted,
            "LOGIN_STARTED",
            "已在系统默认浏览器打开 OpenAI 官方授权页面。",
        ),
        Some(started.auth_url),
    ))
}

fn verify_flow(app: &AppHandle, session_ref: &str) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    let managed = app.state::<Mutex<CodexSessionState>>();
    let mut state = managed
        .lock()
        .map_err(|_| "Codex session state is unavailable".to_string())?;
    let restarted = ensure_client(&mut state, session_ref, &storage)?;

    if let Some(authorized) = state
        .client
        .as_mut()
        .expect("client initialized above")
        .poll_account_update()
    {
        if authorized {
            state.authorized = true;
            state.login_id = None;
        } else if state.authorized {
            state.authorized = false;
            state.login_id = None;
            return Ok(reauth_status(session_ref));
        }
    }

    if let Some(login_id) = state.login_id.clone() {
        match state
            .client
            .as_mut()
            .expect("client initialized above")
            .poll_login(&login_id)
        {
            LoginCompletion::Succeeded => {
                state.login_id = None;
                state.authorized = true;
            }
            LoginCompletion::Failed => {
                state.login_id = None;
                state.authorized = false;
                return Ok(basic_status(
                    session_ref,
                    SessionStateCode::ReauthRequired,
                    "AUTHORIZATION_FAILED",
                    "OpenAI 官方授权未完成，请重新连接。",
                ));
            }
            LoginCompletion::Pending => {
                return Ok(basic_status(
                    session_ref,
                    SessionStateCode::AwaitingVerification,
                    "AWAITING_VERIFICATION",
                    "等待 OpenAI 官方授权确认。",
                ));
            }
        }
    }

    if state.authorized {
        return Ok(authorized_status(session_ref));
    }

    if !state.authorized {
        let account_authorized = state
            .client
            .as_mut()
            .expect("client initialized above")
            .read_account_authorized(true)?;
        if account_authorized {
            state.authorized = true;
            state.login_id = None;
        } else if restarted {
            return Ok(basic_status(
                session_ref,
                SessionStateCode::SessionNotFound,
                "SESSION_NOT_FOUND",
                "未找到已授权的 Codex 账号，请重新连接。",
            ));
        } else {
            return Ok(basic_status(
                session_ref,
                SessionStateCode::AwaitingVerification,
                "AWAITING_VERIFICATION",
                "等待 OpenAI 官方授权确认。",
            ));
        }
    }

    Ok(authorized_status(session_ref))
}

fn sync_quota_flow(app: &AppHandle, session_ref: &str) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    let managed = app.state::<Mutex<CodexSessionState>>();
    let mut state = managed
        .lock()
        .map_err(|_| "Codex session state is unavailable".to_string())?;
    ensure_client(&mut state, session_ref, &storage)?;

    if let Some(authorized) = state
        .client
        .as_mut()
        .expect("client initialized above")
        .poll_account_update()
    {
        state.authorized = authorized;
    }
    if !state.authorized {
        state.authorized = state
            .client
            .as_mut()
            .expect("client initialized above")
            .read_account_authorized(true)?;
    }
    if !state.authorized {
        return Ok(reauth_status(session_ref));
    }

    let rate_limits = state
        .client
        .as_mut()
        .expect("client initialized above")
        .read_rate_limits();
    match rate_limits.and_then(|limits| map_rate_limits_to_quota(&limits)) {
        Ok(quota) => Ok(quota_status(session_ref, quota)),
        Err(_) => {
            if matches!(
                state
                    .client
                    .as_mut()
                    .expect("client initialized above")
                    .read_account_authorized(true),
                Ok(false)
            ) {
                state.authorized = false;
                Ok(reauth_status(session_ref))
            } else {
                Ok(quota_error_status(session_ref))
            }
        }
    }
}

fn pending_cleanup_allowed(account_check: &Result<bool, String>) -> bool {
    matches!(account_check, Ok(false))
}

fn discard_pending_flow(app: &AppHandle, session_ref: &str) -> Result<bool, String> {
    let storage = account_dir(app, session_ref)?;
    let managed = app.state::<Mutex<CodexSessionState>>();
    let mut state = managed
        .lock()
        .map_err(|_| "Codex session state is unavailable".to_string())?;
    let active = state.active_session_ref.as_deref() == Some(session_ref);
    let mut client = if active { state.client.take() } else { None };
    if client.is_none() && storage.exists() {
        client = AppServerClient::start(&storage).ok();
    }
    let Some(mut client) = client else {
        if active && !storage.exists() {
            state.active_session_ref = None;
            state.account_dir = None;
            state.login_id = None;
            state.authorized = false;
        }
        return Ok(!storage.exists());
    };

    let account_check = client.read_account_authorized(true);
    if !pending_cleanup_allowed(&account_check) {
        if active {
            state.authorized = account_check == Ok(true);
            if state.authorized {
                state.login_id = None;
            }
            state.client = Some(client);
        }
        return Ok(false);
    }

    if active {
        state.active_session_ref = None;
        state.account_dir = None;
        state.login_id = None;
        state.authorized = false;
    }
    drop(state);
    drop(client);
    if storage.exists() {
        std::fs::remove_dir_all(&storage)
            .map_err(|_| "Unable to remove the pending Token Eyes Codex binding".to_string())?;
    }
    Ok(true)
}

async fn open_direct_oauth(
    app: &AppHandle,
    session_ref: &str,
) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    if let Ok(Some(status)) = stored_oauth_quota(&storage, session_ref).await {
        return Ok(status);
    }
    let (pending, auth_url) = start_oauth_listener(session_ref)?;
    {
        let managed = app.state::<Mutex<CodexSessionState>>();
        let mut state = managed
            .lock()
            .map_err(|_| "Codex session state is unavailable".to_string())?;
        state.pending_oauth.insert(session_ref.to_string(), pending);
        state.active_session_ref = Some(session_ref.to_string());
        state.account_dir = Some(storage);
        state.authorized = false;
    }
    app.opener()
        .open_url(&auth_url, None::<String>)
        .map_err(|_| "无法在系统默认浏览器中打开 OpenAI 官方授权页面。".to_string())?;
    Ok(basic_status(
        session_ref,
        SessionStateCode::LoginStarted,
        "LOGIN_STARTED",
        "已在系统默认浏览器打开 OpenAI 官方授权页面。",
    ))
}

async fn verify_direct_oauth(
    app: &AppHandle,
    session_ref: &str,
) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    if let Ok(Some(status)) = stored_oauth_quota(&storage, session_ref).await {
        return Ok(status);
    }
    let pending = {
        let managed = app.state::<Mutex<CodexSessionState>>();
        let mut state = managed
            .lock()
            .map_err(|_| "Codex session state is unavailable".to_string())?;
        state.pending_oauth.remove(session_ref)
    };
    let Some(pending) = pending else {
        return Ok(basic_status(
            session_ref,
            SessionStateCode::SessionNotFound,
            "SESSION_NOT_FOUND",
            "未找到待确认的 Codex 授权，请重新连接。",
        ));
    };
    match complete_oauth(&pending).await {
        Ok(None) => {
            let managed = app.state::<Mutex<CodexSessionState>>();
            managed
                .lock()
                .map_err(|_| "Codex session state is unavailable".to_string())?
                .pending_oauth
                .insert(session_ref.to_string(), pending);
            Ok(basic_status(
                session_ref,
                SessionStateCode::AwaitingVerification,
                "AWAITING_VERIFICATION",
                "等待 OpenAI 官方授权确认。",
            ))
        }
        Ok(Some(tokens)) => {
            save_tokens(&storage, &tokens)?;
            match fetch_usage(&tokens).await {
                Ok(windows) => Ok(quota_status(session_ref, oauth_windows_to_quota(&windows)?)),
                Err(_) => Ok(quota_error_status(session_ref)),
            }
        }
        Err(error) => Ok(basic_status(
            session_ref,
            SessionStateCode::ReauthRequired,
            "AUTHORIZATION_FAILED",
            &error,
        )),
    }
}

async fn sync_direct_oauth(
    app: &AppHandle,
    session_ref: &str,
) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    match stored_oauth_quota(&storage, session_ref).await {
        Ok(Some(status)) => Ok(status),
        Ok(None) => Ok(reauth_status(session_ref)),
        Err(error) => Ok(basic_status(
            session_ref,
            SessionStateCode::ReauthRequired,
            "QUOTA_SYNC_FAILED",
            &error,
        )),
    }
}

fn discard_direct_oauth(app: &AppHandle, session_ref: &str) -> Result<bool, String> {
    let managed = app.state::<Mutex<CodexSessionState>>();
    let mut state = managed
        .lock()
        .map_err(|_| "Codex session state is unavailable".to_string())?;
    Ok(state.pending_oauth.remove(session_ref).is_some())
}

#[tauri::command]
pub async fn open_codex_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    open_direct_oauth(&app, &session_ref).await
}

#[tauri::command]
pub async fn verify_codex_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    verify_direct_oauth(&app, &session_ref).await
}

#[tauri::command]
pub async fn sync_codex_console_quota(
    app: AppHandle,
    session_ref: String,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    sync_direct_oauth(&app, &session_ref).await
}

#[tauri::command]
pub async fn discard_codex_pending_session(
    app: AppHandle,
    session_ref: String,
) -> Result<bool, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    discard_direct_oauth(&app, &session_ref)
}

#[tauri::command]
pub async fn delete_codex_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<(), String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || {
        let storage = account_dir(&app, &session_ref)?;
        let root = storage
            .parent()
            .ok_or_else(|| "Invalid Token Eyes Codex account path".to_string())?
            .to_path_buf();
        if storage == root || !storage.starts_with(&root) {
            return Err("Refusing to remove an invalid Codex account path".to_string());
        }
        let managed = app.state::<Mutex<CodexSessionState>>();
        {
            let mut state = managed
                .lock()
                .map_err(|_| "Codex session state is unavailable".to_string())?;
            state.pending_oauth.remove(&session_ref);
            if state.active_session_ref.as_deref() == Some(session_ref.as_str()) {
                state.active_session_ref = None;
                state.account_dir = None;
                state.login_id = None;
                state.authorized = false;
                state.client = None;
            }
        }
        if storage.exists() {
            std::fs::remove_dir_all(&storage)
                .map_err(|_| "Unable to remove the Token Eyes Codex account binding".to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|_| "Codex disconnect task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codex_app_server::SanitizedRateLimitWindow;

    #[test]
    fn session_ref_accepts_only_a_single_safe_binding_suffix() {
        assert!(validate_session_ref("token-plan/codex/session/abc-123_DEF").is_ok());
        for invalid in [
            "",
            "token-plan/glm/session/abc",
            "token-plan/codex/session/",
            "token-plan/codex/session/../other",
            "token-plan/codex/session/cookie=abc",
            "token-plan/codex/session/Bearer-token",
            "token-plan/codex/session/abc/child",
        ] {
            assert!(validate_session_ref(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn maps_only_sanitized_percent_windows_to_quota() {
        let quota = map_rate_limits_to_quota(&SanitizedRateLimits {
            windows: vec![
                SanitizedRateLimitWindow {
                    kind: "rolling_5_hour".to_string(),
                    used_percent: 25.5,
                    resets_at: 1_783_900_800,
                },
                SanitizedRateLimitWindow {
                    kind: "rolling_weekly".to_string(),
                    used_percent: 50.0,
                    resets_at: 1_784_505_600,
                },
            ],
        })
        .expect("quota should map");
        assert_eq!(quota.quota_windows.len(), 2);
        assert_eq!(quota.total_quota, 100.0);
        assert_eq!(quota.used_quota, 50.0);
        assert_eq!(quota.remaining_quota, 50.0);
    }

    #[test]
    fn authorized_without_quota_is_not_an_auth_failure() {
        let status = CodexSessionStatus {
            connected: true,
            authorized: true,
            session_ref: "token-plan/codex/session/test".to_string(),
            state_code: SessionStateCode::Authorized,
            quota_sync_status: QuotaSyncStatus::Error,
            error_code: "QUOTA_SYNC_FAILED".to_string(),
            error_message: "授权已完成，但额度同步暂时失败，可稍后重试。".to_string(),
            quota: None,
        };
        let serialized = serde_json::to_string(&status).expect("status should serialize");
        assert!(serialized.contains("\"authorized\":true"));
        assert!(serialized.contains("\"state_code\":\"authorized\""));
        for forbidden in [
            "authorization",
            "cookie",
            "token=",
            "raw_response",
            "headers",
        ] {
            assert!(!serialized.contains(forbidden));
        }
    }

    #[test]
    fn pending_cleanup_requires_a_confirmed_unauthorized_account() {
        assert!(pending_cleanup_allowed(&Ok(false)));
        assert!(!pending_cleanup_allowed(&Ok(true)));
        assert!(!pending_cleanup_allowed(&Err(
            "account check failed".to_string()
        )));
    }
}
