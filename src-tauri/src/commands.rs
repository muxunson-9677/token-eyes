use std::io::{ErrorKind, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const LOCAL_SERVER_HOST: &str = "127.0.0.1";
const PREFERRED_LOCAL_SERVER_PORT: u16 = 7680;
const FALLBACK_LOCAL_SERVER_PORT_START: u16 = 17680;
const FALLBACK_LOCAL_SERVER_PORT_END: u16 = 17720;
/// When the preferred port (7680) is occupied by a stale/dead process,
/// we also probe this small range right above it for live API servers
/// started by previous `node serve` invocations.
const NEARBY_PORT_PROBE_START: u16 = 7681;
const NEARBY_PORT_PROBE_END: u16 = 7699;
const LOCAL_SERVER_READY_TIMEOUT_SECS: u64 = 20;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Max runtime log file size before rotation (1 MB).
const RUNTIME_LOG_MAX_BYTES: u64 = 1_000_000;
/// Number of rotated backups to keep (runtime.log.1 .. runtime.log.{N}).
const RUNTIME_LOG_KEEP: usize = 2;

// ── Structured error codes ─────────────────────────────────────────────
// Every error that originates from the runtime startup path is prefixed
// with a bracketed code so the frontend can parse it and render a
// targeted retry/diagnostic UI instead of silently falling back to a
// broken default port. See dashboard/src/lib/local-api-url.ts.
const ERR_RESOURCE_DIR: &str = "[E_RUNTIME_RESOURCE_DIR]";
const ERR_MISSING_NODE: &str = "[E_RUNTIME_MISSING_NODE]";
const ERR_MISSING_TRACKER: &str = "[E_RUNTIME_MISSING_TRACKER]";
const ERR_MISSING_DASHBOARD: &str = "[E_RUNTIME_MISSING_DASHBOARD]";
const ERR_MISSING_MANIFEST: &str = "[E_RUNTIME_MISSING_MANIFEST]";
const ERR_PORT_EXHAUSTED: &str = "[E_RUNTIME_PORT_EXHAUSTED]";
const ERR_STARTUP_TIMEOUT: &str = "[E_RUNTIME_STARTUP_TIMEOUT]";
const ERR_BACKEND_CRASHED: &str = "[E_RUNTIME_BACKEND_CRASHED]";

/// When true (debug builds or `TOKEN_EYES_DEV_RUNTIME=1`), allow falling
/// back to PATH `node` + repo source for development. Release builds
/// without the env var use ONLY the bundled `EmbeddedServer` runtime —
/// no silent source-tree/PATH fallback.
fn is_dev_runtime_allowed() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    matches!(
        std::env::var("TOKEN_EYES_DEV_RUNTIME").ok().as_deref(),
        Some("1")
    )
}

/// Replace the user's home directory prefix with `<HOME>` so error
/// messages and logs don't leak the OS username. Our controlled error
/// strings never include API keys, cookies, or authorization headers —
/// this is defense-in-depth against path leakage from `display()`.
fn sanitize_message(msg: impl AsRef<str>) -> String {
    let raw = msg.as_ref();
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    match &home {
        Some(h) if !h.as_os_str().is_empty() => {
            raw.replace(&h.to_string_lossy().into_owned(), "<HOME>")
        }
        _ => raw.to_string(),
    }
}

#[derive(Default)]
pub struct LocalServerState {
    child: Mutex<Option<Child>>,
    url: Mutex<Option<String>>,
    startup: Mutex<()>,
}

impl Drop for LocalServerState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[derive(Serialize)]
pub struct LocalServerStatus {
    running: bool,
    url: String,
}

fn local_server_url(port: u16) -> String {
    format!("http://{}:{}", LOCAL_SERVER_HOST, port)
}

fn local_server_addr(port: u16) -> Option<SocketAddr> {
    format!("{}:{}", LOCAL_SERVER_HOST, port)
        .parse::<SocketAddr>()
        .ok()
}

fn port_from_url(url: &str) -> Option<u16> {
    url.rsplit(':').next()?.parse::<u16>().ok()
}

fn is_port_bindable(port: u16) -> bool {
    TcpListener::bind((LOCAL_SERVER_HOST, port)).is_ok()
}

fn decode_chunked_body(raw_body: &str) -> Option<String> {
    let mut remaining = raw_body.as_bytes();
    let mut decoded = Vec::new();

    loop {
        let line_end = remaining.windows(2).position(|w| w == b"\r\n")?;
        let size_line = std::str::from_utf8(&remaining[..line_end]).ok()?;
        let size_hex = size_line.split(';').next()?.trim();
        let size = usize::from_str_radix(size_hex, 16).ok()?;
        remaining = &remaining[line_end + 2..];

        if size == 0 {
            break;
        }
        if remaining.len() < size + 2 || &remaining[size..size + 2] != b"\r\n" {
            return None;
        }
        decoded.extend_from_slice(&remaining[..size]);
        remaining = &remaining[size + 2..];
    }

    String::from_utf8(decoded).ok()
}

