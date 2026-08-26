# Token Eyes 0.54.48 兼容性收口实施与验收计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task in the existing worktree. Do not create a subagent, branch, or worktree unless the user later gives separate explicit authorization.

**目标：** 在 `main@0.54.47` 的全部既有能力不减少的前提下，只新增【价值对比】和【实时会话】，并选择性保留已经证明有增量价值的数据、授权与可靠性改进，最终产出源码与安装内容可追溯的 `0.54.48` Windows EXE。

**架构：** 以 `main@7445f02ba42b753625b005d54f48b1250035463d` 为兼容基线，在现有 `codex/value-realtime-ui-05447` 分支内逐项恢复旧页面和旧 API 合同；新增页面使用独立视图模型和安全投影，不反向削弱旧页面。执行分为合同锁定、源码调整、第一审、第二审和最终制品双审，任一验收行缺少当前 SHA 的直接证据都阻断交付。

**技术栈：** Node.js/CommonJS、React/Vite、Tauri/Rust、Node Test Runner、Vitest、Playwright、NSIS Windows 安装器。

---

## 1. 固定边界

### 1.1 Git 与工作区

- 唯一工作树：`D:\04-AI-Project\010-Token eye\.worktrees\value-realtime-ui-05447`
- 唯一调整分支：`codex/value-realtime-ui-05447`
- 当前审计起点：`736c8ba94e6313b8eb879d63c2e678f04aa9d495`
- 0.54.47 兼容基线：`7445f02ba42b753625b005d54f48b1250035463d`
- 本地 `main` 指针不是基线依据；2026-08-26 执行时本地 `main=993da2785cf7d61379fa2ec0d11ebea8e9428d71`（0.54.44、落后远端），远端 `main=7445f02b...`。所有对照命令必须使用上述完整基线 SHA，禁止使用可移动或陈旧的 `main` 名称。
- 禁止创建新分支、新工作树或所谓“纠偏分支”。
- 禁止执行 `reset`、`clean`、`checkout`、`switch`、`stash` 或删除现有未跟踪证据。
- 当前 `design-qa.md` 修改和 `.codex-artifacts/` 未跟踪文件视为既有现场；本计划不得覆盖或清理。
- 提交、推送、合并、安装、卸载和清理分支分别需要独立授权，本计划不自动授权这些动作。

### 1.2 “不得减少”的判定

以下任一变化均视为相对 0.54.47 的减损，除非用户逐项明确同意：

- 页面、入口、按钮、字段、账户名称、错误详情、筛选项或状态消失。
- 原来可执行的操作变成禁用、隐藏、只读或需要更多步骤。
- 原来能区分的真实状态被合并，例如账户名称退化为“已绑定”。
- 未知、未记录、读取失败被显示成真实 `0`、空白或破折号。
- 旧 API 字段被删除、改名、改类型或被无差别脱敏，导致旧页面信息减少。
- 刷新、重载、重启、升级安装后状态或数据丢失。
- 全局窗口尺寸、滚动、布局密度或交互方式改变，导致旧页面显示或操作退化。
- 错误诊断从具体可处理信息退化为笼统失败文案。
- 数据迁移造成来源丢失、重复计数、金额与 Token 混淆或第二次同步继续变化。

以下变化允许作为增量，但必须有独立验收行：

- 旧能力完整保留的同时增加新信息、新状态或更准确的数据归因。
- 修正明确的重复计数、错误归因或未知值伪装为零。
- 增加不改变正常路径的安全校验、失败恢复或瞬时重试。
- 新页面专用的缓存、视图模型、安全投影和历史读取。

## 2. 证据与状态规则

### 2.1 唯一允许的状态

- `未执行`：尚无当前 SHA 的直接证据。
- `通过`：预期结果和负向条件都有当前 SHA 的直接证据。
- `失败`：观察到任一不匹配，必须修复后重开相关验收域。
- `阻塞`：缺少真实运行时、安装权限、账号或外部能力；不得改称通过。
- `不适用`：只有合同本身明确说明不适用原因时才能使用。

