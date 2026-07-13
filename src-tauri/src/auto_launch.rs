//! Windows startup registration for Token Eyes (HKCU Run key).

use crate::window_prefs::SILENT_START_ARG;

const RUN_VALUE_NAME: &str = "Token Eyes";

#[cfg(windows)]
fn run_key() -> Result<winreg::RegKey, String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.create_subkey(r"Software\Microsoft\Windows\CurrentVersion\Run")
        .map(|(key, _)| key)
        .map_err(|e| format!("open Run key: {e}"))
}

#[cfg(windows)]
fn launch_command(silent: bool) -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
    let mut cmd = format!("\"{}\"", exe.display());
    if silent {
        cmd.push(' ');
        cmd.push_str(SILENT_START_ARG);
    }
    Ok(cmd)
}

/// Enable or disable launch-at-login. When enabling, `silent` controls `--silent-start`.
pub fn set_enabled(enabled: bool, silent: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let key = run_key()?;
        if enabled {
            let cmd = launch_command(silent)?;
            key.set_value(RUN_VALUE_NAME, &cmd)
                .map_err(|e| format!("set Run value: {e}"))?;
        } else {
            // Missing value means already disabled.
            let _ = key.delete_value(RUN_VALUE_NAME);
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (enabled, silent);
        Err("开机自启目前仅支持 Windows".into())
    }
}

pub fn is_enabled() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let key = run_key()?;
        match key.get_value::<String, _>(RUN_VALUE_NAME) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}
