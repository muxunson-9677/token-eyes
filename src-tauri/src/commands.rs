use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

/// Opens a native folder picker dialog and returns the selected path,
/// or null if the user cancelled.
///
/// If `defaultPath` is provided, the dialog opens at that directory.
/// If the user cancels, returns `Ok(None)` - callers must not clear
/// existing input values on cancel.
#[tauri::command]
pub async fn pick_directory(
    app: AppHandle,
    #[allow(non_snake_case)] defaultPath: Option<String>,
) -> Result<Option<String>, String> {
    let initial = defaultPath.filter(|p| !p.trim().is_empty()).map(PathBuf::from);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file();
        if let Some(path) = initial {
            builder = builder.set_directory(path);
        }
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("Failed to open directory picker: {e}"))?;

    match result {
        Some(path) => {
            let path_str = path.to_string();
            Ok(if path_str.is_empty() { None } else { Some(path_str) })
        }
        None => Ok(None),
    }
}
