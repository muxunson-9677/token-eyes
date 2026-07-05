fn main() {
    // Tauri reads these from tauri.conf.json, but Cargo otherwise does not
    // rerun this build script when only an icon binary changes.
    for icon in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.ico",
        "icons/icon.icns",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }

    tauri_build::build();
}
