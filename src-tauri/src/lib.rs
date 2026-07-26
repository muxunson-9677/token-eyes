mod auto_launch;
mod claude_session;
#[path = "commands.rs"]
mod commands;
mod codex_session;
mod cursor_session;
mod glm_session;
mod kimi_session;
mod tray;
mod window_control;
mod window_prefs;
mod xiaomi_mimo_session;

/// Pure, current-product contracts used by integration tests without exposing
/// the Tauri command modules themselves as public API.
pub mod current_product_contract {
    pub use crate::claude_session::{
        is_official_claude_url, validate_session_ref as validate_claude_session_ref,
    };
    pub use crate::codex_session::{
        is_official_codex_url, validate_session_ref as validate_codex_session_ref,
    };
    pub use crate::commands::LocalServerState;
    pub use crate::tray::{tray_click_restores_main_window, tray_menu_action, TrayMenuAction};
    pub use crate::cursor_session::{
        is_official_cursor_url, validate_session_ref as validate_cursor_session_ref,
    };
    pub use crate::glm_session::{
        is_official_glm_url, validate_session_ref as validate_glm_session_ref,
    };
    pub use crate::kimi_session::{
        is_official_kimi_url, validate_session_ref as validate_kimi_session_ref,
    };
    pub use crate::window_control::{
        should_minimize_to_tray, RestoreTrigger, APP_DISPLAY_NAME, SINGLE_INSTANCE_RESTORE_TRIGGER,
    };
    pub use crate::CURRENT_TAURI_COMMANDS;
    pub use crate::xiaomi_mimo_session::{
        is_official_xiaomi_url, validate_session_ref as validate_xiaomi_session_ref,
    };
}

use std::sync::Mutex;
use tauri::Manager;

use claude_session::ClaudeSessionState;
use codex_session::CodexSessionState;
use cursor_session::CursorSessionState;
use xiaomi_mimo_session::SessionState;

macro_rules! current_tauri_commands {
    ($consumer:ident) => {
        $consumer!(
            commands::pick_directory,
            commands::local_server_status,
            window_prefs::get_window_prefs,
            window_prefs::set_minimize_to_tray_on_close,
            window_prefs::set_launch_on_startup,
            window_prefs::set_silent_startup,
            xiaomi_mimo_session::open_xiaomi_mimo_console_login,
            xiaomi_mimo_session::verify_xiaomi_mimo_console_session,
            xiaomi_mimo_session::delete_xiaomi_mimo_console_session,
            claude_session::open_claude_console_login,
            claude_session::verify_claude_console_session,
            claude_session::delete_claude_console_session,
            codex_session::open_codex_console_login,
            codex_session::verify_codex_console_session,
            codex_session::delete_codex_console_session,
            cursor_session::open_cursor_console_login,
            cursor_session::verify_cursor_console_session,
            cursor_session::delete_cursor_console_session,
            glm_session::open_glm_console_login,
            glm_session::verify_glm_console_session,
            glm_session::delete_glm_console_session,
            kimi_session::open_kimi_console_login,
            kimi_session::verify_kimi_console_session,
            kimi_session::delete_kimi_console_session,
        )
    };
}

macro_rules! build_current_handler {
    ($($command:path),+ $(,)?) => {
        tauri::generate_handler![$($command),+]
    };
}

macro_rules! current_command_names {
    ($($command:path),+ $(,)?) => {
        &[$(stringify!($command)),+]
    };
}

pub const CURRENT_TAURI_COMMANDS: &[&str] = current_tauri_commands!(current_command_names);

/// Windows groups taskbar buttons and labels them by AppUserModelID (AUMID).
/// Because Token Eyes started life as a "CC Switch" fork, a stale pin/shortcut
/// from an earlier build could otherwise make Windows label our window
/// "CC Switch". Pinning our own explicit AUMID keeps the process identity
/// firmly "Token Eyes" regardless of leftover shell state.
#[cfg(windows)]
fn set_windows_app_user_model_id() {
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let id: Vec<u16> = "com.tokeneyes.desktop\0".encode_utf16().collect();
    unsafe {
        let _ = SetCurrentProcessExplicitAppUserModelID(id.as_ptr());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    set_windows_app_user_model_id();

    tauri::Builder::default()
        // MUST be the first plugin: the single-instance guard has to install
        // before anything else so a second launch is short-circuited into
        // `restore_main_window` on the already-running process (fixes both the
        // duplicate-instance bug and "shortcut won't reopen the tray-hidden
        // window").
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            window_control::restore_main_window_for_trigger(
                app,
                window_control::SINGLE_INSTANCE_RESTORE_TRIGGER,
            );
        }))
        .manage(commands::LocalServerState::default())
        .manage(Mutex::new(SessionState::default()))
        .manage(Mutex::new(ClaudeSessionState::default()))
        .manage(Mutex::new(CodexSessionState::default()))
        .manage(Mutex::new(CursorSessionState::default()))
        .manage(Mutex::new(glm_session::GlmSessionState::default()))
        .manage(Mutex::new(kimi_session::KimiSessionState::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(current_tauri_commands!(build_current_handler))
        .setup(|app| {
            window_control::enforce_main_window_title(app.handle());

            if let Err(err) = tray::create_tray(app.handle()) {
                eprintln!("[Token Eyes] tray setup warning: {err}");
            }

            if window_prefs::wants_silent_start() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // Non-blocking: show the WebView shell immediately; bundled backend
            // startup (port probe + node spawn + readiness wait) runs in a
            // background thread. The dashboard resolves the API URL via
            // `local_server_status` with retries (see local-api-url.ts).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<commands::LocalServerState>();
                if let Err(err) = commands::ensure_local_server_started(&handle, state.inner()) {
                    eprintln!("[Token Eyes] local API startup warning: {err}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let prefs = window_prefs::load(window.app_handle());
                if window_control::should_minimize_to_tray(
                    window.label(),
                    prefs.minimize_to_tray_on_close,
                ) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
