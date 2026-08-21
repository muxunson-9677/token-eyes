//! Token Eyes orchestration for the official Codex browser login flow.
//!
//! Authentication is owned by OpenAI's `codex app-server`. Token Eyes opens
//! the returned official URL in the system browser and stores only a binding
//! reference plus sanitized authorization/rate-limit state.

use crate::codex_app_server::{
    validate_auth_url, AppServerClient, AppServerOps, AppServerStartError, LoginCompletion,
    SanitizedRateLimits,
};
use crate::codex_oauth::{
    account_label_from_id_token, complete_oauth, fetch_usage, load_tokens, refresh_tokens,
    save_tokens, start_oauth_listener, subscription_expires_at_from_id_token, CodexUsageWindow,
    PendingCodexOAuth, StoredCodexTokens,
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
    Disconnected,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CodexCancelReason {
    UserCancelled,
    Timeout,
}

impl<'de> Deserialize<'de> for CodexCancelReason {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        match String::deserialize(deserializer)?.as_str() {
            "user_cancelled" => Ok(Self::UserCancelled),
            "timeout" => Ok(Self::Timeout),
            _ => Err(serde::de::Error::custom(
                "unsupported Codex cancellation reason",
            )),
        }
    }
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
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub account_label: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub subscription_expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CodexSessionStatus {
    pub connected: bool,
    pub authorized: bool,
    pub legacy_auth_present: bool,
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
            legacy_auth_present: false,
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
    auth_url: Option<String>,
    authorized: bool,
    client: Option<Box<dyn AppServerOps>>,
    pending_oauth: HashMap<String, PendingCodexOAuth>,
}

pub fn validated_session_suffix(session_ref: &str) -> Result<&str, &'static str> {
    let suffix = session_ref
        .strip_prefix(SESSION_REF_PREFIX)
        .ok_or("session_ref must start with token-plan/codex/session/")?;
    if suffix.is_empty() || suffix.len() > MAX_SESSION_SUFFIX_LEN {
        return Err("session_ref suffix length is invalid");
    }
    if !suffix.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || matches!(character, '-' | '_')
    }) {
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
) -> Result<bool, AppServerStartError> {
    ensure_client_with(state, session_ref, account_dir, |path| {
        AppServerClient::start(path).map(|client| Box::new(client) as Box<dyn AppServerOps>)
    })
}

fn ensure_client_with<F>(
    state: &mut CodexSessionState,
    session_ref: &str,
    account_dir: &Path,
    start_client: F,
) -> Result<bool, AppServerStartError>
where
    F: FnOnce(&Path) -> Result<Box<dyn AppServerOps>, AppServerStartError>,
{
    if state.active_session_ref.as_deref() == Some(session_ref) && state.client.is_some() {
        return Ok(false);
    }
    state.client = None;
    state.login_id = None;
    state.auth_url = None;
    state.authorized = false;
    state.active_session_ref = None;
    state.account_dir = None;

    let client = start_client(account_dir)?;
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
        legacy_auth_present: false,
        session_ref: session_ref.to_string(),
        state_code,
        quota_sync_status: QuotaSyncStatus::Idle,
        error_code: error_code.to_string(),
        error_message: error_message.to_string(),
        quota: None,
    }
}

fn app_server_start_error_status(
    session_ref: &str,
    error: AppServerStartError,
) -> CodexSessionStatus {
    let (error_code, error_message) = match error {
        AppServerStartError::ComponentMissing => (
            "CODEX_COMPONENT_MISSING",
            "未找到 OpenAI 官方 Codex 组件，请先安装或更新 Codex CLI。",
        ),
        AppServerStartError::CredentialStoreUnavailable => (
            "CODEX_CREDENTIAL_STORE_UNAVAILABLE",
            "系统安全凭据存储当前不可用，Codex 授权已停止。",
        ),
        AppServerStartError::Other(_) => (
            "AUTHORIZATION_FAILED",
            "无法启动 OpenAI 官方 Codex 授权组件，请稍后重试。",
        ),
    };
    basic_status(
        session_ref,
        SessionStateCode::Failed,
        error_code,
        error_message,
    )
}

pub fn map_rate_limits_to_quota(
    rate_limits: &SanitizedRateLimits,
) -> Result<CodexQuotaDto, String> {
    let mut quota_windows = Vec::new();
    for window in &rate_limits.windows {
        if !window.used_percent.is_finite() {
            continue;
        }
        let used = window.used_percent.clamp(0.0, PERCENT_SCALE);
        quota_windows.push(CodexQuotaWindowDto {
            kind: window.kind.clone(),
            unit: "percent".to_string(),
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
        account_label: String::new(),
        subscription_expires_at: String::new(),
    })
}

fn authorized_status(session_ref: &str) -> CodexSessionStatus {
    CodexSessionStatus {
        connected: true,
        authorized: true,
        legacy_auth_present: false,
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
        legacy_auth_present: false,
        session_ref: session_ref.to_string(),
        state_code: SessionStateCode::Connected,
        quota_sync_status: QuotaSyncStatus::Success,
        error_code: String::new(),
        error_message: String::new(),
        quota: Some(quota),
    }
}

fn quota_error_status(session_ref: &str) -> CodexSessionStatus {
    CodexSessionStatus {
        connected: true,
        authorized: true,
        legacy_auth_present: false,
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

fn authorization_failure_status(session_ref: &str) -> CodexSessionStatus {
    basic_status(
        session_ref,
        SessionStateCode::Failed,
        "AUTHORIZATION_FAILED",
        "OpenAI 官方授权暂时无法完成，请重新连接。",
    )
}

fn status_with_legacy_auth(mut status: CodexSessionStatus, storage: &Path) -> CodexSessionStatus {
    status.legacy_auth_present = storage.join("auth.json").is_file();
    status
}

fn clear_session_state(state: &mut CodexSessionState) {
    state.login_id = None;
    state.auth_url = None;
    state.authorized = false;
    state.active_session_ref = None;
    state.account_dir = None;
    state.client = None;
}

fn reconcile_unopened_login(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    failure_status: CodexSessionStatus,
) -> CodexSessionStatus {
    let login_id = state.login_id.clone();
    let account_check = if let Some(client) = state.client.as_mut() {
        if let Some(login_id) = login_id.as_deref() {
            let _ = client.cancel_login(login_id);
        }
        client.read_account_authorized(true)
    } else {
        Err("app-server unavailable".to_string())
    };

    state.login_id = None;
    state.auth_url = None;
    if account_check == Ok(true) {
        state.authorized = true;
        return status_with_legacy_auth(authorized_status(session_ref), storage);
    }

    clear_session_state(state);
    status_with_legacy_auth(failure_status, storage)
}

fn open_flow_core<F>(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    open_url: F,
) -> Result<CodexSessionStatus, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    open_flow_core_with_start(state, session_ref, storage, open_url, |path| {
        AppServerClient::start(path).map(|client| Box::new(client) as Box<dyn AppServerOps>)
    })
}

fn open_flow_core_with_start<F, S>(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    open_url: F,
    start_client: S,
) -> Result<CodexSessionStatus, String>
where
    F: FnMut(&str) -> Result<(), String>,
    S: FnOnce(&Path) -> Result<Box<dyn AppServerOps>, AppServerStartError>,
{
    if let Err(error) = ensure_client_with(state, session_ref, storage, start_client) {
        return Ok(status_with_legacy_auth(
            app_server_start_error_status(session_ref, error),
            storage,
        ));
    }

    let already_authorized = match state
        .client
        .as_mut()
        .ok_or_else(|| "Codex app-server is unavailable".to_string())?
        .read_account_authorized(true)
    {
        Ok(authorized) => authorized,
        Err(_) => {
            clear_session_state(state);
            return Ok(status_with_legacy_auth(
                authorization_failure_status(session_ref),
                storage,
            ));
        }
    };
    if already_authorized {
        state.authorized = true;
        state.login_id = None;
        state.auth_url = None;
        return Ok(status_with_legacy_auth(
            authorized_status(session_ref),
            storage,
        ));
    }

    start_browser_login_flow(state, session_ref, storage, open_url)
}

fn start_browser_login_flow<F>(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    mut open_url: F,
) -> Result<CodexSessionStatus, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let started = match state
        .client
        .as_mut()
        .expect("client initialized above")
        .start_browser_login()
    {
        Ok(started) => started,
        Err(_) => {
            clear_session_state(state);
            return Ok(status_with_legacy_auth(
                authorization_failure_status(session_ref),
                storage,
            ));
        }
    };
    state.login_id = Some(started.login_id.clone());
    state.auth_url = Some(started.auth_url.clone());
    state.authorized = false;
    if !validate_auth_url(&started.auth_url) {
        return Ok(reconcile_unopened_login(
            state,
            session_ref,
            storage,
            basic_status(
                session_ref,
                SessionStateCode::Failed,
                "AUTHORIZATION_FAILED",
                "Codex 返回了不受信任的授权地址，已停止本次授权。",
            ),
        ));
    }
    if open_url(&started.auth_url).is_err() {
        return Ok(reconcile_unopened_login(
            state,
            session_ref,
            storage,
            basic_status(
                session_ref,
                SessionStateCode::Failed,
                "BROWSER_OPEN_FAILED",
                "无法在系统默认浏览器中打开 OpenAI 官方授权页面。",
            ),
        ));
    }
    Ok(status_with_legacy_auth(
        basic_status(session_ref, SessionStateCode::LoginStarted, "", ""),
        storage,
    ))
}

fn reauthorize_flow_core<F>(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    open_url: F,
) -> Result<CodexSessionStatus, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    if let Err(error) = ensure_client(state, session_ref, storage) {
        return Ok(status_with_legacy_auth(
            app_server_start_error_status(session_ref, error),
            storage,
        ));
    }
    if let Some(login_id) = state.login_id.take() {
        if let Some(client) = state.client.as_mut() {
            let _ = client.cancel_login(&login_id);
        }
    }
    state.auth_url = None;
    state.authorized = false;
    start_browser_login_flow(state, session_ref, storage, open_url)
}

