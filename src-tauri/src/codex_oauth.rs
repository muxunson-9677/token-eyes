//! Self-contained Cockpit-compatible OpenAI OAuth flow for Codex Token Plans.
//!
//! Each Token plan gets its own storage directory. Credentials never leave the
//! native process; the dashboard only receives sanitized quota percentages.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const OAUTH_AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize";
const OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OAUTH_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
// Match the official Codex CLI flow. OpenAI's authorizer uses this value to
// select the registered localhost callback login experience.
const OAUTH_ORIGINATOR: &str = "codex_vscode";
const AUTH_USER_AGENT: &str = "codex_vscode/0.146.0";
const CALLBACK_PORT: u16 = 1455;
const OAUTH_TIMEOUT_SECONDS: u64 = 300;

#[derive(Debug)]
pub struct PendingCodexOAuth {
    pub redirect_uri: String,
    code_verifier: String,
    expected_state: String,
    receiver: Mutex<Receiver<Result<OAuthCallback, String>>>,
    cancelled: Arc<AtomicBool>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct OAuthCallback {
    code: String,
    state: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredCodexTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub id_token: String,
    #[serde(default)]
    pub account_id: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
}

fn apply_auth_identity_headers(request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    request
        .header("User-Agent", AUTH_USER_AGENT)
        .header("originator", OAUTH_ORIGINATOR)
}

#[derive(Debug, Clone, PartialEq)]
pub struct CodexUsageWindow {
    pub kind: String,
    pub used_percent: f64,
    pub resets_at: i64,
}

fn random_urlsafe(bytes: usize) -> String {
    let mut value = vec![0u8; bytes];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn build_authorize_url(redirect_uri: &str, verifier: &str, state: &str) -> String {
    let mut url =
        url::Url::parse(OAUTH_AUTHORIZE_URL).expect("constant OAuth issuer must be valid");
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", OAUTH_CLIENT_ID)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", "openid profile email offline_access")
        .append_pair("code_challenge", &pkce_challenge(verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("state", state)
        .append_pair("originator", OAUTH_ORIGINATOR);
    url.to_string()
}

fn parse_callback_target(target: &str) -> Result<OAuthCallback, String> {
    let parsed = url::Url::parse(&format!("http://localhost{target}"))
        .map_err(|_| "Codex OAuth callback URL is invalid".to_string())?;
    if parsed.path() != "/auth/callback" {
        return Err("Codex OAuth callback path is invalid".to_string());
    }
    let params = parsed
        .query_pairs()
        .into_owned()
        .collect::<std::collections::HashMap<_, _>>();
    if let Some(error) = params.get("error") {
        let detail = params
            .get("error_description")
            .map(String::as_str)
            .unwrap_or(error);
        return Err(format!("Codex authorization failed: {detail}"));
    }
    let code = params
        .get("code")
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| "Codex OAuth callback did not include an authorization code".to_string())?;
    let state = params
        .get("state")
        .filter(|value| !value.is_empty())
        .cloned()
        .ok_or_else(|| "Codex OAuth callback did not include state".to_string())?;
    Ok(OAuthCallback { code, state })
}

fn read_request_target(stream: &mut std::net::TcpStream) -> Result<String, String> {
    stream
        .set_read_timeout(Some(Duration::from_secs(OAUTH_TIMEOUT_SECONDS)))
        .map_err(|_| "Unable to configure Codex OAuth callback".to_string())?;
    let mut buffer = [0u8; 8192];
    let read = stream
        .read(&mut buffer)
        .map_err(|_| "Unable to read Codex OAuth callback".to_string())?;
    let request = String::from_utf8_lossy(&buffer[..read]);
    let target = request
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .ok_or_else(|| "Codex OAuth callback request is invalid".to_string())?;
    Ok(target.to_string())
}

fn write_callback_response(stream: &mut std::net::TcpStream, success: bool) {
    let (status, body) = if success {
        (
            "200 OK",
            "<!doctype html><meta charset=\"utf-8\"><title>Token Eyes</title><h1>Codex 授权已完成</h1><p>此页面将自动关闭，请返回 Token Eyes。</p><script>setTimeout(()=>window.close(),800)</script>",
        )
    } else {
        (
            "400 Bad Request",
            "<!doctype html><meta charset=\"utf-8\"><title>Token Eyes</title><h1>Codex 授权失败</h1><p>请返回 Token Eyes 后重试。</p>",
        )
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.as_bytes().len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

pub fn start_oauth_listener(_session_ref: &str) -> Result<(PendingCodexOAuth, String), String> {
    let listener = TcpListener::bind(("127.0.0.1", CALLBACK_PORT))
        .map_err(|_| "Codex OAuth callback port 1455 is occupied".to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|_| "Unable to configure Codex OAuth callback".to_string())?;
    let redirect_uri = "http://localhost:1455/auth/callback".to_string();
    let code_verifier = random_urlsafe(64);
    let expected_state = random_urlsafe(32);
    let auth_url = build_authorize_url(&redirect_uri, &code_verifier, &expected_state);
    let (sender, receiver) = mpsc::channel();
    let cancelled = Arc::new(AtomicBool::new(false));
    let listener_cancelled = Arc::clone(&cancelled);
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(OAUTH_TIMEOUT_SECONDS);
        let result = loop {
            if listener_cancelled.load(Ordering::Acquire) {
                break Err("Codex OAuth callback was cancelled".to_string());
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let callback = read_request_target(&mut stream)
                        .and_then(|target| parse_callback_target(&target));
                    write_callback_response(&mut stream, callback.is_ok());
                    break callback;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() >= deadline {
                        break Err("Codex OAuth callback timed out".to_string());
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(_) => break Err("Unable to accept Codex OAuth callback".to_string()),
            }
        };
        let _ = sender.send(result);
    });
    Ok((
        PendingCodexOAuth {
            redirect_uri,
            code_verifier,
            expected_state,
            receiver: Mutex::new(receiver),
            cancelled,
        },
        auth_url,
    ))
}

impl Drop for PendingCodexOAuth {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
    }
}

impl PendingCodexOAuth {
    pub fn authorize_url(&self) -> String {
        build_authorize_url(
            &self.redirect_uri,
            &self.code_verifier,
            &self.expected_state,
        )
    }

    fn try_callback(&self) -> Result<Option<OAuthCallback>, String> {
        let receiver = self
            .receiver
            .lock()
            .map_err(|_| "Codex OAuth callback state is unavailable".to_string())?;
        match receiver.try_recv() {
            Ok(result) => result.map(Some),
            Err(TryRecvError::Empty) => Ok(None),
            Err(TryRecvError::Disconnected) => {
                Err("Codex OAuth callback listener stopped".to_string())
            }
        }
    }
}

pub async fn complete_oauth(
    pending: &PendingCodexOAuth,
) -> Result<Option<StoredCodexTokens>, String> {
    complete_oauth_with_endpoint(pending, OAUTH_TOKEN_URL).await
}

async fn complete_oauth_with_endpoint(
    pending: &PendingCodexOAuth,
    token_endpoint: &str,
) -> Result<Option<StoredCodexTokens>, String> {
    let Some(callback) = pending.try_callback()? else {
        return Ok(None);
    };
    if callback.state != pending.expected_state {
        return Err("Codex OAuth state validation failed".to_string());
    }
    let response = apply_auth_identity_headers(reqwest::Client::new().post(token_endpoint))
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", callback.code.as_str()),
            ("redirect_uri", pending.redirect_uri.as_str()),
            ("client_id", OAUTH_CLIENT_ID),
            ("code_verifier", pending.code_verifier.as_str()),
        ])
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Codex OAuth token exchange could not reach OpenAI".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Codex OAuth token exchange failed (HTTP {})",
            response.status()
        ));
    }
    let tokens: TokenResponse = response
        .json()
        .await
        .map_err(|_| "Codex OAuth token response format is invalid".to_string())?;
    let id_token = tokens
        .id_token
        .ok_or_else(|| "Codex OAuth token response is missing id_token".to_string())?;
    let account_id = account_id_from_id_token(&id_token).unwrap_or_default();
    Ok(Some(StoredCodexTokens {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token.unwrap_or_default(),
        id_token,
        account_id,
    }))
}

