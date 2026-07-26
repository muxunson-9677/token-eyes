# R5 CI 与发布工作流验收

- 日期：2026-07-26
- 分支：`codex/token-eyes-fixes`
- 基线 HEAD：`d4b7bee439754b40b554ee2b7f848537f6b57014`
- 回退引用：`refs/codex-backups/repair-preflight-20260726`

## 结论

R5 阶段门通过。恢复的三个 workflow 面向当前 Node + macOS Swift + Windows Tauri 产品，不再把旧 `.NET TokenTrackerWin` 当作当前 Windows 交付物。本阶段只做本地解析、契约测试与构建验证；未触发发布、上传、推送或外部仓库修改。

## 恢复与比较

只读比较了历史提交 `d1d14f75`、`1a364329`、`b307c49e`、`2054ae83` 中的发布工作流，保留仍适用于当前产品的 draft 并行发布结构，并按当前 Tauri 边界重建：

- `.github/workflows/npm-publish.yml`
- `.github/workflows/release-dmg.yml`
- `.github/workflows/release-windows.yml`

`npm-publish.yml` 在 Node 24 测试作业中安装 Rust 和 Tauri Linux 系统依赖，完整门禁通过后才由 Node 20 发布；版本已存在时跳过安装、构建和发布。顶层权限限定为 `contents: read`。

合并桌面发布先创建 draft，macOS 与 Windows 并行构建，二者成功后才公开 release 并可选通知 Homebrew。`version` 必须为 SemVer；`notes` 必须是一行非空 ASCII/英文说明。Windows 单独 dispatch 可以自行公开，作为 reusable workflow 调用时由父流程统一公开。

## 可信打包边界

- macOS bundler 复制 `src/`、`shared/`、`package.json`、`package-lock.json`，使用 `npm ci --omit=dev --omit=optional --ignore-scripts`；缺少 Dashboard 时 fail closed；打包后验证 provider manifest 并执行 CLI `--help`。
- Windows bundler 同样复制 `shared/`，从 lockfile 安装，并以 bundled `node.exe` 执行 CLI `--help`。
- `create-dmg.sh` 的 CI 分支以包含 `.app` 的 staging 目录作为 `create-dmg` source folder，并先删除预建 `Applications` 链接，避免把 `.app/Contents` 摊平到 DMG 根。
- macOS workflow 使用固定 `-derivedDataPath build/DerivedData`，不依赖 BSD 不支持的 `find -maxdepth`。
- `CLAUDE.md` 已同步当前 Windows Tauri 架构、五处版本值、非空 release notes 参数和本地 DMG 命令。

## 本地 CI

`package.json` 的 `ci:local` 按 fail-closed `&&` 串联：Node、Dashboard typecheck/lint/Vitest/build、Rust 当前 lib/integration、文案/架构/provider 校验和脱敏 fixture strict Token 审计。`audit:tokens:fixture` 始终显式指向仓库 fixture，不回退真实 HOME。

## 验证证据

| 检查 | 结果 |
|---|---|
| R5 workflow + desktop bundle 定向测试 | 71/71 通过 |
| 三份 workflow `js-yaml` 解析 | 3/3 通过 |
| `bundle-runtime.ps1` PowerShell AST | 0 语法错误 |
| `npm run ci:local`（R6 合入后 fresh） | exit 0，全部子门禁通过 |
| `git diff --check`（R5 文件） | 通过，仅 EOL 提示 |
| 外部发布/上传/推送 | 未执行 |

最终只读复审发现的 Linux Tauri 依赖、Homebrew secret 条件、release notes、mac lockfile、两端 shared manifest、DMG source folder 等问题均已修复并加防回归测试。