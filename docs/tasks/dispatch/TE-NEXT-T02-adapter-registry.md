# TE-NEXT-T02 - Adapter Registry Standardization

## 任务边界

你负责实现后续补齐任务 `T02 - 适配器注册机制代码化`。这是工程一致性任务,不是 parser 重构任务。

只做 registry/metadata/test 的最小闭环。不要迁移所有 parser,不要重写 `sync.js` 执行流,不要拆 `rollout.js`,不要改 queue schema。

本工单依据:

- `docs/token-eyes-next-blueprint-v3.md`
- `docs/dev-notes/agent-adapter-spec.md`
- `CLAUDE.md`

## 先读文件

开始前按顺序读:

1. `CLAUDE.md`
2. `docs/dev-notes/agent-adapter-spec.md`
3. `src/lib/rollout.js` 的导出区和 parser 函数名列表
4. `src/commands/sync.js`
5. `src/commands/status.js`
6. `src/lib/diagnostics.js`
7. `src/lib/source-metadata.js`
8. `src/lib/data-directories.js`
9. `dashboard/src/lib/limits-providers.js`
10. `test/limits-providers-parity.test.js`

如果 `docs/dev-notes/agent-adapter-spec.md` 不存在,停止并报告。

## 目标

新增一个轻量 adapter registry,把现有主要 source 的非敏感元数据集中登记,并用测试防止新增 provider 时遗漏 registry。

## 实现要求

### 1. 新增 `src/lib/agent-adapters.js`

导出:

```js
const AGENT_ADAPTERS = [/* entries */];

function listAgentAdapters() {
  return AGENT_ADAPTERS.map((entry) => ({ ...entry, resolverExports: [...entry.resolverExports] }));
}

function getAgentAdapter(id) {
  const normalized = normalizeAdapterId(id);
  return AGENT_ADAPTERS.find((entry) => entry.id === normalized) || null;
}

function listUsageLimitAdapterIds() {
  return AGENT_ADAPTERS.filter((entry) => entry.usageLimitsSurface).map((entry) => entry.id);
}

function listDataDirectoryAdapterKeys() {
  return AGENT_ADAPTERS.map((entry) => entry.pathOverrideKey).filter(Boolean);
}

function listAccountLevelSources() {
  return AGENT_ADAPTERS.filter((entry) => entry.accountLevel).map((entry) => entry.queueSource);
}
```

可以调整内部实现,但导出函数名和行为要稳定。

首批登记至少包含 T01 规范列出的 source。`parserExport` / `resolverExports` 填现有导出名;不确定或无 parser 时用 `null` / `[]`,并在注释里说明原因。

### 2. 修改 `src/lib/source-metadata.js`

让 account-level source 从 registry 派生:

```js
const { listAccountLevelSources } = require("./agent-adapters");
const ACCOUNT_LEVEL_SOURCES = new Set(listAccountLevelSources());
```

保持当前行为: `cursor` 是 account-level,其他现有本地 source 是 local。

### 3. 修改 `src/lib/data-directories.js`

从 registry 派生可覆盖路径 key,但首批实际仍限制为当前设置页已支持的 key:

```js
const { listDataDirectoryAdapterKeys } = require("./agent-adapters");
const DATA_DIRECTORY_KEYS = listDataDirectoryAdapterKeys().filter((key) => ["claude", "codex", "hermes"].includes(key));
```

不要新增 Settings UI 字段。

### 4. 新增 `test/agent-adapters.test.js`

至少覆盖:

- registry id 唯一。
- 每个 entry 有 `id/displayName/queueSource/collectionMode`。
- `getAgentAdapter("Codex")` 或大小写变体能找到 `codex`。
- `listAccountLevelSources()` 包含 `cursor`,不包含 `codex`、`claude`。
- `DATA_DIRECTORY_KEYS` 仍等于 `claude/codex/hermes`。
- `source-metadata` 仍判断 `cursor` 为 account,`codex` 为 local。
- `sync.js` 中主要手写 source 字符串都能在 registry 找到。测试可以读取 `src/commands/sync.js` 源码并检查下列 source: `codex`, `every-code`, `openclaw`, `claude`, `gemini`, `antigravity`, `opencode`, `kilo-cli`, `kilocode`, `goose`, `droid`, `zed`, `roocode`, `cursor`, `kiro`, `hermes`, `kiro-cli`, `kimi`, `kimi-code`, `codebuddy`, `omp`, `pi`, `craft`, `grok`, `copilot`。

## 验证命令

至少运行:

```bash
node --test test/agent-adapters.test.js test/limits-providers-parity.test.js test/status-json-light.test.js
```

再运行 parser smoke:

```bash
node --test test/rollout-parser.test.js test/codex-context-breakdown.test.js test/spend-records-api.test.js
```

如果 parser smoke 因已有慢测或无关环境失败,必须贴出失败摘要并说明与本工单无关。不要只写“测试失败”。

## 验收标准

- 新 registry 文件存在,并列出当前主要 source。
- `source-metadata` 和 `data-directories` 行为保持兼容。
- 新增 registry 测试通过。
- 未改 parser 算法、未改 queue schema、未新增 UI 设置项。
- 报告包含 branch、commit SHA、改动文件、测试命令和结果。

## 禁止事项

- 不要拆 `src/lib/rollout.js`。
- 不要把 `sync.js` 改成完全由 registry 自动执行。
- 不要新增 provider 或 parser。
- 不要改 pricing。
- 不要改 Dashboard 可视化。
- 不要把飞书同步做进产品代码。