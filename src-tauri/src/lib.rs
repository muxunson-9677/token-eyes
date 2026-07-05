mod commands;
mod xiaomi_mimo_session;

use std::sync::Mutex;
use tauri::Manager;

use xiaomi_mimo_session::SessionState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::LocalServerState::default())
        .manage(Mutex::new(SessionState::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::pick_directory,
            commands::local_server_status,
            xiaomi_mimo_session::open_xiaomi_mimo_console_login,
            xiaomi_mimo_session::verify_xiaomi_mimo_console_session,
            xiaomi_mimo_session::delete_xiaomi_mimo_console_session,
        ])
        .setup(|app| {
            let state = app.state::<commands::LocalServerState>();
            if let Err(err) = commands::ensure_local_server_started(app.handle(), state.inner()) {
                eprintln!("[Token Eyes] local API startup warning: {err}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