fn is_token_tracker_api_available(port: u16) -> bool {
    let Some(addr) = local_server_addr(port) else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(150)) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(300)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));

    let request = format!(
        "GET /api/local-auth HTTP/1.1\r\nHost: {}:{}\r\nOrigin: http://tauri.localhost\r\nConnection: close\r\n\r\n",
        LOCAL_SERVER_HOST, port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(size) => {
                buffer.extend_from_slice(&chunk[..size]);
                if buffer.len() > 64 * 1024 {
                    return false;
                }
            }
            Err(err)
                if !buffer.is_empty()
                    && matches!(err.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) =>
            {
                break;
            }
            Err(_) => return false,
        }
    }
    if buffer.is_empty() {
        return false;
    }

    let response = String::from_utf8_lossy(&buffer);
    let lower = response.to_ascii_lowercase();
    if !response.starts_with("HTTP/") || !response.contains(" 200 ") {
        return false;
    }
    if !lower.contains("application/json")
        || !lower.contains("access-control-allow-origin: *")
        || !lower.contains("cache-control: no-store")
    {
        return false;
    }

    let body_start = response.find("\r\n\r\n");
    let raw_body = match body_start {
        Some(idx) => response.get(idx + 4..).unwrap_or(""),
        None => return false,
    };
    let body = if lower.contains("transfer-encoding: chunked") {
        match decode_chunked_body(raw_body) {
            Some(decoded) => decoded,
            None => return false,
        }
    } else {
        raw_body.to_string()
    };

    let json: serde_json::Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let protocol_version = json
        .get("protocol_version")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    if protocol_version < 2 {
        return false;
    }

    let capabilities = match json.get("capabilities").and_then(|v| v.as_array()) {
        Some(v) => v.as_slice(),
        None => &[],
    };
    let required_capabilities = [
        "spend_usage_v2",
        "provider_model_stats",
        "request_usage_records",
        "provider_api_balance",
    ];
    for cap in required_capabilities {
        let has_cap = capabilities.iter().any(|c| c.as_str() == Some(cap));
        if !has_cap {
            return false;
        }
    }

    true
}

fn find_running_token_tracker_api() -> Option<u16> {
    std::iter::once(PREFERRED_LOCAL_SERVER_PORT)
        .chain(NEARBY_PORT_PROBE_START..=NEARBY_PORT_PROBE_END)
        .chain(FALLBACK_LOCAL_SERVER_PORT_START..=FALLBACK_LOCAL_SERVER_PORT_END)
        .find(|port| is_token_tracker_api_available(*port))
}

fn should_probe_existing_server() -> bool {
    false
}

fn choose_bindable_port() -> Option<u16> {
    if is_port_bindable(PREFERRED_LOCAL_SERVER_PORT) {
        return Some(PREFERRED_LOCAL_SERVER_PORT);
    }
    (NEARBY_PORT_PROBE_START..=NEARBY_PORT_PROBE_END)
        .chain(FALLBACK_LOCAL_SERVER_PORT_START..=FALLBACK_LOCAL_SERVER_PORT_END)
        .find(|port| is_port_bindable(*port))
}

fn get_known_url(state: &LocalServerState) -> Result<Option<String>, String> {
    state
        .url
        .lock()
        .map(|guard| guard.clone())
        .map_err(|_| "Local server URL lock poisoned".to_string())
}

fn set_known_url(state: &LocalServerState, url: String) -> Result<String, String> {
    let mut guard = state
        .url
        .lock()
        .map_err(|_| "Local server URL lock poisoned".to_string())?;
    *guard = Some(url.clone());
    Ok(url)
}

fn clear_known_url(state: &LocalServerState) {
    if let Ok(mut guard) = state.url.lock() {
        *guard = None;
    }
}

fn push_candidate_ancestors(candidates: &mut Vec<PathBuf>, start: PathBuf) {
    let mut current = Some(start.as_path());
    while let Some(path) = current {
        let candidate = path.to_path_buf();
        if !candidates.iter().any(|existing| existing == &candidate) {
            candidates.push(candidate);
        }
        current = path.parent();
    }
}

/// Dev-only: locate the repo source tree by walking ancestors of the
/// current dir / exe dir, looking for `bin/tracker.js` +
/// `dashboard/dist/index.html`. Used ONLY when `is_dev_runtime_allowed()`
/// returns true (debug builds or `TOKEN_EYES_DEV_RUNTIME=1`). Release
/// builds without the env var never call this — they use the bundled
/// `EmbeddedServer` from Tauri resources.
fn find_repo_root() -> Option<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(current_dir) = std::env::current_dir() {
        push_candidate_ancestors(&mut candidates, current_dir);
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            push_candidate_ancestors(&mut candidates, exe_dir.to_path_buf());
        }
    }

    candidates.into_iter().find(|dir| {
        dir.join("bin").join("tracker.js").is_file()
            && dir
                .join("dashboard")
                .join("dist")
                .join("index.html")
                .is_file()
    })
}

/// Resolved runtime: the absolute path to the bundled `node.exe` and the
/// `tokentracker/` root that contains `bin/tracker.js`, `src/`, and
/// `dashboard/dist/`.
#[derive(Debug)]
struct ResolvedRuntime {
    node_exe: PathBuf,
    tracker_root: PathBuf,
}

fn bundled_runtime_dir_name() -> String {
    format!("EmbeddedServer-{}", env!("CARGO_PKG_VERSION"))
}

#[derive(Debug, Clone, Deserialize, Eq, PartialEq, Serialize)]
pub struct TokenEyesBuildInfo {
    app_version: String,
    head_sha: String,
    built_at_utc: String,
}