禁止使用任何未列入上述白名单的模糊状态或推测性结论。

### 2.2 每条证据必须记录

- 工作树、分支、完整 HEAD、构建时间和版本。
- 运行层：源码测试、开发页面、生产 bundle、打包 EXE、已安装应用中的哪一层。
- 页面路由、窗口尺寸、缩放、主题、数据状态和用户操作。
- 截图、几何数据、API 安全快照、日志或测试输出的绝对路径。
- 正常结果和明确的负向条件；只有正向截图不算完整证据。

### 2.3 无效证据

- 旧 SHA、旧服务器、旧截图、旧安装包或无法对应源码的运行时。
- 只证明 mock 被调用、进程启动、构建完成、文件存在或 manifest 存在。
- 用单元测试证明真实页面视觉、浏览器授权、持久化或安装版操作可用。
- 第一审重复使用同一截图充当第二审。
- 让用户安装未验证候选包来替代代理完成最终验收。

### 2.4 合同冻结与变更

- 本文档完成自审后先交由用户确认；用户明确确认前不得修改业务代码。
- 用户确认后，所有验收行进入冻结状态。执行者不得在实现中自行缩小、合并或重新解释验收行。
- 新发现若只是实现细节，补充到现有验收行；若改变用户可见结果，必须新增或修改验收行并再次取得用户确认后才能继续。
- 文档修订必须保留“用户原话、变更原因、受影响 ID、确认时间”，禁止直接覆盖旧结论而不留下记录。
- 任何执行总结都必须从本表读取状态，不能凭记忆或聊天中的临时判断宣布完成。

## 3. 逐项验收合同

执行过程中在“状态”列填入唯一允许的状态，并在“证据”列写入当前证据路径。初始状态全部为 `未执行`。

### 3.1 来源与制品

| ID | 初始状态与操作 | 预期结果 | 禁止出现 | 状态 | 证据 |
|---|---|---|---|---|---|
| SRC-01 | 开始每个调整波次前读取工作树、分支、HEAD、status | 始终是本计划固定的工作树和分支；既有脏文件完整保留 | 新分支、新工作树、清理或覆盖既有文件 | 通过 | `.codex-artifacts/05448-acceptance/source-state-round-01.txt` |
| SRC-02 | 对比 `7445f02ba42b753625b005d54f48b1250035463d..HEAD` 的文件和行级差异 | 每一处非新页面差异都被标记为“恢复基线”或某个 KEEP 验收 ID | 无验收 ID 的顺手修改、重构或格式化 | 通过 | `.codex-artifacts/05448-acceptance/diff-inventory.md` |
| SRC-03 | 从最终已确认 SHA 构建 0.54.48 | 源码 SHA、版本、runtime manifest、EXE SHA-256 一一对应 | dirty build、manifest 只记录 HEAD 但遗漏未提交内容 | 通过 | `.codex-artifacts/05448-acceptance/artifact-provenance.json` |

### 3.2 0.54.47 旧页面兼容合同

