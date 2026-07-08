# TE-MVP-WIN-07 - Windows Tauri WebView2 文件夹选择器打包与手动验证

## 给 Claude Code 的执行说明

你是 Windows 桌面验证执行者。只验证/修复 Tauri Windows WebView2 文件夹选择器,不要改支出页、语言系统、全局 copy 文案或其它无关模块。

> 重要经验: 上一个 Claude 失败的原因之一是把“选择路径”当成普通前端按钮处理。浏览器网页不能直接返回本机目录路径。本项目的 Windows 桌面端应走 Tauri/Rust 后端能力 + WebView2 前端宿主;普通浏览器只走本地 API fallback。你必须验证真实点击行为,不能只说 build 通过。

## 仓库与分支

- 仓库: `https://github.com/muxunson-9677/token-eyes`
- 基准分支: 等 Codex 当前 Token Eyes UI 收尾修复提交/推送后的最新分支。
- 新建分支: `claude/te-mvp-win-07-folder-picker-verification`

如果当前工作区有未提交改动,不要直接 `git switch`。请先询问负责人或使用干净 worktree。

开始前执行:

```bash
git fetch origin
git switch codex-token-tracker-baseline
git pull --ff-only
git switch -c claude/te-mvp-win-07-folder-picker-verification
```

## 基线预检

Token Eyes Windows 桌面打包链路按 Tauri 处理。开始任何验证或修复前先确认:

```powershell
Test-Path src-tauri
Test-Path src-tauri\Cargo.toml
Test-Path src-tauri\tauri.conf.json
rustc --version
cargo --version
node --version
npm --version
```

预期:

- `src-tauri`、`src-tauri\Cargo.toml`、`src-tauri\tauri.conf.json` 都存在。
- `rustc`、`cargo`、`node`、`npm` 都能输出版本。
- Windows 10/11 通常自带 WebView2 Runtime；如缺失,只安装/修复 WebView2 Runtime,不要安装无关SDK作为本工单前置。

如果当前分支没有 `src-tauri`,立即停止并报告:

```text
BASELINE_MISMATCH: expected Tauri Windows app files (src-tauri) but current checkout does not contain them.
```

不要退回旧的 Windows 桌面打包流程。

## 背景

需要验证的产品行为:

- `dashboard/src/components/settings/DataDirectoriesSection.jsx`
  - 在 Tauri Windows WebView2 宿主中,点击“选择文件夹”应调用 Rust/Tauri 后端能力或 Tauri dialog 能力打开系统文件夹选择器。
  - 如果不是 Tauri/WebView2 宿主,则 fallback 到 `selectLocalDirectory()` 本地 API。
- Tauri Rust 后端
  - 负责暴露选择目录所需的命令或能力,并把选中的目录路径返回前端。
  - 不读取 prompt、message 或对话正文。
- `src/lib/local-api.js`
  - 普通本地浏览器 fallback endpoint 会尝试打开系统文件夹选择器或返回可理解的失败提示。

## 目标

在有 Rust 工具链 + Node.js + WebView2 Runtime 的 Windows 环境中验证:

1. Tauri Windows app 能完成打包或 dev 启动。
2. Tauri WebView2 中 `/settings` 的三个 `选择文件夹` 按钮能弹出系统文件夹选择器。
3. 选择目录后对应输入框能回填绝对路径。
4. 取消选择不会破坏已有输入值。
5. 浏览器 console / Tauri 后端日志不出现相关错误。

## 允许修改的文件

如果验证失败,只允许改:

- `src-tauri/**`
- `dashboard/src/components/settings/DataDirectoriesSection.jsx`
- `dashboard/src/components/settings/DataDirectoriesSection.test.jsx`
- `dashboard/src/lib/api.ts`
- `src/lib/local-api.js`
- 与本功能直接相关的测试文件

不要改:

- `dashboard/src/content/copy.csv`
- `dashboard/src/lib/locale.ts`
- `dashboard/src/content/i18n/**`
- `dashboard/src/pages/SpendPage.jsx`
- Dashboard/Settings 其它无关模块
- 飞书配置或 `.env`

## 验证命令

先确认工具链:

```powershell
rustc --version
cargo --version
node --version
npm --version
```

再按仓库实际 package scripts 选择 Tauri 命令。优先使用项目脚本:

```powershell
npm run tauri build
```

如果 `package.json` 没有 `tauri` 脚本,使用 Tauri CLI:

```powershell
npx tauri build
```

前端相关验证:

```powershell
npm.cmd --prefix dashboard run test -- DataDirectoriesSection.test.jsx
npm.cmd --prefix dashboard run typecheck
npm.cmd run dashboard:build
```

如果 Rust/Node/Tauri 工具链缺失,不要假装完成。报告为环境阻塞,并写明缺少的具体命令。不要要求无关SDK。

## 手动验证步骤

1. 启动 Tauri Windows app 或等效 Tauri dev 宿主。
2. 打开 `/settings`。
3. 点击 `Claude Code 数据目录` 的 `选择文件夹`。
4. 选择一个测试目录,确认输入框填入绝对路径。
5. 重复验证:
   - `Codex 数据目录`
   - `Hermes Agent 数据目录`
6. 再点击一次并取消,确认已有值不被清空。
7. 保存设置,确认不报错。

## 普通浏览器 fallback 验证

如果时间允许,也验证普通本地浏览器:

```bash
node bin/tracker.js serve --no-sync --no-open
```

打开:

```text
http://127.0.0.1:7681/settings
```

点击 `选择文件夹`。普通浏览器应通过本地 API 尝试打开系统文件夹选择器;如果受浏览器/系统限制不能打开,必须显示中文提示:

```text
当前环境不支持直接选择本机目录，请手动输入路径。
```

## 报告文件

创建:

```text
docs/test-reports/v2.1/19-windows-folder-picker.md
```

报告必须包含:

- 验证日期
- 分支名和 commit SHA
- Windows 版本
- `rustc --version`
- `cargo --version`
- `node --version`
- `npm --version`
- Tauri build/dev 启动结果
- 三个按钮的手动验证结果
- 取消选择的验证结果
- 普通浏览器 fallback 验证结果
- 如有代码修改,列出修改文件和原因
- 阻塞问题
- 非阻塞问题

## 完成后提交

如果只写报告:

```bash
git status --short
git add docs/test-reports/v2.1/19-windows-folder-picker.md
git commit -m "test: verify windows folder picker"
git push -u origin claude/te-mvp-win-07-folder-picker-verification
```

如果修了代码,只 stage 本工单相关文件,并在回复中说明原因。

最后回复:

- 分支名
- commit SHA
- Rust/Node/Tauri 验证结果
- 三个按钮验证结果
- 是否修改代码
- 阻塞问题