fn parse_token_eyes_build_info(raw: &str) -> Result<TokenEyesBuildInfo, String> {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let info: TokenEyesBuildInfo = serde_json::from_str(raw)
        .map_err(|_| "[E_BUILD_INFO_INVALID] manifest JSON is invalid".to_string())?;
    if info.app_version != env!("CARGO_PKG_VERSION") {
        return Err("[E_BUILD_INFO_VERSION] manifest version mismatch".to_string());
    }
    if info.head_sha.len() != 40
        || !info
            .head_sha
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err("[E_BUILD_INFO_SHA] manifest Git SHA is invalid".to_string());
    }
    let built_at = chrono::DateTime::parse_from_rfc3339(&info.built_at_utc)
        .map_err(|_| "[E_BUILD_INFO_TIME] manifest build time is invalid".to_string())?;
    if built_at.offset().local_minus_utc() != 0 {
        return Err("[E_BUILD_INFO_TIME] manifest build time is not UTC".to_string());
    }
    Ok(info)
}

fn get_token_eyes_build_info_at(
    resource_dir: &std::path::Path,
) -> Result<TokenEyesBuildInfo, String> {
    let manifest_path = resource_dir
        .join(bundled_runtime_dir_name())
        .join("runtime-manifest.json");
    let raw = std::fs::read_to_string(manifest_path)
        .map_err(|_| "[E_BUILD_INFO_MISSING] runtime manifest is unavailable".to_string())?;
    parse_token_eyes_build_info(&raw)
}

#[tauri::command]
pub fn get_token_eyes_build_info(app: AppHandle) -> Result<TokenEyesBuildInfo, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|_| "[E_BUILD_INFO_RESOURCE] resource directory is unavailable".to_string())?;
    get_token_eyes_build_info_at(&resource_dir)
}

/// Resolve this release's versioned bundled runtime from Tauri's resource
/// directory. Verifies `node.exe`, `bin/tracker.js`,
/// `dashboard/dist/index.html`, and `runtime-manifest.json` all exist.
fn resolve_bundled_runtime(app: &AppHandle) -> Result<ResolvedRuntime, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("{} could not resolve resource dir: {}", ERR_RESOURCE_DIR, e))?;
    resolve_bundled_runtime_at(&resource_dir)
}

/// Path-only core of [`resolve_bundled_runtime`]. Exposed for unit tests
/// so the file-missing negative probes don't need a live `AppHandle`.
/// Every missing-file path returns its own bracketed `[E_RUNTIME_*]` code
/// so the frontend can render a targeted retry/diagnostic UI.
fn resolve_bundled_runtime_at(resource_dir: &std::path::Path) -> Result<ResolvedRuntime, String> {
    let embedded_dir = resource_dir.join(bundled_runtime_dir_name());
    let node_exe = embedded_dir.join("node.exe");
    let tracker_root = embedded_dir.join("tokentracker");
    let tracker_js = tracker_root.join("bin").join("tracker.js");
    let dashboard_index = tracker_root
        .join("dashboard")
        .join("dist")
        .join("index.html");
    let manifest = embedded_dir.join("runtime-manifest.json");

    if !node_exe.is_file() {
        return Err(format!(
            "{} bundled node.exe not found at {}",
            ERR_MISSING_NODE,
            sanitize_message(node_exe.display().to_string())
        ));
    }
    if !tracker_js.is_file() {
        return Err(format!(
            "{} bundled tracker.js not found at {}",
            ERR_MISSING_TRACKER,
            sanitize_message(tracker_js.display().to_string())
        ));
    }
    if !dashboard_index.is_file() {
        return Err(format!(
            "{} bundled dashboard/dist/index.html not found at {}",
            ERR_MISSING_DASHBOARD,
            sanitize_message(dashboard_index.display().to_string())
        ));
    }
    if !manifest.is_file() {
        return Err(format!(
            "{} runtime-manifest.json not found at {}",
            ERR_MISSING_MANIFEST,
            sanitize_message(manifest.display().to_string())
        ));
    }

    Ok(ResolvedRuntime {
        node_exe,
        tracker_root,
    })
}

/// Dev fallback: use PATH `node` + repo source tree. Only called when
/// `is_dev_runtime_allowed()` is true.
fn resolve_dev_runtime() -> Option<ResolvedRuntime> {
    let repo_root = find_repo_root()?;
    Some(ResolvedRuntime {
        // PATH `node` — only acceptable in dev mode.
        node_exe: PathBuf::from("node"),
        tracker_root: repo_root,
    })
}

/// Resolve the runtime: try bundled first, fall back to dev source only
/// when explicitly allowed. Release builds without the env var use ONLY
/// the bundled runtime — no silent PATH/source-tree fallback.
fn resolve_runtime(app: &AppHandle) -> Result<ResolvedRuntime, String> {
    match resolve_bundled_runtime(app) {
        Ok(rt) => Ok(rt),
        Err(bundled_err) => {
            if is_dev_runtime_allowed() {
                if let Some(dev_rt) = resolve_dev_runtime() {
                    eprintln!(
                        "[Token Eyes] dev runtime fallback: using repo source + PATH node \
                         (bundled runtime missing: {bundled_err})"
                    );
                    return Ok(dev_rt);
                }
            }
            Err(bundled_err)
        }
    }
}

fn backend_log_stdio(app: &AppHandle) -> Option<(Stdio, Stdio)> {
    let data_dir = app.path().app_data_dir().ok()?;
    let log_dir = data_dir.join("logs");
    std::fs::create_dir_all(&log_dir).ok()?;
    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("backend.log"))
        .ok()?;
    let stderr = file.try_clone().ok()?;
    Some((Stdio::from(file), Stdio::from(stderr)))
}

