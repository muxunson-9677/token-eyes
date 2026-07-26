# Token Eyes 项目级成本与时长追踪

日期：2026-07-12  
状态：待用户复核后进入实现计划  
范围约束：**所有代码与文件增删改查仅限本仓库** `d:\04-AI-Project\010-Token eye`（及其子路径），不在仓库外创建或修改文件。  
隐私约束：延续既有原则，只处理 token 计数与用户主动录入的成本，**不**读取或存储提示词/对话内容。

## 背景

系统已有一条独立的项目级数据流 `project.queue.jsonl`（由 `rollout.js` 的 `enqueueTouchedProjectBuckets` 写入），按 `(project_key, source, hour_start)` 归集每个项目的实际 token 用量；`tokentracker-project-usage-summary` 接口 + `ProjectUsagePanel.jsx` 已能在仪表盘的「Projects」tab 展示 Top-N 项目的 token 数、成本、请求数、最后活跃时间。手动成本也已有 `spendRecords` 账本（月付/年付/一次性）与「其他 AI 花费」入口；成本计算 `computeRowCostDetailed` 已把 API 用量成本与订阅费分开。

但当前项目视图「不够精细」：只按 git 远程地址识别（纯本地文件夹进不来）、只有 Top-3、没有「用过哪些 agent」、没有时长、没有把自定义基础设施费/订阅费归到具体项目，也没有可下钻的详情页与项目备注。

## 目标（端到端）

1. **项目识别**：有 git remote 的按远程地址；没有的按本地文件夹兜底，让纯本地项目（如 `06-xxx`）也能作为独立项目出现。
2. **项目备注/别名**：把 `06-xxx` 之类的文件夹名自定义为「托管项目」等易读名称。
3. **成本累积汇总（四条线）**：API key 费、预付 Token 套餐费、包月订阅费（按份额摊）、用户自定义基础设施费（服务器/数据库/插件等），汇总为项目总成本。
4. **开发时长**：展示「首次活跃 → 最后活跃」的日历跨度，并用活跃半小时桶估算「有效投入工时」。
5. **列表 + 详情**：正式的项目列表页（名称/备注 + 用过的 agent + 累积花销），点进去看单项目详情。

## 非目标（本版不做）

- 不做 OpenClaw 的 cwd 归集（现无该能力，列为后续跟进）。
- 不改动 token 归一化与成本核心公式（`computeRowCost` 仍是唯一成本源）。
- 不把项目备注/自定义成本同步到云端（本地 `config.json` 存储）。
- 不做「精确会话时长」的原始日志级重解析（列为 Phase 3 可选）。

## 产品决策（已确认）

| 项 | 决策 |
|---|---|
| 项目识别 | **混合**：优先 git 远程地址（多 clone 合并）；无 remote 时按规范化本地路径兜底 |
| 固定/共用费归集 | **按用量份额自动摊**：用项目占该 provider 的 token 比例切分包月订阅，UI 标注「估算」 |
| 预付 Token 套餐 | 按套餐单价（套餐价 / 套餐总量）× 项目用量，较精确（Phase 2） |
| API key 费 | 对项目行跑 `computeRowCostDetailed`，精确 |
| 自定义基础设施费 | 用户手动指定归属项目 + 分类（Phase 2） |
| 开发时长 | 默认 = 日历跨度 + 活跃半小时桶 × 30min 估算工时；精确会话时长为 Phase 3 可选 |

## 项目身份模型

引入规范化的 **`project_id`** 作为项目的唯一标识：

- **git 项目**：沿用现有 `project_key`（如 `owner/repo`），保持向后兼容——历史 `project.queue.jsonl` 行无需迁移。
- **本地项目**：`local:<规范化路径>`，路径取 `repo_root`（git 仓库根）或工作文件夹；Windows 下统一小写盘符、正斜杠，去尾部分隔符，得到稳定 key。
- **默认显示名**：git 项目沿用 `extractProjectName`；本地项目取路径末段文件夹名（如 `06-xxx`）。
- **别名**：`projectMeta[project_id].alias` 覆盖显示名。

> 边界情况（接受并记录）：同一文件夹先无 remote、后加 remote，会从 `local:` 身份切换到 git 身份，历史数据不合并。属低频情况，本版不处理合并。

## 数据模型变更

### 1. `project.queue.jsonl` 行 + 入队闸门（`src/lib/rollout.js`）

- 现闸门 `if (!projectRef || !projectKey) continue;`（`enqueueTouchedProjectBuckets`,约 1562 行）**放宽**为：只要能解析出 `project_id`（git key 或本地路径）即入队。
- 行内新增字段（向后兼容，旧读取路径忽略未知字段）：
  - `project_id`：规范化标识（git 项目等于 `project_key`;本地项目为 `local:<path>`）。
  - `project_path`：用于展示的本地路径（本地项目必填；git 项目可复用 `repo_root`）。
