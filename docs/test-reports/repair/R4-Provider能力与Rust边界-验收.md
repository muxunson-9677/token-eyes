# R4 Provider 能力与 Rust 有效测试边界验收

- 日期：2026-07-26
- 分支：`codex/token-eyes-fixes`
- 阶段起止提交：`d4b7bee439754b40b554ee2b7f848537f6b57014`（工作区含用户既有未提交修改，本阶段未提交）
- 回退锚点：`refs/codex-backups/repair-preflight-20260726` -> `2974249ea09a689f2554968f3cf02fd0a73c582b`

## 结论

R4 的代码边界和自动化阶段门已通过：Provider parity 来自同一个机器可读清单；Trae 只声明本地采集、手动套餐和桌面可见，不声明官方额度；Cargo 当前目标不再编译 CC Switch 历史测试，也未恢复任何旧依赖或旧功能。最终两轮独立复审均为 Critical 0 / Important 0 / Minor 0。

受当前 Windows 环境和现有产品路由门控限制，macOS 原生测试、Tauri 实机交互以及生产路由中的 Limits 页面人工操作仍明确列为跨平台/最终烟测项，不在本报告中伪造为通过。

## 唯一能力清单与消费边界

新增 `shared/provider-capabilities.json`，为 35 个 Provider 分别声明：

- `token_usage_collection`
- `official_rate_limit`
- `manual_token_plan`
- `provider_balance`
- `desktop_visibility`

同时记录生成和接线所需的 `agent_display_name`、`queue_source`、`native_session_bridge`、`catalog_token_plan`、`agent_order`、`catalog_order`。`src/lib/provider-capabilities.js` 对 schema、ID、五项能力布尔值、元数据类型、能力关系和顺序唯一性进行 fail-fast 校验。

实际消费点：

- Node adapter：`src/lib/agent-adapters.js`
- 官方额度返回校验：`src/lib/usage-limits.js`
- 手动套餐目录：`src/lib/token-plan-catalog/index.js`
- Provider 余额 preset：`src/lib/provider-api-configs.js`
- Dashboard Provider/agent/preset/套餐 UI：`dashboard/src/lib/*` 与 `TokenPlanSection.jsx`
- macOS 常量：`scripts/generate-provider-capabilities.cjs` 生成 `LimitsSettingsStore.swift` 标记区

生成器复用同一校验 loader，并保持 Swift 源文件原有 CRLF；`providers:check` 会阻止手写漂移。npm 发布文件清单已包含 `shared/`，`npm pack --dry-run --json` 验证包内包含 manifest（652 个文件）。

Trae 固定真值：

```json
{
  "token_usage_collection": true,
  "official_rate_limit": false,
  "manual_token_plan": true,
  "provider_balance": false,
  "desktop_visibility": true
}
```

Dashboard 对 Trae、Hermes、OpenClaw、OpenCode 优先按 capability 显示“仅支持手动套餐；暂无官方额度查询”，不再通过空额度 spec 显示“未连接”，也不构造额度进度。

## Rust 当前编译边界

`src-tauri/src/lib.rs` 当前模块：`auto_launch`、`claude_session`、`commands`、`codex_session`、`cursor_session`、`glm_session`、`kimi_session`、`tray`、`window_control`、`window_prefs`、`xiaomi_mimo_session`。

同一个 `current_tauri_commands!` 宏同时生成实际 `invoke_handler` 和测试可见命令清单，共 24 个当前命令：目录选择、本地服务状态、4 个窗口偏好命令，以及 Xiaomi MiMo、Claude、Codex、Cursor、GLM、Kimi 六组 open/verify/delete 原生会话命令。

新增 `src-tauri/tests/current_product.rs`，覆盖：

- 主窗口最小化、托盘菜单/点击恢复动作；
- 单实例插件必须作为第一个插件接线，并使用受测恢复触发契约；删除 plugin 或 callback 会失败；
- 本地服务状态的 ready URL 生命周期；
- manifest 中六个原生会话 Provider 与实际编译 handler 命令一致；
- 官方 URL 防伪与 session ref 校验。

## 历史 Rust 测试迁移清单

以下 11 个文件原样迁至 `src-tauri/tests-legacy-cc-switch/`，hash 与迁移前 HEAD 内容一致，没有删除历史内容：

