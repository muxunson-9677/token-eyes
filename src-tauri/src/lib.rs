mod auto_launch;
mod claude_session;
mod codex_app_server;
mod codex_oauth;
mod codex_session;
#[path = "commands.rs"]
mod commands;
mod cursor_session;
mod glm_session;
mod kimi_session;
mod minimax_session;
mod trae_session;
mod tray;
mod widget_window;
mod window_control;
mod window_prefs;
mod xiaomi_mimo_session;

use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

use claude_session::ClaudeSessionState;
use codex_session::CodexSessionState;
use cursor_session::CursorSessionState;
use xiaomi_mimo_session::SessionState;

const PROVIDER_LINKS_JSON: &str = include_str!("../../shared/provider-links.json");

#[derive(Debug, serde::Deserialize)]
struct ProviderLinkRegistry {
    _meta: ProviderLinkRegistryMeta,
    links: Vec<ProviderLinkEntry>,
}

#[derive(Debug, serde::Deserialize)]
struct ProviderLinkRegistryMeta {
    schema_version: u32,
}

#[derive(Debug, serde::Deserialize)]
struct ProviderLinkEntry {
    link_id: String,
    source_type: String,
    url: String,
    allowed_hosts: Vec<String>,
    expected_final: ProviderLinkExpectedFinal,
}

#[derive(Debug, serde::Deserialize)]
struct ProviderLinkExpectedFinal {
    url: String,
    path: String,
}

fn validate_provider_link_target(
    raw_url: &str,
    allowed_hosts: &[String],
) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw_url).map_err(|_| "provider_link_unsafe".to_string())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "provider_link_unsafe".to_string())?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some_and(|port| port != 443)
        || !allowed_hosts.iter().any(|allowed| allowed == host)
    {
        return Err("provider_link_unsafe".to_string());
    }
    Ok(parsed)
}

fn parse_provider_link_registry(raw: &str) -> Result<ProviderLinkRegistry, String> {
    let registry: ProviderLinkRegistry =
        serde_json::from_str(raw).map_err(|_| "provider_link_registry_invalid".to_string())?;
    if registry._meta.schema_version != 1 || registry.links.is_empty() {
        return Err("provider_link_registry_invalid".to_string());
    }

    let mut link_ids = std::collections::HashSet::with_capacity(registry.links.len());
    for entry in &registry.links {
        if entry.link_id.is_empty()
            || entry.source_type.is_empty()
            || entry.allowed_hosts.is_empty()
            || !link_ids.insert(entry.link_id.as_str())
            || entry.allowed_hosts.iter().any(|host| {
                host.is_empty() || host.contains(':') || host != &host.to_ascii_lowercase()
            })
        {
            return Err("provider_link_registry_invalid".to_string());
        }
        validate_provider_link_target(&entry.url, &entry.allowed_hosts)
            .map_err(|_| "provider_link_registry_invalid".to_string())?;
        let expected_final =
            validate_provider_link_target(&entry.expected_final.url, &entry.allowed_hosts)
                .map_err(|_| "provider_link_registry_invalid".to_string())?;
        if expected_final.path() != entry.expected_final.path {
            return Err("provider_link_registry_invalid".to_string());
        }
    }
    Ok(registry)
}

pub(crate) fn resolve_provider_link_url(link_id: &str) -> Result<url::Url, String> {
    let registry = parse_provider_link_registry(PROVIDER_LINKS_JSON)?;
    let entry = registry
        .links
        .iter()
        .find(|entry| entry.link_id == link_id)
        .ok_or_else(|| "provider_link_unknown".to_string())?;
    validate_provider_link_target(&entry.url, &entry.allowed_hosts)
}