- `resolveProjectContextForPath` 在 git 解析失败时，回退产出「本地路径身份」，而非返回空导致丢弃。

### 2. `projectMeta`（`config.json`，经 `tracker-config` 读写）

```json
{
  "projectMeta": {
    "<project_id>": {
      "alias": "托管项目",
      "pinned": false,
      "hidden": false,
      "tags": ["client"],
      "updated_at": "2026-07-12T00:00:00Z"
    }
  }
}
```

### 3. `spendRecords` 扩展（`src/lib/local-api.js` `normalizeSpendRecord`,约 2831 行）

新增两个**可选**字段（旧记录缺失 → 视为「全局/未分类」，不破坏现有账本）：

- `project_id?`:把该笔成本归属到具体项目；空 = 不归属任何项目。
- `category?`:`server | database | plugin | subscription | other`,用于区分自定义基础设施费与订阅费。

写入校验 `validateSpendRecordContract` 同步允许这两个字段；订阅金额换算沿用现成的 `computeSubscriptionCostForRange`。

## 成本模型（单项目，给定时间范围）

项目总额 = 以下四项之和，UI 对「估算项」标灰/带角标：

| 线 | 算法 | 精度 |
|---|---|---|
| **API key 费** | Σ `computeRowCostDetailed(row)`，取项目行 | 精确 |
| **预付 Token 套餐**（Phase 2） | 项目在该套餐来源的 token × (套餐价 / 套餐总量) | 较精确 |
| **包月订阅（按份额摊）**（Phase 2） | 该订阅在范围内的费用（`computeSubscriptionCostForRange`）× (项目该来源 token / 全部该来源 token) | 估算 |
| **自定义基础设施费**（Phase 2） | Σ `spendRecords` 中 `project_id == 本项目` 且 `category ∈ {server,database,plugin,other}` 的范围内金额 | 用户录入 |

## 时长模型（单项目，给定范围）

- `first_active_at` / `last_active_at` = 项目行 `hour_start` 的最小 / 最大值 → **日历跨度**（天）。
- `active_bucket_count` = 项目**去重后**的 `hour_start` 数量（跨 agent 同一半小时只计一次，避免并行工作重复计时）→ **估算工时** = `active_bucket_count × 30min`。
- Phase 3（可选）：从原始日志解析会话起止，落成新的会话记录，给出更接近真实的会话时长。

## 接口变更（`src/lib/local-api.js`）

### 扩展 `tokentracker-project-usage-summary`

- 支持「全量列表」模式（列表页用），保留默认 Top-N（仪表盘 tab 用）；保留「无项目行时按 source 兜底」逻辑。
- 每个 entry 增补：
  - `project_id`、`display_name`(应用 `projectMeta.alias` 后)、`pinned`/`hidden`。
  - `agents[]`:`{ source, total_tokens, cost_usd }`(由项目行按 `source` 分组得出——数据已在行里)。
  - 成本四拆分：`api_cost_usd` / `package_cost_usd` / `subscription_cost_usd`(估算) / `custom_cost_usd`,以及 `total_cost_usd`。
  - 时长：`first_active_at` / `active_bucket_count` / `estimated_active_minutes`。

### 新增 `tokentracker-project-detail`（`?project_id=...&from&to`）

返回单项目的：概览（跨度、工时、总成本）、agent 明细、成本四拆分、该项目的自定义成本清单、以及可选的按日时间线（复用既有 daily 聚合）。

### 新增 `tokentracker-project-meta`（GET 全部 / POST upsert）

读写 `projectMeta`（别名、置顶、隐藏、标签）。

### 扩展 `tokentracker-spend-records`

CRUD 接受并回传 `project_id` + `category`;既有调用不传时行为不变。

## 前端（`dashboard/`）