| ID | 页面/运行时 | 正常用户操作 | 预期可见结果 | 禁止出现 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| OLD-01 | Windows 主窗口，启动尺寸 `1586×932`，最小尺寸 `900×600` | 启动、缩小、恢复、切换旧页面 | 尺寸、滚动和旧页面可用区域与 0.54.47 一致 | 全局高度变成 `970`、内容遮挡或额外滚动 | 通过 | `.codex-artifacts/05448-acceptance/dev-round-10-final-interaction-a/old-pages/report.json`; `.codex-artifacts/05448-acceptance/dev-round-11-final-interaction-b/old-pages/report.json` |
| OLD-02 | `/dashboard` 首页 | 切换时间范围、Agent、刷新、打开已有详情 | 卡片、趋势、热力图、Agent、Token、成本和详情入口不少于 0.54.47 | 字段消失、真实未知变成 0、布局被新页面 CSS 污染 | 通过 | 同 OLD-01；`.codex-artifacts/05448-acceptance/installed-final-parity-round-1/` |
| OLD-03 | `/spend/usage` 用量页 | 切换筛选、查看请求和展开详情 | 原有来源、模型、请求、Token 组成和筛选全部保留 | DSH/Hermes 迁移后重复、请求详情减少 | 通过 | 同 OLD-01；`.codex-artifacts/05448-acceptance/installed-baseline-05447-real-usage-capture/` |
| OLD-04 | `/spend/cost` 成本页 | 切换月份、展开各成本组、刷新 | 现金支出、API 估算、订阅成本、余额和未知状态语义保持分离 | 将套餐额度当现金、未知显示 `$0.00`、旧组消失 | 通过 | 同 OLD-01；`.codex-artifacts/05448-acceptance/installed-final-parity-round-2/` |
| OLD-05 | `/spend/plans` 套餐市场 | 搜索、筛选、查看套餐、进入配置 | 0.54.47 原有套餐、链接、标签和操作保留；允许增加经核验信息 | 套餐减少、入口失效、价格来源混淆 | 通过 | 同 OLD-01 |
| OLD-06 | `/settings/basic` 基础设置 | 修改可逆设置、刷新、离开返回、重启 | 原设置项、默认值、保存和恢复行为不减少 | 设置消失或不持久化 | 通过 | 同 OLD-01；`.codex-artifacts/05448-acceptance/artifact-provenance.json`（升级前后配置哈希一致） |
| OLD-07 | `/settings/cost` Token Plan 列表 | 查看账户、切换完整邮箱、刷新、排序、展开状态 | 账户名称/脱敏邮箱、完整邮箱开关、成本、有效期、额度、具体错误和排序全部保留 | 只显示“已绑定/未绑定”、开关消失、错误被泛化 | 通过 | 同 OLD-01；`.codex-artifacts/05448-acceptance/keep-api-security/test-results.txt` |
| OLD-08 | `/settings/cost/token-plans/new` 与编辑路由 | 新建、编辑、保存、取消、刷新、删除测试记录 | 0.54.47 支持的 Provider、字段和操作全部可用；增加的授权能力不得破坏旧 Provider | 字段被脱敏到无法编辑、取消后残留监听、删除错误账户 | 通过 | 同 OLD-01；`.codex-artifacts/05448-acceptance/installed-final-parity-round-1/` |
| OLD-09 | `/settings/data` 数据源 | 查看路径、健康状态、刷新和已有操作 | 数据源清单、路径、状态、诊断和操作不少于 0.54.47 | 诊断信息减少、来源顺序或开关丢失 | 通过 | 同 OLD-01 |
| OLD-10 | `/reset-history` 重置历史 | 查看列表、筛选、刷新 | 既有事件、状态、时间和恢复信息完整 | 历史被新聚合逻辑隐藏或显示假零 | 通过 | 同 OLD-01 |
| OLD-11 | `/widgets` 组件管理 | 查看组件、筛选 Agent、编辑 Token Plan 组件 | 账户标签、套餐、额度、筛选和保存行为不减少 | 账户名称退化成账户状态、DSH/WorkBuddy 过滤丢失 | 通过 | 同 OLD-01；`.codex-artifacts/05448-acceptance/installed-final-parity-round-2/` |
| OLD-12 | `/desktop-widget` 桌面组件 | 打开设置、切换 Agent、刷新、重启 | 账户标签、选中状态、数据、持久化和恢复与 0.54.47 一致或只增加 | 账户标签消失、重启后选择丢失 | 通过 | 同 OLD-01；`.codex-artifacts/05448-acceptance/installed-final-parity-round-1/`; `.codex-artifacts/05448-acceptance/installed-final-parity-round-2/` |
| OLD-13 | `/leaderboard`、规则与个人资料路由 | 导航、筛选、打开资料、返回 | 原公开页面、筛选和导航保持可用 | 新路由或共享 CSS 破坏旧页面 | 通过 | 同 OLD-01 |
| OLD-14 | `/first-run` 与旧重定向路由 | 首次进入、完成、重启；访问 `/spend`、`/settings`、`/data-sources` | 首次运行状态和重定向目标与 0.54.47 一致 | 新页面改变首次运行或根路由 | 通过 | 同 OLD-01 |
| OLD-15 | 旧 Token Plan 与 Console Session 本地 API | 以可信本地应用来源读取并完成旧页面旅程 | 旧页面需要的账户、session、错误、额度和状态字段仍存在；秘密仍不外泄 | 无差别安全投影导致旧页面字段减少，或跨来源泄密 | 通过 | `.codex-artifacts/05448-acceptance/keep-api-security/test-results.txt`; 同 OLD-01 |