| 文件 | 移出当前目标原因 |
|---|---|
| `app_config_load.rs` | CC Switch 旧配置加载契约 |
| `app_type_parse.rs` | CC Switch 旧 App 类型解析 |
| `deeplink_import.rs` | 旧 Provider/配置深链导入 |
| `hermes_roundtrip.rs` | CC Switch Hermes 配置往返集成 |
| `import_export_sync.rs` | 旧配置导入导出与同步体系 |
| `mcp_commands.rs` | 已退出当前产品的 MCP 命令 |
| `provider_commands.rs` | 旧 Provider 切换命令 |
| `provider_service.rs` | 旧 Provider 服务/切换域 |
| `proxy_commands.rs` | 已退出当前产品的代理命令 |
| `skill_sync.rs` | 已退出当前产品的 Skill 同步 |
| `support.rs` | 仅服务以上 legacy suite 的辅助模块 |

迁移后 `src-tauri/tests/` 仅保留 `current_product.rs`，不存在 `cc_switch_lib` 引用。Cargo 完整测试通过，未重新接回代理、切换、MCP、Skill 模块或依赖。

## RED -> GREEN 证据

初始 RED：

- agent adapter/Trae parity：2 个失败；
- Swift/Dashboard parity：缺 Trae；
- Dashboard limits prefs hook：1 个失败；
- Cargo 完整测试：11 个 legacy 集成测试因 `cc_switch_lib` 无法解析失败；
- 单实例 wiring 新回归测试先因 `SINGLE_INSTANCE_RESTORE_TRIGGER` 不存在而编译失败。

最终 GREEN：

| 命令/检查 | 结果 |
|---|---|
| `node --test test/agent-adapters.test.js test/limits-providers-parity.test.js` | 25/25 通过 |
| Node R4 扩展定向套件 | 134 个：133 通过、1 跳过、0 失败 |
| Dashboard limits prefs + UsageLimitsPanel + TokenPlanSection | 90/90 通过 |
| `npm --prefix dashboard test` | 92 files / 714 tests 全通过 |
| Dashboard `typecheck` | 0 错误 |
| Dashboard `lint` | 0 错误 |
| Dashboard production build | 3765 modules，成功 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 146/146 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 146 lib + 4 current integration 全通过 |
| `git diff --check` | 通过 |
| Provider 生成一致性 | `providers:check` 通过；Swift EOL 一致 |

已知非阻断输出：jsdom 不实现 canvas/scrollTo 的既有 stderr；Rust `map_login_state_to_status` 既有 `dead_code` warning；Vite 既有大 chunk/动态导入提示。

仓库级 `npm test` 当前为 1515 总计、1452 通过、55 失败、8 跳过。R4 新增/修改的 Provider 与桌面 shell 合同均通过；剩余 55 项由后续阶段处理：CI/发布 workflow 缺失，以及安装/卸载、设置保存、套餐刷新等已在执行文档后续阶段覆盖的已知失败。未将该命令写成全绿。

## 真实体验与平台限制

- Windows Chrome 持久化验收已通过：将 Trae 拖至第一位并隐藏，关闭持久浏览器上下文后用同一 profile 重开，顺序和可见性完全保持；`pageerror` 为 0。
- 新生产构建的 Chrome 检查确认 `/limits` 被当前 `App.jsx` 的 MVP 隐藏路由重定向到 `/dashboard`，`pageerror` 为 0。因此 manual-only 展示以真实组件渲染测试 7/7 作为当前证据；路由门控是否解除留待后续产品边界阶段，不在 R4 静默改动用户既有门控。
- Windows 上不存在 `swift` 和 `xcodebuild`，无法运行当前 macOS `TokenTrackerBar` 原生测试；只完成生成 parity，原生测试列入最终 macOS 环境验收。
- Tauri 的托盘、窗口、单实例和会话桥已由当前 Rust 集成合同覆盖；实际 GUI 点击和真实凭证连接列入 R7 烟测，不声明为本机已完成。

## 回退

本阶段文件可按本报告“唯一能力清单与消费边界”逐项反向恢复；legacy 测试可从 `src-tauri/tests-legacy-cc-switch/` 取回原文，但不得重新放回当前 Cargo target。若需整体取证，可对比回退锚点 `refs/codex-backups/repair-preflight-20260726`，不得在含用户未提交修改的工作区执行 destructive reset。