fn reopen_flow_core<F>(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    mut open_url: F,
) -> Result<CodexSessionStatus, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let session_not_found = || {
        status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::SessionNotFound,
                "SESSION_NOT_FOUND",
                "未找到正在等待验证的 Codex 授权，请重新连接。",
            ),
            storage,
        )
    };

    if state.active_session_ref.as_deref() != Some(session_ref)
        || state.account_dir.as_deref() != Some(storage)
    {
        return Ok(session_not_found());
    }

    if state.authorized && state.client.is_some() {
        state.login_id = None;
        state.auth_url = None;
        return Ok(status_with_legacy_auth(
            authorized_status(session_ref),
            storage,
        ));
    }
    if state.authorized {
        return Ok(session_not_found());
    }

    if state.client.is_none() || state.login_id.is_none() || state.auth_url.is_none() {
        let login_id = state.login_id.clone();
        if let (Some(client), Some(login_id)) = (state.client.as_mut(), login_id.as_deref()) {
            let _ = client.cancel_login(login_id);
        }
        clear_session_state(state);
        return Ok(session_not_found());
    }

    let Some((login_id, auth_url)) = state.login_id.clone().zip(state.auth_url.clone()) else {
        return Ok(session_not_found());
    };

    if !validate_auth_url(&auth_url) {
        if let Some(client) = state.client.as_mut() {
            let _ = client.cancel_login(&login_id);
        }
        clear_session_state(state);
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::Failed,
                "AUTHORIZATION_FAILED",
                "Codex 返回了不受信任的授权地址，已停止本次授权。",
            ),
            storage,
        ));
    }

    if open_url(&auth_url).is_err() {
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::Failed,
                "BROWSER_OPEN_FAILED",
                "无法在系统默认浏览器中重新打开 OpenAI 官方授权页面。",
            ),
            storage,
        ));
    }

    Ok(status_with_legacy_auth(
        basic_status(session_ref, SessionStateCode::AwaitingVerification, "", ""),
        storage,
    ))
}

fn verify_flow_core(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
) -> Result<CodexSessionStatus, String> {
    verify_flow_core_with_start(state, session_ref, storage, |path| {
        AppServerClient::start(path).map(|client| Box::new(client) as Box<dyn AppServerOps>)
    })
}

fn verify_flow_core_with_start<S>(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    start_client: S,
) -> Result<CodexSessionStatus, String>
where
    S: FnOnce(&Path) -> Result<Box<dyn AppServerOps>, AppServerStartError>,
{
    let restarted = match ensure_client_with(state, session_ref, storage, start_client) {
        Ok(restarted) => restarted,
        Err(error) => {
            return Ok(status_with_legacy_auth(
                app_server_start_error_status(session_ref, error),
                storage,
            ))
        }
    };

    let mut login_pending = false;
    if let Some(login_id) = state.login_id.clone() {
        match state
            .client
            .as_mut()
            .expect("client initialized above")
            .poll_login(&login_id)
        {
            LoginCompletion::Succeeded => {
                state.login_id = None;
                state.auth_url = None;
                state.authorized = true;
            }
            LoginCompletion::Failed => {
                clear_session_state(state);
                return Ok(status_with_legacy_auth(
                    authorization_failure_status(session_ref),
                    storage,
                ));
            }
            LoginCompletion::Pending => {
                login_pending = true;
            }
        }
    }

    if state.authorized {
        return Ok(status_with_legacy_auth(
            authorized_status(session_ref),
            storage,
        ));
    }

    if !state.authorized {
        let account_authorized = match state
            .client
            .as_mut()
            .expect("client initialized above")
            .read_account_authorized(true)
        {
            Ok(authorized) => authorized,
            Err(_) => {
                let status =
                    status_with_legacy_auth(authorization_failure_status(session_ref), storage);
                clear_session_state(state);
                return Ok(status);
            }
        };
        if account_authorized {
            state.authorized = true;
            state.login_id = None;
            state.auth_url = None;
        } else if restarted && !login_pending {
            let status = status_with_legacy_auth(
                basic_status(
                    session_ref,
                    SessionStateCode::SessionNotFound,
                    "SESSION_NOT_FOUND",
                    "未找到已授权的 Codex 账号，请重新连接。",
                ),
                storage,
            );
            clear_session_state(state);
            return Ok(status);
        } else {
            return Ok(status_with_legacy_auth(
                basic_status(
                    session_ref,
                    SessionStateCode::AwaitingVerification,
                    "AWAITING_VERIFICATION",
                    "等待 OpenAI 官方授权确认。",
                ),
                storage,
            ));
        }
    }

    Ok(status_with_legacy_auth(
        authorized_status(session_ref),
        storage,
    ))
}

fn sync_quota_flow_core(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
) -> Result<CodexSessionStatus, String> {
    if let Err(error) = ensure_client(state, session_ref, storage) {
        return Ok(status_with_legacy_auth(
            app_server_start_error_status(session_ref, error),
            storage,
        ));
    }

    let rate_limits = state
        .client
        .as_mut()
        .expect("client initialized above")
        .read_rate_limits();
    match rate_limits.and_then(|limits| map_rate_limits_to_quota(&limits)) {
        Ok(quota) => {
            state.authorized = true;
            state.login_id = None;
            state.auth_url = None;
            Ok(status_with_legacy_auth(
                quota_status(session_ref, quota),
                storage,
            ))
        }
        Err(_) => {
            if matches!(
                state
                    .client
                    .as_mut()
                    .expect("client initialized above")
                    .read_account_authorized(true),
                Ok(false)
            ) {
                clear_session_state(state);
                Ok(status_with_legacy_auth(reauth_status(session_ref), storage))
            } else {
                state.authorized = true;
                Ok(status_with_legacy_auth(
                    quota_error_status(session_ref),
                    storage,
                ))
            }
        }
    }
}

fn cancel_flow_core(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    reason: CodexCancelReason,
) -> Result<CodexSessionStatus, String> {
    if state.active_session_ref.as_deref() != Some(session_ref) {
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::SessionNotFound,
                "SESSION_NOT_FOUND",
                "未找到待取消的 Codex 授权。",
            ),
            storage,
        ));
    }
    if state.client.is_none() {
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::SessionNotFound,
                "SESSION_NOT_FOUND",
                "未找到待取消的 Codex 授权。",
            ),
            storage,
        ));
    }

    let login_id = state.login_id.clone();
    let account_check = {
        let client = state.client.as_mut().expect("client checked above");
        if let Some(login_id) = login_id.as_deref() {
            let _ = client.cancel_login(login_id);
        }
        client.read_account_authorized(true)
    };

    match account_check {
        Ok(true) => {
            state.authorized = true;
            state.login_id = None;
            state.auth_url = None;
            Ok(status_with_legacy_auth(
                authorized_status(session_ref),
                storage,
            ))
        }
        Ok(false) if login_id.is_some() => {
            let (error_code, error_message) = match reason {
                CodexCancelReason::UserCancelled => {
                    ("AUTHORIZATION_CANCELLED", "已取消 Codex 授权。")
                }
                CodexCancelReason::Timeout => (
                    "AUTHORIZATION_TIMEOUT",
                    "等待 OpenAI 官方授权超时，已结束本次授权。",
                ),
            };
            clear_session_state(state);
            Ok(status_with_legacy_auth(
                basic_status(
                    session_ref,
                    SessionStateCode::Failed,
                    error_code,
                    error_message,
                ),
                storage,
            ))
        }
        Ok(false) | Err(_) => Ok(status_with_legacy_auth(
            authorization_failure_status(session_ref),
            storage,
        )),
    }
}

fn oauth_windows_to_quota(windows: &[CodexUsageWindow]) -> Result<CodexQuotaDto, String> {
    let sanitized = SanitizedRateLimits {
        windows: windows
            .iter()
            .map(|window| crate::codex_app_server::SanitizedRateLimitWindow {
                kind: window.kind.clone(),
                used_percent: window.used_percent,
                resets_at: window.resets_at,
            })
            .collect(),
    };
    map_rate_limits_to_quota(&sanitized)
}

fn enrich_quota_from_tokens(quota: &mut CodexQuotaDto, tokens: &StoredCodexTokens) {
    quota.account_label = account_label_from_id_token(&tokens.id_token).unwrap_or_default();
    quota.subscription_expires_at =
        subscription_expires_at_from_id_token(&tokens.id_token).unwrap_or_default();
}

async fn status_from_managed_oauth(
    storage: &Path,
    session_ref: &str,
) -> Result<Option<CodexSessionStatus>, String> {
    let Some(tokens) = load_tokens(storage)? else {
        return Ok(None);
    };
    match fetch_usage(&tokens).await {
        Ok(windows) => {
            let mut quota = oauth_windows_to_quota(&windows)?;
            enrich_quota_from_tokens(&mut quota, &tokens);
            Ok(Some(status_with_legacy_auth(
                quota_status(session_ref, quota),
                storage,
            )))
        }
        Err(error) if error.contains("expired") => match refresh_tokens(&tokens).await {
            Ok(refreshed) => {
                save_tokens(storage, &refreshed)?;
                match fetch_usage(&refreshed).await {
                    Ok(windows) => {
                        let mut quota = oauth_windows_to_quota(&windows)?;
                        enrich_quota_from_tokens(&mut quota, &refreshed);
                        Ok(Some(status_with_legacy_auth(
                            quota_status(session_ref, quota),
                            storage,
                        )))
                    }
                    Err(_) => Ok(Some(status_with_legacy_auth(
                        quota_error_status(session_ref),
                        storage,
                    ))),
                }
            }
            Err(_) => Ok(Some(status_with_legacy_auth(
                reauth_status(session_ref),
                storage,
            ))),
        },
        Err(_) => Ok(Some(status_with_legacy_auth(
            quota_error_status(session_ref),
            storage,
        ))),
    }
}

async fn start_direct_oauth(
    app: &AppHandle,
    session_ref: &str,
    force_reauthorize: bool,
) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    if !force_reauthorize {
        if let Some(status) = status_from_managed_oauth(&storage, session_ref).await? {
            if status.state_code != SessionStateCode::ReauthRequired {
                return Ok(status);
            }
        }
    }

    let (pending, auth_url) = start_oauth_listener(session_ref)?;
    {
        let managed = app.state::<Mutex<CodexSessionState>>();
        let mut state = managed
            .lock()
            .map_err(|_| "Codex session state is unavailable".to_string())?;
        state.pending_oauth.remove(session_ref);
        state.pending_oauth.insert(session_ref.to_string(), pending);
        state.active_session_ref = Some(session_ref.to_string());
        state.account_dir = Some(storage.clone());
        state.authorized = false;
        state.login_id = None;
        state.auth_url = None;
    }

    if app.opener().open_url(&auth_url, None::<String>).is_err() {
        let managed = app.state::<Mutex<CodexSessionState>>();
        if let Ok(mut state) = managed.lock() {
            state.pending_oauth.remove(session_ref);
            if state.active_session_ref.as_deref() == Some(session_ref) {
                clear_session_state(&mut state);
            }
        }
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::Failed,
                "BROWSER_OPEN_FAILED",
                "无法在系统默认浏览器中打开 OpenAI 官方授权页面。",
            ),
            &storage,
        ));
    }

    Ok(status_with_legacy_auth(
        basic_status(session_ref, SessionStateCode::LoginStarted, "", ""),
        &storage,
    ))
}

