//! Minimal client for OpenAI's official `codex app-server` JSONL protocol.
//!
//! The reader immediately reduces protocol messages to the small set of
//! account states Token Eyes needs. Raw JSONL, account details, and login
//! errors are never logged or returned to the dashboard.

use serde_json::{json, Value};
use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::{self, BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::{ffi::OsStrExt, process::CommandExt};
#[cfg(windows)]
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
};

const INITIALIZE_METHOD: &str = "initialize";
const INITIALIZED_METHOD: &str = "initialized";
const ACCOUNT_READ_METHOD: &str = "account/read";
const LOGIN_START_METHOD: &str = "account/login/start";
const LOGIN_COMPLETED_METHOD: &str = "account/login/completed";
const LOGIN_CANCEL_METHOD: &str = "account/login/cancel";
const LOGOUT_METHOD: &str = "account/logout";
const RATE_LIMITS_READ_METHOD: &str = "account/rateLimits/read";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const QUEUE_LIMIT: usize = 256;
const CODEX_CONFIG_FILE_NAME: &str = "config.toml";
const CODEX_CONFIG_ERROR: &str = "Unable to prepare Codex credential storage configuration";

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

pub trait AppServerOps: Send {
    fn read_account_authorized(&mut self, refresh_token: bool) -> Result<bool, String>;
    fn start_browser_login(&mut self) -> Result<BrowserLoginStart, String>;
    fn poll_login(&mut self, expected_login_id: &str) -> LoginCompletion;
    fn read_rate_limits(&mut self) -> Result<SanitizedRateLimits, String>;
    fn cancel_login(&mut self, login_id: &str) -> Result<(), String>;
    fn logout(&mut self) -> Result<(), String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppServerStartError {
    ComponentMissing,
    // The official app-server currently exposes no documented typed signal for this case.
    // Keep the Token Eyes mapping testable without constructing it from message text.
    #[allow(dead_code)]
    CredentialStoreUnavailable,
    Other(String),
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
}

pub struct AppServerClient {
    child: Child,
    stdin: Option<ChildStdin>,
    incoming: Arc<Mutex<VecDeque<IncomingMessage>>>,
    reader: Option<JoinHandle<()>>,
    next_id: u64,
    #[cfg(test)]
    written_messages: Arc<Mutex<Vec<Value>>>,
}

trait AppServerShutdownOps {
    fn close_stdin(&mut self);
    fn kill_child(&mut self);
    fn wait_child(&mut self);
    fn join_reader(&mut self);
}

fn shutdown_app_server<O: AppServerShutdownOps>(ops: &mut O) {
    ops.close_stdin();
    ops.kill_child();
    ops.wait_child();
    ops.join_reader();
}

trait ConfigFileOps {
    fn read(&self, path: &Path) -> io::Result<Vec<u8>>;
    fn create_new_temp(&self, directory: &Path) -> io::Result<(PathBuf, File)>;
    fn write_all(&self, file: &mut File, bytes: &[u8]) -> io::Result<()>;
    fn flush(&self, file: &mut File) -> io::Result<()>;
    fn sync_all(&self, file: &File) -> io::Result<()>;
    fn close(&self, file: File);
    fn replace(&self, temp: &Path, target: &Path, target_exists: bool) -> io::Result<()>;
    fn remove_temp(&self, temp: &Path) -> io::Result<()>;
}

#[derive(Clone, Copy)]
struct RealConfigFileOps;

impl ConfigFileOps for RealConfigFileOps {
    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        std::fs::read(path)
    }

    fn create_new_temp(&self, directory: &Path) -> io::Result<(PathBuf, File)> {
        for _ in 0..32 {
            let temp = directory.join(format!(
                ".config.toml.token-eyes-{}-{:016x}.tmp",
                std::process::id(),
                rand::random::<u64>()
            ));
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            match options.open(&temp) {
                Ok(file) => return Ok((temp, file)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
        }
        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "unable to allocate config temp file",
        ))
    }

    fn write_all(&self, file: &mut File, bytes: &[u8]) -> io::Result<()> {
        file.write_all(bytes)
    }

    fn flush(&self, file: &mut File) -> io::Result<()> {
        file.flush()
    }

    fn sync_all(&self, file: &File) -> io::Result<()> {
        file.sync_all()
    }

    fn close(&self, file: File) {
        drop(file);
    }

