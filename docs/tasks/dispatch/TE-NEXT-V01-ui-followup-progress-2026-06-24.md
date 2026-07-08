# TE-NEXT V01 UI 跟进进度 - 2026-06-24

## 飞书进度表更新项

| 字段 | 内容 |
|---|---|
| 序号 | V01-UI-06 |
| 模块 | Token Eyes Tauri / 限制显示 / 支出页 / 概览页 / 图标 |
| 状态 | 已完成，待用户本地验收 |
| 负责人 | Codex |
| 是否派单 | 暂不派 Claude Code；本轮由 Codex 直接修复 |
| 是否人工 | 需要用户打开本地 `token-eyes.exe` 做 UI 验收 |
| 依赖关系 | 依赖 V00 Tauri baseline；不依赖 .NET SDK |

## 已完成内容

1. 限制显示 provider 列表已调整：删除 `Kimi`、`Kiro`、`Grok Build`、`GitHub Copilot`；新增 `Hermes`、`OpenClaw`、`OpenCode`；保留 `Claude`、`Codex`、`Cursor`、`Gemini`、`Antigravity`。
2. 支出页按 CC Switch 使用统计方向补齐：新增真实消耗 Tokens、总请求数、总成本、输入/输出/缓存创建/缓存命中、缓存命中率，以及“请求日志 / Provider 统计 / 模型统计”切换区。
3. 概览页空态文案已修正：不再提示安装 Node.js。当前本机已有队列和 API 数据，空态不是 Node 未安装导致；若某个时间范围暂无展示数据，提示刷新或运行同步。
4. 产品图标已替换为用户提供的黄黑图标，覆盖 Tauri 图标与前端 favicon/app icon。Windows `icon.ico` 已改为 Tauri 可解析的原生 ICO 格式，避免构建阶段再次报 `failed to parse icon`。

## 验证结果

- `npm --prefix dashboard run test -- src/hooks/use-limits-display-prefs.test.js src/pages/SpendPage.test.jsx src/lib/copy-registry.test.js`：通过，41/41。
- `npm run validate:copy`：通过；仅有既有 unused copy warning。
- `npm run validate:ui-hardcode`：通过。
- `npm --prefix dashboard run typecheck`：通过。
- `npm run dashboard:build`：通过；仅有既有 chunk size / dynamic import warning。
- `npx tauri build --no-bundle`：通过，产物路径 `D:\04-AI-Project\010-Token eye\src-tauri\target\release\token-eyes.exe`。

## 人工验收步骤

1. 打开 `D:\04-AI-Project\010-Token eye\src-tauri\target\release\token-eyes.exe`。
2. 进入设置页，检查“限制显示”列表是否符合本记录第 1 点。
3. 进入“支出”页，检查是否出现使用统计区、请求日志、Provider 统计、模型统计。
4. 进入“概览”页，检查空态不再提示安装 Node.js。
5. 查看窗口/任务栏/前端 favicon 是否使用黄黑 Token 图标。

## 当前限制

当前 Codex 环境没有可用的飞书/多维表格写入工具，因此本文件是可粘贴到飞书进度表的本地同步记录；飞书表本身尚未自动写入。