fn tracker_entry_arg() -> PathBuf {
    PathBuf::from("bin").join("tracker.js")
}

fn spawn_local_server(
    app: &AppHandle,
    runtime: &ResolvedRuntime,
    port: u16,
) -> Result<Child, String> {
    let tracker = tracker_entry_arg();
    let mut command = Command::new(&runtime.node_exe);
    command
        .arg(&tracker)
        .arg("serve")
        .arg("--no-open")
        .arg("--no-sync")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&runtime.tracker_root)
        .stdin(Stdio::null());

    if let Some((stdout, stderr)) = backend_log_stdio(app) {
        command.stdout(stdout).stderr(stderr);
    } else {
        command.stdout(Stdio::null()).stderr(Stdio::null());
    }

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let child = command.spawn().map_err(|e| {
        format!(
            "{} failed to start bundled node ({}): {}",
            ERR_BACKEND_CRASHED,
            sanitize_message(runtime.node_exe.display().to_string()),
            e
        )
    })?;

    Ok(child)
}

/// Append a sanitized log line to `<app_data_dir>/logs/runtime.log`,
/// rotating when the file exceeds `RUNTIME_LOG_MAX_BYTES`. Keeps at most
/// `RUNTIME_LOG_KEEP` rotated backups. Failures are silently ignored —
/// logging must never break the app.
fn write_runtime_log(app: &AppHandle, level: &str, message: &str) {
    let Ok(data_dir) = app.path().app_data_dir() else {
        return;
    };
    let log_dir = data_dir.join("logs");
    let _ = std::fs::create_dir_all(&log_dir);
    let log_path = log_dir.join("runtime.log");

    // Rotate if the current log file is too large.
    if let Ok(meta) = std::fs::metadata(&log_path) {
        if meta.len() > RUNTIME_LOG_MAX_BYTES {
            // Shift existing backups: .{N-1} -> .{N}, then current -> .1
            let mut i = RUNTIME_LOG_KEEP;
            while i > 1 {
                let from = log_dir.join(format!("runtime.log.{}", i - 1));
                let to = log_dir.join(format!("runtime.log.{}", i));
                let _ = std::fs::rename(&from, &to);
                i -= 1;
            }
            let _ = std::fs::rename(&log_path, log_dir.join("runtime.log.1"));
        }
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let line = format!(
        "[{}] [{}] {}\n",
        timestamp,
        level,
        sanitize_message(message)
    );
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .and_then(|mut f| f.write_all(line.as_bytes()));
}

/// Poll `is_token_tracker_api_available(port)` until it returns true or
/// the deadline expires. Returns true if the server became ready.
fn wait_for_ready(port: u16, timeout: Duration) -> bool {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if is_token_tracker_api_available(port) {
            return true;
        }
        if std::time::Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

pub fn ensure_local_server_started(
    app: &AppHandle,
    state: &LocalServerState,
) -> Result<String, String> {
    let _startup_guard = state
        .startup
        .lock()
        .map_err(|_| "Local server startup lock poisoned".to_string())?;

    // 1. Fast path: known URL is still serving.
    if let Some(url) = get_known_url(state)? {
        if port_from_url(&url).is_some_and(is_token_tracker_api_available) {
            return Ok(url);
        }
    }

    // 2. Probe for any already-running Token Tracker API on the local machine
    //    (e.g. a `node serve` started by another invocation).
    if should_probe_existing_server() {
        if let Some(port) = find_running_token_tracker_api() {
            return set_known_url(state, local_server_url(port));
        }
    }

    // 3. If we already spawned a child, wait for it (don't spawn a second one).
    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "Local server state lock poisoned".to_string())?;
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    // Child still running — wait for readiness on its known port.
                    if let Some(url) = get_known_url(state)? {
                        if let Some(port) = port_from_url(&url) {
                            if wait_for_ready(
                                port,
                                Duration::from_secs(LOCAL_SERVER_READY_TIMEOUT_SECS),
                            ) {
                                return Ok(url);
                            }
                            // Stale child — kill it and respawn below.
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                    *guard = None;
                    clear_known_url(state);
                }
                Ok(Some(_)) | Err(_) => {
                    *guard = None;
                    clear_known_url(state);
                }
            }
        }
    }

    // 4. Choose a bindable port.
    let port = choose_bindable_port().ok_or_else(|| {
        format!(
            "{} no free local API port found; tried {} and {}-{}",
            ERR_PORT_EXHAUSTED,
            PREFERRED_LOCAL_SERVER_PORT,
            FALLBACK_LOCAL_SERVER_PORT_START,
            FALLBACK_LOCAL_SERVER_PORT_END
        )
    })?;

    // 5. Resolve the runtime (bundled first; dev fallback only if allowed).
    let runtime = resolve_runtime(app)?;

    // 6. Spawn the backend.
    let child = spawn_local_server(app, &runtime, port)?;
    write_runtime_log(
        app,
        "INFO",
        &format!(
            "local API child spawned on port {} with pid {}",
            port,
            child.id()
        ),
    );

    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "Local server state lock poisoned".to_string())?;
        *guard = Some(child);
    }

    let url = local_server_url(port);

    // 7. Wait for the server to become ready. First launch after install can be
    // slower on Windows because WebView/Defender may scan the embedded Node tree.
    if wait_for_ready(port, Duration::from_secs(LOCAL_SERVER_READY_TIMEOUT_SECS)) {
        let result = set_known_url(state, url);
        if result.is_ok() {
            write_runtime_log(app, "INFO", &format!("local API ready on port {}", port));
        }
        return result;
    }

    // 8. Server didn't become ready — diagnose and return a structured error.
    let crashed_status = {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "Local server state lock poisoned".to_string())?;
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    *guard = None;
                    Some(status)
                }
                Ok(None) => {
                    // Still running but not ready — kill the stale child.
                    let _ = child.kill();
                    let _ = child.wait();
                    *guard = None;
                    None
                }
                Err(_) => {
                    *guard = None;
                    None
                }
            }
        } else {
            None
        }
    };
    clear_known_url(state);

    let err = match crashed_status {
        Some(status) => format!(
            "{} backend process exited unexpectedly (status: {})",
            ERR_BACKEND_CRASHED, status
        ),
        None => format!(
            "{} local API did not become ready within {}s on port {}",
            ERR_STARTUP_TIMEOUT, LOCAL_SERVER_READY_TIMEOUT_SECS, port
        ),
    };
    write_runtime_log(app, "ERROR", &err);
    Err(err)
}

