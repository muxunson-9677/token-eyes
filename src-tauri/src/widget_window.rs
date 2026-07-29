use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

pub const WIDGET_LABEL: &str = "desktop-widget";
const PREFS_VERSION: u8 = 1;
const DEFAULT_WIDTH: u32 = 322;
const DEFAULT_HEIGHT: u32 = 72;
const MIN_WIDTH: u32 = 300;
const MIN_HEIGHT: u32 = 72;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetPrefs {
    pub version: u8,
    pub visible: bool,
    pub x: Option<i32>,
    pub y: Option<i32>,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub selected_agent: String,
    pub mode: String,
    pub expanded: bool,
    pub material: String,
    pub opacity: f64,
    pub always_on_top: bool,
}

impl Default for WidgetPrefs {
    fn default() -> Self {
        Self {
            version: PREFS_VERSION,
            visible: false,
            x: None,
            y: None,
            width: DEFAULT_WIDTH,
            height: DEFAULT_HEIGHT,
            scale_factor: 1.0,
            selected_agent: "all".into(),
            mode: "projects".into(),
            expanded: false,
            material: "frost".into(),
            opacity: 0.72,
            always_on_top: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Geometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct MonitorBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn normalize_prefs(mut prefs: WidgetPrefs) -> WidgetPrefs {
    prefs.version = PREFS_VERSION;
    prefs.width = prefs.width.max(MIN_WIDTH);
    prefs.height = prefs.height.max(MIN_HEIGHT);
    prefs.scale_factor = if prefs.scale_factor.is_finite() && prefs.scale_factor > 0.0 {
        prefs.scale_factor
    } else {
        1.0
    };
    if !["all", "claude", "codex", "cursor", "hermes"]
        .contains(&prefs.selected_agent.as_str())
    {
        prefs.selected_agent = "all".into();
    }
    if !["projects", "limits", "models"].contains(&prefs.mode.as_str()) {
        prefs.mode = "projects".into();
    }
    if !["frost", "graphite", "ocean", "sand"].contains(&prefs.material.as_str()) {
        prefs.material = "frost".into();
    }
    prefs.opacity = if prefs.opacity.is_finite() {
        prefs.opacity.clamp(0.4, 0.96)
    } else {
        0.72
    };
    prefs
}

fn merge_display_prefs(mut current: WidgetPrefs, requested: WidgetPrefs) -> WidgetPrefs {
    current.selected_agent = requested.selected_agent;
    current.mode = requested.mode;
    current.expanded = requested.expanded;
    current.material = requested.material;
    current.opacity = requested.opacity;
    current.always_on_top = requested.always_on_top;
    normalize_prefs(current)
}

fn safe_scale_factor(scale_factor: f64) -> f64 {
    if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    }
}

fn logical_size(size: PhysicalSize<u32>, scale_factor: f64) -> (u32, u32) {
    let scale_factor = safe_scale_factor(scale_factor);
    (
        ((size.width as f64 / scale_factor).round() as u32).max(MIN_WIDTH),
        ((size.height as f64 / scale_factor).round() as u32).max(MIN_HEIGHT),
    )
}

fn physical_size(width: u32, height: u32, scale_factor: f64) -> PhysicalSize<u32> {
    let scale_factor = safe_scale_factor(scale_factor);
    PhysicalSize::new(
        (width as f64 * scale_factor).round() as u32,
        (height as f64 * scale_factor).round() as u32,
    )
}

fn intersection_area(geometry: Geometry, monitor: MonitorBounds) -> i64 {
    let left = geometry.x.max(monitor.x);
    let top = geometry.y.max(monitor.y);
    let right = (geometry.x + geometry.width as i32)
        .min(monitor.x + monitor.width as i32);
    let bottom = (geometry.y + geometry.height as i32)
        .min(monitor.y + monitor.height as i32);
    i64::from((right - left).max(0)) * i64::from((bottom - top).max(0))
}

fn clamp_geometry(mut geometry: Geometry, monitors: &[MonitorBounds]) -> Geometry {
    let Some(monitor) = monitors
        .iter()
        .copied()
        .max_by_key(|monitor| intersection_area(geometry, *monitor))
    else {
        return geometry;
    };
    geometry.width = geometry.width.min(monitor.width).max(MIN_WIDTH.min(monitor.width));
    geometry.height = geometry
        .height
        .min(monitor.height)
        .max(MIN_HEIGHT.min(monitor.height));
    let max_x = monitor.x + monitor.width as i32 - geometry.width as i32;
    let max_y = monitor.y + monitor.height as i32 - geometry.height as i32;
    geometry.x = geometry.x.clamp(monitor.x, max_x);
    geometry.y = geometry.y.clamp(monitor.y, max_y);
    geometry
}

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|directory| directory.join("desktop-widget-prefs.json"))
        .map_err(|error| format!("resolve widget prefs directory: {error}"))
}