pub async fn refresh_tokens(tokens: &StoredCodexTokens) -> Result<StoredCodexTokens, String> {
    refresh_tokens_with_endpoint(tokens, OAUTH_TOKEN_URL).await
}

async fn refresh_tokens_with_endpoint(
    tokens: &StoredCodexTokens,
    token_endpoint: &str,
) -> Result<StoredCodexTokens, String> {
    let response = apply_auth_identity_headers(reqwest::Client::new().post(token_endpoint))
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("client_id", OAUTH_CLIENT_ID),
        ])
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|_| "Codex OAuth refresh could not reach OpenAI".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Codex OAuth refresh failed (HTTP {})",
            response.status()
        ));
    }
    let refreshed: TokenResponse = response
        .json()
        .await
        .map_err(|_| "Codex OAuth refresh response format is invalid".to_string())?;
    let id_token = refreshed
        .id_token
        .unwrap_or_else(|| tokens.id_token.clone());
    let account_id =
        account_id_from_id_token(&id_token).unwrap_or_else(|| tokens.account_id.clone());
    Ok(StoredCodexTokens {
        access_token: refreshed.access_token,
        refresh_token: refreshed
            .refresh_token
            .unwrap_or_else(|| tokens.refresh_token.clone()),
        id_token,
        account_id,
    })
}

