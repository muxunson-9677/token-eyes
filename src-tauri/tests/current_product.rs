use token_eyes_lib::current_product_contract::{
    is_official_claude_url, is_official_codex_url, is_official_cursor_url, is_official_glm_url,
    is_official_kimi_url, is_official_xiaomi_url, should_minimize_to_tray,
    tray_click_restores_main_window, tray_menu_action, validate_claude_session_ref,
    validate_codex_session_ref, validate_cursor_session_ref, validate_glm_session_ref,
    validate_kimi_session_ref, validate_xiaomi_session_ref, LocalServerState, RestoreTrigger,
    TrayMenuAction, APP_DISPLAY_NAME, CURRENT_TAURI_COMMANDS, SINGLE_INSTANCE_RESTORE_TRIGGER,
};

use serde_json::Value;

type SessionRefValidator = fn(&str) -> Result<(), &'static str>;

fn has_registered_command(expected: &str) -> bool {
    CURRENT_TAURI_COMMANDS
        .iter()
        .any(|registered| registered.replace(' ', "") == expected)
}

#[test]
fn current_desktop_shell_contract_covers_window_tray_and_local_service_state() {
    assert_eq!(APP_DISPLAY_NAME, "Token Eyes");
    assert!(should_minimize_to_tray("main", true));
    assert!(!should_minimize_to_tray("main", false));
    assert!(!should_minimize_to_tray("secondary", true));

    assert_eq!(tray_menu_action("show"), TrayMenuAction::RestoreMainWindow);
    assert_eq!(tray_menu_action("quit"), TrayMenuAction::Quit);
    assert_eq!(tray_menu_action("unknown"), TrayMenuAction::Ignore);
    assert!(tray_click_restores_main_window(true, true));
    assert!(!tray_click_restores_main_window(true, false));
    assert!(!tray_click_restores_main_window(false, true));
    assert_ne!(RestoreTrigger::SingleInstance, RestoreTrigger::TrayMenu);
    assert_ne!(RestoreTrigger::TrayMenu, RestoreTrigger::TrayClick);

    let state = LocalServerState::default();
    assert_eq!(state.known_url().unwrap(), None);
    let ready_url = "http://127.0.0.1:47831".to_string();
    assert_eq!(
        state.record_ready_url(ready_url.clone()).unwrap(),
        ready_url
    );
    assert_eq!(
        state.known_url().unwrap().as_deref(),
        Some("http://127.0.0.1:47831")
    );
    state.clear_ready_url();
    assert_eq!(state.known_url().unwrap(), None);

    assert!(has_registered_command("commands::local_server_status"));
    assert!(has_registered_command("window_prefs::get_window_prefs"));
}

#[test]
fn single_instance_plugin_is_wired_to_restore_the_existing_main_window() {
    assert_eq!(SINGLE_INSTANCE_RESTORE_TRIGGER, RestoreTrigger::SingleInstance);

    let source = include_str!("../src/lib.rs");
    let plugin = source
        .find(".plugin(tauri_plugin_single_instance::init")
        .expect("current Tauri builder must install the single-instance plugin");
    let callback = source
        .find("window_control::SINGLE_INSTANCE_RESTORE_TRIGGER")
        .expect("single-instance callback must use the tested restore trigger contract");
    let managed_state = source
        .find(".manage(commands::LocalServerState::default())")
        .expect("current Tauri builder must manage local server state");
    assert!(plugin < callback && callback < managed_state, "single-instance wiring must be the first plugin and restore before normal builder state");
}
#[test]
fn native_session_manifest_matches_the_compiled_tauri_handler() {
    let manifest: Value =
        serde_json::from_str(include_str!("../../shared/provider-capabilities.json"))
            .expect("provider capability manifest must be valid JSON");
    let providers = manifest["providers"]
        .as_array()
        .expect("manifest providers must be an array");

    let native_ids: Vec<&str> = providers
        .iter()
        .filter(|provider| provider["native_session_bridge"].as_bool() == Some(true))
        .map(|provider| {
            provider["id"]
                .as_str()
                .expect("provider id must be a string")
        })
        .collect();
    assert_eq!(native_ids.len(), 6);

    for id in native_ids {
        assert_eq!(
            providers
                .iter()
                .find(|provider| provider["id"].as_str() == Some(id))
                .and_then(|provider| provider["official_rate_limit"].as_bool()),
            Some(true),
            "native session provider {id} must be an official rate-limit provider"
        );
        for action in ["open", "verify", "delete"] {
            let command = format!("{id}_session::{action}_{id}_console_session");
            let login_command = format!("{id}_session::{action}_{id}_console_login");
            assert!(
                has_registered_command(&command) || has_registered_command(&login_command),
                "missing compiled Tauri command for {id}/{action}"
            );
        }
    }
}

#[test]
fn current_official_session_contract_accepts_refs_and_rejects_lookalike_hosts() {
    for (validate, session_ref) in [
        (
            validate_claude_session_ref as SessionRefValidator,
            "token-plan/claude/session/test",
        ),
        (
            validate_codex_session_ref as SessionRefValidator,
            "token-plan/codex/session/test",
        ),
        (
            validate_cursor_session_ref as SessionRefValidator,
            "token-plan/cursor/session/test",
        ),
        (
            validate_glm_session_ref as SessionRefValidator,
            "token-plan/glm/session/test",
        ),
        (
            validate_kimi_session_ref as SessionRefValidator,
            "token-plan/kimi/session/test",
        ),
        (
            validate_xiaomi_session_ref as SessionRefValidator,
            "token-plan/xiaomi_mimo/session/test",
        ),
    ] {
        assert!(validate(session_ref).is_ok());
        assert!(validate("").is_err());
    }

    assert!(is_official_claude_url("https://console.anthropic.com/"));
    assert!(is_official_codex_url("https://chatgpt.com/codex"));
    assert!(is_official_cursor_url("https://cursor.com/settings"));
    assert!(is_official_glm_url("https://open.bigmodel.cn/login"));
    assert!(is_official_kimi_url("https://kimi.com/code"));
    assert!(is_official_xiaomi_url("https://mimo.mi.com/console"));

    for official_check in [
        is_official_claude_url as fn(&str) -> bool,
        is_official_codex_url,
        is_official_cursor_url,
        is_official_glm_url,
        is_official_kimi_url,
        is_official_xiaomi_url,
    ] {
        assert!(!official_check(
            "https://official.example.evil.invalid/login"
        ));
    }
}