fn load(app: &AppHandle) -> WidgetPrefs {
    let Ok(path) = prefs_path(app) else {
        return WidgetPrefs::default();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return WidgetPrefs::default();
    };
    normalize_prefs(serde_json::from_str(&raw).unwrap_or_default())
}

fn save(app: &AppHandle, prefs: &WidgetPrefs) -> Result<(), String> {
    let path = prefs_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("create widget prefs directory: {error}"))?;
    }
    let raw = serde_json::to_string_pretty(&normalize_prefs(prefs.clone()))
        .map_err(|error| format!("serialize widget prefs: {error}"))?;
    fs::write(path, raw).map_err(|error| format!("write widget prefs: {error}"))
}

fn monitor_bounds(window: &WebviewWindow) -> Vec<MonitorBounds> {
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| MonitorBounds {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect()
}

fn apply_geometry(window: &WebviewWindow, prefs: &WidgetPrefs) {
    let size = physical_size(
        prefs.width,
        prefs.height,
        window.scale_factor().unwrap_or(1.0),
    );
    let default_position = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|monitor| Geometry {
            x: monitor.position().x + 24,
            y: monitor.position().y + 24,
            width: size.width,
            height: size.height,
        })
        .unwrap_or(Geometry {
            x: 24,
            y: 24,
            width: size.width,
            height: size.height,
        });
    let geometry = clamp_geometry(
        Geometry {
            x: prefs.x.unwrap_or(default_position.x),
            y: prefs.y.unwrap_or(default_position.y),
            width: size.width,
            height: size.height,
        },
        &monitor_bounds(window),
    );
    let _ = window.set_size(PhysicalSize::new(geometry.width, geometry.height));
    let _ = window.set_position(PhysicalPosition::new(geometry.x, geometry.y));
}

fn create_window(app: &AppHandle, prefs: &WidgetPrefs) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(
        app,
        WIDGET_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("Token Eyes Widget")
    .inner_size(prefs.width as f64, prefs.height as f64)
    .min_inner_size(MIN_WIDTH as f64, MIN_HEIGHT as f64)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(prefs.always_on_top)
    .skip_taskbar(true)
    .visible(false)
    .initialization_script(
        "history.replaceState({}, '', '/desktop-widget?app=1');",
    )
    .build()
    .map_err(|error| format!("create desktop widget: {error}"))?;
    apply_geometry(&window, prefs);
    Ok(window)
}

fn widget_window(app: &AppHandle, prefs: &WidgetPrefs) -> Result<WebviewWindow, String> {
    match app.get_webview_window(WIDGET_LABEL) {
        Some(window) => Ok(window),
        None => create_window(app, prefs),
    }
}

pub fn is_widget_window(label: &str) -> bool {
    label == WIDGET_LABEL
}

pub fn persist_geometry(window: &WebviewWindow) {
    if !is_widget_window(window.label()) {
        return;
    }
    let mut prefs = load(window.app_handle());
    if let Ok(position) = window.outer_position() {
        prefs.x = Some(position.x);
        prefs.y = Some(position.y);
    }
    if let Ok(size) = window.inner_size() {
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        (prefs.width, prefs.height) = logical_size(size, scale_factor);
        prefs.scale_factor = scale_factor;
    }
    let _ = save(window.app_handle(), &prefs);
}

pub fn restore_if_visible(app: &AppHandle) {
    let prefs = load(app);
    if !prefs.visible {
        return;
    }
    if let Ok(window) = widget_window(app, &prefs) {
        let _ = window.show();
    }
}

pub fn toggle_desktop_widget(app: &AppHandle) {
    let visible = app
        .get_webview_window(WIDGET_LABEL)
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false);
    if visible {
        let _ = hide_desktop_widget(app.clone());
    } else {
        let _ = show_desktop_widget(app.clone());
    }
}

#[tauri::command]
pub fn show_desktop_widget(app: AppHandle) -> Result<WidgetPrefs, String> {
    let mut prefs = load(&app);
    let window = widget_window(&app, &prefs)?;
    let _ = window.set_always_on_top(prefs.always_on_top);
    apply_geometry(&window, &prefs);
    window.show().map_err(|error| error.to_string())?;
    prefs.visible = true;
    save(&app, &prefs)?;
    Ok(prefs)
}

