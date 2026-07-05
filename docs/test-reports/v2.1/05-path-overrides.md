# V2.1-05 路径覆盖配置验收报告

日期: 2026-06-19
分支: `codex-token-tracker-baseline`

## 结论

V2.1-05 已完成当前 MVP 范围内的路径覆盖链路:

- 新增本机配置结构 `dataDirectories.claude/codex/hermes`,空字符串保持 TokenTracker 默认路径。
- `sync` 会读取本机配置并把非空覆盖值接入 Claude、Codex、Hermes 的数据目录解析。
- Settings 页面新增 Claude Code、Codex、Hermes Agent 三个本地数据目录输入框。
- 本地设置接口只写入本机 `config.json`,没有接到云端账号或同步接口。
- Hermes 覆盖路径仍交给现有 Hermes 解析逻辑处理,保留 SQLite 本地快照读取行为。

## 主要改动

- `src/lib/data-directories.js`: 新增路径覆盖规范化与解析函数。
- `src/commands/sync.js`: 同步命令接入 `dataDirectories` 覆盖值。
- `src/lib/local-api.js`: 新增 `tokentracker-local-settings` 本地接口,支持读取/保存路径覆盖。
- `dashboard/src/components/settings/DataDirectoriesSection.jsx`: 新增 Settings 页面路径覆盖输入区。
- `dashboard/src/lib/api.ts`: 新增本地设置 API client。
- `test/data-directories.test.js`: 覆盖默认路径与覆盖路径解析。
- `test/local-settings-api.test.js`: 覆盖本机设置接口的保存行为。
- `dashboard/src/components/settings/DataDirectoriesSection.test.jsx`: 覆盖 Settings UI 读取、编辑、保存路径。

## 已执行验证

```bash
node --test test\data-directories.test.js test\local-settings-api.test.js
```

结果: 通过。4 个 Node 测试全部通过。

```bash
npm.cmd --prefix dashboard run test -- DataDirectoriesSection.test.jsx
```

结果: 通过。1 个 Vitest 组件测试通过,无 React `act` 警告。

```bash
node -c src\lib\data-directories.js
node -c src\commands\sync.js
node -c src\lib\local-api.js
```

结果: 通过。三个文件语法检查均为退出码 0。

```bash
npm.cmd --prefix dashboard run typecheck
```

结果: 通过。`tsc --noEmit` 退出码 0。

```bash
npm.cmd run dashboard:build
```

结果: 通过。Vite 构建成功。构建输出中仍有既有 chunk 大小和动态导入提示,不影响退出码。

```bash
git diff --check
```

结果: 通过。仅输出基座替换带来的 CRLF 提示。

## 未执行或受限项

- 完整 `npm test` 当前仍受 Windows 沙箱/上游测试环境限制阻塞,原因见 `docs/dev-notes/baseline.md`: 测试使用 `process.env.HOME`,但代码路径依赖 `os.homedir()` 导致写入 `C:\Users\admin\.tokentracker`; 同时缺少 `sqlite3` CLI,并存在 Windows symlink 权限问题。
- 当前机器没有可访问的 `\\wsl.localhost` / `\\wsl$` 路径,所以 WSL UNC 的真实端到端读盘需要等用户回到可授权/可访问环境后再跑。

## 验收对应关系

- 空设置保持默认路径: 已由 `resolveDataDirectoryPaths keeps TokenTracker defaults when overrides are empty` 覆盖。
- UNC 路径可保存: 已由本地设置 API 测试保存 `\\wsl.localhost\Ubuntu\home\agent\.claude` 和 Hermes UNC 路径覆盖。
- Codex 覆盖路径改变 sessions root: 已由 `resolveDataDirectoryPaths applies MVP data directory overrides` 覆盖。
- 设置页不上传云端: 当前只调用 `tokentracker-local-settings` 本机接口,并通过本地 auth 写入本机 `config.json`。
