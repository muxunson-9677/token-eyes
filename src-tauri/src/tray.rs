//! Minimal Token Eyes system tray: show main window / quit.

use crate::commands;
use crate::window_control::{restore_main_window, APP_DISPLAY_NAME};
use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Wry,
};

const TRAY_ID: &str = "token-eyes-tray";

pub struct CodexTrayState {
    status_item: MenuItem<Wry>,
}

pub struct CompactQuotaTrayState {
    status_item: MenuItem<Wry>,
    five_hour_item: MenuItem<Wry>,
    seven_day_item: MenuItem<Wry>,
    month_item: MenuItem<Wry>,
}

#[derive(Deserialize)]
struct CompactQuotaResponse {
    title: String,
    #[serde(default)]
    lines: Vec<String>,
}

fn compact_quota_labels(title: &str, lines: &[String]) -> [String; 4] {
    let line_for = |label: &str, needles: &[&str]| {
        let line = lines.iter().find(|line| {
            let lower = line.to_ascii_lowercase();
            needles.iter().any(|needle| lower.contains(needle))
        });
        match line {
            Some(line) => format!("{label}: {line}"),
            None => format!("{label}: —"),
        }
    };
    [
        format!("\u{989d}\u{5ea6}: {title}"),
        line_for("5\u{5c0f}\u{65f6}", &["5h", "five_hour"]),
        line_for("7\u{5929}", &["7d", "seven_day"]),
        line_for("\u{6708}\u{5ea6}", &["month", "monthly"]),
    ]
}

fn set_compact_quota_labels(app: &AppHandle, labels: [String; 4]) {
    let state = app.state::<CompactQuotaTrayState>();
    let _ = state.status_item.set_text(&labels[0]);
    let _ = state.five_hour_item.set_text(&labels[1]);
    let _ = state.seven_day_item.set_text(&labels[2]);
    let _ = state.month_item.set_text(&labels[3]);
}

pub fn refresh_compact_quota_status(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let app_for_start = app.clone();
        let base_url = tauri::async_runtime::spawn_blocking(move || {
            let state = app_for_start.state::<commands::LocalServerState>();
            commands::ensure_local_server_started(&app_for_start, state.inner())
        })
        .await
        .ok()
        .and_then(Result::ok);

        let Some(base_url) = base_url else {
            set_compact_quota_labels(&app, compact_quota_labels("\u{6682}\u{65f6}\u{4e0d}\u{53ef}\u{7528}", &[]));
            return;
        };
        let url = format!("{base_url}/functions/tokentracker-tray-compact?density=full");
        let response = reqwest::Client::new()
            .get(url)
            .timeout(std::time::Duration::from_secs(4))
            .send()
            .await;
        let response = match response.and_then(|response| response.error_for_status()) {
            Ok(response) => response.json::<CompactQuotaResponse>().await,
            Err(error) => Err(error),
        };
        match response {
            Ok(view) => set_compact_quota_labels(&app, compact_quota_labels(&view.title, &view.lines)),
            Err(_) => set_compact_quota_labels(&app, compact_quota_labels("\u{6682}\u{65f6}\u{4e0d}\u{53ef}\u{7528}", &[])),
        }
    });
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
    let quota_status = MenuItem::with_id(app, "quota-status", "\u{989d}\u{5ea6}: \u{8bfb}\u{53d6}\u{4e2d}", false, None::<&str>)?;
    let quota_five_hour = MenuItem::with_id(app, "quota-5h", "5\u{5c0f}\u{65f6}: —", false, None::<&str>)?;
    let quota_seven_day = MenuItem::with_id(app, "quota-7d", "7\u{5929}: —", false, None::<&str>)?;
    let quota_month = MenuItem::with_id(app, "quota-month", "\u{6708}\u{5ea6}: —", false, None::<&str>)?;
    let refresh_quota = MenuItem::with_id(app, "refresh-quota-status", "\u{5237}\u{65b0}\u{989d}\u{5ea6}", true, None::<&str>)?;
    let codex_status = MenuItem::with_id(
        app,
        "codex-reset-status",
        codex_reset_tray_label(0, None),
        false,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quota_status, &quota_five_hour, &quota_seven_day, &quota_month, &refresh_quota, &codex_status, &show, &quit])?;
    app.manage(CodexTrayState {
        status_item: codex_status,
    });
    app.manage(CompactQuotaTrayState {
        status_item: quota_status,
        five_hour_item: quota_five_hour,
        seven_day_item: quota_seven_day,
        month_item: quota_month,
    });

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(APP_DISPLAY_NAME)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => restore_main_window(app),
            "refresh-quota-status" => refresh_compact_quota_status(app),
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
    use super::{codex_reset_tray_label, compact_quota_labels};

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

    #[test]
    fn keeps_the_windows_quota_tray_to_safe_5h_7d_and_monthly_lines() {
        let labels = compact_quota_labels(
            "codex 5h 80%",
            &[
                "codex 5h 80% · 1h00m".to_string(),
                "codex 7d 31% · 4d00h".to_string(),
                "claude monthly 12% · 18d00h".to_string(),
            ],
        );

        assert_eq!(labels[0], "\u{989d}\u{5ea6}: codex 5h 80%");
        assert_eq!(labels[1], "5\u{5c0f}\u{65f6}: codex 5h 80% · 1h00m");
        assert_eq!(labels[2], "7\u{5929}: codex 7d 31% · 4d00h");
        assert_eq!(labels[3], "\u{6708}\u{5ea6}: claude monthly 12% · 18d00h");
        assert!(!labels.join(" ").contains("private"));
    }
}