#[tauri::command]
async fn open_external_link(app: tauri::AppHandle, link_id: String) -> Result<bool, String> {
    let url = resolve_provider_link_url(&link_id)?;
    app.opener()
        .open_url(url.as_str(), None::<String>)
        .map_err(|_| "provider_link_open_failed".to_string())?;
    Ok(true)
}

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
            window_control::restore_main_window(app);
        }))
        .manage(commands::LocalServerState::default())
        .manage(Mutex::new(SessionState::default()))
        .manage(Mutex::new(ClaudeSessionState::default()))
        .manage(Mutex::new(CodexSessionState::default()))
        .manage(Mutex::new(CursorSessionState::default()))
        .manage(Mutex::new(glm_session::GlmSessionState::default()))
        .manage(Mutex::new(kimi_session::KimiSessionState::default()))
        .manage(Mutex::new(minimax_session::MiniMaxSessionState::default()))
        .manage(Mutex::new(trae_session::TraeSessionState::default()))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::pick_directory,
            commands::local_server_status,
            commands::get_token_eyes_build_info,
            open_external_link,
            tray::set_codex_reset_tray_status,
            widget_window::show_desktop_widget,
            widget_window::hide_desktop_widget,
            widget_window::get_desktop_widget_prefs,
            widget_window::set_desktop_widget_prefs,
            widget_window::set_desktop_widget_always_on_top,
            widget_window::set_desktop_widget_popover,
            widget_window::set_desktop_widget_celebration,
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
            codex_session::reauthorize_codex_console_login,
            codex_session::reopen_codex_console_login,
            codex_session::verify_codex_console_session,
            codex_session::sync_codex_console_quota,
            codex_session::cancel_codex_console_login,
            codex_session::cleanup_legacy_codex_auth_file,
            codex_session::delete_codex_console_session,
            cursor_session::open_cursor_console_login,
            cursor_session::verify_cursor_console_session,
            cursor_session::delete_cursor_console_session,
            glm_session::open_glm_console_login,
            glm_session::verify_glm_console_session,
            glm_session::refresh_glm_console_session,
            glm_session::delete_glm_console_session,
            kimi_session::open_kimi_console_login,
            kimi_session::verify_kimi_console_session,
            kimi_session::delete_kimi_console_session,
            minimax_session::open_minimax_console_login,
            minimax_session::verify_minimax_console_session,
            minimax_session::delete_minimax_console_session,
            trae_session::open_trae_console_login,
            trae_session::verify_trae_console_session,
            trae_session::sync_trae_console_quota,
            trae_session::delete_trae_console_session,
        ])
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

            widget_window::restore_if_visible(app.handle());

            // Non-blocking: show the WebView shell immediately; bundled backend
            // startup (port probe + node spawn + readiness wait) runs in a
            // background thread. The dashboard resolves the API URL via
            // `local_server_status` with retries (see local-api-url.ts).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = handle.state::<commands::LocalServerState>();
                if let Err(err) = commands::ensure_local_server_started(&handle, state.inner()) {
                    eprintln!("[Token Eyes] local API startup warning: {err}");
                } else {
                    tray::refresh_compact_quota_status(&handle);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                if widget_window::is_widget_window(window.label()) {
                    api.prevent_close();
                    let _ = widget_window::hide_desktop_widget(window.app_handle().clone());
                } else {
                    let prefs = window_prefs::load(window.app_handle());
                    if window_control::should_minimize_to_tray(
                        window.label(),
                        prefs.minimize_to_tray_on_close,
                    ) {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)
                if widget_window::is_widget_window(window.label()) =>
            {
                if let Some(widget) = window
                    .app_handle()
                    .get_webview_window(widget_window::WIDGET_LABEL)
                {
                    widget_window::persist_geometry(&widget);
                }
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod provider_link_tests {
    use super::{
        parse_provider_link_registry, resolve_provider_link_url, validate_provider_link_target,
        PROVIDER_LINKS_JSON,
    };

    #[test]
    fn resolves_every_compiled_registry_entry_by_link_id() {
        let registry: serde_json::Value = serde_json::from_str(PROVIDER_LINKS_JSON).unwrap();
        for entry in registry["links"].as_array().unwrap() {
            let link_id = entry["link_id"].as_str().unwrap();
            let expected_url = entry["url"].as_str().unwrap();
            assert_eq!(
                resolve_provider_link_url(link_id).unwrap().as_str(),
                expected_url
            );
        }
    }

    #[test]
    fn rejects_arbitrary_url_unknown_id_and_unsafe_targets() {
        assert_eq!(
            resolve_provider_link_url("https://evil.example/secret").unwrap_err(),
            "provider_link_unknown"
        );

        let allowed = vec!["cursor.com".to_string()];
        for unsafe_url in [
            "http://cursor.com/",
            "https://user:pass@cursor.com/",
            "https://cursor.com:8443/",
            "https://cursor.com.evil.example/",
            "https://evil.example/",
        ] {
            assert_eq!(
                validate_provider_link_target(unsafe_url, &allowed).unwrap_err(),
                "provider_link_unsafe"
            );
        }
    }

    #[test]
    fn rejects_unknown_registry_schema_and_duplicate_link_ids() {
        let unknown_schema = r#"{"_meta":{"schema_version":2},"links":[]}"#;
        assert_eq!(
            parse_provider_link_registry(unknown_schema).unwrap_err(),
            "provider_link_registry_invalid"
        );

        let duplicate_ids = r#"{
          "_meta":{"schema_version":1},
          "links":[
            {"link_id":"same","source_type":"official_product","url":"https://cursor.com/","allowed_hosts":["cursor.com"],"expected_final":{"url":"https://cursor.com/","path":"/"}},
            {"link_id":"same","source_type":"official_product","url":"https://cursor.com/pricing","allowed_hosts":["cursor.com"],"expected_final":{"url":"https://cursor.com/pricing","path":"/pricing"}}
          ]
        }"#;
        assert_eq!(
            parse_provider_link_registry(duplicate_ids).unwrap_err(),
            "provider_link_registry_invalid"
        );
    }
}
