# TE-NEXT-V00 - Token Eyes Tauri baseline 恢复

## 任务边界

本工单用于恢复 Token Eyes 的 Tauri Windows 桌面壳，是 `V01 - WebView2 手动验证` 的前置工单。

当前主线缺少可直接运行的 `src-tauri/`，用户无法验证 Windows WebView2 文件夹选择器。因此 V00 只做以下事情：

- 恢复一个最小可运行的 Token Eyes Tauri 2 工程。
- 将 Tauri 壳连接到当前 `dashboard/` 构建产物。
- 暴露 Rust 后端 `pick_directory` 命令。
- 让 Settings -> Data Directories 优先调用 Tauri 目录选择器。
- 确认 Windows 打包流程使用 Rust 工具链 + Node.js + WebView2 Runtime，不要求 `.NET SDK` 或 `.NET 8 SDK`。

不要在本工单修改 Spend/R/Q/S/T/U 已审功能，不要改 parser 算法，不要改 queue schema，不要新增旧 `TokenTrackerWin/` 的 .NET 打包路径，也不要把旧 CC Switch Tauri 壳直接当作验收通过。

## 分支与仓库

- 仓库：`https://github.com/muxunson-9677/token-eyes`
- 基准分支：`claude/te-full-h04-final-integration-acceptance`
- V00 分支：`claude/te-next-v00-tauri-baseline-restore`

## 必须读取

按顺序读取：

1. `CLAUDE.md`
2. `docs/token-eyes-next-blueprint-v3.md`
3. `docs/tasks/dispatch/TE-MVP-WIN-07-windows-folder-picker-verification.md`
4. `dashboard/src/components/settings/DataDirectoriesSection.jsx`
5. `dashboard/src/lib/tauri-directory.js`
6. `dashboard/src/lib/api.ts`
7. `src/lib/local-api.js` 中 `/functions/tokentracker-select-directory`
8. 旧 Tauri 来源中的 `src-tauri/**`、`package.json`、`pick_directory` 实现和 capability 配置

不要读取真实用户日志正文、prompt、message、encrypted_content 或 tool result 正文。

## 实现要求

### 1. 恢复最小 Tauri 工程

至少包含：

- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/build.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/default.json`
- `src-tauri/src/main.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/icons/**`
- `src-tauri/.gitignore`

`src-tauri/.gitignore` 必须排除 `/target/` 和 `/gen/schemas`，避免提交 Cargo/Tauri 构建产物。

### 2. 产品身份

`src-tauri/tauri.conf.json` 必须满足：

```json
{
  "productName": "Token Eyes",
  "identifier": "com.tokeneyes.desktop"
}
```

不能保留 `CC Switch` 或 `com.ccswitch.desktop`。

### 3. 当前 dashboard 连接

Tauri 必须加载当前仓库的 `dashboard/`：

```json
{
  "frontendDist": "../dashboard/dist",
  "devUrl": "http://localhost:5173",
  "beforeDevCommand": "npm --prefix dashboard run dev -- --host 127.0.0.1",
  "beforeBuildCommand": "npm --prefix dashboard run build"
}
```

### 4. `pick_directory` 命令

Rust 后端必须暴露：

```rust
#[tauri::command]
pub async fn pick_directory(
    app: tauri::AppHandle,
    #[allow(non_snake_case)] defaultPath: Option<String>,
) -> Result<Option<String>, String>
```

行为要求：

- 调用 Tauri dialog 插件打开系统文件夹选择器。
- 选择目录后返回绝对路径字符串。
- 取消选择时返回 `Ok(None)`，不能清空前端已有输入值。
- 支持 `defaultPath` 作为初始目录。
- IPC 或 dialog 失败时返回可读错误。
- 使用 `spawn_blocking`，避免阻塞 async runtime。

### 5. 插件与权限

`src-tauri/src/lib.rs` 必须注册：

```rust
.plugin(tauri_plugin_dialog::init())
```

`src-tauri/capabilities/default.json` 必须包含：

```json
"dialog:default"
```

`Cargo.toml` 必须使用 Tauri 2 和 dialog 插件，不要降级到 Tauri 1。

### 6. npm 脚本

根 `package.json` 必须有：

```json
{
  "scripts": {
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.11.3"
  }
}
```

## 验证命令

在 Windows PowerShell 中运行：

```powershell
rustc --version
cargo --version
node --version
npm --version
npm --prefix dashboard run test -- DataDirectoriesSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:guardrails
npm run dashboard:build
npm run tauri:build
git diff --check
```

如果失败原因是 WebView2 Runtime 缺失，只报告 WebView2 Runtime 缺失；不要要求安装 `.NET SDK`。

## V01 放行条件

只有满足以下条件，才能进入 V01：

- `src-tauri/` 存在，且产品身份为 Token Eyes。
- `npm run dashboard:build` 成功。
- `npm run tauri:build` 成功，并生成 Windows `.msi` 和 `.exe`。
- `pick_directory` Rust 命令已实现并注册。
- dialog 插件和权限已配置。
- `DataDirectoriesSection.jsx` 优先调用 Tauri 目录选择器。
- V00 修改已经形成提交并推送到 V00 分支。

## 完成后回复

完成后用中文回复，包含：

- 分支名
- commit SHA
- `src-tauri` 是否存在
- `productName` / `identifier`
- dashboard build 是否通过
- Tauri build 是否通过
- 产物路径
- `pick_directory` 是否接通
- 是否可以继续 V01
- 如不能继续，列出具体阻塞