#[tauri::command]
pub fn hide_desktop_widget(app: AppHandle) -> Result<WidgetPrefs, String> {
    let mut prefs = load(&app);
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        persist_geometry(&window);
        window.hide().map_err(|error| error.to_string())?;
        prefs = load(&app);
    }
    prefs.visible = false;
    save(&app, &prefs)?;
    Ok(prefs)
}

#[tauri::command]
pub fn get_desktop_widget_prefs(app: AppHandle) -> WidgetPrefs {
    load(&app)
}

#[tauri::command]
pub fn set_desktop_widget_prefs(
    app: AppHandle,
    requested: WidgetPrefs,
) -> Result<WidgetPrefs, String> {
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        persist_geometry(&window);
    }
    let prefs = merge_display_prefs(load(&app), requested);
    save(&app, &prefs)?;
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        let _ = window.set_always_on_top(prefs.always_on_top);
    }
    Ok(prefs)
}

#[tauri::command]
pub fn set_desktop_widget_always_on_top(
    app: AppHandle,
    enabled: bool,
) -> Result<WidgetPrefs, String> {
    let mut prefs = load(&app);
    prefs.always_on_top = enabled;
    if let Some(window) = app.get_webview_window(WIDGET_LABEL) {
        window
            .set_always_on_top(enabled)
            .map_err(|error| error.to_string())?;
    }
    save(&app, &prefs)?;
    Ok(prefs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_compact_resizable_glass_capsule() {
        let prefs = WidgetPrefs::default();
        assert_eq!((prefs.width, prefs.height), (322, 72));
        assert!(prefs.always_on_top);
        assert_eq!(prefs.material, "frost");
        assert_eq!(prefs.opacity, 0.72);
        assert_eq!(prefs.selected_agent, "all");
        assert_eq!(prefs.mode, "projects");
    }

    #[test]
    fn clamps_saved_geometry_fully_inside_a_visible_monitor() {
        let geometry = Geometry {
            x: 4_000,
            y: -900,
            width: 900,
            height: 700,
        };
        let monitors = [MonitorBounds {
            x: 0,
            y: 0,
            width: 1_920,
            height: 1_080,
        }];
        assert_eq!(
            clamp_geometry(geometry, &monitors),
            Geometry {
                x: 1_020,
                y: 0,
                width: 900,
                height: 700,
            },
        );
    }

    #[test]
    fn migrates_invalid_or_legacy_preferences_to_safe_values() {
        let prefs = normalize_prefs(WidgetPrefs {
            version: 0,
            width: 1,
            height: 1,
            opacity: 0.01,
            selected_agent: "invalid".into(),
            mode: "invalid".into(),
            material: "invalid".into(),
            ..WidgetPrefs::default()
        });
        assert_eq!(prefs.version, 1);
        assert_eq!((prefs.width, prefs.height), (300, 72));
        assert_eq!(prefs.opacity, 0.4);
        assert_eq!(prefs.selected_agent, "all");
        assert_eq!(prefs.mode, "projects");
        assert_eq!(prefs.material, "frost");
    }

    #[test]
    fn preference_updates_preserve_native_geometry() {
        let current = WidgetPrefs {
            visible: true,
            x: Some(410),
            y: Some(220),
            width: 488,
            height: 256,
            scale_factor: 1.5,
            ..WidgetPrefs::default()
        };
        let requested = WidgetPrefs {
            selected_agent: "codex".into(),
            mode: "limits".into(),
            expanded: true,
            material: "ocean".into(),
            opacity: 0.84,
            always_on_top: false,
            ..WidgetPrefs::default()
        };
        let merged = merge_display_prefs(current.clone(), requested);
        assert_eq!(
            (
                merged.visible,
                merged.x,
                merged.y,
                merged.width,
                merged.height,
                merged.scale_factor,
            ),
            (
                current.visible,
                current.x,
                current.y,
                current.width,
                current.height,
                current.scale_factor,
            ),
        );
        assert_eq!(merged.selected_agent, "codex");
        assert_eq!(merged.mode, "limits");
        assert!(merged.expanded);
        assert_eq!(merged.material, "ocean");
        assert_eq!(merged.opacity, 0.84);
        assert!(!merged.always_on_top);
    }

    #[test]
    fn logical_size_round_trips_across_dpi_changes() {
        assert_eq!(logical_size(PhysicalSize::new(483, 216), 1.5), (322, 144));
        assert_eq!(physical_size(322, 144, 2.0), PhysicalSize::new(644, 288));
    }
}
