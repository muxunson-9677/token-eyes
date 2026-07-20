//! Minimal Token Eyes system tray: show main window / quit.

use crate::window_control::{restore_main_window, APP_DISPLAY_NAME};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

const TRAY_ID: &str = "token-eyes-tray";

pub struct CodexTrayState {
    status_item: MenuItem<Wry>,
}

fn codex_reset_tray_label(unread_count: u32, latest_type: Option<&str>) -> String {
    let bounded_count = unread_count.min(999);
    if bounded_count == 0 {
        return "Codex 重置通知：暂无新提醒".to_string();
    }
    if bounded_count == 1 && latest_type == Some("reset_completed") {
        return "Codex 额度已恢复".to_string();
    }
    format!("Codex 重置通知：{bounded_count} 条新提醒")
}

fn supported_latest_type(latest_type: Option<&str>) -> Option<&str> {
    match latest_type {
        Some(
            value @ ("reset_upcoming"
            | "reset_completed"
            | "unexpected_quota_restore"
            | "banked_reset_available"
            | "official_reset_announcement"),
        ) => Some(value),
        _ => None,
    }
}

#[tauri::command]
pub fn set_codex_reset_tray_status(
    state: tauri::State<'_, CodexTrayState>,
    unread_count: u32,
    latest_type: Option<String>,
) -> Result<(), String> {
    let latest_type = supported_latest_type(latest_type.as_deref());
    state
        .status_item
        .set_text(codex_reset_tray_label(unread_count, latest_type))
        .map_err(|error| error.to_string())
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let codex_status = MenuItem::with_id(
        app,
        "codex-reset-status",
        codex_reset_tray_label(0, None),
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&codex_status, &show, &quit])?;
    app.manage(CodexTrayState {
        status_item: codex_status,
    });

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(APP_DISPLAY_NAME)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => restore_main_window(app),
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                restore_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let _tray = builder.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::codex_reset_tray_label;

    #[test]
    fn formats_empty_codex_reset_status() {
        assert_eq!(
            codex_reset_tray_label(0, None),
            "Codex 重置通知：暂无新提醒"
        );
    }

    #[test]
    fn highlights_a_completed_reset() {
        assert_eq!(
            codex_reset_tray_label(1, Some("reset_completed")),
            "Codex 额度已恢复"
        );
    }

    #[test]
    fn caps_the_unread_count() {
        assert_eq!(
            codex_reset_tray_label(1_500, Some("official_reset_announcement")),
            "Codex 重置通知：999 条新提醒"
        );
    }
}
