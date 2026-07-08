mod claude_session;
mod commands;
mod codex_session;
mod cursor_session;
mod glm_session;
mod kimi_session;
mod xiaomi_mimo_session;

use std::sync::Mutex;
use tauri::Manager;

use claude_session::ClaudeSessionState;
use codex_session::CodexSessionState;
use cursor_session::CursorSessionState;
use xiaomi_mimo_session::SessionState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::LocalServerState::default())
        .manage(Mutex::new(SessionState::default()))
        .manage(Mutex::new(ClaudeSessionState::default()))
        .manage(Mutex::new(CodexSessionState::default()))
        .manage(Mutex::new(CursorSessionState::default()))
        .manage(Mutex::new(glm_session::GlmSessionState::default()))
        .manage(Mutex::new(kimi_session::KimiSessionState::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::pick_directory,
            commands::local_server_status,
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
        ])
        .setup(|app| {
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