async fn verify_direct_oauth(
    app: &AppHandle,
    session_ref: &str,
) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    let pending = {
        let managed = app.state::<Mutex<CodexSessionState>>();
        let mut state = managed
            .lock()
            .map_err(|_| "Codex session state is unavailable".to_string())?;
        state.pending_oauth.remove(session_ref)
    };

    let Some(pending) = pending else {
        if let Some(status) = status_from_managed_oauth(&storage, session_ref).await? {
            return Ok(status);
        }
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::SessionNotFound,
                "SESSION_NOT_FOUND",
                "未找到待确认的 Codex 授权，请重新连接。",
            ),
            &storage,
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
            Ok(status_with_legacy_auth(
                basic_status(
                    session_ref,
                    SessionStateCode::AwaitingVerification,
                    "AWAITING_VERIFICATION",
                    "等待 OpenAI 官方授权确认。",
                ),
                &storage,
            ))
        }
        Ok(Some(tokens)) => {
            save_tokens(&storage, &tokens)?;
            {
                let managed = app.state::<Mutex<CodexSessionState>>();
                if let Ok(mut state) = managed.lock() {
                    state.authorized = true;
                    state.active_session_ref = Some(session_ref.to_string());
                    state.account_dir = Some(storage.clone());
                };
            }
            Ok(status_from_managed_oauth(&storage, session_ref)
                .await?
                .unwrap_or_else(|| quota_error_status(session_ref)))
        }
        Err(_) => Ok(status_with_legacy_auth(
            authorization_failure_status(session_ref),
            &storage,
        )),
    }
}

async fn sync_direct_oauth(
    app: &AppHandle,
    session_ref: &str,
) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    Ok(status_from_managed_oauth(&storage, session_ref)
        .await?
        .unwrap_or_else(|| status_with_legacy_auth(reauth_status(session_ref), &storage)))
}

fn reopen_direct_oauth(app: &AppHandle, session_ref: &str) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    let auth_url = {
        let managed = app.state::<Mutex<CodexSessionState>>();
        let state = managed
            .lock()
            .map_err(|_| "Codex session state is unavailable".to_string())?;
        state
            .pending_oauth
            .get(session_ref)
            .map(PendingCodexOAuth::authorize_url)
    };
    let Some(auth_url) = auth_url else {
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::SessionNotFound,
                "SESSION_NOT_FOUND",
                "未找到正在等待验证的 Codex 授权，请重新连接。",
            ),
            &storage,
        ));
    };
    if app.opener().open_url(&auth_url, None::<String>).is_err() {
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::Failed,
                "BROWSER_OPEN_FAILED",
                "无法在系统默认浏览器中重新打开 OpenAI 官方授权页面。",
            ),
            &storage,
        ));
    }
    Ok(status_with_legacy_auth(
        basic_status(
            session_ref,
            SessionStateCode::AwaitingVerification,
            "AWAITING_VERIFICATION",
            "等待 OpenAI 官方授权确认。",
        ),
        &storage,
    ))
}

fn cancel_direct_oauth(
    app: &AppHandle,
    session_ref: &str,
    reason: CodexCancelReason,
) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    let removed = app
        .state::<Mutex<CodexSessionState>>()
        .lock()
        .map_err(|_| "Codex session state is unavailable".to_string())?
        .pending_oauth
        .remove(session_ref)
        .is_some();
    if !removed {
        return Ok(status_with_legacy_auth(
            basic_status(
                session_ref,
                SessionStateCode::SessionNotFound,
                "SESSION_NOT_FOUND",
                "未找到待取消的 Codex 授权。",
            ),
            &storage,
        ));
    }
    let (error_code, error_message) = match reason {
        CodexCancelReason::UserCancelled => ("AUTHORIZATION_CANCELLED", "已取消 Codex 授权。"),
        CodexCancelReason::Timeout => (
            "AUTHORIZATION_TIMEOUT",
            "等待 OpenAI 官方授权超时，已结束本次授权。",
        ),
    };
    Ok(status_with_legacy_auth(
        basic_status(
            session_ref,
            SessionStateCode::Failed,
            error_code,
            error_message,
        ),
        &storage,
    ))
}

#[tauri::command]
pub async fn open_codex_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    start_direct_oauth(&app, &session_ref, false).await
}

#[tauri::command]
pub async fn reauthorize_codex_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    start_direct_oauth(&app, &session_ref, true).await
}

#[tauri::command]
pub async fn reopen_codex_console_login(
    app: AppHandle,
    session_ref: String,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || reopen_direct_oauth(&app, &session_ref))
        .await
        .map_err(|_| "Codex login reopen task failed".to_string())?
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
pub async fn cancel_codex_console_login(
    app: AppHandle,
    session_ref: String,
    reason: CodexCancelReason,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || cancel_direct_oauth(&app, &session_ref, reason))
        .await
        .map_err(|_| "Codex cancellation task failed".to_string())?
}

fn disconnected_status(session_ref: &str) -> CodexSessionStatus {
    basic_status(session_ref, SessionStateCode::Disconnected, "", "")
}

fn binding_cleanup_failure_status(session_ref: &str, storage: &Path) -> CodexSessionStatus {
    status_with_legacy_auth(
        basic_status(
            session_ref,
            SessionStateCode::Failed,
            "CODEX_LOCAL_BINDING_DELETE_FAILED",
            "Token Eyes 本地账号绑定清理失败；请重试删除连接。",
        ),
        storage,
    )
}

fn disconnect_flow_core<F>(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    mut remove_binding: F,
) -> Result<CodexSessionStatus, String>
where
    F: FnMut(&Path) -> Result<(), String>,
{
    let owns_active_binding = state.active_session_ref.as_deref() == Some(session_ref)
        && state.account_dir.as_deref() == Some(storage);
    state.pending_oauth.remove(session_ref);
    if owns_active_binding {
        if let (Some(login_id), Some(client)) = (state.login_id.as_deref(), state.client.as_mut()) {
            let _ = client.cancel_login(login_id);
        }
        let client = state.client.take();
        drop(client);
        state.login_id = None;
        state.auth_url = None;
        state.authorized = false;
        state.active_session_ref = None;
        state.account_dir = None;
    }

    if storage.exists() && remove_binding(storage).is_err() {
        return Ok(binding_cleanup_failure_status(session_ref, storage));
    }
    Ok(disconnected_status(session_ref))
}

fn disconnect_flow(app: &AppHandle, session_ref: &str) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    let root = storage
        .parent()
        .ok_or_else(|| "Invalid Token Eyes Codex account path".to_string())?
        .to_path_buf();
    if storage == root || !storage.starts_with(&root) {
        return Err("Refusing to remove an invalid Codex account path".to_string());
    }
    let managed = app.state::<Mutex<CodexSessionState>>();
    let mut state = managed
        .lock()
        .map_err(|_| "Codex session state is unavailable".to_string())?;
    disconnect_flow_core(&mut state, session_ref, &storage, |path| {
        std::fs::remove_dir_all(path)
            .map_err(|_| "Unable to remove the Token Eyes Codex account binding".to_string())
    })
}

fn legacy_cleanup_failure_status(session_ref: &str, storage: &Path) -> CodexSessionStatus {
    let mut status = authorized_status(session_ref);
    status.error_code = "LEGACY_CREDENTIAL_CLEANUP_FAILED".to_string();
    status.error_message = "旧版 Codex 凭据文件未删除；当前账号绑定保持不变。".to_string();
    status_with_legacy_auth(status, storage)
}

fn cleanup_legacy_codex_auth_file_flow(
    app: &AppHandle,
    session_ref: &str,
) -> Result<CodexSessionStatus, String> {
    let storage = account_dir(app, session_ref)?;
    if load_tokens(&storage)?.is_none() {
        return Ok(legacy_cleanup_failure_status(session_ref, &storage));
    }
    let legacy_auth = storage.join("auth.json");
    if !legacy_auth.is_file() || std::fs::remove_file(&legacy_auth).is_err() {
        return Ok(legacy_cleanup_failure_status(session_ref, &storage));
    }
    let mut status = authorized_status(session_ref);
    status.legacy_auth_present = false;
    Ok(status)
}

fn cleanup_legacy_codex_auth_file_core<F>(
    state: &mut CodexSessionState,
    session_ref: &str,
    storage: &Path,
    mut remove_file: F,
) -> Result<CodexSessionStatus, String>
where
    F: FnMut(&Path) -> Result<(), String>,
{
    let legacy_auth = storage.join("auth.json");
    if state.active_session_ref.as_deref() != Some(session_ref)
        || state.account_dir.as_deref() != Some(storage)
        || state.client.is_none()
        || !legacy_auth.is_file()
    {
        return Ok(legacy_cleanup_failure_status(session_ref, storage));
    }

    let prerequisites_satisfied = {
        let client = state.client.as_mut().expect("client checked above");
        client.read_account_authorized(true) == Ok(true) && client.read_rate_limits().is_ok()
    };
    if !prerequisites_satisfied {
        state.authorized = true;
        return Ok(legacy_cleanup_failure_status(session_ref, storage));
    }

    if remove_file(&legacy_auth).is_err() {
        state.authorized = true;
        return Ok(legacy_cleanup_failure_status(session_ref, storage));
    }
    state.authorized = true;
    Ok(status_with_legacy_auth(
        authorized_status(session_ref),
        storage,
    ))
}

#[tauri::command]
pub async fn cleanup_legacy_codex_auth_file(
    app: AppHandle,
    session_ref: String,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_legacy_codex_auth_file_flow(&app, &session_ref)
    })
    .await
    .map_err(|_| "Codex legacy credential cleanup task failed".to_string())?
}

