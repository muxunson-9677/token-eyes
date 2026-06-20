# C03 — 真实 WSL UNC 路径端到端读取验收

- **验证日期**: 2026-06-20
- **分支**: `claude/te-mvp-wsl-08-real-unc-read-verification`
- **Commit**: `20e8a35`
- **执行环境**: WSL2 Ubuntu 26.04 LTS, Node.js v22.22.3
- **Windows 用户**: admin
- **WSL 发行版**: Ubuntu 26.04 (Resolute Raccoon)

---

## 1. 路径 `Test-Path` 验证

从 WSL 内部验证四个目标路径是否存在（使用 WSL 原生路径格式）:

| # | 目标路径 (Windows) | WSL 等效路径 | 存在? |
|---|---|---|---|
| 1 | `\\wsl.localhost\Ubuntu\home\hermes\.claude\projects` | `/home/hermes/.claude/projects` | ✅ EXISTS |
| 2 | `\\wsl.localhost\Ubuntu\home\hermes\.hermes\state.db` | `/home/hermes/.hermes/state.db` | ✅ EXISTS |
| 3 | `C:\Users\admin\.codex\sessions` | `/mnt/c/Users/admin/.codex/sessions` | ✅ EXISTS |
| 4 | `C:\Users\admin\.codex\archived_sessions` | `/mnt/c/Users\admin\.codex\archived_sessions` | ✅ EXISTS |

**数据量确认**:

- Claude Code: 13 个项目目录, 72 个 JSONL 会话文件
- Codex: 60 个 JSONL 会话文件 (`sessions/2026/05/24` 到 `sessions/2026/06/14`)
- Hermes: SQLite `state.db` (312 MB), 931 个 sessions, 18,246 条 messages

---

## 2. 写入 `dataDirectories` 配置

**备份**: `~/.tokentracker/tracker/config.json.c03-backup-20260620225713`

**写入的 config.json**:

```json
{
  "installedAt": "2026-06-14T15:57:56.463Z",
  "baseUrl": "https://srctyff5.us-east.insforge.app",
  "dataDirectories": {
    "claude": "\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.claude",
    "codex": "C:\\Users\\admin\\.codex",
    "hermes": "\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.hermes"
  }
}
```

**`resolveDataDirectoryPaths` 读回结果**:

```json
{
  "dataDirectories": {
    "claude": "\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.claude",
    "codex": "C:\\Users\\admin\\.codex",
    "hermes": "\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.hermes"
  },
  "codexHome": "C:\\Users\\admin\\.codex",
  "codeHome": "/home/hermes/.code",
  "claudeProjectsDir": "\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.claude/projects",
  "hermesPath": "\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.hermes"
}
```

**结论**: 配置读写逻辑正确。三个覆盖值均已保存并正确读回。

---

## 3. 单元测试结果

### `node --test test/data-directories.test.js`

```
ok 1 - normalizeDataDirectories trims known directory overrides
ok 2 - resolveDataDirectoryPaths keeps TokenTracker defaults when overrides are empty
ok 3 - resolveDataDirectoryPaths applies MVP data directory overrides
# tests 3, pass 3, fail 0
```

### `DataDirectoriesSection.test.jsx` (Vitest)

```
✓ src/components/settings/DataDirectoriesSection.test.jsx (5 tests)
# Tests 5 passed (5)
```

---

## 4. 第一次 `node bin/tracker.js sync`

### 4a. 基线 sync（默认路径，无 dataDirectories 覆盖）

```
Sync finished:
- Parsed files: 1010
- New 30-min buckets queued: 283
- Uploaded: skipped (no device token)
```

队列来源统计:

| source | entries |
|---|---|
| claude | 167 |
| hermes | 795 |
| codex | **0** |

**Codex 来源为 0 的原因**: 默认 `codexHome` = `~/.codex` (`/home/hermes/.codex`) 在 WSL 内不存在。Codex 数据实际位于 `/mnt/c/Users/admin/.codex`。

### 4b. 覆盖 sync（写入 Windows UNC 路径后）

```
Sync finished:
- Parsed files: 0
- New 30-min buckets queued: 0
- Uploaded: skipped (no device token)
```

**三个来源全部为 0**。

---

## 5. 第二次 `node bin/tracker.js sync`（Windows 路径覆盖下）

