//! Minimal client for OpenAI's official `codex app-server` JSONL protocol.
//!
//! The reader immediately reduces protocol messages to the small set of
//! account states Token Eyes needs. Raw JSONL, account details, and login
//! errors are never logged or returned to the dashboard.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const INITIALIZE_METHOD: &str = "initialize";
const INITIALIZED_METHOD: &str = "initialized";
const ACCOUNT_READ_METHOD: &str = "account/read";
const ACCOUNT_UPDATED_METHOD: &str = "account/updated";
const LOGIN_START_METHOD: &str = "account/login/start";
const LOGIN_COMPLETED_METHOD: &str = "account/login/completed";
const LOGOUT_METHOD: &str = "account/logout";
const RATE_LIMITS_READ_METHOD: &str = "account/rateLimits/read";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const QUEUE_LIMIT: usize = 256;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LoginCompletion {
    Pending,
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrowserLoginStart {
    pub login_id: String,
    pub auth_url: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SanitizedRateLimitWindow {
    pub kind: String,
    pub used_percent: f64,
    pub resets_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SanitizedRateLimits {
    pub windows: Vec<SanitizedRateLimitWindow>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CodexExecutable {
    Direct(PathBuf),
    CmdScript(PathBuf),
}

#[derive(Debug)]
enum ResponsePayload {
    Acknowledged,
    AccountAuthorized(bool),
    LoginStarted(BrowserLoginStart),
    RateLimits(SanitizedRateLimits),
    Rejected,
}

#[derive(Debug)]
enum IncomingMessage {
    Response { id: u64, payload: ResponsePayload },
    LoginCompleted { login_id: String, success: bool },
    AccountUpdated { authorized: bool },
}

pub struct AppServerClient {
    child: Child,
    stdin: Option<ChildStdin>,
    incoming: Arc<Mutex<VecDeque<IncomingMessage>>>,
    reader: Option<JoinHandle<()>>,
    next_id: u64,
}

pub fn validate_auth_url(url: &str) -> bool {
    let Ok(parsed) = url::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" || !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    let Some(host) = parsed.host_str() else {
        return false;
    };
    ["chatgpt.com", "openai.com"]
        .iter()
        .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

pub fn parse_login_start_response(message: &Value) -> Result<BrowserLoginStart, String> {
    let result = message
        .get("result")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex login response is missing a result".to_string())?;
    let login_id = result
        .get("loginId")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Codex login response is missing loginId".to_string())?;
    let auth_url = result
        .get("authUrl")
        .and_then(Value::as_str)
        .filter(|value| validate_auth_url(value))
        .ok_or_else(|| "Codex returned a non-official authorization URL".to_string())?;
    Ok(BrowserLoginStart {
        login_id: login_id.to_string(),
        auth_url: auth_url.to_string(),
    })
}

pub fn parse_account_authorized(message: &Value) -> bool {
    message
        .pointer("/result/account/type")
        .and_then(Value::as_str)
        == Some("chatgpt")
}

pub fn parse_rate_limits_response(message: &Value) -> Result<SanitizedRateLimits, String> {
    let limits = message
        .pointer("/result/rateLimits")
        .and_then(Value::as_object)
        .or_else(|| {
            message
                .pointer("/result/rateLimitsByLimitId/codex")
                .and_then(Value::as_object)
        })
        .or_else(|| {
            message
                .pointer("/result/rateLimitsByLimitId")
                .and_then(Value::as_object)
                .and_then(|buckets| {
                    buckets.values().find_map(|bucket| {
                        let object = bucket.as_object()?;
                        (object.get("limitId").and_then(Value::as_str) == Some("codex"))
                            .then_some(object)
                    })
                })
        })
        .ok_or_else(|| "Codex rate-limit response is missing rateLimits".to_string())?;
    let mut windows = Vec::new();
    for name in ["primary", "secondary"] {
        let Some(window) = limits.get(name).and_then(Value::as_object) else {
            continue;
        };
        let Some(duration) = window.get("windowDurationMins").and_then(Value::as_i64) else {
            continue;
        };
        let kind = match duration {
            300 => "rolling_5_hour",
            10_080 => "rolling_weekly",
            _ => continue,
        };
        let Some(used_percent) = window.get("usedPercent").and_then(Value::as_f64) else {
            continue;
        };
        if !used_percent.is_finite() {
            continue;
        }
        windows.push(SanitizedRateLimitWindow {
            kind: kind.to_string(),
            used_percent: used_percent.clamp(0.0, 100.0),
            resets_at: window.get("resetsAt").and_then(Value::as_i64).unwrap_or(0),
        });
    }
    if windows.is_empty() {
        return Err("Codex returned no supported rate-limit windows".to_string());
    }
    Ok(SanitizedRateLimits { windows })
}

fn classify_incoming(message: Value) -> Option<IncomingMessage> {
    if message.get("method").and_then(Value::as_str) == Some(LOGIN_COMPLETED_METHOD) {
        let login_id = message
            .pointer("/params/loginId")
            .and_then(Value::as_str)?
            .to_string();
        let success = message
            .pointer("/params/success")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        return Some(IncomingMessage::LoginCompleted { login_id, success });
    }
    if message.get("method").and_then(Value::as_str) == Some(ACCOUNT_UPDATED_METHOD) {
        let authorized =
            message.pointer("/params/authMode").and_then(Value::as_str) == Some("chatgpt");
        return Some(IncomingMessage::AccountUpdated { authorized });
    }

    let id = message.get("id").and_then(Value::as_u64)?;
    let payload = if message.get("error").is_some() {
        ResponsePayload::Rejected
    } else if message.pointer("/result/authUrl").is_some() {
        match parse_login_start_response(&message) {
            Ok(result) => ResponsePayload::LoginStarted(result),
            Err(_) => ResponsePayload::Rejected,
        }
    } else if message.pointer("/result/rateLimits").is_some()
        || message.pointer("/result/rateLimitsByLimitId").is_some()
    {
        match parse_rate_limits_response(&message) {
            Ok(result) => ResponsePayload::RateLimits(result),
            Err(_) => ResponsePayload::Rejected,
        }
    } else if message.pointer("/result/account").is_some()
        || message.pointer("/result/requiresOpenaiAuth").is_some()
    {
        ResponsePayload::AccountAuthorized(parse_account_authorized(&message))
    } else {
        ResponsePayload::Acknowledged
    };
    Some(IncomingMessage::Response { id, payload })
}

pub fn resolve_codex_executable_with<F>(
    path_entries: &[PathBuf],
    app_data: Option<&Path>,
    windows: bool,
    exists: F,
) -> Option<CodexExecutable>
where
    F: Fn(&Path) -> bool,
{
    let mut directories = path_entries.to_vec();
    if windows {
        if let Some(app_data) = app_data {
            let npm = app_data.join("npm");
            if !directories.contains(&npm) {
                directories.push(npm);
            }
        }
    }

    for directory in directories {
        if windows {
            let executable = directory.join("codex.exe");
            if exists(&executable) {
                return Some(CodexExecutable::Direct(executable));
            }
            let script = directory.join("codex.cmd");
            if exists(&script) {
                return Some(CodexExecutable::CmdScript(script));
            }
        } else {
            let executable = directory.join("codex");
            if exists(&executable) {
                return Some(CodexExecutable::Direct(executable));
            }
        }
    }
    None
}

fn resolve_codex_executable() -> Option<CodexExecutable> {
    let path_entries = std::env::var_os("PATH")
        .map(|value| std::env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let app_data = std::env::var_os("APPDATA").map(PathBuf::from);
    resolve_codex_executable_with(
        &path_entries,
        app_data.as_deref(),
        cfg!(windows),
        Path::is_file,
    )
}

fn build_command(executable: &CodexExecutable) -> Result<Command, String> {
    let mut command = match executable {
        CodexExecutable::Direct(path) => {
            let mut command = Command::new(path);
            command.arg("app-server");
            command
        }
        CodexExecutable::CmdScript(path) => {
            let path_text = path.to_string_lossy();
            if path_text.contains(['\r', '\n']) {
                return Err("Codex command path contains unsupported characters".to_string());
            }
            let mut command = Command::new(path);
            command.arg("app-server");
            command
        }
    };
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    Ok(command)
}

impl AppServerClient {
    pub fn start(codex_home: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(codex_home)
            .map_err(|_| "Unable to prepare Token Eyes Codex account storage".to_string())?;
        let executable = resolve_codex_executable().ok_or_else(|| {
            "未找到 OpenAI Codex 组件，请先安装或更新官方 Codex CLI 后重试。".to_string()
        })?;
        let mut command = build_command(&executable)?;
        command.env("CODEX_HOME", codex_home);
        let mut child = command
            .spawn()
            .map_err(|_| "Unable to start the official Codex component".to_string())?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex app-server stdin is unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Codex app-server stdout is unavailable".to_string())?;
        let incoming = Arc::new(Mutex::new(VecDeque::new()));
        let reader_queue = Arc::clone(&incoming);
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(message) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                let Some(message) = classify_incoming(message) else {
                    continue;
                };
                let Ok(mut queue) = reader_queue.lock() else {
                    break;
                };
                if queue.len() >= QUEUE_LIMIT {
                    queue.pop_front();
                }
                queue.push_back(message);
            }
        });

        let mut client = Self {
            child,
            stdin: Some(stdin),
            incoming,
            reader: Some(reader),
            next_id: 1,
        };
        match client.request(
            INITIALIZE_METHOD,
            Some(json!({
                "clientInfo": {
                    "name": "token_eyes",
                    "title": "Token Eyes",
                    "version": env!("CARGO_PKG_VERSION")
                }
            })),
        )? {
            ResponsePayload::Acknowledged => {}
            _ => return Err("Codex app-server initialization failed".to_string()),
        }
        client.notify(INITIALIZED_METHOD, Some(json!({})))?;
        Ok(client)
    }

    pub fn read_account_authorized(&mut self, refresh_token: bool) -> Result<bool, String> {
        match self.request(
            ACCOUNT_READ_METHOD,
            Some(json!({ "refreshToken": refresh_token })),
        )? {
            ResponsePayload::AccountAuthorized(authorized) => Ok(authorized),
            _ => Err("Codex account state is unavailable".to_string()),
        }
    }

    pub fn start_browser_login(&mut self) -> Result<BrowserLoginStart, String> {
        match self.request(
            LOGIN_START_METHOD,
            Some(json!({
                "type": "chatgpt",
                "useHostedLoginSuccessPage": true,
                "appBrand": "codex"
            })),
        )? {
            ResponsePayload::LoginStarted(result) => Ok(result),
            _ => Err("Codex browser login could not be started".to_string()),
        }
    }

    pub fn poll_login(&mut self, expected_login_id: &str) -> LoginCompletion {
        let Ok(mut queue) = self.incoming.lock() else {
            return LoginCompletion::Failed;
        };
        let position = queue.iter().position(|message| {
            matches!(
                message,
                IncomingMessage::LoginCompleted { login_id, .. } if login_id == expected_login_id
            )
        });
        let Some(IncomingMessage::LoginCompleted { success, .. }) =
            position.and_then(|index| queue.remove(index))
        else {
            return LoginCompletion::Pending;
        };
        if success {
            LoginCompletion::Succeeded
        } else {
            LoginCompletion::Failed
        }
    }

    pub fn poll_account_update(&mut self) -> Option<bool> {
        let Ok(mut queue) = self.incoming.lock() else {
            return None;
        };
        let mut latest = None;
        let mut index = 0;
        while index < queue.len() {
            if matches!(
                queue.get(index),
                Some(IncomingMessage::AccountUpdated { .. })
            ) {
                if let Some(IncomingMessage::AccountUpdated { authorized }) = queue.remove(index) {
                    latest = Some(authorized);
                }
            } else {
                index += 1;
            }
        }
        latest
    }

    pub fn read_rate_limits(&mut self) -> Result<SanitizedRateLimits, String> {
        match self.request(RATE_LIMITS_READ_METHOD, None)? {
            ResponsePayload::RateLimits(result) => Ok(result),
            _ => Err("Codex rate limits are unavailable".to_string()),
        }
    }

    pub fn logout(&mut self) -> Result<(), String> {
        match self.request(LOGOUT_METHOD, None)? {
            ResponsePayload::Acknowledged => Ok(()),
            _ => Err("Codex logout failed".to_string()),
        }
    }

    fn notify(&mut self, method: &str, params: Option<Value>) -> Result<(), String> {
        let mut message = json!({ "method": method });
        if let Some(params) = params {
            message["params"] = params;
        }
        self.write_message(&message)
    }

    fn request(&mut self, method: &str, params: Option<Value>) -> Result<ResponsePayload, String> {
        let id = self.next_id;
        self.next_id += 1;
        let mut message = json!({ "method": method, "id": id });
        if let Some(params) = params {
            message["params"] = params;
        }
        self.write_message(&message)?;
        let started = Instant::now();
        while started.elapsed() < REQUEST_TIMEOUT {
            if let Ok(mut queue) = self.incoming.lock() {
                let position = queue.iter().position(|message| {
                    matches!(message, IncomingMessage::Response { id: response_id, .. } if *response_id == id)
                });
                if let Some(IncomingMessage::Response { payload, .. }) =
                    position.and_then(|index| queue.remove(index))
                {
                    return match payload {
                        ResponsePayload::Rejected => {
                            Err(format!("Codex app-server rejected {method}"))
                        }
                        payload => Ok(payload),
                    };
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
        Err(format!("Codex app-server timed out during {method}"))
    }

    fn write_message(&mut self, message: &Value) -> Result<(), String> {
        let stdin = self
            .stdin
            .as_mut()
            .ok_or_else(|| "Codex app-server stdin is closed".to_string())?;
        serde_json::to_writer(&mut *stdin, message)
            .map_err(|_| "Unable to encode a Codex app-server request".to_string())?;
        stdin
            .write_all(b"\n")
            .and_then(|_| stdin.flush())
            .map_err(|_| "Unable to write to the Codex app-server".to_string())
    }
}

impl Drop for AppServerClient {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_official_https_auth_urls() {
        assert!(validate_auth_url(
            "https://chatgpt.com/auth/authorize?client_id=token-eyes-test"
        ));
        assert!(validate_auth_url("https://auth.openai.com/authorize"));
        assert!(!validate_auth_url(
            "https://chatgpt.com.evil.example/auth/authorize"
        ));
        assert!(!validate_auth_url("http://chatgpt.com/auth/authorize"));
        assert!(!validate_auth_url("https://user@chatgpt.com/authorize"));
    }

    #[test]
    fn parses_matching_login_completion_notification() {
        let message = json!({
            "method": "account/login/completed",
            "params": { "loginId": "login-1", "success": true }
        });
        assert!(matches!(
            classify_incoming(message),
            Some(IncomingMessage::LoginCompleted { login_id, success: true })
                if login_id == "login-1"
        ));
    }

    #[test]
    fn parses_sanitized_rate_limit_windows() {
        let message = json!({
            "id": 7,
            "result": {
                "rateLimits": {
                    "primary": {
                        "usedPercent": 25.5,
                        "windowDurationMins": 300,
                        "resetsAt": 1783900800
                    },
                    "secondary": {
                        "usedPercent": 50,
                        "windowDurationMins": 10080,
                        "resetsAt": 1784505600
                    }
                }
            }
        });
        let quota = parse_rate_limits_response(&message).expect("rate limits should parse");
        assert_eq!(quota.windows.len(), 2);
        assert_eq!(quota.windows[0].kind, "rolling_5_hour");
        assert_eq!(quota.windows[0].used_percent, 25.5);
        assert_eq!(quota.windows[1].kind, "rolling_weekly");
    }

    #[test]
    fn parses_codex_bucket_from_rate_limits_by_limit_id() {
        let message = json!({
            "id": 7,
            "result": {
                "rateLimits": null,
                "rateLimitsByLimitId": {
                    "codex": {
                        "limitId": "codex",
                        "primary": {
                            "usedPercent": 20,
                            "windowDurationMins": 300,
                            "resetsAt": 1783900800
                        },
                        "secondary": {
                            "usedPercent": 45,
                            "windowDurationMins": 10080,
                            "resetsAt": 1784505600
                        }
                    }
                }
            }
        });
        let quota = parse_rate_limits_response(&message).expect("Codex bucket should parse");
        assert_eq!(quota.windows.len(), 2);
        assert_eq!(quota.windows[0].kind, "rolling_5_hour");
        assert_eq!(quota.windows[1].kind, "rolling_weekly");
    }

    #[test]
    fn production_classifier_tracks_account_logout_notifications() {
        let message = json!({
            "method": "account/updated",
            "params": { "authMode": null }
        });
        assert!(matches!(
            classify_incoming(message),
            Some(IncomingMessage::AccountUpdated { authorized: false })
        ));
    }

    #[test]
    fn resolves_windows_script_from_path_with_spaces() {
        let directory = PathBuf::from(r"C:\Program Files\OpenAI");
        let expected = directory.join("codex.cmd");
        let resolved = resolve_codex_executable_with(&[directory], None, true, |candidate| {
            candidate == expected
        });
        assert_eq!(resolved, Some(CodexExecutable::CmdScript(expected)));
    }

    #[test]
    fn resolver_returns_none_when_codex_is_missing() {
        let resolved =
            resolve_codex_executable_with(&[PathBuf::from(r"C:\missing")], None, true, |_| false);
        assert_eq!(resolved, None);
    }

    #[cfg(windows)]
    #[test]
    fn cmd_script_with_spaces_receives_the_fixed_app_server_argument() {
        let fixture_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join(format!("codex command fixture {}", std::process::id()));
        std::fs::create_dir_all(&fixture_dir).expect("fixture directory should be created");
        let script = fixture_dir.join("codex.cmd");
        std::fs::write(
            &script,
            "@echo off\r\n> received.txt echo %~1\r\nif \"%~1\"==\"app-server\" exit /b 0\r\nexit /b 17\r\n",
        )
        .expect("fixture script should be written");

        let mut command =
            build_command(&CodexExecutable::CmdScript(script)).expect("command should build");
        command.current_dir(&fixture_dir);
        let status = command.status().expect("fixture command should start");
        let received = std::fs::read_to_string(fixture_dir.join("received.txt"))
            .unwrap_or_else(|_| "<script did not start>".to_string());
        let _ = std::fs::remove_dir_all(&fixture_dir);
        assert!(
            status.success(),
            "cmd script did not receive app-server; exit={:?}, received={received:?}",
            status.code()
        );
    }
}
