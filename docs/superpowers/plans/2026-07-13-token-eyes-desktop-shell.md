# Token Eyes Desktop Shell Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Token Eyes native shell enforce one user-visible identity and route every second-launch or tray-show request through one tested main-window restoration path.

**Architecture:** Add one small Rust `window_control` module that owns the display name and restoration order, then reuse it from the single-instance callback, setup hook, and tray. Add a tiny dashboard identity helper backed by the copy registry so `document.title` cannot retain a legacy name. Verify the cross-layer contract with Rust unit tests, Vitest, a Node source/config guardrail, and repository-contained builds.

**Tech Stack:** Rust 2021, Tauri 2, `tauri-plugin-single-instance`, React 18, Vite 7, Vitest 2, Node test runner.

**Execution constraint:** Work in the current `codex/token-eyes-fixes` workspace because the relevant Cursor baseline is uncommitted. Stage only files that belong to this subproject. Do not launch or modify an installed application and do not touch CC Switch.

---

## File map

- Create `src-tauri/src/window_control.rs`: Token Eyes display-name constant, testable restoration order, Tauri adapters.
- Modify `src-tauri/src/lib.rs`: register the module, use it for startup identity and single-instance activation.
- Modify `src-tauri/src/tray.rs`: remove duplicate window restoration and reuse the shared controller.
- Include existing related baseline files `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/auto_launch.rs`, and `src-tauri/src/window_prefs.rs` in the native-shell commit so that commit builds independently.
- Create `dashboard/src/lib/app-identity.js`: set the document title from `shared.app_name`.
- Create `dashboard/src/lib/app-identity.test.js`: verify title correction.
- Modify `dashboard/src/main.jsx`: apply identity before React mounts.
- Create `test/token-eyes-desktop-shell-contract.test.js`: cross-layer identity and single-instance source/config guardrail.
- Modify `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`: update status and evidence.

### Task 1: Add the tested native window controller

**Files:**
- Create: `src-tauri/src/window_control.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Register the empty module and write the failing restoration-order test**

Add `mod window_control;` next to the existing native modules in `src-tauri/src/lib.rs`. Create `src-tauri/src/window_control.rs` with the test first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct RecordingWindow {
        calls: RefCell<Vec<&'static str>>,
    }

    impl WindowActions for RecordingWindow {
        fn unminimize(&self) { self.calls.borrow_mut().push("unminimize"); }
        fn show(&self) { self.calls.borrow_mut().push("show"); }
        fn set_title(&self, title: &str) {
            assert_eq!(title, APP_DISPLAY_NAME);
            self.calls.borrow_mut().push("set_title");
        }
        fn focus(&self) { self.calls.borrow_mut().push("focus"); }
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
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib window_control::tests::restore_window_unminimizes_shows_corrects_title_then_focuses
```

Expected: compilation fails because `WindowActions`, `APP_DISPLAY_NAME`, and `restore_window` do not exist.

- [ ] **Step 3: Implement the minimal controller and Tauri adapters**

Add above the test module:

```rust
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
    fn unminimize(&self) { let _ = WebviewWindow::unminimize(self); }
    fn show(&self) { let _ = WebviewWindow::show(self); }
    fn set_title(&self, title: &str) { let _ = WebviewWindow::set_title(self, title); }
    fn focus(&self) { let _ = WebviewWindow::set_focus(self); }
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
```

- [ ] **Step 4: Run the focused test and all native library tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib window_control::tests::restore_window_unminimizes_shows_corrects_title_then_focuses
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: focused test passes; all existing 140 native library tests plus the new test pass.

### Task 2: Route startup, second launch, and tray activation through the controller

**Files:**
- Create: `test/token-eyes-desktop-shell-contract.test.js`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/tray.rs`
- Include in commit: `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/auto_launch.rs`, `src-tauri/src/window_prefs.rs`

- [ ] **Step 1: Write the failing cross-layer native-shell contract test**

Create `test/token-eyes-desktop-shell-contract.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Token Eyes native shell uses one restoration path for second launch and tray", () => {
  const lib = read("src-tauri/src/lib.rs");
  const tray = read("src-tauri/src/tray.rs");

  assert.match(lib, /tauri_plugin_single_instance::init\([\s\S]*window_control::restore_main_window/);
  assert.match(lib, /window_control::enforce_main_window_title\(app\.handle\(\)\)/);
  assert.match(tray, /window_control::restore_main_window/);
  assert.doesNotMatch(tray, /fn show_main_window/);
});

