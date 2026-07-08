# Token Eyes 基座迁移记录

更新时间: 2026-06-19

## 迁移结论

已在 `codex-token-tracker-baseline` 分支把当前工作区从旧 CC Switch/Tauri 壳替换为 TokenTracker 基座。

## 上游来源

- 上游仓库: `github.com/mm7894215/TokenTracker`
- 上游提交: `7459948`
- 上游版本: `0.54.0`
- 当前 package 名称: `tokentracker-cli`

## 保留内容

迁移时保留并恢复了以下 Token Eyes 项目文档:

- `docs/token-eyes-dev-plan-v2.md`
- `docs/token-eyes-full-plan-for-codex.md`
- `docs/token-eyes-v2.1-mvp-plan.md`
- `docs/feishu-setup.md`
- `docs/dev-notes/v2.1-mvp-interfaces.md`
- `docs/tasks/v2.1/`
- `docs/mvp-current-state-report.md`

## 删除/替换内容

旧 CC Switch/Tauri 壳内容已从工作区移除,包括:

- `src-tauri/`
- 原 Tauri 前端 `src/`、`tests/`、`vite.config.ts`
- `pnpm-lock.yaml`、`pnpm-workspace.yaml`
- 旧 CC Switch 用户手册、release notes、旧工单和旧测试报告

这些删除是换基座的一部分。后续开发以 TokenTracker 目录结构为准。

## 验证记录

已完成依赖安装:

```bash
npm.cmd install
npm.cmd --prefix dashboard install
```

已通过:

```bash
npm.cmd run dashboard:build
npm.cmd --prefix dashboard run typecheck
node bin/tracker.js -h
```

`node bin/tracker.js sync --help` 不是上游 CLI 支持的参数,已改用 `node bin/tracker.js -h` 做入口烟测。

`npm.cmd test` 当前未通过,主要阻塞不是本次迁移代码改动,而是上游测试在当前 Windows 沙箱里的环境依赖:

- 部分测试只改 `process.env.HOME`,但代码使用 `os.homedir()`,在 Windows 下仍解析到 `C:\Users\admin`,导致测试读写 `C:\Users\admin\.tokentracker` 并触发沙箱 `EPERM`。
- 当前环境没有 `sqlite3` 命令,涉及 Zed/Goose sqlite 夹具的测试报 `spawnSync sqlite3 ENOENT`。
- 当前沙箱禁止测试创建某些 symlink,`usage-limits.test.js` 的 nvm Gemini 回退用例报 `EPERM`。

后续如果要让完整 `npm test` 在本 Windows 工作区通过,应先补一张独立工单处理测试环境兼容,不要把它和 V2.1 产品功能实现混在一起。

## V2.1-01 解析器基线结论

详见 `docs/test-reports/v2.1/01-parser-baseline.md`。

当前结论:

- Codex 解析器已用真实本机日志验证通过。
- Claude Code 当前 Windows 日志只有 0-token conversation row,还需要 WSL 或真实 token 日志复验。
- Hermes Agent 的 Windows `state.db` 存在,但 `sessions=0`、`messages=0`,当前没有可解析 token row。
- `\\wsl.localhost` 和 `\\wsl$` 当前不可见,后续路径覆盖工单需要把 WSL UNC 路径作为重点。
- Hermes DeepSeek/MiMo 计费线本轮无法验证,先按 V2.1 方案作为单一 `hermes` 来源展示。