    fn replace(&self, temp: &Path, target: &Path, target_exists: bool) -> io::Result<()> {
        #[cfg(windows)]
        {
            let to_wide = |path: &Path| -> io::Result<Vec<u16>> {
                let mut wide = path.as_os_str().encode_wide().collect::<Vec<_>>();
                if wide.contains(&0) {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidInput,
                        "config path contains an embedded NUL",
                    ));
                }
                wide.push(0);
                Ok(wide)
            };
            let temp = to_wide(temp)?;
            let target = to_wide(target)?;
            let flags = MOVEFILE_WRITE_THROUGH
                | if target_exists {
                    MOVEFILE_REPLACE_EXISTING
                } else {
                    0
                };
            // Both files are in the same directory, so this is a single-volume atomic move.
            // Deliberately omit COPY_ALLOWED and never remove the existing target first.
            let replaced = unsafe { MoveFileExW(temp.as_ptr(), target.as_ptr(), flags) };
            if replaced == 0 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            let _ = target_exists;
            std::fs::rename(temp, target)
        }
    }

    fn remove_temp(&self, temp: &Path) -> io::Result<()> {
        std::fs::remove_file(temp)
    }
}

fn prepare_codex_config_with<O: ConfigFileOps>(codex_home: &Path, ops: &O) -> Result<(), String> {
    let target = codex_home.join(CODEX_CONFIG_FILE_NAME);
    let (existing, target_exists) = match ops.read(&target) {
        Ok(bytes) => (bytes, true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => (Vec::new(), false),
        Err(_) => return Err(CODEX_CONFIG_ERROR.to_string()),
    };
    let text = std::str::from_utf8(&existing).map_err(|_| CODEX_CONFIG_ERROR.to_string())?;
    let uses_crlf = text.contains("\r\n") && !text.replace("\r\n", "").contains('\n');
    let mut document = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| CODEX_CONFIG_ERROR.to_string())?;
    let root = document.as_table_mut();
    match root.get_mut("cli_auth_credentials_store") {
        Some(item) => {
            let value = item
                .as_value_mut()
                .ok_or_else(|| CODEX_CONFIG_ERROR.to_string())?;
            let current = value
                .as_str()
                .ok_or_else(|| CODEX_CONFIG_ERROR.to_string())?;
            if current == "keyring" {
                return Ok(());
            }
            let decor = value.decor().clone();
            let mut replacement = toml_edit::Value::from("keyring");
            *replacement.decor_mut() = decor;
            *value = replacement;
        }
        None => {
            root.insert("cli_auth_credentials_store", toml_edit::value("keyring"));
        }
    }
    let mut updated = document.to_string();
    if uses_crlf {
        updated = updated.replace('\n', "\r\n");
    }
    let updated = updated.into_bytes();

    let (temp, mut file) = ops
        .create_new_temp(codex_home)
        .map_err(|_| CODEX_CONFIG_ERROR.to_string())?;
    let write_result = ops
        .write_all(&mut file, &updated)
        .and_then(|_| ops.flush(&mut file))
        .and_then(|_| ops.sync_all(&file));
    ops.close(file);
    if write_result.is_err() {
        let _ = ops.remove_temp(&temp);
        return Err(CODEX_CONFIG_ERROR.to_string());
    }
    if ops.replace(&temp, &target, target_exists).is_err() {
        let _ = ops.remove_temp(&temp);
        return Err(CODEX_CONFIG_ERROR.to_string());
    }
    Ok(())
}

fn prepare_codex_config(codex_home: &Path) -> Result<(), String> {
    prepare_codex_config_with(codex_home, &RealConfigFileOps)
}