```
Sync finished:
- Parsed files: 0
- New 30-min buckets queued: 0
- Uploaded: skipped (no device token)
```

结果与第一次一致，无状态污染。之前的 962 条队列数据（来自基线 sync）未被清除。

---

## 6. Queue Source Counts（最终状态）

```json
{
  "total": 962,
  "counts": {
    "claude": 167,
    "hermes": 795
  }
}
```

| source | 有队列数据? | 总 tokens | 模型 |
|---|---|---|---|
| claude | ✅ (167 entries) | 380,667,627 | deepseek-v4-flash, deepseek-v4-pro, mimo-v2.5-pro, unknown |
| hermes | ✅ (795 entries) | 1,223,918,247 | deepseek-v4-pro, qwen3.7-max, mimo-v2.5-pro |
| codex | ❌ (0 entries) | — | — |

**注**: Claude 和 Hermes 数据来自基线 sync（使用默认 WSL 原生路径）。Windows 路径覆盖后两者也为 0。

---

## 7. Local Settings API

```
GET http://127.0.0.1:7680/functions/tokentracker-local-settings
```

```json
{
  "dataDirectories": {
    "claude": "\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.claude",
    "codex": "C:\\Users\\admin\\.codex",
    "hermes": "\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.hermes"
  },
  "agentDefaultPricing": {
    "claude": { "inputUsdPer1M": 0, "outputUsdPer1M": 0 },
    "codex": { "inputUsdPer1M": 0, "outputUsdPer1M": 0 },
    "hermes": { "inputUsdPer1M": 0, "outputUsdPer1M": 0 }
  }
}
```

**结论**: API 正确返回三个 `dataDirectories` 覆盖值。

---

## 8. Usage Summary API

```
GET http://127.0.0.1:7680/functions/tokentracker-usage-summary?from=2026-05-21&to=2026-06-20
```

```json
{
  "totals": {
    "total_tokens": 1603000405,
    "billable_total_tokens": 1603000405,
    "total_cost_usd": "0.000000",
    "input_tokens": 45634757,
    "output_tokens": 3620176,
    "cached_input_tokens": 1553745472,
    "conversation_count": 19896
  }
}
```

**结论**: API 返回真实的 token 用量数据（来自队列中的 claude + hermes 条目）。费用为 $0 是因为 `agentDefaultPricing` 全部为 0（预期行为）。

---

## 9. Dashboard 验证

- **验证方式**: 启动 `node bin/tracker.js serve --no-sync`，浏览器访问 `http://127.0.0.1:7680/dashboard`
- **页面能否打开**: ✅ 正常加载
- **是否有真实数据**: ✅ 展示来自 claude 和 hermes 的真实 token 用量（非 mock 数据）
- **三类来源同屏展示**: ❌ 仅展示 claude 和 hermes，无 codex 数据

---

## 10. 关键发现: Windows 路径在 WSL 内不可访问

Node.js `fs.existsSync()` 对 Windows 格式路径的返回结果:

```
"\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.claude"  → false
"C:\\Users\\admin\\.codex"                          → false
"\\\\wsl.localhost\\Ubuntu\\home\\hermes\\.hermes"  → false
```

**根因**: WSL2 内的 Linux 文件系统不识别 Windows UNC 路径 (`\\server\share`) 和 Windows 盘符路径 (`C:\...`)。`fs.existsSync()` 返回 `false`，sync 跳过所有数据源。

**Codex 委托来源分析**:

| 场景 | codexHome 解析为 | 可访问? | 结果 |
|---|---|---|---|
| 默认 (无覆盖) | `/home/hermes/.codex` | ❌ (WSL 内无此目录) | 0 entries |
| Windows 覆盖 | `C:\Users\admin\.codex` | ❌ (Linux 不识别盘符) | 0 entries |
| WSL 原生路径 (诊断) | `/mnt/c/Users/admin/.codex` | ✅ | 数据存在 (60 文件) |

---

## 11. 验收结论

### **BLOCKED**

| # | 目标 | 结果 |
|---|---|---|
| 1 | 本地设置能保存并读回三个覆盖值 | ✅ PASS |
| 2 | `sync` 能使用覆盖路径读取真实数据 | ❌ FAIL |
| 3 | 队列里能看到 claude / codex / hermes 三类来源 | ⚠️ PARTIAL (claude ✅, hermes ✅, codex ❌) |
| 4 | Dashboard 首屏同屏展示三者 | ❌ FAIL (无 codex) |
| 5 | 失败原因定位 | ✅ 已定位 |

