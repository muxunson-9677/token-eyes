# Token Eyes Day 1 Baseline

更新时间: 2026-06-17

## 仓库与基线

- 上游基线: `farion1231/cc-switch` release `v3.16.3`。
- 基线导入方式: 将上游 `v3.16.3` 源码导入当前仓库，并保留项目计划文档到 `docs/`。
- 本地默认分支: `main`。
- 分支策略: `main` 只接收审核后的合并；每个任务使用 `feature/<编号>-<关键词>` 分支。
- 计划文档位置:
  - `docs/cc-switch-usage-monitor-dev-plan.md`
  - `docs/codex-kickoff-prompt.md`
  - `docs/mvp-2day-plan-and-codex-prompt.md`

## 基线运行确认

- 当前代码已经包含本地会话用量同步入口 `sync_session_usage`。
- 已有同步源:
  - Claude Code: `src-tauri/src/services/session_usage.rs`
  - Codex: `src-tauri/src/services/session_usage_codex.rs`
  - Gemini: `src-tauri/src/services/session_usage_gemini.rs`
  - OpenCode: `src-tauri/src/services/session_usage_opencode.rs`
- Win Codex / WSL Claude Code 用量统计属于基线已有能力，本阶段不需要开发新逻辑。
- 2026-06-17 验证结果:
  - `cargo test --manifest-path src-tauri/Cargo.toml session_usage`: 34 passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml schema_create_tables_include_billing_mode_and_subscription_fees`: passed。
  - `cargo test --manifest-path src-tauri/Cargo.toml migration_v11_to_v12_adds_billing_fields_and_subscription_fees`: passed。
  - `cargo check --manifest-path src-tauri/Cargo.toml`: passed，只有基线已有 warning。
  - `pnpm typecheck`: passed。
  - `pnpm build:renderer`: passed，只有基线构建体积/浏览器数据 warning。
- 本机使用 pnpm 11，首次安装依赖需要允许锁文件中既有的 `esbuild` 与 `msw` postinstall；已记录在 `pnpm-workspace.yaml` 的 `allowBuilds` 中，未新增依赖。

## 标准用量表结构

执行计划中写作 `usage_records`，但当前 CC Switch 基线实际使用的标准明细表名是 `proxy_request_logs`。本阶段不重命名表，后续所有适配器都写入 `proxy_request_logs`，以保持既有查询与 Dashboard 兼容。

`proxy_request_logs` 主要字段:

- `request_id TEXT PRIMARY KEY`
- `provider_id TEXT NOT NULL`
- `app_type TEXT NOT NULL`
- `model TEXT NOT NULL`
- `request_model TEXT`
- `pricing_model TEXT`
- `input_tokens INTEGER NOT NULL DEFAULT 0`
- `output_tokens INTEGER NOT NULL DEFAULT 0`
- `cache_read_tokens INTEGER NOT NULL DEFAULT 0`
- `cache_creation_tokens INTEGER NOT NULL DEFAULT 0`
- `input_cost_usd TEXT NOT NULL DEFAULT '0'`
- `output_cost_usd TEXT NOT NULL DEFAULT '0'`
- `cache_read_cost_usd TEXT NOT NULL DEFAULT '0'`
- `cache_creation_cost_usd TEXT NOT NULL DEFAULT '0'`
- `total_cost_usd TEXT NOT NULL DEFAULT '0'`
- `latency_ms INTEGER NOT NULL`
- `first_token_ms INTEGER`
- `duration_ms INTEGER`
- `status_code INTEGER NOT NULL`
- `error_message TEXT`
- `session_id TEXT`
- `provider_type TEXT`
- `is_streaming INTEGER NOT NULL DEFAULT 0`
- `cost_multiplier TEXT NOT NULL DEFAULT '1.0'`
- `created_at INTEGER NOT NULL`
- `data_source TEXT NOT NULL DEFAULT 'proxy'`
- `billing_mode TEXT NOT NULL DEFAULT 'api_key'`
- `plan_cycle_type TEXT`
- `plan_start_at INTEGER`
- `plan_end_at INTEGER`

聚合表 `usage_daily_rollups` 主要字段:

- `date TEXT NOT NULL`
- `app_type TEXT NOT NULL`
- `provider_id TEXT NOT NULL`
- `model TEXT NOT NULL`
- `request_model TEXT NOT NULL DEFAULT ''`
- `pricing_model TEXT NOT NULL DEFAULT ''`
- `request_count INTEGER NOT NULL DEFAULT 0`
- `success_count INTEGER NOT NULL DEFAULT 0`
- `input_tokens INTEGER NOT NULL DEFAULT 0`
- `output_tokens INTEGER NOT NULL DEFAULT 0`
- `cache_read_tokens INTEGER NOT NULL DEFAULT 0`
- `cache_creation_tokens INTEGER NOT NULL DEFAULT 0`
- `total_cost_usd TEXT NOT NULL DEFAULT '0'`
- `avg_latency_ms INTEGER NOT NULL DEFAULT 0`

## 用量页面位置

- 页面入口: `src/components/usage/UsageDashboard.tsx`
- 顶部概览: `src/components/usage/UsageHero.tsx`
- 趋势图: `src/components/usage/UsageTrendChart.tsx`
- 请求列表: `src/components/usage/RequestLogTable.tsx`
- 来源统计: `src/components/usage/ProviderStatsTable.tsx`
- 模型统计: `src/components/usage/ModelStatsTable.tsx`
- 数据来源条: `src/components/usage/DataSourceBar.tsx`
- 前端 API: `src/lib/api/usage.ts`
- React Query: `src/lib/query/usage.ts`
- 类型定义: `src/types/usage.ts`
- 后端命令: `src-tauri/src/commands/usage.rs`
- 后端统计服务: `src-tauri/src/services/usage_stats.rs`

## 路径设置模块位置

- 后端设置结构: `src-tauri/src/settings.rs`
- 通用路径命令: `src-tauri/src/commands/config.rs`
- Hermes 配置目录解析: `src-tauri/src/hermes_config.rs`
- 前端设置 schema: `src/lib/schemas/settings.ts`
- 设置表单状态: `src/hooks/useSettingsForm.ts`
- 设置保存逻辑: `src/hooks/useSettings.ts`
- 目录设置 hook: `src/hooks/useDirectorySettings.ts`
- 目录设置 UI: `src/components/settings/DirectorySettings.tsx`
- 设置页接线: `src/components/settings/SettingsPage.tsx`

## Day 1 Schema 变更

- Schema 版本: `11 -> 12`。
- `proxy_request_logs` 新增字段:
  - `billing_mode`
  - `plan_cycle_type`
  - `plan_start_at`
  - `plan_end_at`
- 新增表: `subscription_fees`。