| 区域 | 变更 |
|---|---|
| `dashboard/src/pages/ProjectsPage.jsx`(新建) | 项目列表页：每行 = 别名/文件夹名 + agent 徽标 + 累积花销（估算部分标注）+ 跨度/工时 + 最后活跃；支持排序/搜索/置顶/隐藏；行内重命名与备注 |
| `dashboard/src/pages/ProjectDetailPage.jsx`(新建) | 单项目详情：概览、agent 明细、成本四拆分、自定义成本编辑器（新增服务器/DB/插件费并归属本项目）、可选按日时间线 |
| `dashboard/src/ui/dashboard/components/ProjectUsagePanel.jsx` | 保留仪表盘 tab，新增「查看全部」入口跳转 `/projects` |
| `dashboard/src/hooks/use-project-usage-summary.ts` + 新 hooks | 扩展 summary 类型；新增 project-detail / project-meta / 扩展 spend-records 的 hook |
| `dashboard/src/lib/api.ts` | 新增 `getProjectDetail` / `getProjectMeta` / `upsertProjectMeta`;扩展 `getProjectUsageSummary` 与 spend-records 客户端 |
| `dashboard/src/App.jsx` | 注册 `/projects`、`/projects/:id` 路由（`React.lazy`,遵循既有懒加载约定；`NativeAuthCallbackPage` 例外不改） |
| `dashboard/src/content/copy.csv` | 新增全部用户可见文案键，禁止硬编码 |

## 仓库内落点（仅本仓库）

| 区域 | 变更 |
|---|---|
| `src/lib/rollout.js` | 放宽入队闸门；本地路径身份回退；行内加 `project_id` / `project_path` |
| `src/lib/project-path.js` | 本地 key 规范化、本地项目显示名 |
| `src/lib/local-api.js` | 扩展 project-usage-summary；新增 project-detail、project-meta；扩展 spend-records；四线成本计算 |
| `src/lib/pricing/*` | 复用 `computeRowCostDetailed`;新增预付套餐单价换算辅助（Phase 2） |
| `config.json` 读写（`tracker-config`） | `projectMeta` 段 |
| `dashboard/src/**` | 见上表 |
| 测试 | 接口聚合、parser 本地归集、订阅摊分单测；copy 与 UI 硬编码校验 |

## 错误处理

- 无 git remote / 非 git 目录：走本地路径身份，不再静默丢弃。
- `project_id` 无法解析（极少数无 cwd 场景，如 OpenClaw）：跳过项目归集，不影响主 `queue.jsonl` 统计。
- `projectMeta` / `spendRecords` 读写失败：回退空/默认，不阻断页面；写失败 toast + 回滚。
- 估算项（订阅摊分、套餐单价）在 UI 明确标注「估算」，避免误读为精确账单。

## 分期与工作量

| 阶段 | 内容 | 难度 |
|---|---|---|
| **Phase 1（MVP）** | 本地文件夹归集 + `projectMeta` 别名 + 扩展 summary（agents + 跨度/工时 + API 精确成本）+ 项目列表页 | 低-中 |
| **Phase 2** | 自定义基础设施费（spend-records `project_id`+`category`）+ 订阅按份额摊 + 预付套餐单价 + 项目详情页 | 中 |
| **Phase 3（可选）** | 精确会话时长追踪 | 中-高 |

Phase 1 即可满足核心诉求：列表显示「文件夹名/备注 + 用过的 agent + 累积花销」。

## 验证计划

1. parser：在无 git remote 的本地文件夹里产生使用 → `project.queue.jsonl` 出现 `local:` 身份的行。
2. 接口：project-usage-summary 全量模式返回 `agents[]`、成本四拆分、跨度/工时；无项目行时按 source 兜底不报错。
3. 成本：订阅摊分单测（份额之和 = 该订阅范围内总额，不超发）；自定义费按 `project_id` 正确归集。
4. 别名：`projectMeta` upsert 后列表与详情显示别名。
5. `npm run validate:copy` / UI 硬编码校验通过；相关前端与 `src/` 单测通过。
6. 手动：本地项目出现在列表 → 重命名为「托管项目」→ 加一笔服务器月费归属它 → 项目总额包含该费用且订阅部分标注估算。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 本地路径含用户名/隐私 | 仅本地存储，且与既有 `repo_root` 存储一致，不外传 |
| 订阅摊分被误读为精确账单 | UI 明确「估算」标注；详情页拆分展示精确项与估算项 |
| Windows 路径大小写/分隔符导致 key 不稳定 | 规范化（小写盘符、正斜杠、去尾分隔符）后再作 key |
| 同一文件夹加 remote 后身份切换 | 记录为已知边界，本版不做历史合并 |
| 列表页数据量增大（全量模式） | 服务端聚合 + 分页/上限；仪表盘 tab 仍走 Top-N |

## 实现顺序（供后续计划引用）

1. `rollout.js` 本地归集 + 闸门放宽 + 行字段（Phase 1 基础）。
2. `local-api.js` 扩展 summary（agents + 跨度/工时 + API 成本）+ `projectMeta` CRUD。
3. Dashboard：项目列表页 + 文案 + 路由 + hooks/api。
4. Phase 2：spend-records 扩展 + 订阅摊分 + 套餐单价 + 详情页。
5. Phase 3（可选）：精确会话时长。
