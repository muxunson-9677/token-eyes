//! Token Eyes window / startup preferences (app-data JSON).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub const SILENT_START_ARG: &str = "--silent-start";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPrefs {
    pub minimize_to_tray_on_close: bool,
    pub launch_on_startup: bool,
    pub silent_startup: bool,
}

impl Default for WindowPrefs {
    fn default() -> Self {
        Self {
            minimize_to_tray_on_close: true,
            launch_on_startup: false,
            silent_startup: false,
        }
    }
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app data dir: {e}"))?;
    Ok(dir.join("window-prefs.json"))
}

pub fn load(app: &AppHandle) -> WindowPrefs {
    let Ok(path) = prefs_path(app) else {
        return WindowPrefs::default();
    };
    let Ok(raw) = fs::read_to_string(&path) else {
        return WindowPrefs::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

pub fn save(app: &AppHandle, prefs: &WindowPrefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create app data dir: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(prefs).map_err(|e| format!("serialize prefs: {e}"))?;
    fs::write(&path, raw).map_err(|e| format!("write prefs: {e}"))
}

pub fn wants_silent_start() -> bool {
    std::env::args().any(|a| a == SILENT_START_ARG)
}

#[tauri::command]
pub fn get_window_prefs(app: AppHandle) -> Result<WindowPrefs, String> {
    let mut prefs = load(&app);
    match crate::auto_launch::is_enabled() {
        Ok(enabled) => {
            if prefs.launch_on_startup != enabled {
                prefs.launch_on_startup = enabled;
                let _ = save(&app, &prefs);
            }
        }
        Err(err) => {
            eprintln!("[Token Eyes] auto-launch status check failed: {err}");
        }
    }
    Ok(prefs)
}

#[tauri::command]
pub fn set_minimize_to_tray_on_close(app: AppHandle, enabled: bool) -> Result<WindowPrefs, String> {
    let mut prefs = load(&app);
    prefs.minimize_to_tray_on_close = enabled;
    save(&app, &prefs)?;
    Ok(prefs)
}

#[tauri::command]
pub fn set_launch_on_startup(app: AppHandle, enabled: bool) -> Result<WindowPrefs, String> {
    let mut prefs = load(&app);
    crate::auto_launch::set_enabled(enabled, prefs.silent_startup)?;
    prefs.launch_on_startup = enabled;
    save(&app, &prefs)?;
    Ok(prefs)
}

#[tauri::command]
pub fn set_silent_startup(app: AppHandle, enabled: bool) -> Result<WindowPrefs, String> {
    let mut prefs = load(&app);
    prefs.silent_startup = enabled;
    if prefs.launch_on_startup {
        crate::auto_launch::set_enabled(true, enabled)?;
    }
    save(&app, &prefs)?;
    Ok(prefs)
}
