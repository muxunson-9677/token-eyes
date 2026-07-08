# 21 - Token Eyes Tauri V01 入口与目录选择器修复报告

## 基本信息

| 项目 | 结果 |
|---|---|
| 日期 | 2026-06-23 |
| 触发原因 | 用户打开 V00 产物后进入 TokenTracker 官网落地页，无法进入可验证的 Token Eyes 桌面设置页 |
| 处理方式 | Codex 直接修复，不再派发 Claude Code 工单 |
| 任务归属 | V01 失败证据后的 V02 类修复 |

## 问题原因

V00 的 Tauri 壳已经能打包，但 `src-tauri/tauri.conf.json` 没有开启 `app.withGlobalTauri`。Tauri v2 默认不会把 Tauri API 注入到 `window.__TAURI__`，导致前端：

- 不能稳定识别当前运行环境是 Tauri 桌面应用。
- `/` 启动路径不会跳转到 `/settings`，仍按普通公网访问逻辑展示落地页。
- `Settings -> Data Directories` 的目录选择按钮可能无法调用 Rust 后端的 `pick_directory`。

## 修复内容

| 文件 | 修改 |
|---|---|
| `src-tauri/tauri.conf.json` | 增加 `app.withGlobalTauri: true`，让 Windows Tauri WebView 暴露 `window.__TAURI__` |
| `dashboard/src/App.jsx` | Tauri 环境下 `/` 和 `/index.html` 自动跳转 `/settings` |
| `dashboard/src/lib/tauri-directory.js` | 兼容 `window.__TAURI__.core.invoke`、`window.__TAURI__.invoke`、`window.__TAURI_INTERNALS__.invoke` |
| `dashboard/src/components/settings/DataDirectoriesSection.jsx` | 调用 Tauri 目录选择器时传入当前路径作为 `defaultPath` |
| `dashboard/src/lib/tauri-directory.test.js` | 新增 Tauri v2 / legacy internals / 非 Tauri 三种场景测试 |

## 验证结果

| 命令 | 结果 |
|---|---|
| `npm --prefix dashboard run test -- src/lib/tauri-directory.test.js src/lib/native-bridge.tauri.test.js` | 通过，5/5 |
| `npm --prefix dashboard run typecheck` | 通过 |
| `npm run tauri:build` | 通过，重新生成 `.msi` 和 `.exe` |

## 新产物路径

- `D:\04-AI-Project\010-Token eye\src-tauri\target\release\token-eyes.exe`
- `D:\04-AI-Project\010-Token eye\src-tauri\target\release\bundle\nsis\Token Eyes_0.1.0_x64-setup.exe`
- `D:\04-AI-Project\010-Token eye\src-tauri\target\release\bundle\msi\Token Eyes_0.1.0_x64_en-US.msi`

## 当前结论

V01 之前失败的“打开后进入官网页”问题已修复。下一步仍是人工在 Windows Tauri 应用中验证：

1. 打开新生成的 `Token Eyes_0.1.0_x64-setup.exe` 或直接运行 `token-eyes.exe`。
2. 应用应进入 `Settings` 页面，而不是 TokenTracker 官网落地页。
3. 在 `Data Directories` 区域依次点击 Claude Code、Codex、Hermes 的“选择文件夹”按钮。
4. 验证系统文件夹选择器能弹出、选择后能回填、取消后不清空已有值。