fn id_token_claims(id_token: &str) -> Option<Value> {
    let payload = id_token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn account_id_from_id_token(id_token: &str) -> Option<String> {
    id_token_claims(id_token)?
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object)
        .and_then(|auth| auth.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

pub fn account_label_from_id_token(id_token: &str) -> Option<String> {
    id_token_claims(id_token)?
        .get("email")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(str::to_string)
}

pub fn subscription_expires_at_from_id_token(id_token: &str) -> Option<String> {
    id_token_claims(id_token)?
        .get("https://api.openai.com/auth")
        .and_then(Value::as_object)
        .and_then(|auth| auth.get("chatgpt_subscription_active_until"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub fn save_tokens(directory: &Path, tokens: &StoredCodexTokens) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|_| "Unable to prepare Codex account storage".to_string())?;
    let saved_at = chrono::Utc::now().to_rfc3339();
    let saved_at_unix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let value = serde_json::json!({
        "OPENAI_API_KEY": Value::Null,
        "auth_mode": "chatgpt",
        "last_refresh": saved_at,
        "last_refresh_unix": saved_at_unix,
        "tokens": tokens,
    });
    let temporary = directory.join("token-eyes-oauth.json.tmp");
    let destination = directory.join("token-eyes-oauth.json");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(&value)
            .map_err(|_| "Unable to encode Codex credentials".to_string())?,
    )
    .map_err(|_| "Unable to save Codex credentials".to_string())?;
    fs::rename(temporary, destination)
        .map_err(|_| "Unable to finalize Codex credentials".to_string())
}

pub fn load_tokens(directory: &Path) -> Result<Option<StoredCodexTokens>, String> {
    let path = directory.join("token-eyes-oauth.json");
    if !path.is_file() {
        return Ok(None);
    }
    let value: Value = serde_json::from_slice(
        &fs::read(path).map_err(|_| "Unable to read Codex credentials".to_string())?,
    )
    .map_err(|_| "Codex credentials are invalid".to_string())?;
    let tokens = serde_json::from_value(value.get("tokens").cloned().unwrap_or(Value::Null))
        .map_err(|_| "Codex credentials are incomplete".to_string())?;
    Ok(Some(tokens))
}

/// Upgrades an older Token Eyes managed OAuth envelope without consulting a
/// separately installed Codex CLI.
pub fn ensure_app_server_auth_envelope(directory: &Path) -> Result<(), String> {
    let path = directory.join("token-eyes-oauth.json");
    if !path.is_file() {
        return Ok(());
    }
    let raw: Value = serde_json::from_slice(
        &fs::read(&path).map_err(|_| "Unable to read Codex credentials".to_string())?,
    )
    .map_err(|_| "Codex credentials are invalid".to_string())?;
    let already_compatible = raw.get("OPENAI_API_KEY").is_some()
        && raw
            .get("last_refresh")
            .and_then(Value::as_str)
            .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok());
    if already_compatible {
        return Ok(());
    }
    let tokens = serde_json::from_value(raw.get("tokens").cloned().unwrap_or(Value::Null))
        .map_err(|_| "Codex credentials are incomplete".to_string())?;
    save_tokens(directory, &tokens)
}

pub fn parse_usage_response(value: &Value) -> Result<Vec<CodexUsageWindow>, String> {
    let limits = value
        .get("rate_limit")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex usage response is missing rate_limit".to_string())?;
    let mut windows = Vec::new();
    for (field, fallback_kind) in [
        ("primary_window", "rolling_5_hour"),
        ("secondary_window", "rolling_weekly"),
    ] {
        let Some(window) = limits.get(field).and_then(Value::as_object) else {
            continue;
        };
        let Some(used_percent) = window.get("used_percent").and_then(Value::as_f64) else {
            continue;
        };
        let kind = match window.get("limit_window_seconds").and_then(Value::as_i64) {
            Some(18_000) => "rolling_5_hour",
            Some(604_800) => "rolling_weekly",
            _ => fallback_kind,
        };
        windows.push(CodexUsageWindow {
            kind: kind.to_string(),
            used_percent: used_percent.clamp(0.0, 100.0),
            resets_at: window.get("reset_at").and_then(Value::as_i64).unwrap_or(0),
        });
    }
    for additional in value
        .get("additional_rate_limits")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let limit_name = additional
            .get("limit_name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if !limit_name.contains("gpt-5.3") || !limit_name.contains("codex-spark") {
            continue;
        }
        let Some(rate_limit) = additional.get("rate_limit").and_then(Value::as_object) else {
            continue;
        };
        for field in ["primary_window", "secondary_window"] {
            let Some(window) = rate_limit.get(field).and_then(Value::as_object) else {
                continue;
            };
            let Some(used_percent) = window.get("used_percent").and_then(Value::as_f64) else {
                continue;
            };
            let kind = match window.get("limit_window_seconds").and_then(Value::as_i64) {
                Some(18_000) => "gpt_5_3_codex_spark_5_hour",
                _ => "gpt_5_3_codex_spark_weekly",
            };
            windows.push(CodexUsageWindow {
                kind: kind.to_string(),
                used_percent: used_percent.clamp(0.0, 100.0),
                resets_at: window.get("reset_at").and_then(Value::as_i64).unwrap_or(0),
            });
        }
    }
    if windows.is_empty() {
        return Err("Codex returned no supported quota windows".to_string());
    }
    Ok(windows)
}