### 3.3 值得保留的非页面增量

| ID | 增量 | 操作与初始状态 | 预期结果 | 禁止出现 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| KEEP-01 | DeepSeek Harness 归因升级 | 使用包含 `request/context`、推理 Token、旧 cursor、瞬时读取失败的固定 fixture；连续同步两次 | 识别 `api_key`/`deepseek`，补回纯推理，迁移一次，第二次总量不变 | 重复计数、旧来源丢失、失败文件被错误标记完成 | 通过 | `.codex-artifacts/05448-acceptance/keep-dsh/test-results.txt` |
| KEEP-02 | Hermes 归因升级 | 使用默认/命名 profile、活动 session、旧 attribution fixture；连续同步两次 | Provider、billing mode、推理和 billable totals 正确，迁移幂等 | 活动 session 重复、旧 unknown 无证据拆分 | 通过 | `.codex-artifacts/05448-acceptance/keep-hermes/test-results.txt` |
| KEEP-03 | WorkBuddy Credits 语义 | 覆盖未知容量、真实 0、正常额度、失败、同日下降、补充额度和跨日 | 单位为 Credits；未知不变 0；真实 0 保留；失败不影响其他 Provider | 公开价格换算、伪造 Token/美元、删除旧账户显示 | 通过 | `.codex-artifacts/05448-acceptance/keep-workbuddy/test-results.txt` |
| KEEP-04 | Trae 授权可靠性 | 覆盖正确/错误 state、fragment、失败回调、取消、超时、断线；真实链路需另行授权 | 状态校验、取消清理、失败语义和已授权状态保持正确 | 额度失败撤销授权、监听器残留、账户误删 | 通过 | `.codex-artifacts/05448-acceptance/keep-trae/test-results.txt` |
| KEEP-05 | Provider 授权矩阵与 Agent Registry | 对照实际 Tauri command、旧 Agent 顺序和名称 | 矩阵只描述真实能力；集中注册后所有旧消费者输出不减少 | 因矩阵隐藏 0.54.47 可用操作、Agent 消失或改名 | 通过 | `.codex-artifacts/05448-acceptance/keep-registry/test-results.txt` |
| KEEP-06 | 静态资源和 Windows 复制可靠性 | 请求缺失 hash asset、模拟发布中资源、模拟 `EBUSY/EPERM` | 缺失 asset 返回 404；发布中短暂等待；复制有限重试 | SPA HTML 冒充 JS、无限重试、旧 chunk 永久堆积 | 通过 | `.codex-artifacts/05448-acceptance/keep-runtime/test-results.txt` |
| KEEP-07 | API 安全边界 | 分别从可信本地来源、允许的 loopback 来源和禁止来源请求 | 可信旧 UI 获得兼容字段；新页面只获安全投影；禁止来源被拒绝 | 为安全而削弱旧 UI，或为兼容而泄露秘密 | 通过 | `.codex-artifacts/05448-acceptance/keep-api-security/test-results.txt` |

### 3.4 两个新增页面

