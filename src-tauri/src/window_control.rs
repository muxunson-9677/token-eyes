use tauri::{AppHandle, Manager, WebviewWindow};

pub const APP_DISPLAY_NAME: &str = "Token Eyes";
const MAIN_WINDOW_LABEL: &str = "main";
const RESTORE_LOOKUP_RETRIES: usize = 20;
const RESTORE_LOOKUP_DELAY_MS: u64 = 50;

trait WindowActions {
    fn unminimize(&self);
    fn show(&self);
    fn set_title(&self, title: &str);
    fn focus(&self);
}

impl WindowActions for WebviewWindow {
    fn unminimize(&self) {
        let _ = WebviewWindow::unminimize(self);
    }

    fn show(&self) {
        let _ = WebviewWindow::show(self);
    }

    fn set_title(&self, title: &str) {
        let _ = WebviewWindow::set_title(self, title);
    }

    fn focus(&self) {
        let _ = WebviewWindow::set_focus(self);
    }
}

fn restore_window(window: &impl WindowActions) {
    window.unminimize();
    window.show();
    window.set_title(APP_DISPLAY_NAME);
    window.focus();
}

fn try_restore_main_window(app: &AppHandle) -> bool {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        restore_window(&window);
        true
    } else {
        false
    }
}

pub fn restore_main_window(app: &AppHandle) {
    if try_restore_main_window(app) {
        return;
    }

    // A second process can notify the single-instance plugin while Tauri is
    // still registering the configured main window. Keep the request alive
    // briefly instead of dropping the user's shortcut click.
    let app = app.clone();
    std::thread::spawn(move || {
        for _ in 0..RESTORE_LOOKUP_RETRIES {
            std::thread::sleep(std::time::Duration::from_millis(RESTORE_LOOKUP_DELAY_MS));
            if try_restore_main_window(&app) {
                return;
            }
        }
    });
}

pub fn should_minimize_to_tray(window_label: &str, minimize_to_tray: bool) -> bool {
    minimize_to_tray && window_label == MAIN_WINDOW_LABEL
}

pub fn enforce_main_window_title(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.set_title(APP_DISPLAY_NAME);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct RecordingWindow {
        calls: RefCell<Vec<&'static str>>,
    }

    impl WindowActions for RecordingWindow {
        fn unminimize(&self) {
            self.calls.borrow_mut().push("unminimize");
        }

        fn show(&self) {
            self.calls.borrow_mut().push("show");
        }

        fn set_title(&self, title: &str) {
            assert_eq!(title, APP_DISPLAY_NAME);
            self.calls.borrow_mut().push("set_title");
        }

        fn focus(&self) {
            self.calls.borrow_mut().push("focus");
        }
    }

    #[test]
    fn restore_window_unminimizes_shows_corrects_title_then_focuses() {
        let window = RecordingWindow::default();
        restore_window(&window);
        assert_eq!(
            window.calls.into_inner(),
            vec!["unminimize", "show", "set_title", "focus"],
        );
    }

    #[test]
    fn only_the_main_window_can_be_intercepted_for_minimize_to_tray() {
        assert!(should_minimize_to_tray("main", true));
        assert!(!should_minimize_to_tray("main", false));
        assert!(!should_minimize_to_tray("codex_login_123", true));
        assert!(!should_minimize_to_tray("glm_login_123", true));
    }

    #[test]
    fn twenty_restore_requests_keep_using_the_same_window_actions() {
        let window = RecordingWindow::default();
        for _ in 0..20 {
            restore_window(&window);
        }
        let calls = window.calls.into_inner();
        assert_eq!(calls.len(), 80);
        for chunk in calls.chunks_exact(4) {
            assert_eq!(chunk, ["unminimize", "show", "set_title", "focus"]);
        }
    }
}