test("Token Eyes Tauri metadata has no legacy visible product name", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json"));
  const cargo = read("src-tauri/Cargo.toml");

  assert.equal(config.productName, "Token Eyes");
  assert.equal(config.app.windows[0].title, "Token Eyes");
  assert.equal(config.identifier, "com.tokeneyes.desktop");
  assert.match(cargo, /description = "Token Eyes - AI Token Usage Tracker Desktop"/);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```powershell
node --test test/token-eyes-desktop-shell-contract.test.js
```

Expected: the restoration-path test fails because `lib.rs` and `tray.rs` still contain separate local helpers and setup does not enforce the title.

- [ ] **Step 3: Replace duplicate native-shell logic with the shared controller**

In `src-tauri/src/lib.rs`:

```rust
mod window_control;

// Remove the local focus_main_window function.

.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
    window_control::restore_main_window(app);
}))

.setup(|app| {
    window_control::enforce_main_window_title(app.handle());
    // Keep the existing tray, silent-start, and local-server setup below.
```

In `src-tauri/src/tray.rs`:

```rust
use crate::window_control::{restore_main_window, APP_DISPLAY_NAME};

// Remove show_main_window.

let mut builder = TrayIconBuilder::with_id(TRAY_ID)
    .menu(&menu)
    .tooltip(APP_DISPLAY_NAME)
    .show_menu_on_left_click(false)
    .on_menu_event(|app, event| match event.id.as_ref() {
        "show" => restore_main_window(app),
        "quit" => app.exit(0),
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
```

- [ ] **Step 4: Run native and contract tests**

Run:

```powershell
node --test test/token-eyes-desktop-shell-contract.test.js
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: both commands pass with no new warnings beyond the pre-existing Xiaomi dead-code warning.

- [ ] **Step 5: Commit the native shell slice**

Stage only:

```powershell
git add -- test/token-eyes-desktop-shell-contract.test.js src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/auto_launch.rs src-tauri/src/lib.rs src-tauri/src/tray.rs src-tauri/src/window_control.rs src-tauri/src/window_prefs.rs
git commit -m "fix: enforce Token Eyes desktop shell identity"
```

Before committing, run `git diff --cached --stat` and confirm no CC Switch path or unrelated dashboard/contest file is staged.

### Task 3: Correct the dashboard document title before React mounts

**Files:**
- Create: `dashboard/src/lib/app-identity.test.js`
- Create: `dashboard/src/lib/app-identity.js`
- Modify: `dashboard/src/main.jsx`

- [ ] **Step 1: Write the failing title-correction test**

Create `dashboard/src/lib/app-identity.test.js`:

```js
import { describe, expect, it } from "vitest";
import { applyDocumentIdentity } from "./app-identity.js";

describe("applyDocumentIdentity", () => {
  it("replaces a legacy document title with the Token Eyes app name", () => {
    const target = { title: "CC Switch" };
    applyDocumentIdentity(target);
    expect(target.title).toBe("Token Eyes");
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm --prefix dashboard run test -- --run src/lib/app-identity.test.js
```

Expected: fails because `app-identity.js` does not exist.

- [ ] **Step 3: Implement the identity helper and call it at startup**

Create `dashboard/src/lib/app-identity.js`:

```js
import { copy } from "./copy";

export function applyDocumentIdentity(target = document) {
  target.title = copy("shared.app_name");
}
```

In `dashboard/src/main.jsx`, import and invoke it before router creation:

```jsx
import { applyDocumentIdentity } from "./lib/app-identity.js";

applyDocumentIdentity();
```

- [ ] **Step 4: Run the focused test, copy validation, and dashboard build**

Run:

```powershell
npm --prefix dashboard run test -- --run src/lib/app-identity.test.js
npm run validate:copy
npm run validate:ui-hardcode
npm run dashboard:build
```

Expected: all four commands pass.

- [ ] **Step 5: Commit the dashboard identity slice**

```powershell
git add -- dashboard/src/lib/app-identity.js dashboard/src/lib/app-identity.test.js dashboard/src/main.jsx
git commit -m "fix: keep the Token Eyes document title"
```

Confirm only these three files are staged. `dashboard/src/main.jsx` already contains Cursor baseline work; its complete current form is intentionally included because the new call must ship with that native hash-router entrypoint.

### Task 4: Verify the repository-contained build and update progress

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`

- [ ] **Step 1: Run the complete subproject-A verification set**

Run:

```powershell
node --test test/token-eyes-desktop-shell-contract.test.js
npm --prefix dashboard run test -- --run src/lib/app-identity.test.js
npm run validate:copy
npm run validate:ui-hardcode
npm run dashboard:build
cargo test --manifest-path src-tauri/Cargo.toml --lib
$env:CARGO_NET_OFFLINE = "true"
cargo build --manifest-path src-tauri/Cargo.toml --release
Remove-Item Env:CARGO_NET_OFFLINE
```

Expected: every command exits 0. The release executable is produced under `src-tauri/target/release/`, inside the repository. Do not launch or install it during this task.

- [ ] **Step 2: Check the diff and repository boundary**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; no file outside the repository was created or changed by the implementation commands.

- [ ] **Step 3: Update the tracking document**

Change subproject A status to `代码与仓库内验证完成，系统实机验收待用户授权`, and append one progress row containing:

```markdown
| 2026-07-13 | 完成共享窗口恢复、单实例接线、托盘接线和 Token Eyes 可见标题纠偏 | Node contract、Vitest、Rust lib tests、Dashboard build、Rust release build 均通过 | 未安装或启动仓库外客户端；20 次系统实机启动验收待用户明确授权 | 开始子项目 B 授权状态机设计确认与实施计划 |
```

- [ ] **Step 4: Commit the progress evidence**

```powershell
git add -- docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md
git commit -m "docs: record desktop shell verification"
```

- [ ] **Step 5: Report the checkpoint**

Report exactly four sections: completed, verification evidence, still incomplete, next step. Explicitly state that CC Switch and all repository-external software/files were untouched.