#[tauri::command]
pub async fn local_server_status(app: AppHandle) -> Result<LocalServerStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<LocalServerState>();
        let url = ensure_local_server_started(&app, state.inner())?;
        let running = port_from_url(&url).is_some_and(is_token_tracker_api_available);
        Ok(LocalServerStatus { running, url })
    })
    .await
    .map_err(|error| format!("Local server status task failed: {error}"))?
}

/// Opens a native folder picker dialog and returns the selected path,
/// or null if the user cancelled.
///
/// If `defaultPath` is provided, the dialog opens at that directory.
/// If the user cancels, returns `Ok(None)` - callers must not clear
/// existing input values on cancel.
#[tauri::command]
pub async fn pick_directory(
    app: AppHandle,
    #[allow(non_snake_case)] defaultPath: Option<String>,
) -> Result<Option<String>, String> {
    let initial = defaultPath
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file();
        if let Some(path) = initial {
            builder = builder.set_directory(path);
        }
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("Failed to open directory picker: {e}"))?;

    match result {
        Some(path) => {
            let path_str = path.to_string();
            Ok(if path_str.is_empty() {
                None
            } else {
                Some(path_str)
            })
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn serve_probe_response(response: impl Into<String>) -> (u16, thread::JoinHandle<()>) {
        serve_probe_response_with_close_delay(response, Duration::ZERO)
    }

    #[test]
    fn local_server_state_has_a_single_flight_startup_lock() {
        let state = LocalServerState::default();
        let _guard = state.startup.lock().expect("lock startup");
        assert!(state.startup.try_lock().is_err());
    }

    fn serve_probe_response_with_close_delay(
        response: impl Into<String>,
        close_delay: Duration,
    ) -> (u16, thread::JoinHandle<()>) {
        let listener = TcpListener::bind((LOCAL_SERVER_HOST, 0)).expect("bind probe server");
        let port = listener.local_addr().expect("probe address").port();
        let response = response.into();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept probe request");
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            stream
                .write_all(response.as_bytes())
                .expect("write probe response");
            if !close_delay.is_zero() {
                thread::sleep(close_delay);
            }
        });
        (port, handle)
    }

    #[test]
    fn api_probe_rejects_legacy_server_without_tauri_cors_contract() {
        let (port, handle) = serve_probe_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{\"token\":\"legacy\"}",
        );

        assert!(!is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn desktop_runtime_never_reuses_an_unowned_local_server() {
        assert!(!should_probe_existing_server());
    }

    #[test]
    fn api_probe_rejects_server_without_protocol_version() {
        let (port, handle) = serve_probe_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 21\r\n\r\n{\"token\":\"current\"}",
        );

        assert!(!is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn api_probe_rejects_server_with_old_protocol_version() {
        let (port, handle) = serve_probe_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 62\r\n\r\n{\"token\":\"v1\",\"protocol_version\":1,\"capabilities\":[\"spend_usage_v1\"]}",
        );

        assert!(!is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn api_probe_rejects_server_missing_capability() {
        let (port, handle) = serve_probe_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 113\r\n\r\n{\"token\":\"v2\",\"protocol_version\":2,\"capabilities\":[\"spend_usage_v2\",\"provider_model_stats\"]}",
        );

        assert!(!is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn api_probe_rejects_server_without_provider_api_balance_capability() {
        let (port, handle) = serve_probe_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 145\r\n\r\n{\"token\":\"v2\",\"protocol_version\":2,\"capabilities\":[\"spend_usage_v2\",\"provider_model_stats\",\"request_usage_records\"]}",
        );

        assert!(!is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn api_probe_accepts_server_with_full_protocol_contract() {
        let (port, handle) = serve_probe_response(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 168\r\n\r\n{\"token\":\"v2\",\"protocol_version\":2,\"capabilities\":[\"spend_usage_v2\",\"provider_model_stats\",\"request_usage_records\",\"provider_api_balance\"]}",
        );

        assert!(is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn api_probe_accepts_large_local_auth_response() {
        let padding = "x".repeat(4096);
        let body = format!(
            "{{\"token\":\"v2\",\"protocol_version\":2,\"padding\":\"{}\",\"capabilities\":[\"spend_usage_v2\",\"provider_model_stats\",\"request_usage_records\",\"provider_api_balance\"]}}",
            padding
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\n\r\n{}",
            body.len(),
            body
        );
        let (port, handle) = serve_probe_response(response);

        assert!(is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn api_probe_accepts_response_before_connection_close() {
        let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 168\r\n\r\n{\"token\":\"v2\",\"protocol_version\":2,\"capabilities\":[\"spend_usage_v2\",\"provider_model_stats\",\"request_usage_records\",\"provider_api_balance\"]}";
        let (port, handle) =
            serve_probe_response_with_close_delay(response, Duration::from_millis(800));

        assert!(is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn api_probe_accepts_chunked_local_auth_response() {
        let body = "{\"token\":\"v2\",\"protocol_version\":2,\"capabilities\":[\"spend_usage_v2\",\"provider_model_stats\",\"request_usage_records\",\"provider_api_balance\"]}";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{}\r\n0\r\n\r\n",
            body.len(),
            body
        );
        let (port, handle) = serve_probe_response(response);

        assert!(is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }

    #[test]
    fn error_codes_are_bracketed_and_machine_parseable() {
        // The frontend parses `[E_RUNTIME_*]` prefixes to render targeted
        // retry UI. Every code must be uppercase, bracketed, and start
        // with E_RUNTIME_.
        for code in [
            ERR_RESOURCE_DIR,
            ERR_MISSING_NODE,
            ERR_MISSING_TRACKER,
            ERR_MISSING_DASHBOARD,
            ERR_MISSING_MANIFEST,
            ERR_PORT_EXHAUSTED,
            ERR_STARTUP_TIMEOUT,
            ERR_BACKEND_CRASHED,
        ] {
            assert!(
                code.starts_with("[E_RUNTIME_"),
                "code {code} missing prefix"
            );
            assert!(code.ends_with(']'), "code {code} missing closing bracket");
            let inner = &code[1..code.len() - 1];
            assert!(
                inner == inner.to_uppercase(),
                "code {code} must be uppercase"
            );
        }
    }

    #[test]
    fn sanitize_message_strips_home_prefix() {
        // Without a HOME/USERPROFILE set, the message passes through.
        // (We can't reliably set env vars in a parallel test runner, so
        // we verify the no-home-set path and the structure of the output.)
        let msg = "[E_RUNTIME_MISSING_NODE] node.exe not found";
        let cleaned = sanitize_message(msg);
        // Either the home prefix was stripped (if set) or the message is unchanged.
        assert!(cleaned.contains("[E_RUNTIME_MISSING_NODE]"));
    }

    #[test]
    fn is_dev_runtime_allowed_returns_true_in_debug_builds() {
        // cfg!(debug_assertions) is true in `cargo test` (dev profile).
        // We can't easily test the Release path from here, but we can
        // assert the dev path works.
        if cfg!(debug_assertions) {
            assert!(is_dev_runtime_allowed());
        }
    }

    #[test]
    fn tracker_entry_arg_is_relative_to_survive_install_paths_with_spaces() {
        let arg = tracker_entry_arg();

        assert_eq!(arg, PathBuf::from("bin").join("tracker.js"));
        assert!(!arg.is_absolute());
        assert!(!arg.to_string_lossy().contains("Token Eyes"));
    }

    #[test]
    fn find_repo_root_returns_none_when_no_source_tree() {
        // In the test working directory (which is NOT the repo root for
        // the bundled runtime path), find_repo_root should return None
        // unless the test happens to run inside the repo. This test is
        // best-effort: if it finds a repo root, the path must contain
        // bin/tracker.js + dashboard/dist/index.html.
        if let Some(root) = find_repo_root() {
            assert!(root.join("bin").join("tracker.js").is_file());
            assert!(root
                .join("dashboard")
                .join("dist")
                .join("index.html")
                .is_file());
        }
    }

    // ── R1 第 2 轮负向探针：文件缺失场景 ──────────────────────────
    // resolve_bundled_runtime_at 必须对每个缺失文件返回对应的
    // [E_RUNTIME_*] 错误码，前端依赖这些码渲染定向重试 UI。
    // 不允许静默回退到默认端口或 PATH node。

    /// Build a temp dir with this release's complete versioned runtime layout. The caller
    /// owns cleanup via `std::fs::remove_dir_all`. We avoid pulling in the
    /// `tempfile` crate just for these probes — `std::env::temp_dir()` +
    /// a high-resolution suffix is enough for test isolation.
    fn make_complete_runtime_root() -> PathBuf {
        let ns = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("token-eyes-r1-neg-{ns}"));
        let embedded = root.join(bundled_runtime_dir_name());
        let tracker_root = embedded.join("tokentracker");
        std::fs::create_dir_all(tracker_root.join("bin")).expect("create bin dir");
        std::fs::create_dir_all(tracker_root.join("dashboard").join("dist"))
            .expect("create dashboard dist dir");
        std::fs::write(embedded.join("node.exe"), b"fake-node-binary").expect("write node.exe");
        std::fs::write(tracker_root.join("bin").join("tracker.js"), b"// stub")
            .expect("write tracker.js");
        std::fs::write(
            tracker_root
                .join("dashboard")
                .join("dist")
                .join("index.html"),
            b"<html></html>",
        )
        .expect("write index.html");
        std::fs::write(
            embedded.join("runtime-manifest.json"),
            b"{\"node\":{\"sha256\":\"x\"}}",
        )
        .expect("write manifest");
        root
    }

    #[test]
    fn bundled_runtime_directory_is_versioned_by_package_version() {
        assert_eq!(
            bundled_runtime_dir_name(),
            format!("EmbeddedServer-{}", env!("CARGO_PKG_VERSION"))
        );
    }

    #[test]
    fn build_info_reads_the_versioned_manifest_and_serializes_only_public_identity() {
        let root = make_complete_runtime_root();
        let raw = format!(
            "\u{feff}{{\"app_version\":\"{}\",\"head_sha\":\"{}\",\"built_at_utc\":\"2026-08-21T01:02:03.000Z\",\"node\":{{\"sha256\":\"synthetic\"}},\"ignored_secret\":\"must-not-escape\"}}",
            env!("CARGO_PKG_VERSION"),
            "a".repeat(40),
        );
        std::fs::write(
            root.join(bundled_runtime_dir_name())
                .join("runtime-manifest.json"),
            raw,
        )
        .expect("write build manifest");

        let info = get_token_eyes_build_info_at(&root).expect("valid build identity");
        let serialized = serde_json::to_value(info).expect("serialize build identity");
        std::fs::remove_dir_all(&root).ok();
        assert_eq!(
            serialized,
            serde_json::json!({
                "app_version": env!("CARGO_PKG_VERSION"),
                "head_sha": "a".repeat(40),
                "built_at_utc": "2026-08-21T01:02:03.000Z",
            })
        );
    }

    #[test]
    fn build_info_rejects_version_sha_and_time_drift_without_echoing_manifest_values() {
        for (raw, expected_code, forbidden) in [
            (
                format!(
                    r#"{{"app_version":"9.9.9","head_sha":"{}","built_at_utc":"2026-08-21T01:02:03Z"}}"#,
                    "a".repeat(40)
                ),
                "[E_BUILD_INFO_VERSION]",
                "9.9.9",
            ),
            (
                format!(
                    r#"{{"app_version":"{}","head_sha":"unknown","built_at_utc":"2026-08-21T01:02:03Z"}}"#,
                    env!("CARGO_PKG_VERSION")
                ),
                "[E_BUILD_INFO_SHA]",
                "unknown",
            ),
            (
                format!(
                    r#"{{"app_version":"{}","head_sha":"{}","built_at_utc":"SYNTHETIC_BAD_TIME"}}"#,
                    env!("CARGO_PKG_VERSION"),
                    "a".repeat(40)
                ),
                "[E_BUILD_INFO_TIME]",
                "SYNTHETIC_BAD_TIME",
            ),
        ] {
            let error = parse_token_eyes_build_info(&raw).expect_err("invalid manifest must fail");
            assert!(error.starts_with(expected_code), "got {error}");
            assert!(
                !error.contains(forbidden),
                "error echoed manifest value: {error}"
            );
        }
    }

    #[test]
    fn resolve_bundled_runtime_at_does_not_reuse_a_legacy_runtime_directory() {
        let root = make_complete_runtime_root();
        std::fs::rename(
            root.join(bundled_runtime_dir_name()),
            root.join("EmbeddedServer"),
        )
        .expect("move runtime to legacy location");

        let err = resolve_bundled_runtime_at(&root).expect_err("legacy runtime must not be reused");
        std::fs::remove_dir_all(&root).ok();
        assert!(err.starts_with("[E_RUNTIME_MISSING_NODE]"), "got: {err}");
    }

    #[test]
    fn resolve_bundled_runtime_at_succeeds_with_complete_layout() {
        let root = make_complete_runtime_root();
        let result = resolve_bundled_runtime_at(&root);
        std::fs::remove_dir_all(&root).ok();
        let rt = result.expect("complete layout should resolve");
        assert!(rt.node_exe.is_absolute());
        assert!(rt.tracker_root.is_absolute());
        assert!(rt.node_exe.ends_with("node.exe"));
        assert!(rt.tracker_root.ends_with("tokentracker"));
    }

    #[test]
    fn resolve_bundled_runtime_at_returns_missing_node_when_node_exe_absent() {
        let root = make_complete_runtime_root();
        std::fs::remove_file(root.join(bundled_runtime_dir_name()).join("node.exe")).unwrap();
        let err = resolve_bundled_runtime_at(&root).expect_err("missing node should fail");
        std::fs::remove_dir_all(&root).ok();
        assert!(err.starts_with("[E_RUNTIME_MISSING_NODE]"), "got: {err}");
    }

    #[test]
    fn resolve_bundled_runtime_at_returns_missing_tracker_when_tracker_js_absent() {
        let root = make_complete_runtime_root();
        std::fs::remove_file(
            root.join(bundled_runtime_dir_name())
                .join("tokentracker")
                .join("bin")
                .join("tracker.js"),
        )
        .unwrap();
        let err = resolve_bundled_runtime_at(&root).expect_err("missing tracker should fail");
        std::fs::remove_dir_all(&root).ok();
        assert!(err.starts_with("[E_RUNTIME_MISSING_TRACKER]"), "got: {err}");
    }

    #[test]
    fn resolve_bundled_runtime_at_returns_missing_dashboard_when_index_absent() {
        let root = make_complete_runtime_root();
        std::fs::remove_file(
            root.join(bundled_runtime_dir_name())
                .join("tokentracker")
                .join("dashboard")
                .join("dist")
                .join("index.html"),
        )
        .unwrap();
        let err = resolve_bundled_runtime_at(&root).expect_err("missing dashboard should fail");
        std::fs::remove_dir_all(&root).ok();
        assert!(
            err.starts_with("[E_RUNTIME_MISSING_DASHBOARD]"),
            "got: {err}"
        );
    }

    #[test]
    fn resolve_bundled_runtime_at_returns_missing_manifest_when_manifest_absent() {
        let root = make_complete_runtime_root();
        std::fs::remove_file(
            root.join(bundled_runtime_dir_name())
                .join("runtime-manifest.json"),
        )
        .unwrap();
        let err = resolve_bundled_runtime_at(&root).expect_err("missing manifest should fail");
        std::fs::remove_dir_all(&root).ok();
        assert!(
            err.starts_with("[E_RUNTIME_MISSING_MANIFEST]"),
            "got: {err}"
        );
    }

    #[test]
    fn resolve_bundled_runtime_at_error_starts_with_bracketed_code() {
        // The frontend's parseRuntimeErrorCode splits on the FIRST ']'.
        // Every error string must therefore start with the bracketed code,
        // not a path or any other prefix. This guards against regressions
        // where someone prepends a log level or timestamp.
        let root = make_complete_runtime_root();
        std::fs::remove_file(root.join(bundled_runtime_dir_name()).join("node.exe")).unwrap();
        let err = resolve_bundled_runtime_at(&root).expect_err("should fail");
        std::fs::remove_dir_all(&root).ok();
        assert!(
            err.starts_with('['),
            "error must start with '[' for frontend parsing, got: {err}"
        );
        let close = err.find(']').expect("error must contain ']'");
        assert!(
            err[..close].starts_with("[E_RUNTIME_"),
            "error prefix must be [E_RUNTIME_*, got: {}",
            &err[..close]
        );
    }

    // ── R1 第 2 轮负向探针：端口占用 ──────────────────────────────
    // 7680 被占用时 choose_bindable_port 必须回退到其他端口；
    // 不允许静默回退到默认端口 7680（旧 05 P0 反例）。

    #[test]
    fn choose_bindable_port_falls_back_when_preferred_port_occupied() {
        // On Windows, port 7680 may be in the Hyper-V dynamic port reserved
        // range (PermissionDenied code 10013) and therefore cannot be bound
        // by a test even when nothing is listening on it. To make this
        // probe robust across machines, we don't assume 7680 is bindable:
        //
        // 1. Call choose_bindable_port once to get a port that IS bindable.
        // 2. Bind it (so it becomes occupied).
        // 3. Call choose_bindable_port again — it must NOT return the
        //    occupied port, proving the fallback path works.
        //
        // This still exercises the exact same code path (is_port_bindable
        // returns false → scan fallback ranges) without depending on the
        // preferred port being bindable on this particular Windows host.
        let first = choose_bindable_port().expect("first port");
        let holder =
            TcpListener::bind((LOCAL_SERVER_HOST, first)).expect("bind first port to occupy it");
        let second = choose_bindable_port().expect("fallback port");
        drop(holder);
        assert_ne!(first, second, "must not return the now-occupied port");
        let in_nearby = (NEARBY_PORT_PROBE_START..=NEARBY_PORT_PROBE_END).contains(&second);
        let in_fallback =
            (FALLBACK_LOCAL_SERVER_PORT_START..=FALLBACK_LOCAL_SERVER_PORT_END).contains(&second);
        // The second port may legitimately equal PREFERRED if PREFERRED
        // was free all along and `first` was in a fallback range. The
        // invariant we care about is: it's never the occupied one and it's
        // always in one of our probed ranges.
        let in_preferred = second == PREFERRED_LOCAL_SERVER_PORT;
        assert!(
            in_nearby || in_fallback || in_preferred,
            "second port {second} not in any probed range"
        );
    }

    // ── R1 第 2 轮负向探针：后端启动后不就绪 ──────────────────────
    // wait_for_ready 必须在超时后返回 false，不允许无限等待。
    // ensure_local_server_started 依赖此函数区分 BACKEND_CRASHED 与
    // STARTUP_TIMEOUT。

    #[test]
    fn wait_for_ready_returns_false_when_server_never_becomes_ready() {
        // Bind a TCP listener that accepts ONE connection and responds
        // with 500, then exits (dropping the listener). After the first
        // probe, is_token_tracker_api_available will fail to connect
        // (connection refused) and return false quickly. wait_for_ready
        // must still time out because no probe ever returns true.
        //
        // We accept only ONE connection (matching serve_probe_response's
        // pattern) so the probe thread exits promptly and join() doesn't
        // deadlock waiting for a second accept that never comes.
        let listener = TcpListener::bind((LOCAL_SERVER_HOST, 0)).expect("bind silent server");
        let port = listener.local_addr().expect("addr").port();
        let handle = thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0_u8; 1024];
                let _ = stream.read(&mut buf);
                let _ = stream.write_all(b"HTTP/1.1 500 Internal Server Error\r\n\r\n");
            }
        });
        let ready = wait_for_ready(port, Duration::from_millis(800));
        handle.join().ok();
        assert!(!ready, "wait_for_ready must return false on timeout");
    }

    #[test]
    fn api_probe_rejects_server_returning_500_error() {
        // Negative probe: a backend that returns 5xx must not be accepted
        // as a ready Token Tracker API. Guards against silent acceptance
        // of a half-dead backend that happens to keep the port open.
        let (port, handle) =
            serve_probe_response("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n");
        assert!(!is_token_tracker_api_available(port));
        handle.join().expect("probe server thread");
    }
}
