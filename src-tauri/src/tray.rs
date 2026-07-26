//! Minimal Token Eyes system tray: show main window / quit.

use crate::window_control::{
    restore_main_window_for_trigger, RestoreTrigger, APP_DISPLAY_NAME,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle,
};

const TRAY_ID: &str = "token-eyes-tray";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayMenuAction {
    RestoreMainWindow,
    Quit,
    Ignore,
}

pub fn tray_menu_action(menu_id: &str) -> TrayMenuAction {
    match menu_id {
        "show" => TrayMenuAction::RestoreMainWindow,
        "quit" => TrayMenuAction::Quit,
        _ => TrayMenuAction::Ignore,
    }
}

pub fn tray_click_restores_main_window(is_left_button: bool, is_button_up: bool) -> bool {
    is_left_button && is_button_up
}

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(APP_DISPLAY_NAME)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match tray_menu_action(event.id.as_ref()) {
            TrayMenuAction::RestoreMainWindow => {
                restore_main_window_for_trigger(app, RestoreTrigger::TrayMenu)
            }
            TrayMenuAction::Quit => app.exit(0),
            TrayMenuAction::Ignore => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if tray_click_restores_main_window(
                    button == MouseButton::Left,
                    button_state == MouseButtonState::Up,
                ) {
                    restore_main_window_for_trigger(
                        tray.app_handle(),
                        RestoreTrigger::TrayClick,
                    );
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    let _tray = builder.build(app)?;
    Ok(())
}