pub async fn fetch_usage(tokens: &StoredCodexTokens) -> Result<Vec<CodexUsageWindow>, String> {
    let mut request = reqwest::Client::new()
        .get("https://chatgpt.com/backend-api/wham/usage")
        .bearer_auth(&tokens.access_token)
        .header("User-Agent", "codex-cli")
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(15));
    if !tokens.account_id.is_empty() {
        request = request.header("ChatGPT-Account-Id", &tokens.account_id);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Unable to reach the official Codex usage service".to_string())?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("Codex authorization has expired; reconnect this account".to_string());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Codex usage service returned HTTP {}",
            response.status()
        ));
    }
    let value: Value = response
        .json()
        .await
        .map_err(|_| "Codex usage response format is invalid".to_string())?;
    parse_usage_response(&value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_official_pkce_authorize_url() {
        let url = url::Url::parse(&build_authorize_url(
            "http://localhost:1455/auth/callback",
            "verifier",
            "state-value",
        ))
        .unwrap();
        let query = url
            .query_pairs()
            .into_owned()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(url.host_str(), Some("auth.openai.com"));
        assert_eq!(
            query.get("client_id").map(String::as_str),
            Some(OAUTH_CLIENT_ID)
        );
        assert_eq!(
            query.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            query.get("originator").map(String::as_str),
            Some(OAUTH_ORIGINATOR)
        );
        assert_eq!(query.get("state").map(String::as_str), Some("state-value"));
    }

    #[test]
    fn callback_requires_code_and_state() {
        assert_eq!(
            parse_callback_target("/auth/callback?code=abc&state=xyz").unwrap(),
            OAuthCallback {
                code: "abc".into(),
                state: "xyz".into()
            }
        );
        assert!(parse_callback_target("/auth/callback?code=abc").is_err());
        assert!(parse_callback_target("/wrong?code=abc&state=xyz").is_err());
    }

    #[test]
    fn callback_exchanges_the_code_with_the_same_pkce_verifier() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let captured = Arc::new(Mutex::new(String::new()));
        let captured_request = Arc::clone(&captured);
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut request = [0u8; 8192];
            let read = stream.read(&mut request).unwrap();
            *captured_request.lock().unwrap() =
                String::from_utf8_lossy(&request[..read]).to_string();
            let body = r#"{"access_token":"access","refresh_token":"refresh","id_token":"e30.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.sig"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body,
            );
            stream.write_all(response.as_bytes()).unwrap();
        });

        let (sender, receiver) = mpsc::channel();
        sender
            .send(Ok(OAuthCallback {
                code: "authorization-code".to_string(),
                state: "expected-state".to_string(),
            }))
            .unwrap();
        let pending = PendingCodexOAuth {
            redirect_uri: "http://localhost:1455/auth/callback".to_string(),
            code_verifier: "pkce-verifier".to_string(),
            expected_state: "expected-state".to_string(),
            receiver: Mutex::new(receiver),
            cancelled: Arc::new(AtomicBool::new(false)),
        };

        let tokens = tauri::async_runtime::block_on(complete_oauth_with_endpoint(
            &pending,
            &format!("http://{address}/oauth/token"),
        ))
        .expect("synthetic token exchange should succeed")
        .expect("callback should be ready");
        server.join().unwrap();

        assert_eq!(tokens.access_token, "access");
        let request = captured.lock().unwrap();
        let lowercase_request = request.to_ascii_lowercase();
        assert!(lowercase_request.contains("user-agent: codex_vscode/0.146.0"));
        assert!(lowercase_request.contains("originator: codex_vscode"));
        assert!(request.contains("grant_type=authorization_code"));
        assert!(request.contains("code=authorization-code"));
        assert!(request.contains("code_verifier=pkce-verifier"));
        assert!(request.contains("redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback"));
    }

    #[test]
    fn refresh_exchange_uses_the_managed_refresh_token_without_codex_cli() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let captured = Arc::new(Mutex::new(String::new()));
        let captured_request = Arc::clone(&captured);
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 8192];
            let read = stream.read(&mut request).unwrap();
            *captured_request.lock().unwrap() =
                String::from_utf8_lossy(&request[..read]).to_string();
            let body = r#"{"access_token":"access-two","refresh_token":"refresh-two","id_token":"e30.eyJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20ifQ.sig"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body,
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        let previous = StoredCodexTokens {
            access_token: "access-one".into(),
            refresh_token: "refresh-one".into(),
            id_token: "id-one".into(),
            account_id: "account-one".into(),
        };

        let refreshed = tauri::async_runtime::block_on(refresh_tokens_with_endpoint(
            &previous,
            &format!("http://{address}/oauth/token"),
        ))
        .expect("synthetic refresh should succeed");
        server.join().unwrap();

        assert_eq!(refreshed.access_token, "access-two");
        assert_eq!(refreshed.refresh_token, "refresh-two");
        let request = captured.lock().unwrap();
        let lowercase_request = request.to_ascii_lowercase();
        assert!(lowercase_request.contains("user-agent: codex_vscode/0.146.0"));
        assert!(lowercase_request.contains("originator: codex_vscode"));
        assert!(request.contains("grant_type=refresh_token"));
        assert!(request.contains("refresh_token=refresh-one"));
        assert!(request.contains("client_id=app_EMoamEEZ73f0CkXaXp7hrann"));
        assert!(!request.contains("scope="));
    }

    #[test]
    fn refresh_preserves_tokens_that_openai_does_not_rotate() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 8192];
            let _ = stream.read(&mut request).unwrap();
            let body = r#"{"access_token":"access-two"}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body,
            );
            stream.write_all(response.as_bytes()).unwrap();
        });
        let previous = StoredCodexTokens {
            access_token: "access-one".into(),
            refresh_token: "refresh-one".into(),
            id_token: "id-one".into(),
            account_id: "account-one".into(),
        };

        let refreshed = tauri::async_runtime::block_on(refresh_tokens_with_endpoint(
            &previous,
            &format!("http://{address}/oauth/token"),
        ))
        .expect("synthetic refresh should preserve unrotated credentials");
        server.join().unwrap();

        assert_eq!(refreshed.access_token, "access-two");
        assert_eq!(refreshed.refresh_token, "refresh-one");
        assert_eq!(refreshed.id_token, "id-one");
        assert_eq!(refreshed.account_id, "account-one");
    }

    #[test]
    fn cockpit_style_callback_window_matches_the_five_minute_ui() {
        assert_eq!(OAUTH_TIMEOUT_SECONDS, 300);
    }

    #[test]
    fn cancelling_a_pending_login_releases_port_1455_for_an_immediate_retry() {
        let (pending, _) = start_oauth_listener("token-plan/codex/session/cancel-one")
            .expect("first listener should start");
        drop(pending);

        let deadline = std::time::Instant::now() + Duration::from_secs(1);
        loop {
            match start_oauth_listener("token-plan/codex/session/cancel-two") {
                Ok((retry, _)) => {
                    drop(retry);
                    break;
                }
                Err(_) if std::time::Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(error) => panic!("callback port stayed occupied after cancel: {error}"),
            }
        }
    }

    #[test]
    fn parses_official_wham_usage_windows() {
        let windows = parse_usage_response(&serde_json::json!({
            "rate_limit": {
                "primary_window": { "used_percent": 22.5, "reset_at": 123 },
                "secondary_window": { "used_percent": 67.0, "reset_at": 456 }
            }
        }))
        .unwrap();
        assert_eq!(windows[0].kind, "rolling_5_hour");
        assert_eq!(windows[0].used_percent, 22.5);
        assert_eq!(windows[1].kind, "rolling_weekly");
        assert_eq!(windows[1].resets_at, 456);
    }

    #[test]
    fn parses_real_wham_weekly_and_gpt_5_3_additional_limits() {
        let windows = parse_usage_response(&serde_json::json!({
            "rate_limit": {
                "primary_window": {
                    "used_percent": 4,
                    "limit_window_seconds": 604800,
                    "reset_at": 1787196799
                }
            },
            "additional_rate_limits": [{
                "limit_name": "GPT-5.3-Codex-Spark",
                "metered_feature": "codex_bengalfox",
                "rate_limit": {
                    "primary_window": {
                        "used_percent": 56,
                        "limit_window_seconds": 604800,
                        "reset_at": 1787701607
                    }
                }
            }]
        }))
        .unwrap();

        assert_eq!(windows.len(), 2);
        assert_eq!(windows[0].kind, "rolling_weekly");
        assert_eq!(windows[0].used_percent, 4.0);
        assert_eq!(windows[1].kind, "gpt_5_3_codex_spark_weekly");
        assert_eq!(windows[1].used_percent, 56.0);
    }

    #[test]
    fn extracts_account_id_from_id_token_without_exposing_claims() {
        let payload = URL_SAFE_NO_PAD
            .encode(br#"{"https://api.openai.com/auth":{"chatgpt_account_id":"acct-123"}}"#);
        assert_eq!(
            account_id_from_id_token(&format!("x.{payload}.y")).as_deref(),
            Some("acct-123")
        );
    }

    #[test]
    fn extracts_email_label_from_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"muxunson@gmail.com"}"#);
        assert_eq!(
            account_label_from_id_token(&format!("x.{payload}.y")).as_deref(),
            Some("muxunson@gmail.com")
        );
    }

    #[test]
    fn extracts_official_subscription_expiry_from_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(
            br#"{"https://api.openai.com/auth":{"chatgpt_subscription_active_until":"2026-08-30T14:24:24+00:00"}}"#,
        );
        assert_eq!(
            subscription_expires_at_from_id_token(&format!("x.{payload}.y")).as_deref(),
            Some("2026-08-30T14:24:24+00:00")
        );
    }

    #[test]
    fn stores_two_oauth_accounts_without_overwriting_each_other() {
        let root = std::env::temp_dir().join(format!("token-eyes-codex-{}", random_urlsafe(8)));
        let first = root.join("account-one");
        let second = root.join("account-two");
        let first_tokens = StoredCodexTokens {
            access_token: "access-one".into(),
            refresh_token: "refresh-one".into(),
            id_token: "id-one".into(),
            account_id: "account-one".into(),
        };
        let second_tokens = StoredCodexTokens {
            access_token: "access-two".into(),
            refresh_token: "refresh-two".into(),
            id_token: "id-two".into(),
            account_id: "account-two".into(),
        };

        save_tokens(&first, &first_tokens).unwrap();
        save_tokens(&second, &second_tokens).unwrap();

        assert_eq!(load_tokens(&first).unwrap(), Some(first_tokens));
        assert_eq!(load_tokens(&second).unwrap(), Some(second_tokens));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reauthorization_replaces_the_same_managed_credential_file() {
        let root = std::env::temp_dir().join(format!(
            "token-eyes-codex-reauthorize-{}",
            random_urlsafe(8)
        ));
        let first = StoredCodexTokens {
            access_token: "access-one".into(),
            refresh_token: "refresh-one".into(),
            id_token: "id-one".into(),
            account_id: "account-one".into(),
        };
        let second = StoredCodexTokens {
            access_token: "access-two".into(),
            refresh_token: "refresh-two".into(),
            id_token: "id-two".into(),
            account_id: "account-two".into(),
        };

        save_tokens(&root, &first).expect("first authorization should persist");
        save_tokens(&root, &second).expect("reauthorization should replace managed credentials");
        assert_eq!(load_tokens(&root).unwrap(), Some(second));
        assert!(!root.join("token-eyes-oauth.json.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stores_a_codex_app_server_compatible_auth_envelope() {
        let root =
            std::env::temp_dir().join(format!("token-eyes-codex-envelope-{}", random_urlsafe(8)));
        let tokens = StoredCodexTokens {
            access_token: "access".into(),
            refresh_token: "refresh".into(),
            id_token: "id".into(),
            account_id: "account".into(),
        };

        save_tokens(&root, &tokens).unwrap();

        let raw: Value =
            serde_json::from_slice(&fs::read(root.join("token-eyes-oauth.json")).unwrap()).unwrap();
        assert!(raw.get("OPENAI_API_KEY").is_some());
        assert!(raw
            .get("last_refresh")
            .and_then(Value::as_str)
            .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok()));
        assert!(raw
            .get("last_refresh_unix")
            .and_then(Value::as_u64)
            .is_some());
        assert_eq!(
            raw.pointer("/tokens/access_token").and_then(Value::as_str),
            Some("access")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn upgrades_a_legacy_token_eyes_auth_envelope_for_codex_app_server() {
        let root =
            std::env::temp_dir().join(format!("token-eyes-codex-migrate-{}", random_urlsafe(8)));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("token-eyes-oauth.json"),
            serde_json::to_vec(&serde_json::json!({
                "auth_mode": "chatgpt",
                "last_refresh_unix": 123,
                "tokens": {
                    "access_token": "access",
                    "refresh_token": "refresh",
                    "id_token": "id",
                    "account_id": "account"
                }
            }))
            .unwrap(),
        )
        .unwrap();

        ensure_app_server_auth_envelope(&root).unwrap();

        let raw: Value =
            serde_json::from_slice(&fs::read(root.join("token-eyes-oauth.json")).unwrap()).unwrap();
        assert!(raw.get("OPENAI_API_KEY").is_some());
        assert!(raw
            .get("last_refresh")
            .and_then(Value::as_str)
            .is_some_and(|value| chrono::DateTime::parse_from_rfc3339(value).is_ok()));
        assert_eq!(
            raw.pointer("/tokens/account_id").and_then(Value::as_str),
            Some("account")
        );
        let _ = fs::remove_dir_all(root);
    }
}