fn spawn_app_server_with<T, P, S>(
    executable: &CodexExecutable,
    codex_home: &Path,
    prepare_config: P,
    spawn: S,
) -> Result<T, String>
where
    P: FnOnce(&Path) -> Result<(), String>,
    S: FnOnce(Command) -> Result<T, String>,
{
    prepare_config(codex_home)?;
    let mut command = build_command(executable)?;
    command.env("CODEX_HOME", codex_home);
    spawn(command)
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
    let primary_limits = message
        .pointer("/result/rateLimits")
        .and_then(Value::as_object);
    let buckets = message
        .pointer("/result/rateLimitsByLimitId")
        .and_then(Value::as_object);
    let mut windows = Vec::new();
    let mut collect = |limit_id: &str, limits: &serde_json::Map<String, Value>| {
        for name in ["primary", "secondary"] {
            let Some(window) = limits.get(name).and_then(Value::as_object) else {
                continue;
            };
            let Some(duration) = window.get("windowDurationMins").and_then(Value::as_i64) else {
                continue;
            };
            let kind = if limit_id == "codex" {
                match duration {
                    300 => "rolling_5_hour".to_string(),
                    10_080 => "rolling_weekly".to_string(),
                    _ => continue,
                }
            } else {
                let normalized = limit_id
                    .chars()
                    .map(|character| {
                        if character.is_ascii_alphanumeric() {
                            character.to_ascii_lowercase()
                        } else {
                            '_'
                        }
                    })
                    .collect::<String>();
                let suffix = match duration {
                    300 => "5_hour",
                    10_080 => "weekly",
                    _ => "limit",
                };
                format!("{normalized}_{suffix}")
            };
            if windows
                .iter()
                .any(|existing: &SanitizedRateLimitWindow| existing.kind == kind)
            {
                continue;
            }
            let Some(used_percent) = window.get("usedPercent").and_then(Value::as_f64) else {
                continue;
            };
            if !used_percent.is_finite() {
                continue;
            }
            windows.push(SanitizedRateLimitWindow {
                kind,
                used_percent: used_percent.clamp(0.0, 100.0),
                resets_at: window.get("resetsAt").and_then(Value::as_i64).unwrap_or(0),
            });
        }
    };
    if let Some(limits) = primary_limits {
        collect("codex", limits);
    }
    if let Some(buckets) = buckets {
        for (key, bucket) in buckets {
            let Some(limits) = bucket.as_object() else {
                continue;
            };
            let limit_id = limits.get("limitId").and_then(Value::as_str).unwrap_or(key);
            collect(limit_id, limits);
        }
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
    pub fn start(codex_home: &Path) -> Result<Self, AppServerStartError> {
        std::fs::create_dir_all(codex_home)
            .map_err(|_| AppServerStartError::Other("account storage unavailable".to_string()))?;
        let executable = resolve_codex_executable().ok_or(AppServerStartError::ComponentMissing)?;
        let mut child = spawn_app_server_with(
            &executable,
            codex_home,
            prepare_codex_config,
            |mut command| {
                command
                    .spawn()
                    .map_err(|_| "Unable to start the official Codex component".to_string())
            },
        )
        .map_err(AppServerStartError::Other)?;
        let stdin = child.stdin.take().ok_or_else(|| {
            AppServerStartError::Other("app-server stdin unavailable".to_string())
        })?;
        let stdout = child.stdout.take().ok_or_else(|| {
            AppServerStartError::Other("app-server stdout unavailable".to_string())
        })?;
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
            #[cfg(test)]
            written_messages: Arc::new(Mutex::new(Vec::new())),
        };
        match client
            .request(
                INITIALIZE_METHOD,
                Some(json!({
                    "clientInfo": {
                        "name": "token_eyes",
                        "title": "Token Eyes",
                        "version": env!("CARGO_PKG_VERSION")
                    }
                })),
            )
            .map_err(AppServerStartError::Other)?
        {
            ResponsePayload::Acknowledged => {}
            _ => {
                return Err(AppServerStartError::Other(
                    "app-server initialization failed".to_string(),
                ))
            }
        }
        client
            .notify(INITIALIZED_METHOD, Some(json!({})))
            .map_err(AppServerStartError::Other)?;
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

    pub fn read_rate_limits(&mut self) -> Result<SanitizedRateLimits, String> {
        match self.request(RATE_LIMITS_READ_METHOD, None)? {
            ResponsePayload::RateLimits(result) => Ok(result),
            _ => Err("Codex rate limits are unavailable".to_string()),
        }
    }

    pub fn cancel_login(&mut self, login_id: &str) -> Result<(), String> {
        match self.request(LOGIN_CANCEL_METHOD, Some(json!({ "loginId": login_id })))? {
            ResponsePayload::Acknowledged => Ok(()),
            _ => Err("Codex browser login could not be cancelled".to_string()),
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
        #[cfg(test)]
        if let Ok(mut written) = self.written_messages.lock() {
            written.push(message.clone());
        }
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

impl AppServerOps for AppServerClient {
    fn read_account_authorized(&mut self, refresh_token: bool) -> Result<bool, String> {
        AppServerClient::read_account_authorized(self, refresh_token)
    }

    fn start_browser_login(&mut self) -> Result<BrowserLoginStart, String> {
        AppServerClient::start_browser_login(self)
    }

    fn poll_login(&mut self, expected_login_id: &str) -> LoginCompletion {
        AppServerClient::poll_login(self, expected_login_id)
    }

    fn read_rate_limits(&mut self) -> Result<SanitizedRateLimits, String> {
        AppServerClient::read_rate_limits(self)
    }

    fn cancel_login(&mut self, login_id: &str) -> Result<(), String> {
        AppServerClient::cancel_login(self, login_id)
    }

    fn logout(&mut self) -> Result<(), String> {
        AppServerClient::logout(self)
    }
}

impl AppServerShutdownOps for AppServerClient {
    fn close_stdin(&mut self) {
        drop(self.stdin.take());
    }

    fn kill_child(&mut self) {
        let _ = self.child.kill();
    }

    fn wait_child(&mut self) {
        let _ = self.child.wait();
    }

    fn join_reader(&mut self) {
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

impl Drop for AppServerClient {
    fn drop(&mut self) {
        shutdown_app_server(self);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::sync::atomic::{AtomicU64, Ordering};

    static FIXTURE_ID: AtomicU64 = AtomicU64::new(1);

    struct TestDirectory {
        path: PathBuf,
    }

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let id = FIXTURE_ID.fetch_add(1, Ordering::Relaxed);
            let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("target")
                .join("codex-config-tests")
                .join(format!("{}-{id}-{label}", std::process::id()));
            std::fs::create_dir_all(&path).expect("fixture directory should be created");
            Self { path }
        }

        fn config_path(&self) -> PathBuf {
            self.path.join(CODEX_CONFIG_FILE_NAME)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum InjectFailure {
        Write,
        Sync,
        Replace,
    }

    struct RecordingConfigFileOps {
        failure: Option<InjectFailure>,
        trace: RefCell<Vec<&'static str>>,
        created: RefCell<Vec<PathBuf>>,
        removed: RefCell<Vec<PathBuf>>,
    }

    #[derive(Default)]
    struct RecordingShutdownOps {
        trace: Vec<&'static str>,
    }

    impl AppServerShutdownOps for RecordingShutdownOps {
        fn close_stdin(&mut self) {
            self.trace.push("close_stdin");
        }

        fn kill_child(&mut self) {
            self.trace.push("kill");
        }

        fn wait_child(&mut self) {
            self.trace.push("wait");
        }

        fn join_reader(&mut self) {
            self.trace.push("join_reader");
        }
    }

    impl RecordingConfigFileOps {
        fn new(failure: Option<InjectFailure>) -> Self {
            Self {
                failure,
                trace: RefCell::new(Vec::new()),
                created: RefCell::new(Vec::new()),
                removed: RefCell::new(Vec::new()),
            }
        }

        fn trace(&self) -> Vec<&'static str> {
            self.trace.borrow().clone()
        }
    }

    impl ConfigFileOps for RecordingConfigFileOps {
        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            self.trace.borrow_mut().push("read");
            RealConfigFileOps.read(path)
        }

        fn create_new_temp(&self, directory: &Path) -> io::Result<(PathBuf, File)> {
            self.trace.borrow_mut().push("create_new");
            let (path, file) = RealConfigFileOps.create_new_temp(directory)?;
            self.created.borrow_mut().push(path.clone());
            Ok((path, file))
        }

        fn write_all(&self, file: &mut File, bytes: &[u8]) -> io::Result<()> {
            self.trace.borrow_mut().push("write");
            if self.failure == Some(InjectFailure::Write) {
                return Err(io::Error::other("synthetic write failure"));
            }
            RealConfigFileOps.write_all(file, bytes)
        }

        fn flush(&self, file: &mut File) -> io::Result<()> {
            self.trace.borrow_mut().push("flush");
            RealConfigFileOps.flush(file)
        }

        fn sync_all(&self, file: &File) -> io::Result<()> {
            self.trace.borrow_mut().push("sync_all");
            if self.failure == Some(InjectFailure::Sync) {
                return Err(io::Error::other("synthetic sync failure"));
            }
            RealConfigFileOps.sync_all(file)
        }

        fn close(&self, file: File) {
            self.trace.borrow_mut().push("close");
            RealConfigFileOps.close(file);
        }

        fn replace(&self, temp: &Path, target: &Path, target_exists: bool) -> io::Result<()> {
            self.trace.borrow_mut().push("replace");
            if self.failure == Some(InjectFailure::Replace) {
                return Err(io::Error::other("synthetic replace failure"));
            }
            RealConfigFileOps.replace(temp, target, target_exists)
        }

        fn remove_temp(&self, temp: &Path) -> io::Result<()> {
            self.trace.borrow_mut().push("remove_temp");
            self.removed.borrow_mut().push(temp.to_path_buf());
            RealConfigFileOps.remove_temp(temp)
        }
    }

    fn config_temp_paths(directory: &Path) -> Vec<PathBuf> {
        let mut paths = std::fs::read_dir(directory)
            .expect("fixture directory should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| {
                        name.starts_with(".config.toml.token-eyes-") && name.ends_with(".tmp")
                    })
            })
            .collect::<Vec<_>>();
        paths.sort();
        paths
    }

    fn assert_sanitized_config_error(error: &str, config_path: &Path, marker: &str) {
        assert_eq!(error, CODEX_CONFIG_ERROR);
        assert!(!error.contains(marker));
        assert!(!error.contains(&config_path.to_string_lossy().to_string()));
    }

    #[test]
    fn config_writer_creates_top_level_keyring_setting() {
        let fixture = TestDirectory::new("create");

        prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
            .expect("a new config should be prepared");

        let bytes = std::fs::read(fixture.config_path()).expect("config should exist");
        let text = std::str::from_utf8(&bytes).expect("config should be UTF-8");
        assert_eq!(
            text.parse::<toml_edit::DocumentMut>()
                .expect("config should remain valid TOML")["cli_auth_credentials_store"]
                .as_str(),
            Some("keyring")
        );
        assert!(text.starts_with("cli_auth_credentials_store = \"keyring\""));
        assert!(config_temp_paths(&fixture.path).is_empty());
    }

    #[test]
    fn config_writer_preserves_unknown_keys_sections_comments_and_order() {
        let fixture = TestDirectory::new("preserve");
        let original = concat!(
            "# root comment\n",
            "future_root = \"fixture-value\"\n",
            "cli_auth_credentials_store = \"auto\" # keep credential comment\n",
            "\n",
            "[future_section]\n",
            "enabled = true # keep section comment\n",
        );
        std::fs::write(fixture.config_path(), original).expect("fixture config should be written");

        prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
            .expect("existing config should be prepared");

        let updated =
            std::fs::read_to_string(fixture.config_path()).expect("config should be readable");
        assert_eq!(
            updated,
            original.replacen("\"auto\"", "\"keyring\"", 1),
            "only the credential-store string may change"
        );
    }

    #[test]
    fn nested_credential_store_key_does_not_replace_the_required_top_level_setting() {
        let fixture = TestDirectory::new("nested-key");
        let original = concat!(
            "# keep\n",
            "[future_section]\n",
            "cli_auth_credentials_store = \"file\" # nested value stays untouched\n",
        );
        std::fs::write(fixture.config_path(), original).expect("fixture config should be written");

        prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
            .expect("top-level credential store should be added");

        let updated =
            std::fs::read_to_string(fixture.config_path()).expect("config should be readable");
        let document = updated
            .parse::<toml_edit::DocumentMut>()
            .expect("updated config should remain valid TOML");
        assert_eq!(
            document["cli_auth_credentials_store"].as_str(),
            Some("keyring")
        );
        assert_eq!(
            document["future_section"]["cli_auth_credentials_store"].as_str(),
            Some("file")
        );
        assert!(updated.contains("# nested value stays untouched"));
    }

    #[test]
    fn config_writer_updates_auto_and_file_without_losing_value_decor() {
        for previous in ["auto", "file"] {
            let fixture = TestDirectory::new(previous);
            let original = format!(
                "cli_auth_credentials_store =   \"{previous}\"   # keep inline decor\n[future]\nvalue=7\n"
            );
            std::fs::write(fixture.config_path(), &original)
                .expect("fixture config should be written");

            prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
                .expect("credential store should be updated");

            let updated =
                std::fs::read_to_string(fixture.config_path()).expect("config should be readable");
            assert_eq!(
                updated,
                original.replacen(&format!("\"{previous}\""), "\"keyring\"", 1)
            );
        }
    }

    #[test]
    fn existing_keyring_config_is_a_byte_identical_no_op_without_temp_or_replace() {
        let fixture = TestDirectory::new("noop");
        let original = b"# keep bytes\r\ncli_auth_credentials_store = \"keyring\" # keep\r\n[future]\r\nvalue = 1\r\n";
        std::fs::write(fixture.config_path(), original).expect("fixture config should be written");
        let ops = RecordingConfigFileOps::new(None);

        prepare_codex_config_with(&fixture.path, &ops)
            .expect("an existing keyring setting should be accepted");

        assert_eq!(
            std::fs::read(fixture.config_path()).expect("config should be readable"),
            original
        );
        assert_eq!(ops.trace(), vec!["read"]);
        assert!(config_temp_paths(&fixture.path).is_empty());
    }

    #[test]
    fn config_writer_is_byte_idempotent_after_the_first_update() {
        let fixture = TestDirectory::new("idempotent");
        std::fs::write(
            fixture.config_path(),
            "# keep\ncli_auth_credentials_store = \"file\" # keep\n",
        )
        .expect("fixture config should be written");

        prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
            .expect("first config update should succeed");
        let once = std::fs::read(fixture.config_path()).expect("config should be readable");
        let ops = RecordingConfigFileOps::new(None);
        prepare_codex_config_with(&fixture.path, &ops)
            .expect("second config update should be a no-op");

        assert_eq!(
            std::fs::read(fixture.config_path()).expect("config should be readable"),
            once
        );
        assert_eq!(ops.trace(), vec!["read"]);
        assert!(config_temp_paths(&fixture.path).is_empty());
    }

    #[test]
    fn config_writer_rejects_non_utf8_without_changing_the_target() {
        let fixture = TestDirectory::new("non-utf8");
        let original = b"future = \"SYNTHETIC_PRIVATE_MARKER\"\ninvalid = \xff\n";
        std::fs::write(fixture.config_path(), original).expect("fixture config should be written");

        let error = prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
            .expect_err("non-UTF8 config must fail closed");

        assert_sanitized_config_error(&error, &fixture.config_path(), "SYNTHETIC_PRIVATE_MARKER");
        assert_eq!(
            std::fs::read(fixture.config_path()).expect("config should be readable"),
            original
        );
        assert!(config_temp_paths(&fixture.path).is_empty());
    }

    #[test]
    fn config_writer_rejects_invalid_toml_without_changing_the_target() {
        let fixture = TestDirectory::new("invalid-toml");
        let original = b"future = \"SYNTHETIC_PRIVATE_MARKER\"\n[broken\n";
        std::fs::write(fixture.config_path(), original).expect("fixture config should be written");

        let error = prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
            .expect_err("invalid TOML must fail closed");

        assert_sanitized_config_error(&error, &fixture.config_path(), "SYNTHETIC_PRIVATE_MARKER");
        assert_eq!(
            std::fs::read(fixture.config_path()).expect("config should be readable"),
            original
        );
        assert!(config_temp_paths(&fixture.path).is_empty());
    }

    #[test]
    fn config_writer_rejects_non_string_credential_store_without_changing_the_target() {
        for original in [
            b"cli_auth_credentials_store = 7\n".as_slice(),
            b"[cli_auth_credentials_store]\nmode = \"keyring\"\n".as_slice(),
        ] {
            let fixture = TestDirectory::new("non-string");
            std::fs::write(fixture.config_path(), original)
                .expect("fixture config should be written");

            let error = prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
                .expect_err("a non-string credential store must fail closed");

            assert_sanitized_config_error(&error, &fixture.config_path(), "mode");
            assert_eq!(
                std::fs::read(fixture.config_path()).expect("config should be readable"),
                original
            );
            assert!(config_temp_paths(&fixture.path).is_empty());
        }
    }

    #[test]
    fn atomic_config_writer_orders_write_flush_sync_close_then_replace() {
        let fixture = TestDirectory::new("ordered-write");
        std::fs::write(
            fixture.config_path(),
            "cli_auth_credentials_store = \"auto\"\n",
        )
        .expect("fixture config should be written");
        let ops = RecordingConfigFileOps::new(None);

        prepare_codex_config_with(&fixture.path, &ops).expect("config update should succeed");

        assert_eq!(
            ops.trace(),
            vec![
                "read",
                "create_new",
                "write",
                "flush",
                "sync_all",
                "close",
                "replace"
            ]
        );
        let created = ops.created.borrow();
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].parent(), Some(fixture.path.as_path()));
        assert!(config_temp_paths(&fixture.path).is_empty());
    }

    #[test]
    fn write_sync_and_replace_failures_preserve_target_and_cleanup_only_the_exact_temp() {
        for failure in [
            InjectFailure::Write,
            InjectFailure::Sync,
            InjectFailure::Replace,
        ] {
            let fixture = TestDirectory::new("injected-failure");
            let original = b"cli_auth_credentials_store = \"auto\"\nfuture = true\n";
            std::fs::write(fixture.config_path(), original)
                .expect("fixture config should be written");
            let decoy = fixture.path.join(".config.toml.token-eyes-decoy.tmp");
            std::fs::write(&decoy, b"do not remove").expect("decoy should be written");
            let ops = RecordingConfigFileOps::new(Some(failure));

            let error = prepare_codex_config_with(&fixture.path, &ops)
                .expect_err("the injected I/O failure must fail closed");

            assert_sanitized_config_error(&error, &fixture.config_path(), "future");
            assert_eq!(
                std::fs::read(fixture.config_path()).expect("config should be readable"),
                original,
                "the previous target must remain byte-identical after {failure:?} failure"
            );
            assert!(
                decoy.exists(),
                "cleanup must not remove a similarly named file"
            );
            assert_eq!(ops.created.borrow().len(), 1);
            assert_eq!(*ops.removed.borrow(), *ops.created.borrow());
            assert!(
                ops.trace().contains(&match failure {
                    InjectFailure::Write => "write",
                    InjectFailure::Sync => "sync_all",
                    InjectFailure::Replace => "replace",
                }),
                "the requested failure stage must actually be exercised"
            );
            assert!(ops.trace().ends_with(&["remove_temp"]));
        }
    }

    #[test]
    fn real_config_temp_files_use_create_new_and_are_unique_in_the_target_directory() {
        let fixture = TestDirectory::new("unique-temp");
        let (first_path, first_file) = RealConfigFileOps
            .create_new_temp(&fixture.path)
            .expect("first temp should be created");
        let (second_path, second_file) = RealConfigFileOps
            .create_new_temp(&fixture.path)
            .expect("second temp should be created");

        assert_ne!(first_path, second_path);
        assert_eq!(first_path.parent(), Some(fixture.path.as_path()));
        assert_eq!(second_path.parent(), Some(fixture.path.as_path()));
        assert!(first_path.is_file());
        assert!(second_path.is_file());

        RealConfigFileOps.close(first_file);
        RealConfigFileOps.close(second_file);
        RealConfigFileOps
            .remove_temp(&first_path)
            .expect("first temp should be removed");
        RealConfigFileOps
            .remove_temp(&second_path)
            .expect("second temp should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn new_config_and_temp_permissions_are_not_broader_than_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = TestDirectory::new("permissions");
        let (temp_path, temp_file) = RealConfigFileOps
            .create_new_temp(&fixture.path)
            .expect("temp should be created");
        let temp_mode = std::fs::metadata(&temp_path)
            .expect("temp metadata should be readable")
            .permissions()
            .mode();
        assert_eq!(temp_mode & 0o077, 0);
        RealConfigFileOps.close(temp_file);
        RealConfigFileOps
            .remove_temp(&temp_path)
            .expect("temp should be removed");

        prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
            .expect("config should be created");
        let config_mode = std::fs::metadata(fixture.config_path())
            .expect("config metadata should be readable")
            .permissions()
            .mode();
        assert_eq!(config_mode & 0o077, 0);
    }

    #[cfg(windows)]
    #[test]
    fn windows_existing_config_is_atomically_replaced_without_removing_the_target_first() {
        let fixture = TestDirectory::new("windows-replace");
        let original = concat!(
            "# keep\r\n",
            "cli_auth_credentials_store = \"auto\" # keep\r\n",
            "[future]\r\n",
            "enabled = true\r\n",
        );
        std::fs::write(fixture.config_path(), original).expect("fixture config should be written");

        prepare_codex_config_with(&fixture.path, &RealConfigFileOps)
            .expect("an existing Windows config should be atomically replaced");

        assert_eq!(
            std::fs::read_to_string(fixture.config_path()).expect("config should be readable"),
            original.replacen("\"auto\"", "\"keyring\"", 1)
        );
        assert!(config_temp_paths(&fixture.path).is_empty());
    }

    #[cfg(windows)]
    #[test]
    fn windows_atomic_replace_contract_forbids_target_remove_and_copy_fallback() {
        let source = include_str!("codex_app_server.rs");
        let implementation = source
            .split("impl ConfigFileOps for RealConfigFileOps")
            .nth(1)
            .and_then(|rest| rest.split("fn remove_temp").next())
            .expect("real config file operations should be present");

        assert!(implementation.contains("MoveFileExW"));
        assert!(implementation.contains("MOVEFILE_REPLACE_EXISTING"));
        assert!(implementation.contains("MOVEFILE_WRITE_THROUGH"));
        assert!(!implementation.contains("remove_file(target"));
        assert!(!implementation.contains("MOVEFILE_COPY_ALLOWED"));
    }

    #[test]
    fn app_server_prepares_config_before_invoking_spawn() {
        let fixture = TestDirectory::new("start-order");
        let events = RefCell::new(Vec::new());
        let executable = CodexExecutable::Direct(PathBuf::from("codex-fixture"));

        spawn_app_server_with(
            &executable,
            &fixture.path,
            |_| {
                events.borrow_mut().push("prepare");
                Ok(())
            },
            |_| {
                events.borrow_mut().push("spawn");
                Ok(())
            },
        )
        .expect("prepared command should be spawned");

        assert_eq!(*events.borrow(), vec!["prepare", "spawn"]);
    }

    #[test]
    fn config_prepare_failure_prevents_app_server_spawn() {
        let fixture = TestDirectory::new("start-failure");
        let events = RefCell::new(Vec::new());
        let executable = CodexExecutable::Direct(PathBuf::from("codex-fixture"));

        let result = spawn_app_server_with(
            &executable,
            &fixture.path,
            |_| {
                events.borrow_mut().push("prepare");
                Err(CODEX_CONFIG_ERROR.to_string())
            },
            |_| {
                events.borrow_mut().push("spawn");
                Ok(())
            },
        );

        assert_eq!(result, Err(CODEX_CONFIG_ERROR.to_string()));
        assert_eq!(*events.borrow(), vec!["prepare"]);
    }

    fn client_with_messages(
        messages: Vec<IncomingMessage>,
    ) -> (AppServerClient, Arc<Mutex<Vec<Value>>>) {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            command.args(["/C", "more"]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sh");
            command.args(["-c", "cat >/dev/null"]);
            command
        };
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("test child should start");
        let stdin = child.stdin.take().expect("test child stdin should exist");
        let written_messages = Arc::new(Mutex::new(Vec::new()));
        let client = AppServerClient {
            child,
            stdin: Some(stdin),
            incoming: Arc::new(Mutex::new(VecDeque::from(messages))),
            reader: None,
            next_id: 1,
            written_messages: Arc::clone(&written_messages),
        };
        (client, written_messages)
    }

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
    fn login_completion_consumes_only_the_matching_login_id() {
        let unrelated = classify_incoming(json!({
            "method": "account/login/completed",
            "params": { "loginId": "login-2", "success": false }
        }))
        .expect("unrelated completion should classify");
        let matching = classify_incoming(json!({
            "method": "account/login/completed",
            "params": { "loginId": "login-1", "success": true }
        }))
        .expect("matching completion should classify");
        let (mut client, _) = client_with_messages(vec![unrelated, matching]);

        assert_eq!(client.poll_login("login-1"), LoginCompletion::Succeeded);
        assert_eq!(client.poll_login("missing-login"), LoginCompletion::Pending);
        assert_eq!(client.poll_login("login-2"), LoginCompletion::Failed);
    }

    #[test]
    fn drop_closes_stdin_then_kills_and_waits_for_child_before_joining_reader() {
        let mut shutdown = RecordingShutdownOps::default();

        shutdown_app_server(&mut shutdown);

        assert_eq!(
            shutdown.trace,
            vec!["close_stdin", "kill", "wait", "join_reader"]
        );
    }

    #[test]
    fn cancel_login_request_targets_the_matching_login_id() {
        let acknowledged = IncomingMessage::Response {
            id: 1,
            payload: ResponsePayload::Acknowledged,
        };
        let (mut client, written) = client_with_messages(vec![acknowledged]);

        <AppServerClient as AppServerOps>::cancel_login(&mut client, "login-1")
            .expect("cancel request should be acknowledged");

        let messages = written.lock().expect("written requests should be readable");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].get("id"), Some(&json!(1)));
        assert_eq!(
            messages[0].get("method"),
            Some(&json!("account/login/cancel"))
        );
        assert_eq!(
            messages[0].pointer("/params/loginId"),
            Some(&json!("login-1"))
        );
        assert!(
            client
                .incoming
                .lock()
                .expect("incoming queue should lock")
                .is_empty(),
            "cancel must consume its matching acknowledgement"
        );
    }

    #[test]
    fn cancel_login_returns_error_when_app_server_rejects_the_request() {
        let rejected = IncomingMessage::Response {
            id: 1,
            payload: ResponsePayload::Rejected,
        };
        let (mut client, written) = client_with_messages(vec![rejected]);

        let result = <AppServerClient as AppServerOps>::cancel_login(&mut client, "login-rejected");

        assert!(result.is_err(), "a rejected cancel request must fail");
        let messages = written.lock().expect("written requests should be readable");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].get("id"), Some(&json!(1)));
        assert_eq!(
            messages[0].get("method"),
            Some(&json!("account/login/cancel"))
        );
        assert_eq!(
            messages[0].pointer("/params/loginId"),
            Some(&json!("login-rejected"))
        );
        assert!(
            client
                .incoming
                .lock()
                .expect("incoming queue should lock")
                .is_empty(),
            "cancel must consume its matching rejection"
        );
    }

    #[test]
    fn acknowledged_cancel_allows_the_same_client_to_start_the_next_login() {
        let acknowledged = IncomingMessage::Response {
            id: 1,
            payload: ResponsePayload::Acknowledged,
        };
        let next_login = classify_incoming(json!({
            "id": 2,
            "result": {
                "loginId": "login-next",
                "authUrl": "https://auth.openai.com/authorize"
            }
        }))
        .expect("next login response should classify");
        let (mut client, written) = client_with_messages(vec![acknowledged, next_login]);

        client
            .cancel_login("login-current")
            .expect("current login should cancel");
        let started = client
            .start_browser_login()
            .expect("next login should start on the same client");

        assert_eq!(started.login_id, "login-next");
        assert_eq!(started.auth_url, "https://auth.openai.com/authorize");
        let messages = written.lock().expect("written requests should be readable");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].get("id"), Some(&json!(1)));
        assert_eq!(messages[0].get("method"), Some(&json!(LOGIN_CANCEL_METHOD)));
        assert_eq!(
            messages[0].pointer("/params/loginId"),
            Some(&json!("login-current"))
        );
        assert_eq!(messages[1].get("id"), Some(&json!(2)));
        assert_eq!(messages[1].get("method"), Some(&json!(LOGIN_START_METHOD)));
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
                    },
                    "gpt-5.3-codex-spark": {
                        "limitId": "gpt-5.3-codex-spark",
                        "primary": {
                            "usedPercent": 44,
                            "windowDurationMins": 10080,
                            "resetsAt": 1784505600
                        }
                    }
                }
            }
        });
        let quota = parse_rate_limits_response(&message).expect("Codex bucket should parse");
        assert_eq!(quota.windows.len(), 3);
        assert_eq!(quota.windows[0].kind, "rolling_5_hour");
        assert_eq!(quota.windows[1].kind, "rolling_weekly");
        assert_eq!(quota.windows[2].kind, "gpt_5_3_codex_spark_weekly");
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
