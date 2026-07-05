# 20 - Token Eyes Tauri baseline 验证报告

## 基本信息

| 项目 | 结果 |
|---|---|
| 验证日期 | 2026-06-23 |
| 分支 | `claude/te-next-v00-tauri-baseline-restore` |
| 验证时 HEAD | `15cdb133537f57b21adcb2a2f44ee596d944c048` |
| V00 提交状态 | 本报告随 V00 提交发布，最终 SHA 以提交记录和飞书记录为准 |
| Windows 验证栈 | Rust 工具链 + Node.js + WebView2 Runtime |
| 是否需要 `.NET SDK` | 不需要 |

## 工具链版本

| 工具 | 版本 |
|---|---|
| `rustc` | 1.96.0 |
| `cargo` | 1.96.0 |
| `node` | v24.14.1 |
| `npm` | 11.11.0 |

## Tauri 工程检查

| 检查项 | 结果 |
|---|---|
| `src-tauri/` 是否存在 | 通过 |
| `src-tauri/Cargo.toml` | 通过，package name 为 `token-eyes` |
| `src-tauri/tauri.conf.json` | 通过 |
| `src-tauri/build.rs` | 通过 |
| `src-tauri/src/main.rs` | 通过 |
| `src-tauri/src/lib.rs` | 通过 |
| `src-tauri/src/commands.rs` | 通过，包含 `pick_directory` |
| `src-tauri/capabilities/default.json` | 通过 |
| `src-tauri/icons/` | 通过，包含 5 个图标文件 |
| `src-tauri/.gitignore` | 通过，排除 `/target/` 和 `/gen/schemas` |

## 产品身份

| 字段 | 结果 |
|---|---|
| `productName` | `Token Eyes` |
| `identifier` | `com.tokeneyes.desktop` |
| `version` | `0.1.0` |

未发现 `CC Switch` 或 `com.ccswitch.desktop` 残留在 Tauri 产品身份中。

## dashboard 连接

| 配置项 | 结果 |
|---|---|
| `frontendDist` | `../dashboard/dist` |
| `devUrl` | `http://localhost:5173` |
| `beforeDevCommand` | `npm --prefix dashboard run dev -- --host 127.0.0.1` |
| `beforeBuildCommand` | `npm --prefix dashboard run build` |

## `pick_directory` 检查

Rust 命令签名：

```rust
#[tauri::command]
pub async fn pick_directory(
    app: AppHandle,
    #[allow(non_snake_case)] defaultPath: Option<String>,
) -> Result<Option<String>, String>
```

行为检查：

| 要求 | 结果 |
|---|---|
| 调用 Tauri dialog 打开系统文件夹选择器 | 通过 |
| 支持 `defaultPath` 初始目录 | 通过 |
| 用户取消时返回 `Ok(None)` | 通过 |
| 用户取消时不清空已有输入值 | 通过 |
| 使用 `spawn_blocking` | 通过 |
| `tauri_plugin_dialog::init()` 已注册 | 通过 |
| `dialog:default` 权限已配置 | 通过 |

前端调用链：

```text
DataDirectoriesSection.jsx
  -> selectDirectoryViaTauri()
  -> window.__TAURI_INTERNALS__.invoke("pick_directory")
  -> Rust commands::pick_directory
```

## 验证命令结果

| 命令 | 结果 |
|---|---|
| `npm --prefix dashboard run test -- DataDirectoriesSection.test.jsx` | 通过，5/5 |
| `npm --prefix dashboard run typecheck` | 通过 |
| `npm run validate:guardrails` | 通过 |
| `npm run dashboard:build` | 通过，Vite build 成功 |
| `npm run tauri:build` | 通过，Rust release 构建成功 |
| `git diff --check` | 通过，仅有 Windows 换行提示 |

`npm run tauri:build` 产物：

- `src-tauri/target/release/token-eyes.exe`
- `src-tauri/target/release/bundle/msi/Token Eyes_0.1.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/Token Eyes_0.1.0_x64-setup.exe`

## 修改文件列表

| 文件 | 说明 |
|---|---|
| `CLAUDE.md` | 明确 Token Eyes Tauri 验证不需要 `.NET SDK` |
| `package.json` | 新增 `tauri:dev` 和 `tauri:build` 脚本，加入 Tauri CLI |
| `package-lock.json` | 锁定 Tauri CLI 依赖 |
| `dashboard/src/components/settings/DataDirectoriesSection.jsx` | 优先调用 Tauri 目录选择器，再回退到旧 WebView2 bridge 和本地 API |
| `dashboard/src/lib/tauri-directory.js` | 新增 Tauri IPC 目录选择 helper |
| `src-tauri/**` | 新增 Token Eyes Tauri 2 最小桌面工程 |
| `docs/tasks/dispatch/TE-NEXT-V00-tauri-baseline-restore.md` | 新增中文 V00 工单 |
| `docs/test-reports/v2.1/20-token-eyes-tauri-baseline.md` | 新增中文 V00 验证报告 |

## 阻塞与风险

- 功能和构建验证已通过。
- 当前工作区仍有其他任务的未提交文件；V00 提交只应包含本工单文件。
- V01 仍需要用户在 Windows 桌面应用里手动点击三个目录选择按钮做 smoke 验证。

## 是否可以进入 V01

可以进入 V01 的手动验证阶段。原因：

- Token Eyes Tauri baseline 已恢复。
- Windows 打包已经成功生成 `.msi` 和 `.exe`。
- `pick_directory` 已由 Tauri/Rust 后端提供。
- 前端 Settings -> Data Directories 已优先接入 Tauri IPC。

V01 不再使用旧 CC Switch 壳，也不需要 `.NET SDK`。