| ID | 页面 | 正常用户操作 | 预期可见结果 | 禁止出现 | 状态 | 证据 |
|---|---|---|---|---|---|---|
| NEW-01 | `/spend/value-comparison` | 首次进入、切换周期/月、展开证据、刷新、离开返回 | 真实来源、单位、证据状态、API 等价值、订阅现金和不可用原因清楚分离；缓存不阻塞切换 | 设计稿数字、公开价格冒充账单、未知显示 0、隐私内容 | 通过 | `.codex-artifacts/05448-acceptance/dev-round-7-final-sha-a/new-pages/report.json`; `.codex-artifacts/05448-acceptance/dev-round-8-final-sha-b/new-pages/report.json` |
| NEW-02 | `/spend/realtime-sessions` | 查看请求/会话/Agent/覆盖率，切换标签和周期，刷新、失败恢复 | 生命周期、来源、模型、Token、状态和覆盖证据正确；持续轮询不阻断页面 | lifecycle-only 显示 unknown、提示词/消息正文/秘密泄露 | 通过 | 同 NEW-01 |
| NEW-03 | 响应式和密度 | 在 `1586×932`、`1280×760`，分别使用 0/1/2/5/10 项与长文本/错误状态 | 无水平溢出、遮挡、卡片畸变或不可达控件 | 只验空状态或单一截图 | 通过 | 同 NEW-01；对应目录 `density/` 截图与 JSON |
| NEW-04 | 缓存和失败恢复 | 先取得成功数据，再模拟单端点失败、恢复并刷新 | 保留最后一次成功数据并标记 stale；一个 Provider 失败不清空其他数据 | 失败后整页空白、旧数据冒充实时数据 | 通过 | 同 NEW-01（`preservedAfterFailure`、`recovered`） |

## 4. 实施任务与阻断门

### Task 1：锁定差异清单，不改业务代码

**文件：**

- 修改：`docs/superpowers/plans/2026-08-26-05448-compatibility-acceptance-plan.md`
- 创建证据：`.codex-artifacts/05448-acceptance/diff-inventory.md`

- [x] **Step 1：记录工作区基线**

  运行：

  ```powershell
  git branch --show-current
  git rev-parse HEAD
  git status --short --branch
  git rev-parse 7445f02ba42b753625b005d54f48b1250035463d^{commit}
  git ls-remote origin refs/heads/main
  ```

  预期：分支为 `codex/value-realtime-ui-05447`，HEAD 为当前执行起点，精确基线与远端 `main` 均为 `7445f02ba42b753625b005d54f48b1250035463d`；既有脏文件被记录但不修改。不得因为本地 `main` 陈旧而移动它或切换工作树。

- [x] **Step 2：为全部差异分配验收 ID**

  运行：

  ```powershell
  git diff --name-status 7445f02ba42b753625b005d54f48b1250035463d..HEAD
  git diff --stat 7445f02ba42b753625b005d54f48b1250035463d..HEAD
  ```

  将每个文件标为 `NEW-*`、`KEEP-*`、`OLD-* restore` 或 `docs/tests only`。预期：不存在“顺便保留”或“暂时不管”的文件。

- [x] **Step 3：执行计划自审**

  检查用户全部要求是否有验收行，搜索含糊状态词：

  ```powershell
  $forbidden = @('基本' + '通过', '大' + '致', '理论' + '可用', 'T' + 'BD', 'TO' + 'DO', '以后' + '再说')
  Select-String -LiteralPath docs/superpowers/plans/2026-08-26-05448-compatibility-acceptance-plan.md -Pattern $forbidden
  ```

  预期：无匹配。

- [x] **Step 4：取得用户对合同的明确确认**

  用户已通过目标模式明确要求“按已确认的0.54.48兼容性收口计划执行，直到产出并验收最终EXE”，合同自该消息起冻结并进入 Task 2。

### Task 2：先用测试锁住 0.54.47 不得减少的合同

**重点测试文件：**

- `dashboard/src/components/settings/TokenPlanSection.test.jsx`
- `dashboard/src/ui/dashboard/components/TokenServiceList.test.jsx`
- `dashboard/src/pages/WidgetsPage.test.jsx`
- `dashboard/src/pages/DesktopWidgetPage.test.tsx`
- `test/token-plans-api.test.js`
- `test/token-plan-console-sessions.test.js`
- `test/workbuddy-quota.test.js`
- `test/provider-capabilities-registry.test.js`
- `test/token-eyes-desktop-shell-contract.test.js`