#[tauri::command]
pub async fn delete_codex_console_session(
    app: AppHandle,
    session_ref: String,
) -> Result<CodexSessionStatus, String> {
    validate_session_ref(&session_ref).map_err(str::to_string)?;
    tauri::async_runtime::spawn_blocking(move || disconnect_flow(&app, &session_ref))
        .await
        .map_err(|_| "Codex disconnect task failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codex_app_server::{
        AppServerStartError, BrowserLoginStart, SanitizedRateLimitWindow,
    };
    use std::collections::VecDeque;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum AppServerCall {
        ReadAccount(bool),
        StartLogin,
        PollLogin(String),
        ReadRateLimits,
        CancelLogin(String),
    }

    #[derive(Default)]
    struct FakeAppServer {
        calls: Arc<Mutex<Vec<AppServerCall>>>,
        account_reads: VecDeque<Result<bool, String>>,
        login_starts: VecDeque<Result<BrowserLoginStart, String>>,
        login_completions: VecDeque<LoginCompletion>,
        rate_limits: VecDeque<Result<SanitizedRateLimits, String>>,
        cancel_results: VecDeque<Result<(), String>>,
    }

    impl FakeAppServer {
        fn record(&self, call: AppServerCall) {
            self.calls.lock().expect("call log should lock").push(call);
        }
    }

    impl AppServerOps for FakeAppServer {
        fn read_account_authorized(&mut self, refresh_token: bool) -> Result<bool, String> {
            self.record(AppServerCall::ReadAccount(refresh_token));
            self.account_reads
                .pop_front()
                .unwrap_or_else(|| Err("unexpected account/read".to_string()))
        }

        fn start_browser_login(&mut self) -> Result<BrowserLoginStart, String> {
            self.record(AppServerCall::StartLogin);
            self.login_starts
                .pop_front()
                .unwrap_or_else(|| Err("unexpected account/login/start".to_string()))
        }

        fn poll_login(&mut self, expected_login_id: &str) -> LoginCompletion {
            self.record(AppServerCall::PollLogin(expected_login_id.to_string()));
            self.login_completions
                .pop_front()
                .expect("unexpected account/login/completed poll")
        }

        fn read_rate_limits(&mut self) -> Result<SanitizedRateLimits, String> {
            self.record(AppServerCall::ReadRateLimits);
            self.rate_limits
                .pop_front()
                .unwrap_or_else(|| Err("unexpected account/rateLimits/read".to_string()))
        }

        fn cancel_login(&mut self, login_id: &str) -> Result<(), String> {
            self.record(AppServerCall::CancelLogin(login_id.to_string()));
            self.cancel_results
                .pop_front()
                .expect("unexpected account/login/cancel")
        }
    }

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            for attempt in 0..32 {
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("system clock should follow the Unix epoch")
                    .as_nanos();
                let path = std::env::temp_dir().join(format!(
                    "token-eyes-codex-{label}-{}-{timestamp}-{}-{attempt}",
                    std::process::id(),
                    NEXT.fetch_add(1, Ordering::Relaxed)
                ));
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("test directory should be created: {error}"),
                }
            }
            panic!("unable to allocate a unique test directory")
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn state_with_fake(
        session_ref: &str,
        storage: &Path,
        fake: FakeAppServer,
    ) -> CodexSessionState {
        CodexSessionState {
            active_session_ref: Some(session_ref.to_string()),
            account_dir: Some(storage.to_path_buf()),
            client: Some(Box::new(fake)),
            ..CodexSessionState::default()
        }
    }

    fn supported_rate_limits() -> SanitizedRateLimits {
        SanitizedRateLimits {
            windows: vec![SanitizedRateLimitWindow {
                kind: "rolling_weekly".to_string(),
                used_percent: 25.0,
                resets_at: 1_784_505_600,
            }],
        }
    }

    #[test]
    fn component_missing_start_error_maps_to_the_stable_component_code() {
        let status = app_server_start_error_status(
            "token-plan/codex/session/component-missing",
            AppServerStartError::ComponentMissing,
        );

        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "CODEX_COMPONENT_MISSING");
        assert!(!status.authorized);
        assert!(!status.connected);
    }

    #[test]
    fn typed_credential_store_error_maps_to_the_specialized_stable_code() {
        let status = app_server_start_error_status(
            "token-plan/codex/session/keyring-unavailable",
            AppServerStartError::CredentialStoreUnavailable,
        );

        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "CODEX_CREDENTIAL_STORE_UNAVAILABLE");
        assert!(!status.authorized);
        assert!(!status.connected);
    }

    #[test]
    fn generic_start_error_text_never_guesses_a_credential_store_type() {
        let status = app_server_start_error_status(
            "token-plan/codex/session/generic-start-error",
            AppServerStartError::Other(
                "synthetic upstream text mentions keyring credential store".to_string(),
            ),
        );

        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_FAILED");
        assert!(!status.error_message.contains("keyring"));
        assert!(!status.error_message.contains("credential store"));
    }

    #[test]
    fn open_flow_maps_typed_start_failure_from_the_production_start_seam() {
        let session_ref = "token-plan/codex/session/start-seam";
        let storage = TestDirectory::new("start-seam");
        let mut state = CodexSessionState::default();

        let status = open_flow_core_with_start(
            &mut state,
            session_ref,
            storage.path(),
            |_| panic!("the opener must not run when app-server start fails"),
            |_| Err(AppServerStartError::ComponentMissing),
        )
        .expect("typed start failure should return a status");

        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "CODEX_COMPONENT_MISSING");
        assert!(!status.authorized);
        assert!(!status.connected);
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
    }

    #[test]
    fn open_flow_maps_typed_credential_store_failure_from_the_production_start_seam() {
        let session_ref = "token-plan/codex/session/start-seam-keyring";
        let storage = TestDirectory::new("start-seam-keyring");
        let mut state = CodexSessionState::default();
        let opener_calls = Arc::new(AtomicUsize::new(0));
        let opener_calls_for_call = Arc::clone(&opener_calls);

        let status = open_flow_core_with_start(
            &mut state,
            session_ref,
            storage.path(),
            move |_| {
                opener_calls_for_call.fetch_add(1, Ordering::Relaxed);
                Ok(())
            },
            |_| Err(AppServerStartError::CredentialStoreUnavailable),
        )
        .expect("typed credential-store failure should return a status");

        assert_eq!(opener_calls.load(Ordering::Relaxed), 0);
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "CODEX_CREDENTIAL_STORE_UNAVAILABLE");
        assert!(!status.authorized);
        assert!(!status.connected);
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
    }

    #[test]
    fn open_flow_never_guesses_keyring_from_generic_production_start_text() {
        let session_ref = "token-plan/codex/session/start-seam-generic";
        let storage = TestDirectory::new("start-seam-generic");
        let mut state = CodexSessionState::default();
        let opener_calls = Arc::new(AtomicUsize::new(0));
        let opener_calls_for_call = Arc::clone(&opener_calls);

        let status = open_flow_core_with_start(
            &mut state,
            session_ref,
            storage.path(),
            move |_| {
                opener_calls_for_call.fetch_add(1, Ordering::Relaxed);
                Ok(())
            },
            |_| {
                Err(AppServerStartError::Other(
                    "synthetic generic text mentions keyring and credential store".to_string(),
                ))
            },
        )
        .expect("generic start failure should return a status");

        assert_eq!(opener_calls.load(Ordering::Relaxed), 0);
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_FAILED");
        assert!(!status.error_message.contains("keyring"));
        assert!(!status.error_message.contains("credential store"));
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
    }

    #[test]
    fn session_ref_accepts_only_a_single_safe_binding_suffix() {
        assert!(validate_session_ref("token-plan/codex/session/abc-123_def").is_ok());
        for invalid in [
            "",
            "token-plan/glm/session/abc",
            "token-plan/codex/session/",
            "token-plan/codex/session/abc-123_DEF",
            "token-plan/codex/session/../other",
            "token-plan/codex/session/cookie=abc",
            "token-plan/codex/session/Bearer-token",
            "token-plan/codex/session/abc/child",
        ] {
            assert!(validate_session_ref(invalid).is_err(), "accepted {invalid}");
        }
    }

    #[test]
    fn session_ref_case_variants_cannot_alias_the_same_windows_binding_directory() {
        let lowercase = "token-plan/codex/session/abc-123_def";
        let windows_case_variant = "token-plan/codex/session/ABC-123_DEF";

        assert!(validate_session_ref(lowercase).is_ok());
        assert!(
            validate_session_ref(windows_case_variant).is_err(),
            "case variants must not alias the same default NTFS account directory"
        );
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
        assert!(quota
            .quota_windows
            .iter()
            .all(|window| window.unit == "percent"));
        assert_eq!(quota.total_quota, 100.0);
        assert_eq!(quota.used_quota, 50.0);
        assert_eq!(quota.remaining_quota, 50.0);
    }

    #[test]
    fn authorized_without_quota_is_not_an_auth_failure() {
        let status = CodexSessionStatus {
            connected: true,
            authorized: true,
            legacy_auth_present: false,
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
    fn open_flow_status_probes_only_the_exact_legacy_auth_file() {
        let session_ref = "token-plan/codex/session/open-legacy-probe";
        let storage = TestDirectory::new("open-legacy-probe");
        std::fs::write(storage.path().join("auth.json"), "{}")
            .expect("exact legacy auth fixture should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls,
            account_reads: VecDeque::from([Ok(false)]),
            login_starts: VecDeque::from([Ok(BrowserLoginStart {
                login_id: "login-open-probe".to_string(),
                auth_url: "https://auth.openai.com/authorize".to_string(),
            })]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);

        let status = open_flow_core(&mut state, session_ref, storage.path(), |_| Ok(()))
            .expect("open flow should return a status");

        assert!(
            status.legacy_auth_present,
            "open status must probe exact auth.json"
        );
        assert_eq!(status.state_code, SessionStateCode::LoginStarted);
        assert!(status.error_code.is_empty());
        assert!(status.error_message.is_empty());
    }

    #[test]
    fn explicit_reauthorization_starts_browser_login_even_when_account_read_is_authorized() {
        let session_ref = "token-plan/codex/session/force-reauth";
        let storage = TestDirectory::new("force-reauth");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(true)]),
            login_starts: VecDeque::from([Ok(BrowserLoginStart {
                login_id: "login-force-reauth".to_string(),
                auth_url: "https://auth.openai.com/authorize".to_string(),
            })]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;
        let opened = Arc::new(Mutex::new(Vec::new()));
        let opened_for_call = Arc::clone(&opened);

        let status = reauthorize_flow_core(&mut state, session_ref, storage.path(), move |url| {
            opened_for_call
                .lock()
                .expect("opened URL log should lock")
                .push(url.to_string());
            Ok(())
        })
        .expect("explicit reauthorization should return a status");

        assert_eq!(status.state_code, SessionStateCode::LoginStarted);
        assert!(!status.authorized);
        assert_eq!(
            *opened.lock().expect("opened URL log should lock"),
            vec!["https://auth.openai.com/authorize".to_string()]
        );
        assert_eq!(
            *calls.lock().expect("app-server call log should lock"),
            vec![AppServerCall::StartLogin],
            "explicit user reauthorization must not short-circuit on account/read"
        );
    }

    #[test]
    fn open_flow_status_ignores_sibling_and_nested_legacy_files() {
        let session_ref = "token-plan/codex/session/open-non-exact-legacy-probe";
        let non_exact_storage = TestDirectory::new("open-non-exact-legacy-probe");
        std::fs::write(non_exact_storage.path().join("auth.json.bak"), "{}")
            .expect("sibling fixture should be written");
        let nested = non_exact_storage.path().join("nested");
        std::fs::create_dir_all(&nested).expect("nested fixture should be created");
        std::fs::write(nested.join("auth.json"), "{}").expect("nested fixture should be written");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            account_reads: VecDeque::from([Ok(false)]),
            login_starts: VecDeque::from([Ok(BrowserLoginStart {
                login_id: "login-open-non-exact".to_string(),
                auth_url: "https://auth.openai.com/authorize".to_string(),
            })]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, non_exact_storage.path(), fake);

        let status = open_flow_core(
            &mut state,
            session_ref,
            non_exact_storage.path(),
            |_| Ok(()),
        )
        .expect("open flow should return a status");

        assert!(!status.legacy_auth_present);
    }

    #[test]
    fn verify_flow_status_probes_exact_legacy_auth_and_reports_absence() {
        let session_ref = "token-plan/codex/session/verify-legacy-probe";
        let storage = TestDirectory::new("verify-legacy-probe");
        std::fs::write(storage.path().join("auth.json"), "{}")
            .expect("exact legacy auth fixture should be written");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;

        let status = verify_flow_core(&mut state, session_ref, storage.path())
            .expect("verify flow should return a status");

        assert!(
            status.legacy_auth_present,
            "verify status must probe exact auth.json"
        );
    }

    #[test]
    fn verify_flow_status_reports_no_legacy_auth_when_file_is_absent() {
        let session_ref = "token-plan/codex/session/verify-no-legacy-probe";
        let empty_storage = TestDirectory::new("verify-no-legacy-probe");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, empty_storage.path(), fake);
        state.authorized = true;

        let status = verify_flow_core(&mut state, session_ref, empty_storage.path())
            .expect("verify flow should return a status");

        assert!(!status.legacy_auth_present);
    }

    #[test]
    fn verify_restarted_without_an_authorized_account_is_terminal_session_not_found() {
        let session_ref = "token-plan/codex/session/verify-restarted-missing";
        let storage = TestDirectory::new("verify-restarted-missing");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let calls_for_fake = Arc::clone(&calls);
        let mut state = CodexSessionState::default();

        let status =
            verify_flow_core_with_start(&mut state, session_ref, storage.path(), move |_| {
                Ok(Box::new(FakeAppServer {
                    calls: calls_for_fake,
                    account_reads: VecDeque::from([Ok(false)]),
                    ..FakeAppServer::default()
                }) as Box<dyn AppServerOps>)
            })
            .expect("restarted unauthorized session should return a terminal status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![AppServerCall::ReadAccount(true)]
        );
        assert_eq!(status.state_code, SessionStateCode::SessionNotFound);
        assert_eq!(status.error_code, "SESSION_NOT_FOUND");
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
    }

    #[test]
    fn verify_failed_login_is_terminal_and_sanitized() {
        let session_ref = "token-plan/codex/session/verify-failed";
        let storage = TestDirectory::new("verify-failed");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            login_completions: VecDeque::from([LoginCompletion::Failed]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-verify-failed".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());

        let status = verify_flow_core(&mut state, session_ref, storage.path())
            .expect("login failure should return a stable status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![AppServerCall::PollLogin("login-verify-failed".to_string())]
        );
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_FAILED");
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert!(!state.authorized);
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
    }

    #[test]
    fn verify_account_read_transport_error_returns_a_sanitized_status() {
        let session_ref = "token-plan/codex/session/verify-read-error";
        let storage = TestDirectory::new("verify-read-error");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            login_completions: VecDeque::from([LoginCompletion::Pending]),
            account_reads: VecDeque::from([Err(
                "synthetic transport error with secret-looking detail".to_string(),
            )]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-verify-read-error".to_string());

        let result = verify_flow_core(&mut state, session_ref, storage.path());

        assert!(
            result.is_ok(),
            "transport failure must be a status: {result:?}"
        );
        let status = result.expect("checked above");
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_FAILED");
        assert!(!status.error_message.contains("secret-looking"));
        assert!(!status.authorized);
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert!(!status.connected);
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::PollLogin("login-verify-read-error".to_string()),
                AppServerCall::ReadAccount(true),
            ]
        );
    }

    #[test]
    fn verify_pending_login_recovers_a_lost_completion_via_account_read() {
        let session_ref = "token-plan/codex/session/verify-pending-authorized";
        let storage = TestDirectory::new("verify-pending-authorized");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            login_completions: VecDeque::from([LoginCompletion::Pending]),
            account_reads: VecDeque::from([Ok(true)]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-pending-authorized".to_string());

        let status = verify_flow_core(&mut state, session_ref, storage.path())
            .expect("account/read true should recover a lost completion notification");

        assert!(status.authorized);
        assert!(status.connected);
        assert!(state.authorized);
        assert!(state.login_id.is_none());
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::PollLogin("login-pending-authorized".to_string()),
                AppServerCall::ReadAccount(true),
            ]
        );
    }

    #[test]
    fn verify_pending_login_with_account_read_false_remains_awaiting() {
        let session_ref = "token-plan/codex/session/verify-pending-awaiting";
        let storage = TestDirectory::new("verify-pending-awaiting");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            login_completions: VecDeque::from([LoginCompletion::Pending]),
            account_reads: VecDeque::from([Ok(false)]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-pending-awaiting".to_string());

        let status = verify_flow_core(&mut state, session_ref, storage.path())
            .expect("pending login should return an awaiting status");

        assert_eq!(status.state_code, SessionStateCode::AwaitingVerification);
        assert_eq!(status.error_code, "AWAITING_VERIFICATION");
        assert!(!status.authorized);
        assert!(!status.connected);
        assert_eq!(state.login_id.as_deref(), Some("login-pending-awaiting"));
    }

    #[test]
    fn sync_flow_status_probes_only_the_exact_legacy_auth_file() {
        let session_ref = "token-plan/codex/session/sync-legacy-probe";
        let storage = TestDirectory::new("sync-legacy-probe");
        std::fs::write(storage.path().join("auth.json"), "{}")
            .expect("exact legacy auth fixture should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            rate_limits: VecDeque::from([Ok(supported_rate_limits())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;

        let status = sync_quota_flow_core(&mut state, session_ref, storage.path())
            .expect("sync flow should return a status");

        assert!(
            status.legacy_auth_present,
            "sync status must probe exact auth.json"
        );
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![AppServerCall::ReadRateLimits]
        );
    }

    #[test]
    fn sync_flow_status_ignores_sibling_and_nested_legacy_files() {
        let session_ref = "token-plan/codex/session/sync-non-exact-legacy-probe";
        let non_exact_storage = TestDirectory::new("sync-non-exact-legacy-probe");
        std::fs::write(non_exact_storage.path().join("auth.json.bak"), "{}")
            .expect("sibling fixture should be written");
        let nested = non_exact_storage.path().join("nested");
        std::fs::create_dir_all(&nested).expect("nested fixture should be created");
        std::fs::write(nested.join("auth.json"), "{}").expect("nested fixture should be written");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            rate_limits: VecDeque::from([Ok(supported_rate_limits())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, non_exact_storage.path(), fake);
        state.authorized = true;

        let status = sync_quota_flow_core(&mut state, session_ref, non_exact_storage.path())
            .expect("sync flow should return a status");

        assert!(!status.legacy_auth_present);
    }

    #[test]
    fn cancel_login_completed_race_preserves_the_authorized_account() {
        let session_ref = "token-plan/codex/session/cancel-race";
        let storage = TestDirectory::new("cancel-race");
        std::fs::write(storage.path().join("auth.json"), "{}")
            .expect("legacy auth fixture should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(true)]),
            cancel_results: VecDeque::from([Ok(())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-matching".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());

        let status = cancel_flow_core(
            &mut state,
            session_ref,
            storage.path(),
            CodexCancelReason::Timeout,
        )
        .expect("cancel reconciliation should return a status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::CancelLogin("login-matching".to_string()),
                AppServerCall::ReadAccount(true),
            ]
        );
        assert!(status.authorized);
        assert!(status.connected);
        assert!(status.legacy_auth_present);
        assert!(state.authorized);
        assert!(state.client.is_some());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
        assert_eq!(state.account_dir.as_deref(), Some(storage.path()));
    }

    #[test]
    fn cancel_confirmed_unauthorized_clears_the_pending_binding() {
        let session_ref = "token-plan/codex/session/cancel-unauthorized";
        let storage = TestDirectory::new("cancel-unauthorized");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            cancel_results: VecDeque::from([Ok(())]),
            account_reads: VecDeque::from([Ok(false)]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-cancel".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());

        let status = cancel_flow_core(
            &mut state,
            session_ref,
            storage.path(),
            CodexCancelReason::UserCancelled,
        )
        .expect("confirmed cancellation should return a terminal status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::CancelLogin("login-cancel".to_string()),
                AppServerCall::ReadAccount(true),
            ]
        );
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_CANCELLED");
        assert!(!status.authorized);
        assert!(!status.connected);
        assert!(!state.authorized);
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
    }

    #[test]
    fn cancel_timeout_with_confirmed_unauthorized_account_returns_timeout_status() {
        let session_ref = "token-plan/codex/session/cancel-timeout";
        let storage = TestDirectory::new("cancel-timeout");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            cancel_results: VecDeque::from([Ok(())]),
            account_reads: VecDeque::from([Ok(false)]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-timeout".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());

        let status = cancel_flow_core(
            &mut state,
            session_ref,
            storage.path(),
            CodexCancelReason::Timeout,
        )
        .expect("confirmed timeout should return a terminal status");

        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_TIMEOUT");
        assert!(!status.error_message.contains("login-timeout"));
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
    }

    #[test]
    fn cancel_reason_deserialization_accepts_only_allowlisted_values_without_echoing_unknown_input()
    {
        assert_eq!(
            serde_json::from_str::<CodexCancelReason>("\"user_cancelled\"")
                .expect("user_cancelled should deserialize"),
            CodexCancelReason::UserCancelled
        );
        assert_eq!(
            serde_json::from_str::<CodexCancelReason>("\"timeout\"")
                .expect("timeout should deserialize"),
            CodexCancelReason::Timeout
        );
        let secret_looking_input = "secret-looking-keyring-value";
        let error =
            serde_json::from_str::<CodexCancelReason>(&format!("\"{secret_looking_input}\""))
                .expect_err("unknown cancellation reasons must be rejected");
        assert_eq!(error.to_string(), "unsupported Codex cancellation reason");
        assert!(!error.to_string().contains(secret_looking_input));
    }

    #[test]
    fn cancel_rejection_with_confirmed_unauthorized_account_clears_pending() {
        let session_ref = "token-plan/codex/session/cancel-rejected";
        let storage = TestDirectory::new("cancel-rejected");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            cancel_results: VecDeque::from([Err("synthetic cancel rejection".to_string())]),
            account_reads: VecDeque::from([Ok(false)]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-cancel-rejected".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());

        let status = cancel_flow_core(
            &mut state,
            session_ref,
            storage.path(),
            CodexCancelReason::UserCancelled,
        )
        .expect("cancel rejection should return a sanitized status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::CancelLogin("login-cancel-rejected".to_string()),
                AppServerCall::ReadAccount(true),
            ]
        );
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_CANCELLED");
        assert!(!status.error_message.contains("synthetic"));
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
    }

    #[test]
    fn cancel_account_read_error_never_clears_the_pending_login() {
        let session_ref = "token-plan/codex/session/cancel-read-error";
        let storage = TestDirectory::new("cancel-read-error");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            cancel_results: VecDeque::from([Ok(())]),
            account_reads: VecDeque::from([Err("synthetic account error".to_string())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-cancel-read-error".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());

        let status = cancel_flow_core(
            &mut state,
            session_ref,
            storage.path(),
            CodexCancelReason::Timeout,
        )
        .expect("account read error should return a sanitized status");

        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_FAILED");
        assert_eq!(state.login_id.as_deref(), Some("login-cancel-read-error"));
        assert!(state.client.is_some());
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
    }

    #[test]
    fn rate_limit_failure_keeps_an_authorized_session_connected() {
        let session_ref = "token-plan/codex/session/rate-limit-error";
        let storage = TestDirectory::new("rate-limit-error");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            rate_limits: VecDeque::from([Err("rate limits unavailable".to_string())]),
            account_reads: VecDeque::from([Ok(true)]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;

        let status = sync_quota_flow_core(&mut state, session_ref, storage.path())
            .expect("quota failure should return a status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadRateLimits,
                AppServerCall::ReadAccount(true)
            ]
        );
        assert!(status.authorized);
        assert!(status.connected);
        assert_eq!(status.state_code, SessionStateCode::Authorized);
        assert_eq!(status.quota_sync_status, QuotaSyncStatus::Error);
        assert_eq!(status.error_code, "QUOTA_SYNC_FAILED");
        assert!(state.authorized);
    }

    #[test]
    fn rate_limit_failure_with_confirmed_unauthorized_account_requires_reauth_terminally() {
        let session_ref = "token-plan/codex/session/rate-limit-reauth";
        let storage = TestDirectory::new("rate-limit-reauth");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            rate_limits: VecDeque::from([Err("rate limits unavailable".to_string())]),
            account_reads: VecDeque::from([Ok(false)]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;
        state.login_id = Some("stale-pending-login".to_string());

        let status = sync_quota_flow_core(&mut state, session_ref, storage.path())
            .expect("confirmed unauthorized account should return reauth status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadRateLimits,
                AppServerCall::ReadAccount(true)
            ]
        );
        assert_eq!(status.state_code, SessionStateCode::ReauthRequired);
        assert_eq!(status.error_code, "REAUTH_REQUIRED");
        assert!(!status.authorized);
        assert!(!status.connected);
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(state.login_id.is_none());
    }

    #[test]
    fn account_read_transport_error_is_not_reported_as_reauth() {
        let session_ref = "token-plan/codex/session/account-read-error";
        let storage = TestDirectory::new("account-read-error");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            rate_limits: VecDeque::from([Err("rate limits unavailable".to_string())]),
            account_reads: VecDeque::from([Err("transport unavailable".to_string())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;

        let status = sync_quota_flow_core(&mut state, session_ref, storage.path())
            .expect("transport errors should return an authorized quota status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadRateLimits,
                AppServerCall::ReadAccount(true)
            ]
        );
        assert!(status.authorized);
        assert!(status.connected);
        assert_eq!(status.error_code, "QUOTA_SYNC_FAILED");
        assert_ne!(status.state_code, SessionStateCode::ReauthRequired);
        assert!(state.authorized);
    }

    #[test]
    fn browser_open_failure_cancels_and_reconciles_without_leaving_pending_state() {
        let session_ref = "token-plan/codex/session/opener-failure";
        let storage = TestDirectory::new("opener-failure");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(false), Ok(false)]),
            login_starts: VecDeque::from([Ok(BrowserLoginStart {
                login_id: "login-opener".to_string(),
                auth_url: "https://auth.openai.com/authorize".to_string(),
            })]),
            cancel_results: VecDeque::from([Ok(())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);

        let result = open_flow_core(&mut state, session_ref, storage.path(), |_| {
            Err("system opener failed".to_string())
        });

        assert!(
            result.is_ok(),
            "opener failure must return a stable status, got {result:?}"
        );
        let status = result.expect("checked above");
        assert_eq!(status.error_code, "BROWSER_OPEN_FAILED");
        assert!(!status.authorized);
        assert!(!status.connected);
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadAccount(true),
                AppServerCall::StartLogin,
                AppServerCall::CancelLogin("login-opener".to_string()),
                AppServerCall::ReadAccount(true),
            ]
        );
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert!(state.client.is_none());
        assert!(!state.authorized);
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
    }

    #[test]
    fn browser_open_failure_preserves_a_concurrently_authorized_account() {
        let session_ref = "token-plan/codex/session/opener-race";
        let storage = TestDirectory::new("opener-race");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(false), Ok(true)]),
            login_starts: VecDeque::from([Ok(BrowserLoginStart {
                login_id: "login-opener-race".to_string(),
                auth_url: "https://auth.openai.com/authorize".to_string(),
            })]),
            cancel_results: VecDeque::from([Ok(())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);

        let result = open_flow_core(&mut state, session_ref, storage.path(), |_| {
            Err("system opener failed".to_string())
        });

        assert!(
            result.is_ok(),
            "authorized opener race must return a status, got {result:?}"
        );
        let status = result.expect("checked above");
        assert!(status.authorized);
        assert!(status.connected);
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadAccount(true),
                AppServerCall::StartLogin,
                AppServerCall::CancelLogin("login-opener-race".to_string()),
                AppServerCall::ReadAccount(true),
            ]
        );
        assert!(state.authorized);
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert!(state.client.is_some());
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
        assert_eq!(state.account_dir.as_deref(), Some(storage.path()));
    }

    #[test]
    fn non_allowlisted_login_url_is_never_opened_and_is_reconciled() {
        let session_ref = "token-plan/codex/session/non-official-url";
        let storage = TestDirectory::new("non-official-url");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(false), Ok(false)]),
            login_starts: VecDeque::from([Ok(BrowserLoginStart {
                login_id: "login-untrusted".to_string(),
                auth_url: "https://attacker.invalid/authorize".to_string(),
            })]),
            cancel_results: VecDeque::from([Ok(())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        let opener_calls = Arc::new(AtomicUsize::new(0));
        let opener_calls_for_call = Arc::clone(&opener_calls);

        let status = open_flow_core(&mut state, session_ref, storage.path(), move |_| {
            opener_calls_for_call.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
        .expect("invalid URL should return a stable status");

        assert_eq!(opener_calls.load(Ordering::Relaxed), 0);
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_FAILED");
        assert!(!status.authorized);
        assert!(!status.connected);
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadAccount(true),
                AppServerCall::StartLogin,
                AppServerCall::CancelLogin("login-untrusted".to_string()),
                AppServerCall::ReadAccount(true),
            ]
        );
        assert!(state.client.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
    }

    #[test]
    fn reopen_pending_login_uses_the_existing_official_url_without_restarting_login() {
        let session_ref = "token-plan/codex/session/reopen-pending";
        let storage = TestDirectory::new("reopen-pending");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        let login_id = "synthetic-login-id-never-serialized";
        let auth_url = "https://auth.openai.com/authorize?synthetic=never-serialized";
        state.login_id = Some(login_id.to_string());
        state.auth_url = Some(auth_url.to_string());
        let opened_urls = Arc::new(Mutex::new(Vec::new()));
        let opened_urls_for_call = Arc::clone(&opened_urls);

        let status = reopen_flow_core(&mut state, session_ref, storage.path(), move |url| {
            opened_urls_for_call
                .lock()
                .expect("opener log should lock")
                .push(url.to_string());
            Ok(())
        })
        .expect("reopen should return a pending status");

        assert_eq!(
            *opened_urls.lock().expect("opener log should lock"),
            vec![auth_url.to_string()]
        );
        assert!(calls.lock().expect("call log should lock").is_empty());
        assert_eq!(status.state_code, SessionStateCode::AwaitingVerification);
        assert!(!status.authorized);
        assert!(!status.connected);
        assert!(status.error_code.is_empty());
        assert_eq!(state.login_id.as_deref(), Some(login_id));
        assert_eq!(state.auth_url.as_deref(), Some(auth_url));
        assert!(state.client.is_some());
        let serialized = serde_json::to_string(&status).expect("status should serialize");
        assert!(!serialized.contains(login_id));
        assert!(!serialized.contains(auth_url));
        assert!(!serialized.contains("auth_url"));
        assert!(!serialized.contains("login_id"));
    }

    #[test]
    fn reopen_authorized_race_returns_authorized_and_clears_only_pending_fields() {
        let session_ref = "token-plan/codex/session/reopen-authorized-race";
        let storage = TestDirectory::new("reopen-authorized-race");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;
        state.login_id = Some("login-authorized-race".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());
        let opener_calls = Arc::new(AtomicUsize::new(0));
        let opener_calls_for_call = Arc::clone(&opener_calls);

        let status = reopen_flow_core(&mut state, session_ref, storage.path(), move |_| {
            opener_calls_for_call.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
        .expect("authorized race should return a status");

        assert_eq!(opener_calls.load(Ordering::Relaxed), 0);
        assert!(calls.lock().expect("call log should lock").is_empty());
        assert_eq!(status.state_code, SessionStateCode::Authorized);
        assert!(status.authorized);
        assert!(status.connected);
        assert!(status.error_code.is_empty());
        assert!(state.authorized);
        assert!(state.client.is_some());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
        assert_eq!(state.account_dir.as_deref(), Some(storage.path()));
    }

    #[test]
    fn reopen_missing_login_id_clears_the_same_session_incomplete_state() {
        let session_ref = "token-plan/codex/session/reopen-missing-login";
        let storage = TestDirectory::new("reopen-missing-login");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());
        let opener_calls = Arc::new(AtomicUsize::new(0));
        let opener_calls_for_call = Arc::clone(&opener_calls);

        let status = reopen_flow_core(&mut state, session_ref, storage.path(), move |_| {
            opener_calls_for_call.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
        .expect("missing login id should return a terminal status");

        assert_eq!(opener_calls.load(Ordering::Relaxed), 0);
        assert!(calls.lock().expect("call log should lock").is_empty());
        assert_eq!(status.state_code, SessionStateCode::SessionNotFound);
        assert_eq!(status.error_code, "SESSION_NOT_FOUND");
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(state.client.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
    }

    #[test]
    fn reopen_missing_auth_url_cancels_exact_login_then_clears_same_session() {
        let session_ref = "token-plan/codex/session/reopen-missing-url";
        let storage = TestDirectory::new("reopen-missing-url");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let login_id = "login-missing-auth-url";
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            cancel_results: VecDeque::from([Ok(())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some(login_id.to_string());

        let status = reopen_flow_core(&mut state, session_ref, storage.path(), |_| {
            panic!("opener must not run when auth URL is missing")
        })
        .expect("missing auth URL should return a terminal status");

        assert_eq!(status.state_code, SessionStateCode::SessionNotFound);
        assert_eq!(status.error_code, "SESSION_NOT_FOUND");
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![AppServerCall::CancelLogin(login_id.to_string())]
        );
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(state.client.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
    }

    #[test]
    fn reopen_missing_client_clears_the_same_session_incomplete_state() {
        let session_ref = "token-plan/codex/session/reopen-missing-client";
        let storage = TestDirectory::new("reopen-missing-client");
        let mut state = CodexSessionState {
            active_session_ref: Some(session_ref.to_string()),
            account_dir: Some(storage.path().to_path_buf()),
            login_id: Some("login-without-client".to_string()),
            auth_url: Some("https://auth.openai.com/authorize".to_string()),
            authorized: false,
            client: None,
            pending_oauth: HashMap::new(),
        };

        let status = reopen_flow_core(&mut state, session_ref, storage.path(), |_| {
            panic!("opener must not run when app-server client is missing")
        })
        .expect("missing client should return a terminal status");

        assert_eq!(status.state_code, SessionStateCode::SessionNotFound);
        assert_eq!(status.error_code, "SESSION_NOT_FOUND");
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(state.client.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
    }

    #[test]
    fn reopen_different_session_never_mutates_or_calls_the_active_session() {
        let session_ref = "token-plan/codex/session/reopen-original";
        let other_session_ref = "token-plan/codex/session/reopen-other";
        let storage = TestDirectory::new("reopen-original");
        let other_storage = TestDirectory::new("reopen-other");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        let login_id = "login-owned-by-original-session";
        let auth_url = "https://auth.openai.com/authorize";
        state.login_id = Some(login_id.to_string());
        state.auth_url = Some(auth_url.to_string());
        let opener_calls = Arc::new(AtomicUsize::new(0));
        let opener_calls_for_call = Arc::clone(&opener_calls);

        let status = reopen_flow_core(
            &mut state,
            other_session_ref,
            other_storage.path(),
            move |_| {
                opener_calls_for_call.fetch_add(1, Ordering::Relaxed);
                Ok(())
            },
        )
        .expect("a different active session should return a status");

        assert_eq!(opener_calls.load(Ordering::Relaxed), 0);
        assert!(calls.lock().expect("call log should lock").is_empty());
        assert_eq!(status.state_code, SessionStateCode::SessionNotFound);
        assert_eq!(status.error_code, "SESSION_NOT_FOUND");
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
        assert_eq!(state.account_dir.as_deref(), Some(storage.path()));
        assert!(state.client.is_some());
        assert_eq!(state.login_id.as_deref(), Some(login_id));
        assert_eq!(state.auth_url.as_deref(), Some(auth_url));
    }

    #[test]
    fn reopen_rejects_an_invalid_retained_url_and_clears_the_pending_state() {
        let session_ref = "token-plan/codex/session/reopen-invalid-url";
        let storage = TestDirectory::new("reopen-invalid-url");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            cancel_results: VecDeque::from([Ok(())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        let login_id = "login-reopen-invalid";
        let auth_url = "https://attacker.invalid/authorize?secret=synthetic";
        state.login_id = Some(login_id.to_string());
        state.auth_url = Some(auth_url.to_string());
        let opener_calls = Arc::new(AtomicUsize::new(0));
        let opener_calls_for_call = Arc::clone(&opener_calls);

        let status = reopen_flow_core(&mut state, session_ref, storage.path(), move |_| {
            opener_calls_for_call.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
        .expect("invalid retained URL should return a status");

        assert_eq!(opener_calls.load(Ordering::Relaxed), 0);
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_FAILED");
        assert!(!status.error_message.contains(auth_url));
        assert!(!status.error_message.contains(login_id));
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![AppServerCall::CancelLogin(login_id.to_string())]
        );
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(state.client.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
    }

    #[test]
    fn reopen_opener_failure_is_sanitized_and_preserves_pending_state_for_retry() {
        let session_ref = "token-plan/codex/session/reopen-opener-failure";
        let storage = TestDirectory::new("reopen-opener-failure");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        let login_id = "login-reopen-opener-failure";
        let auth_url = "https://auth.openai.com/authorize?secret=synthetic";
        state.login_id = Some(login_id.to_string());
        state.auth_url = Some(auth_url.to_string());

        let status = reopen_flow_core(&mut state, session_ref, storage.path(), |_| {
            Err("synthetic secret-looking opener detail".to_string())
        })
        .expect("opener failure should return a status");

        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "BROWSER_OPEN_FAILED");
        assert!(!status.error_message.contains("secret-looking"));
        assert!(!status.error_message.contains(auth_url));
        assert!(!status.error_message.contains(login_id));
        assert!(calls.lock().expect("call log should lock").is_empty());
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
        assert_eq!(state.account_dir.as_deref(), Some(storage.path()));
        assert!(state.client.is_some());
        assert_eq!(state.login_id.as_deref(), Some(login_id));
        assert_eq!(state.auth_url.as_deref(), Some(auth_url));
    }

    #[test]
    fn login_start_transport_error_returns_a_sanitized_terminal_status() {
        let session_ref = "token-plan/codex/session/login-start-error";
        let storage = TestDirectory::new("login-start-error");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            account_reads: VecDeque::from([Ok(false)]),
            login_starts: VecDeque::from([Err(
                "synthetic secret-looking login start detail".to_string()
            )]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);

        let result = open_flow_core(&mut state, session_ref, storage.path(), |_| Ok(()));

        assert!(
            result.is_ok(),
            "login start failure must be a status: {result:?}"
        );
        let status = result.expect("checked above");
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "AUTHORIZATION_FAILED");
        assert!(!status.error_message.contains("secret-looking"));
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
    }

    #[test]
    fn disconnect_removes_the_token_eyes_binding_without_logging_out_codex() {
        let session_ref = "token-plan/codex/session/logout-still-authorized";
        let storage = TestDirectory::new("logout-still-authorized");
        let marker = storage.path().join("binding-marker");
        std::fs::write(&marker, "binding").expect("binding marker should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;
        let removed_paths = Arc::new(Mutex::new(Vec::new()));
        let removed_for_call = Arc::clone(&removed_paths);

        let status = disconnect_flow_core(&mut state, session_ref, storage.path(), |path| {
            assert_eq!(path, storage.path());
            removed_for_call
                .lock()
                .expect("remove log should lock")
                .push(path.to_path_buf());
            std::fs::remove_dir_all(path).map_err(|error| error.to_string())
        })
        .expect("local disconnect should return a status");

        assert!(calls.lock().expect("call log should lock").is_empty());
        assert_eq!(status.state_code, SessionStateCode::Disconnected);
        assert!(!status.authorized);
        assert!(!status.connected);
        assert!(status.error_code.is_empty());
        assert!(!state.authorized);
        assert!(state.client.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert_eq!(
            *removed_paths.lock().expect("remove log should lock"),
            vec![storage.path().to_path_buf()]
        );
        assert!(!marker.exists());
    }

    #[test]
    fn disconnect_binding_removal_failure_returns_sanitized_retryable_status() {
        let session_ref = "token-plan/codex/session/logout-remove-failure";
        let storage = TestDirectory::new("logout-remove-failure");
        let marker = storage.path().join("binding-marker");
        std::fs::write(&marker, "binding").expect("binding marker should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            cancel_results: VecDeque::from([Ok(())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;
        state.login_id = Some("login-remove-failure".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());

        let result = disconnect_flow_core(&mut state, session_ref, storage.path(), |_| {
            Err("synthetic secret-looking path removal detail".to_string())
        });

        assert!(
            result.is_ok(),
            "filesystem failure must return a DTO: {result:?}"
        );
        let status = result.expect("checked above");
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![AppServerCall::CancelLogin(
                "login-remove-failure".to_string()
            )]
        );
        assert_eq!(status.state_code, SessionStateCode::Failed);
        assert_eq!(status.error_code, "CODEX_LOCAL_BINDING_DELETE_FAILED");
        assert!(!status.authorized);
        assert!(!status.connected);
        assert!(!status.error_message.contains("secret-looking"));
        assert!(!status
            .error_message
            .contains(&storage.path().to_string_lossy().to_string()));
        assert!(!state.authorized);
        assert!(state.client.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(marker.exists());
    }

    #[test]
    fn disconnect_pending_login_cancels_the_pending_flow_then_removes_the_binding() {
        let session_ref = "token-plan/codex/session/logout-pending";
        let storage = TestDirectory::new("logout-pending");
        let marker = storage.path().join("binding-marker");
        std::fs::write(&marker, "binding").expect("binding marker should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            cancel_results: VecDeque::from([Ok(())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.login_id = Some("login-disconnect".to_string());
        state.auth_url = Some("https://auth.openai.com/authorize".to_string());
        let removed_paths = Arc::new(Mutex::new(Vec::new()));
        let removed_for_call = Arc::clone(&removed_paths);

        let status = disconnect_flow_core(&mut state, session_ref, storage.path(), |path| {
            assert_eq!(path, storage.path());
            removed_for_call
                .lock()
                .expect("remove log should lock")
                .push(path.to_path_buf());
            std::fs::remove_dir_all(path).map_err(|error| error.to_string())
        })
        .expect("local disconnect should return a disconnected status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![AppServerCall::CancelLogin("login-disconnect".to_string())]
        );
        assert_eq!(status.state_code, SessionStateCode::Disconnected);
        assert!(!status.connected);
        assert!(!status.authorized);
        assert!(status.error_code.is_empty());
        assert!(status.error_message.is_empty());
        assert!(!state.authorized);
        assert!(state.active_session_ref.is_none());
        assert!(state.account_dir.is_none());
        assert!(state.login_id.is_none());
        assert!(state.auth_url.is_none());
        assert!(state.client.is_none());
        assert_eq!(
            *removed_paths.lock().expect("remove log should lock"),
            vec![storage.path().to_path_buf()]
        );
        assert!(!storage.path().exists());
    }

    #[test]
    fn legacy_cleanup_removes_only_the_exact_auth_json_file() {
        let session_ref = "token-plan/codex/session/legacy-cleanup";
        let storage = TestDirectory::new("legacy-cleanup");
        let legacy_auth = storage.path().join("auth.json");
        let config = storage.path().join("config.toml");
        let sibling = storage.path().join("account.json");
        let nested = storage.path().join("nested");
        std::fs::write(&legacy_auth, "{}").expect("legacy auth fixture should be written");
        std::fs::write(&config, "model = 'codex'").expect("config fixture should be written");
        std::fs::write(&sibling, "{}").expect("sibling fixture should be written");
        std::fs::create_dir_all(&nested).expect("nested fixture should be created");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(true)]),
            rate_limits: VecDeque::from([Ok(supported_rate_limits())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;

        let result =
            cleanup_legacy_codex_auth_file_core(&mut state, session_ref, storage.path(), |path| {
                assert_eq!(path, legacy_auth.as_path());
                std::fs::remove_file(path).map_err(|error| error.to_string())
            });

        assert!(
            result.is_ok(),
            "verified legacy cleanup should succeed, got {result:?}"
        );
        let status = result.expect("checked above");
        assert!(status.authorized);
        assert!(status.connected);
        assert!(!status.legacy_auth_present);
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadAccount(true),
                AppServerCall::ReadRateLimits,
            ]
        );
        assert!(!legacy_auth.exists());
        assert!(config.exists());
        assert!(sibling.exists());
        assert!(nested.is_dir());
        assert!(storage.path().is_dir());
    }

    #[test]
    fn legacy_cleanup_remove_failure_keeps_authorized_binding_and_file() {
        let session_ref = "token-plan/codex/session/legacy-remove-failure";
        let storage = TestDirectory::new("legacy-remove-failure");
        let legacy_auth = storage.path().join("auth.json");
        std::fs::write(&legacy_auth, "{}").expect("legacy auth fixture should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(true)]),
            rate_limits: VecDeque::from([Ok(supported_rate_limits())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;

        let result =
            cleanup_legacy_codex_auth_file_core(&mut state, session_ref, storage.path(), |path| {
                assert_eq!(path, legacy_auth.as_path());
                Err("injected remove failure".to_string())
            });

        assert!(
            result.is_ok(),
            "remove failure must be returned as a status, got {result:?}"
        );
        let status = result.expect("checked above");
        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadAccount(true),
                AppServerCall::ReadRateLimits,
            ]
        );
        assert_eq!(status.error_code, "LEGACY_CREDENTIAL_CLEANUP_FAILED");
        assert!(status.legacy_auth_present);
        assert!(status.authorized);
        assert!(status.connected);
        assert!(state.authorized);
        assert!(state.client.is_some());
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
        assert_eq!(state.account_dir.as_deref(), Some(storage.path()));
        assert!(legacy_auth.is_file());
    }

    #[test]
    fn legacy_cleanup_unauthorized_account_keeps_auth_json() {
        let session_ref = "token-plan/codex/session/legacy-unauthorized";
        let storage = TestDirectory::new("legacy-unauthorized");
        let legacy_auth = storage.path().join("auth.json");
        std::fs::write(&legacy_auth, "{}").expect("legacy auth fixture should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(false)]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;
        let removed = Arc::new(Mutex::new(Vec::new()));
        let removed_for_call = Arc::clone(&removed);

        let status =
            cleanup_legacy_codex_auth_file_core(&mut state, session_ref, storage.path(), |path| {
                assert_eq!(path, legacy_auth.as_path());
                removed_for_call
                    .lock()
                    .expect("remove log should lock")
                    .push(path.to_path_buf());
                std::fs::remove_file(path).map_err(|error| error.to_string())
            })
            .expect("cleanup refusal should return a status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![AppServerCall::ReadAccount(true)]
        );
        assert_eq!(status.error_code, "LEGACY_CREDENTIAL_CLEANUP_FAILED");
        assert!(status.authorized);
        assert!(status.connected);
        assert!(status.legacy_auth_present);
        assert!(state.authorized);
        assert!(state.client.is_some());
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
        assert_eq!(state.account_dir.as_deref(), Some(storage.path()));
        assert!(removed.lock().expect("remove log should lock").is_empty());
        assert!(legacy_auth.exists());
    }

    #[test]
    fn legacy_cleanup_rate_limit_failure_keeps_auth_json() {
        let session_ref = "token-plan/codex/session/legacy-rate-failure";
        let storage = TestDirectory::new("legacy-rate-failure");
        let legacy_auth = storage.path().join("auth.json");
        std::fs::write(&legacy_auth, "{}").expect("legacy auth fixture should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(true)]),
            rate_limits: VecDeque::from([Err("rate limits unavailable".to_string())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;
        let removed = Arc::new(Mutex::new(Vec::new()));
        let removed_for_call = Arc::clone(&removed);

        let status =
            cleanup_legacy_codex_auth_file_core(&mut state, session_ref, storage.path(), |path| {
                assert_eq!(path, legacy_auth.as_path());
                removed_for_call
                    .lock()
                    .expect("remove log should lock")
                    .push(path.to_path_buf());
                std::fs::remove_file(path).map_err(|error| error.to_string())
            })
            .expect("cleanup refusal should return a status");

        assert_eq!(
            *calls.lock().expect("call log should lock"),
            vec![
                AppServerCall::ReadAccount(true),
                AppServerCall::ReadRateLimits,
            ]
        );
        assert_eq!(status.error_code, "LEGACY_CREDENTIAL_CLEANUP_FAILED");
        assert!(status.authorized);
        assert!(status.connected);
        assert!(status.legacy_auth_present);
        assert!(state.authorized);
        assert!(state.client.is_some());
        assert_eq!(state.active_session_ref.as_deref(), Some(session_ref));
        assert_eq!(state.account_dir.as_deref(), Some(storage.path()));
        assert!(removed.lock().expect("remove log should lock").is_empty());
        assert!(legacy_auth.exists());
    }

    #[test]
    fn legacy_cleanup_account_read_error_keeps_auth_json() {
        let session_ref = "token-plan/codex/session/legacy-read-error";
        let storage = TestDirectory::new("legacy-read-error");
        let legacy_auth = storage.path().join("auth.json");
        std::fs::write(&legacy_auth, "{}").expect("legacy auth fixture should be written");
        let fake = FakeAppServer {
            calls: Arc::new(Mutex::new(Vec::new())),
            account_reads: VecDeque::from([Err("synthetic account error".to_string())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(session_ref, storage.path(), fake);
        state.authorized = true;

        let status =
            cleanup_legacy_codex_auth_file_core(&mut state, session_ref, storage.path(), |_| {
                panic!("remove must not run when account/read fails")
            })
            .expect("cleanup refusal should return a status");

        assert_eq!(status.error_code, "LEGACY_CREDENTIAL_CLEANUP_FAILED");
        assert!(status.authorized);
        assert!(status.connected);
        assert!(status.legacy_auth_present);
        assert!(legacy_auth.exists());
    }

    #[test]
    fn legacy_cleanup_never_uses_one_binding_client_for_another_binding() {
        let active_ref = "token-plan/codex/session/legacy-active-a";
        let requested_ref = "token-plan/codex/session/legacy-requested-b";
        let active_storage = TestDirectory::new("legacy-active-a");
        let requested_storage = TestDirectory::new("legacy-requested-b");
        let legacy_auth = requested_storage.path().join("auth.json");
        std::fs::write(&legacy_auth, "{}").expect("legacy auth fixture should be written");
        let calls = Arc::new(Mutex::new(Vec::new()));
        let fake = FakeAppServer {
            calls: Arc::clone(&calls),
            account_reads: VecDeque::from([Ok(true)]),
            rate_limits: VecDeque::from([Ok(supported_rate_limits())]),
            ..FakeAppServer::default()
        };
        let mut state = state_with_fake(active_ref, active_storage.path(), fake);
        state.authorized = true;

        let status = cleanup_legacy_codex_auth_file_core(
            &mut state,
            requested_ref,
            requested_storage.path(),
            |_| panic!("remove must not run for a mismatched binding"),
        )
        .expect("binding mismatch should return a status");

        assert_eq!(status.error_code, "LEGACY_CREDENTIAL_CLEANUP_FAILED");
        assert!(status.legacy_auth_present);
        assert!(calls.lock().expect("call log should lock").is_empty());
        assert!(legacy_auth.exists());
        assert_eq!(state.active_session_ref.as_deref(), Some(active_ref));
        assert_eq!(state.account_dir.as_deref(), Some(active_storage.path()));
    }
}
