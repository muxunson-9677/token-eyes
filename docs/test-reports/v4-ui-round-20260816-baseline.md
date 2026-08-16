# 0.54.40-V4 新一轮 UI 优化基线报告

## 基线身份

- 正式基线分支：`0.54.40-V4`
- 本轮功能分支：`codex/v4-ui-round-20260816`
- 当前基线提交：`804e8158abc5917152881c772e2103cb041ee31a`
- 工作树：`D:\04-AI-Project\010-Token eye\.worktrees\v4-ui-round-20260816`
- 需求与实施计划：`docs/superpowers/plans/2026-08-16-v4-ui-round-20260816.md`
- 用户参考截图：`C:\Users\admin\AppData\Local\Temp\codex-clipboard-d5ac01fa-f294-465f-b9e9-c2e281ea1490.png`
- 参考截图物理像素：`2800 × 1696`

## 依赖安装

### 根目录

- 命令：`npm ci`
- 结果：成功，安装 47 个包。
- 已有告警：npm 不识别 `electron_mirror`、`electron_builder_binaries_mirror` 配置；`prebuild-install` 已弃用。

### Dashboard

- 命令：`npm --prefix dashboard ci`
- 结果：成功，安装 527 个包。
- 已有告警：安装策略阻止了 `esbuild@0.27.4` 与两个 `esbuild@0.21.5` 的安装脚本。

## 质量基线

### 类型检查

- 命令：`npm --prefix dashboard run typecheck`
- 结果：通过，退出码 0。

### 生产构建

- 命令：`npm --prefix dashboard run build`
- 结果：通过，Vite 7.3.5 共转换 3800 个模块，用时约 15.08 秒。
- 已有告警：`local-api-auth` 同时存在动态与静态导入；部分构建分块超过 500 kB。

### 全量测试

- 命令：`npm test`
- 结果：通过，退出码 0。
- 测试总数：1841。
- 通过：1833。
- 失败：0。
- 跳过：8。
- 测试套件：73。
- 总用时：约 169.016 秒。

## 已识别的基线风险

构建和部分测试读取了真实用户目录下的 `C:\Users\admin\.tokentracker\tracker\relay-cookies.json`。日志没有输出 cookie 值，但这表明现有构建/测试仍存在依赖真实用户目录的隔离风险。本轮不得把“全量测试通过”等同于“测试数据完全隔离”；凡涉及相应模块的新增测试，必须使用临时目录或显式注入的数据源。

## 尚待采集的界面证据

- 当前工具会话没有提供 `js_repl`，因此无法按持久 Playwright 会话流程直接采集界面。
- 后续使用仓库现有 Playwright/E2E 能力完成确定视口截图、真实点击路径和视觉复核。
- 应用默认窗口尺寸还需结合 Windows 缩放比例与 Electron/Tauri 逻辑像素实测，不能直接把参考截图的物理像素 `2800 × 1696` 写成窗口逻辑尺寸。

本报告只记录改动前基线，不代表本轮 11 项 UI 调整已经验收。