### 失败详情

```
C03_BLOCKED_NEEDS_C04:
  sync returns 0 parsed files when dataDirectories contains Windows-format paths
  (UNC \\wsl.localhost\... and drive-letter C:\...) because Node.js fs on WSL-Linux
  cannot resolve Windows paths;
  evidence=sync output "Parsed files: 0" with all three overrides set;
  node fs.existsSync returns false for all three Windows-format paths from WSL;
  Codex also absent under defaults because ~/.codex doesn't exist in WSL
  (data lives at /mnt/c/Users/admin/.codex);
  suggested_scope=implement WSL path translation in data-directories.js or sync.js:
    (1) detect WSL environment (e.g. /proc/version contains "microsoft"),
    (2) translate \\wsl.localhost\<distro>\... → /... for Claude/Hermes,
    (3) translate C:\... → /mnt/c/... for Codex,
    (4) alternatively, accept WSL-native paths in dataDirectories config and
        document the cross-environment path format requirement.
```

### 具体阻塞点

**阻塞点 1 — UNC 路径翻译缺失**:
- `\\wsl.localhost\Ubuntu\home\hermes\.claude` 在 WSL 内无法被 `fs.existsSync()` 识别
- 等效 WSL 路径 `/home/hermes/.claude` 完全可用
- 代码中无 `\\wsl.localhost\<distro>\...` → `/...` 的翻译逻辑

**阻塞点 2 — Windows 盘符路径翻译缺失**:
- `C:\Users\admin\.codex` 在 WSL 内无法被 `fs.existsSync()` 识别
- 等效 WSL 路径 `/mnt/c/Users/admin/.codex` 完全可用（60 个 JSONL 文件已验证）
- 代码中无 `C:\...` → `/mnt/c/...` 的翻译逻辑

**阻塞点 3 — Codex 默认路径不匹配**:
- 即使不使用 `dataDirectories` 覆盖，Codex 数据也不会被发现
- 默认 `codexHome` = `~/.codex` (`/home/hermes/.codex`) 在 WSL 内不存在
- 真实 Codex 数据位于 `/mnt/c/Users/admin/.codex`

---

## 12. 非阻塞问题

| # | 问题 | 严重度 | 备注 |
|---|---|---|---|
| N1 | `agentDefaultPricing` 全部为 $0 | Low | 无默认定价，费用始终显示 $0.00 |
| N2 | `archived_sessions` 目录为空 | Info | Codex 无归档会话，不影响验证 |
| N3 | Hermes `state.db` 无 `sessions` 表时 `sqlite3` CLI 不可用 | Info | Node.js 内置 `node:sqlite` 正常工作 |

---

## 13. 数据完整性证据

### Claude Code (72 JSONL 文件)

```
/home/hermes/.claude/projects/-home-hermes-projects-token-eyes-08/*.jsonl
/home/hermes/.claude/projects/-home-hermes-projects-token-eyes-07/*.jsonl
/home/hermes/.claude/projects/-mnt-c-WINDOWS-system32/*.jsonl  (16 files)
...
```

### Codex (60 JSONL 文件)

```
/mnt/c/Users/admin/.codex/sessions/2026/05/24/rollout-*.jsonl  (14 files)
/mnt/c/Users/admin/.codex/sessions/2026/05/25/rollout-*.jsonl  (32 files)
/mnt/c/Users/admin/.codex/sessions/2026/06/13/rollout-*.jsonl  (2 files)
/mnt/c/Users/admin/.codex/sessions/2026/06/14/rollout-*.jsonl  (2 files)
```

Codex JSONL 条目类型: `session_meta`, `event_msg`, `response_item`, `turn_context`, `compacted`

### Hermes (931 sessions, 18246 messages)

```
/home/hermes/.hermes/state.db  (SQLite 3.x, 312 MB)
Sources: cli(77), cron(799), feishu(46), api_server(3), subagent(3), tui(2), weixin(1)
Models: deepseek-v4-pro(555), mimo-v2.5-pro(348), qwen3.7-max(21)
```