- [x] **Step 1：恢复或新增旧能力断言**

  断言必须覆盖账户标签、完整邮箱开关、具体错误、旧 API 字段、组件账户标签和 `1586×932` 窗口；不得删除或反转 0.54.47 的产品断言。

- [x] **Step 2：运行测试并确认当前实现暴露真实失败**

  预期：凡当前实现已经造成减损的合同测试应先失败；不得为了绿色弱化断言。

- [x] **Step 3：记录 RED 证据**

  将失败名称和对应 `OLD-*` ID 写入 `.codex-artifacts/05448-acceptance/contract-red.txt`。

  RED 证据已记录；四组定向测试分别稳定暴露窗口、账户标签、完整邮箱、WorkBuddy 账户信息和可信本地 API 兼容字段的减损，同时其余相关断言继续通过。

### Task 3：恢复旧页面和旧 API 合同

**主要修改范围：**

- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/ui/dashboard/components/TokenServiceList.jsx`
- `dashboard/src/pages/WidgetsPage.jsx`
- `dashboard/src/pages/DesktopWidgetPage.tsx`
- `src/lib/widget-view-model.js`
- `src/lib/local-api.js`
- `src/lib/workbuddy-quota.js`
- `src-tauri/tauri.conf.json`
- `src-tauri/tauri.windows.conf.json`

- [x] **Step 1：恢复账户身份和旧 UI 控件**
- [x] **Step 2：恢复可信本地旧 API 的兼容字段，同时保留秘密过滤**
- [x] **Step 3：恢复旧窗口尺寸和旧组件数据合同**
- [x] **Step 4：逐组运行 Task 2 测试直到 GREEN**
- [x] **Step 5：运行 `git diff --check` 并更新 OLD 验收状态；没有页面证据时仍保持 `未执行`**

### Task 4：隔离并保留增量改进

**主要修改范围：**

- `src/lib/rollout.js`
- `src/lib/workbuddy-quota.js`
- `src-tauri/src/trae_session.rs`
- `shared/provider-capabilities.json`
- `shared/agent-registry.json`
- `src/commands/init.js`
- `src/commands/serve.js`
- `dashboard/vite.config.js`

- [x] **Step 1：保留 KEEP-01 至 KEEP-05 的定向测试并连续同步两次**
- [x] **Step 2：把安全投影限制到新页面或不可信来源，旧 UI 使用兼容投影**
- [x] **Step 3：保留 asset 404 与有限复制重试，取消 `emptyOutDir: false` 和运行时旧 chunk 永久堆积**
- [x] **Step 4：运行 KEEP 定向测试并把输出保存到各自证据目录**

### Task 5：第一审——逐条合同与源码/开发运行时核对

- [x] **Step 1：运行 focused tests、dashboard typecheck/build、Rust 定向测试和 `git diff --check`**
- [x] **Step 2：用同一脱敏数据快照运行 0.54.47 参考和当前候选，按 OLD-01 至 OLD-15 同视口并排核对**
- [x] **Step 3：按 NEW-01 至 NEW-04 使用正常鼠标/键盘完成全状态旅程**
- [x] **Step 4：视觉检查所有截图，不仅检查像素或几何 JSON**
- [x] **Step 5：任何失败触发修复；修复后重新执行该页面全部 OLD/NEW 行及其相邻页面，不只重拍局部截图**

源码/生产 bundle 第一审证据：`.codex-artifacts/05448-acceptance/dev-round-5-precommit-review-a/`。该结论只适用于未提交源码快照及记录的精确 bundle；最终合同状态仍须等待提交 SHA 与安装版双审。

第一审只回答：“实现是否逐项满足合同？”通过后仍不得打包交付。

### Task 6：第二审——从 fresh 进程重新以用户方式核对

- [x] **Step 1：停止第一审服务，重新启动生产 bundle 和全新浏览器/应用进程**
- [x] **Step 2：不读取第一审结论，从入口重新执行 OLD、KEEP 和 NEW 的关键旅程**
- [x] **Step 3：重点反证字段是否减少、状态是否合并、刷新/返回/重载/重启是否丢失、第二次同步是否重复**
- [x] **Step 4：生成与第一审独立的截图、API 快照和日志**
- [x] **Step 5：第二审失败时撤销第一审通过状态，修复后两审都必须完整重跑**

fresh 进程第二审证据：`.codex-artifacts/05448-acceptance/dev-round-6-precommit-review-b/`；综合摘要：`.codex-artifacts/05448-acceptance/source-browser-audit-summary.md`。Task 7 的最终来源绑定、升级安装和两次独立安装版核对证据见 `.codex-artifacts/05448-acceptance/artifact-provenance.json` 与 `installed-final-parity-round-{1,2}/`。

第二审只回答：“真实用户重新使用时，代码中声称已实现的结果是否确实出现且没有退化？”

### Task 7：最终 EXE 来源绑定与安装版双审

只有在用户另行授权安装/卸载后执行。

- [x] **Step 1：确认工作区可构建状态，记录精确 SHA；不得从未记录 dirty 内容构建候选**
- [x] **Step 2：从该 SHA 构建 0.54.48，记录 EXE SHA-256、manifest 和 bundle 文件清单**
- [x] **Step 3：安装版第一审：从 0.54.47 升级，验证旧设置/账户/数据保留并完成关键 OLD/NEW 旅程**
- [x] **Step 4：安装版第二审：完全退出并重启已安装应用，从入口重新核对窗口、旧页面、新页面、刷新和持久化**
- [x] **Step 5：核对安装目录内容与构建 manifest；发现 stale chunk、SHA 不一致或旧 runtime 即判失败**
- [x] **Step 6：所有验收行均为通过后，才允许把精确 EXE 描述为 0.54.48 验收候选**

网页登录/OAuth 不包含在上述安装版输入中。KEEP-04 的当前“通过”仅指本地 state、fragment、取消、超时、断线和错误语义合同；真实网页登录链路按用户 2026-08-26 指示延期，未打开登录页、未触发授权，也未用替代证据声称登录成功。

## 5. 防止“执行中做偏”的强制机制

1. **先 RED 后实现：** 旧能力减损必须先由合同测试暴露，不能靠实现者记忆。
2. **每个改动绑定验收 ID：** 找不到对应 ID 的改动不得保留。
3. **反证审查：** 每轮专门寻找“少了什么、合并了什么、隐藏了什么、第二次是否变化”，而不是只确认新增页面能打开。
4. **两次独立核对：** 第二审必须 fresh 进程、fresh 导航和独立证据，不能继承第一审结论。
5. **失败扩大重测范围：** 修复一个局部问题后，重新核对整页、相邻共享组件和对应 API，而不是只看修复点。
6. **制品重新开始：** 源码/开发页面通过后，最终 EXE 仍从零执行两审；安装成功不等于功能通过。
7. **严格措辞：** 在全部验收行通过前，只能报告“源码已调整”“定向测试通过”“第一审失败/通过”“第二审未执行”等分层事实。
8. **停止线：** 一旦出现未授权分支/工作树、旧能力减损、证据 SHA 不一致或真实链路不可执行，立即停止继续扩展并报告，不用更多代码掩盖问题。

## 6. 最终交付报告格式

最终报告必须逐层列出：

- 固定工作树、分支、最终 HEAD 和与 main 的关系。
- 哪些旧页面恢复为 0.54.47，证据分别在哪里。
- 哪些非页面增量被保留，以及为什么不构成减损。
- 两个新页面的正常、空、密集、错误、刷新和重启结果。
- focused tests、full tests、typecheck、build、Rust、开发运行时、生产 bundle、EXE、安装版分别是什么状态。
- 第一审和第二审的独立证据目录。
- EXE 路径、SHA-256、源码 SHA、runtime manifest 和安装后 manifest。
- 所有失败、阻塞和残余风险；存在任何未通过行时不得提供“已完成/可安装”的结论。
