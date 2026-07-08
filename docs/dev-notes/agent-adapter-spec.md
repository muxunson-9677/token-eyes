# Agent Adapter Standardization Spec

更新时间: 2026-06-22

任务: T01 - 适配器标准化接口规范

## 目标

为 Token Eyes / Token Tracker 的 AI 工具来源接入定义一层最小可执行的 adapter metadata 和注册清单,让后续新增工具时先登记 source、显示名、日志发现方式、解析入口、状态展示和测试要求,避免继续把 provider 信息散落在 `rollout.js`、`sync.js`、`status.js`、`diagnostics.js`、Dashboard 图标和 macOS provider 列表中。

T01 只定义规范。T02 只实现注册清单和校验,不得迁移或重写所有 parser。

## 当前基线

当前扩展点分散在这些位置:

- `src/lib/rollout.js`: 导出 `parse*Incremental()`、`resolve*()`、`list*()` 等 parser 和日志发现函数。
- `src/commands/sync.js`: 手动 import parser,再按固定顺序逐段调用。
- `src/commands/status.js`: 手动探测 hooks、被动日志、SQLite、各 provider 安装状态。
- `src/lib/diagnostics.js`: 另一套诊断字段和路径探测。
- `src/lib/passive-mode.js`: 只覆盖部分 hook 型 provider 的 passive mode 判定。
- `src/lib/data-directories.js`: 当前只允许 `claude/codex/hermes` 三类用户覆盖路径。
- `src/lib/source-metadata.js`: 目前只维护 account/local scope,例如 `cursor` 是 account-level source。
- `dashboard/src/lib/limits-providers.js` 和 `TokenTrackerBar/TokenTrackerBar/Models/LimitsSettingsStore.swift`: Usage Limits provider 顺序需要 parity test 保护。
- `dashboard/src/ui/dashboard/components/ProviderIcon.jsx`: provider icon 与 logo map。

## 设计原则

1. 不改 queue row schema。`source/model/token/cost` 字段语义保持不变。
2. 不重写 parser。现有 `parse*Incremental()` 仍留在 `rollout.js`,T02 只引用它们。
3. 注册清单先服务工程一致性,不强行驱动所有运行时逻辑。
4. provider metadata 只记录非敏感信息,不得包含 prompt、message、conversation body、API key 或用户本地绝对路径样例。
5. 新 source 的接入必须带测试,至少覆盖 registry 完整性、sync/status/diagnostics 可见性和 UI 显示名/icon 映射。

## Adapter 定义

新增 `src/lib/agent-adapters.js`,导出以下结构。

```js
const AGENT_ADAPTERS = [
  {
    id: "codex",
    displayName: "Codex",
    queueSource: "codex",
    family: "openai",
    collectionMode: "hook_or_passive_log",
    parserExport: "parseRolloutIncremental",
    resolverExports: ["listRolloutFiles", "listRolloutFilesDeep"],
    statusSurface: true,
    diagnosticsSurface: true,
    usageLimitsSurface: true,
    pathOverrideKey: "codex",
    accountLevel: false,
    notes: "Codex CLI rollout JSONL; archived_sessions is scanned with event dedup."
  }
];

module.exports = {
  AGENT_ADAPTERS,
  getAgentAdapter,
  listAgentAdapters,
  listUsageLimitAdapterIds,
  listDataDirectoryAdapterKeys,
  listAccountLevelSources,
};
```

字段说明:

| 字段 | 说明 |
|---|---|
| `id` | 稳定 adapter id,小写 kebab/snake 均可,但不得和已有 id 冲突。 |
| `displayName` | UI/状态页显示名。 |
| `queueSource` | 写入 `queue.jsonl` 的 `source` 值。 |
| `family` | 供应商或协议族,例如 `openai`、`anthropic`、`sqlite_local`、`vscode_extension`、`unknown`。 |
| `collectionMode` | `hook_or_passive_log` / `passive_log` / `sqlite` / `cloud_api` / `otel`。 |
| `parserExport` | `src/lib/rollout.js` 中已经存在的 parser 导出名;无 parser 的纯 UI provider 可为 `null`。 |
| `resolverExports` | 日志/数据库发现函数导出名列表。 |
| `statusSurface` | 是否应出现在 `tracker status`。 |
| `diagnosticsSurface` | 是否应出现在 diagnostics。 |
| `usageLimitsSurface` | 是否应出现在 Usage Limits provider 偏好。 |
| `pathOverrideKey` | 对应 `dataDirectories` 可覆盖的 key;没有用户可配置路径时为 `null`。 |
| `accountLevel` | 是否属于 account-level source,当前 `cursor` 为 true。 |
| `notes` | 给维护者看的短说明。 |

## 首批必须登记的 adapters

T02 至少登记这些现有来源,不得遗漏当前 sync/status 已支持的主要 source:

- `claude`
- `codex`
- `every-code`
- `cursor`
- `gemini`
- `opencode`
- `openclaw`
- `kilo-cli`
- `kilocode`
- `roocode`
- `kiro`
- `kiro-cli`
- `hermes`
- `kimi`
- `kimi-code`
- `codebuddy`
- `omp`
- `pi`
- `craft`
- `copilot`
- `zed`
- `goose`
- `droid`
- `grok`
- `antigravity`

如果 T02 发现某个 source 在 `sync.js` 中已存在但未列入这里,应补入 registry,并在报告中说明。

## T02 实现边界

T02 应做:

1. 新增 `src/lib/agent-adapters.js`。
2. 新增 `test/agent-adapters.test.js`。
3. 让 `src/lib/source-metadata.js` 从 registry 读取 account-level source,保持 `cursor` 行为不变。
4. 让 `src/lib/data-directories.js` 从 registry 派生允许覆盖的 key,但首批仍只允许 `claude/codex/hermes`,避免 UI 还没准备好时扩大设置面。
5. 增加 parity 测试,确保 `sync.js` 中手动调用的主要 `source` 都能在 registry 中找到。
6. 文档化新增 source 的接入 checklist。

T02 不应做:

- 不迁移 `sync.js` 调用链到 registry 自动执行。
- 不拆分 `rollout.js`。
- 不改现有 parser 算法。
- 不改变 provider 的默认显示顺序。
- 不新增 UI 页面。
- 不改变 queue schema 或 pricing lookup。

## 新 source 接入 checklist

后续新增 source 时必须逐项完成:

1. 在 `src/lib/agent-adapters.js` 添加 adapter。
2. 如果有 parser,在 `src/lib/rollout.js` 暴露 parser/resolver,并在 `src/commands/sync.js` 接入。
3. 如果 status/diagnostics 需要显示,补 `statusSurface` / `diagnosticsSurface` 对应逻辑和测试。
4. 如果 Usage Limits 需要显示,同步 `dashboard/src/lib/limits-providers.js`、`TokenTrackerBar/TokenTrackerBar/Models/LimitsSettingsStore.swift` 和 parity test。
5. 如果需要用户配置路径,补 `dataDirectories` key 和 Settings UI,不要只改后端。
6. 补 parser 单测或 registry parity 单测。
7. 不返回 prompt、message、conversation body。

## 验收标准

- `src/lib/agent-adapters.js` 能列出当前主要 source 的 metadata。
- `getAgentAdapter(id)` 和 `listAgentAdapters()` 行为稳定,按 `id` 排序或按定义顺序返回,测试固定。
- `source-metadata` 仍能把 `cursor` 判定为 account-level source,其他本地 source 保持 local。
- `data-directories` 仍只归一化 `claude/codex/hermes`,但允许 key 的来源有 registry 依据。
- 新增 registry parity test 能发现 `sync.js` 中已接入但 registry 未登记的 source。
- 现有 parser 测试不因 T02 失败。