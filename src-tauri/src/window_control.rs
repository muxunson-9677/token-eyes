use tauri::{AppHandle, Manager, WebviewWindow};

pub const APP_DISPLAY_NAME: &str = "Token Eyes";
const MAIN_WINDOW_LABEL: &str = "main";

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

pub fn restore_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        restore_window(&window);
    }
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
}
