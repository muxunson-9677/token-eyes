# [MVP] 05 - Win + WSL 数据目录覆盖

## 任务ID

`V2.1-05`

## 对应 full-plan

full-plan #4 和 #5。

## 执行方

Claude Code

## 分支名

`feature/05-mvp-path-overrides`

## 所属模块

设置页 + 同步路径解析。

## 目标文件

- 修改: `src/commands/sync.js`
- 修改: `src/lib/rollout.js`
- 修改: `src/lib/runtime-config.js`
- 修改: `src/lib/local-api.js`
- 修改: `dashboard/src/pages/SettingsPage.jsx`
- 修改或新建: `dashboard/src/components/settings/` 或 `dashboard/src/ui/dashboard/components/` 下的设置组件
- 测试: `test/rollout-parser.test.js`
- 测试: 在 `test/*.test.js` 下新增聚焦测试
- 测试: 在被改设置组件旁新增 Dashboard 测试
- 新建: `docs/test-reports/v2.1/05-path-overrides.md`

## 背景说明

V2.1 必须让 Windows 桌面端同时读到 WSL 内 Claude Code、WSL 内 Hermes Agent 和 Windows 本机 Codex 的数据。TokenTracker 已有部分环境变量覆盖和 Hermes UNC SQLite 快照读取逻辑。本任务只补 MVP 需要的 UI 和配置链路。

## 已确定输入规范

使用 `docs/dev-notes/v2.1-mvp-interfaces.md` 的“数据目录覆盖”章节。

## 具体步骤

1. 先执行 `docs/tasks/v2.1/README.md` 中的基座预检。
2. 先写失败测试,覆盖:
   - Claude 覆盖路径能改变 project directory root。
   - Codex 覆盖路径能改变 `sessions` 和 `archived_sessions` root。
   - Hermes 覆盖路径仍沿用现有 UNC 快照行为。
3. 实现最小本地配置结构:

```json
{
  "dataDirectories": {
    "claude": "",
    "codex": "",
    "hermes": ""
  }
}
```

4. 把 sync 路径解析接到非空覆盖值。
5. 在 Settings UI 增加三个输入框:
   - Claude Code 数据目录
   - Codex 数据目录
   - Hermes Agent 数据目录
6. 输入为空时保持 TokenTracker 默认行为不变。
7. 跑定向测试,然后运行:

```bash
npm test
npm --prefix dashboard run build
```

8. 把验证证据写入 `docs/test-reports/v2.1/05-path-overrides.md`。

## 验收标准

- 空设置保持 TokenTracker 默认路径。
- 能保存并使用 `\\wsl.localhost\Ubuntu\home\hermes\.claude` 这类 UNC 路径。
- Hermes UNC DB 读取仍先做本地 SQLite 快照。
- 设置页不提供把这些本地路径同步到云端的入口。
- 报告包含执行过的命令和通过/失败结果。

## 禁止事项

- 不把本地路径上传到任何云端或账号接口。
- V2.1 不做自动枚举 WSL 发行版。
- 不改变 parser token normalization。
