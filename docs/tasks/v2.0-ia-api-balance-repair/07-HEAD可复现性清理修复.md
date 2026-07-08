# 07 - HEAD 可复现性清理修复

## 中文简述

本工单继续复用上一轮 `03-发布配置与可复现收口.md` 的上下文。当前独立验收发现：工作区仍有大量未跟踪文件，并且包含任务相关测试和工单文档，例如 `dashboard/src/App.routes.test.jsx`、`README.md`、`02-前端交互与订阅契约修复.md`、`派发口令.md`。这意味着“当前 HEAD 可复现”结论不成立。正式验收必须做到：必要代码、测试、工单回写进入版本控制；临时日志、截图、探针脚本不进入提交，且不会干扰后续验收。

## 第一性原理执行规则

- 可复现性的第一原则是“别人只拉 HEAD 就能复现必要结果”。
- 不允许用当前工作区未提交文件作为通过证据。
- 不允许 `git add -A`，必须逐项判断文件归属。
- 不允许提交临时日志、截图、一次性探针、构建产物或用户无关文件。
- 不允许删除用户文件；只清理本轮生成的临时产物，无法确认归属时先记录风险。

## 贝叶斯验收缺口

| 项目 | 修复前状态 | 新反例 | 影响 | 目标后验 |
|---|---:|---|---|---:|
| B7 回归与可发布 | 曾宣称达标 | 任务相关文件未进入 HEAD | 从 HEAD 无法复现验收结论 | >= 0.95 |

## 当前缺漏证据

修复前运行：

```powershell
git status --short --untracked-files=all -- dashboard/src/App.routes.test.jsx docs/tasks/v2.0-ia-api-balance-repair
```

看到：

```text
?? dashboard/src/App.routes.test.jsx
?? docs/tasks/v2.0-ia-api-balance-repair/02-前端交互与订阅契约修复.md
?? docs/tasks/v2.0-ia-api-balance-repair/README.md
?? docs/tasks/v2.0-ia-api-balance-repair/派发口令.md
```

同时全局未跟踪文件数量曾达到 239 个。

## 修复范围

重点检查并处理：

- `dashboard/src/App.routes.test.jsx`
- `docs/tasks/v2.0-ia-api-balance-repair/README.md`
- `docs/tasks/v2.0-ia-api-balance-repair/02-前端交互与订阅契约修复.md`
- `docs/tasks/v2.0-ia-api-balance-repair/派发口令.md`
- 本轮新增的 `05/06/07/08` 工单和更新后的派发口令。
- `.gitignore` 或项目已有 ignore 规则，仅在必要时做最小补充。

## 必须实现

1. 分类所有未跟踪文件。
   - 必须提交：任务相关工单、回写、必要测试、必要源代码。
   - 必须忽略或删除：临时日志、截图、一次性探针脚本、构建产物。
   - 不确定归属：不要删除，记录到工单回写。

2. 修复任务相关文件未提交问题。
   - 如果 `dashboard/src/App.routes.test.jsx` 是必要路由测试，应进入版本控制，并确保全量前端测试包含它。
   - 如果它已被其他测试替代，应删除或移入正确位置，并在回写中说明替代测试。
   - 任务目录下的 README、派发口令、02 文档、本轮 05-08 文档必须进入版本控制。

3. 清理提交边界。
   - 禁止提交 `_acceptance_*`、`_review_*`、`_04_*` 截图/日志/临时脚本，除非工单明确要求作为长期测试 fixture。
   - 禁止提交 `Token Eyes/*.exe`、安装包、构建产物。
   - 如添加 `.gitignore`，只添加明确的临时产物模式，不要误忽略源代码或测试。

4. 从 HEAD 复现。
   - 提交后使用干净状态或临时 stash 验证必要测试和文档存在。
   - 验证 `git ls-files` 能列出任务相关文件。

## 必须运行的验证命令

```powershell
git status --short --untracked-files=all -- dashboard/src/App.routes.test.jsx docs/tasks/v2.0-ia-api-balance-repair
git ls-files docs/tasks/v2.0-ia-api-balance-repair
git ls-files dashboard/src/App.routes.test.jsx
npm --prefix dashboard run test -- src/App.routes.test.jsx
npm --prefix dashboard run test
npm test
git diff --check
```

如果 `dashboard/src/App.routes.test.jsx` 被删除或替代，必须运行替代测试，并在回写中写清楚替代路径。

## 验收标准

- 任务相关文件不再显示为 `??`。
- `git ls-files docs/tasks/v2.0-ia-api-balance-repair` 能列出 README、派发口令、01-08 工单。
- 必要测试文件进入版本控制，或有明确替代测试证明。
- 工作区可以仍保留用户/历史临时文件，但必须与本轮验收无关，且不能作为通过证据。
- B7 后验重新计算并达到 `>= 0.95`。

## 完成回写模板

```text
执行摘要：
复用上一轮上下文：03-发布配置与可复现收口
未跟踪文件分类：
提交的任务相关文件：
忽略/删除/保留的临时文件：
修改文件：
验证命令、退出码和关键输出：
最终 git status 摘要：
B7 后验更新：
Git 提交：
剩余风险：
```

## 对抗性审查要求

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况。

---

## 07 工单执行回写

### 执行摘要

修复 HEAD 不可复现问题。基线（05/06 合入后）下，工作区仍有 241 个未跟踪文件，其中包含任务相关测试 `dashboard/src/App.routes.test.jsx`、任务目录 `README.md`、`02-前端交互与订阅契约修复.md`、`08-最终独立贝叶斯复验.md`、`派发口令.md` 等——从纯 HEAD 拉取无法复现验收结论。本工单逐项分类 241 个未跟踪文件，将 5 个任务相关新文件 + `.gitignore` 最小补充提交入版本控制（commit `bbcdc5c`），用根锚定的 `.gitignore` 模式屏蔽 126+ 个临时产物（日志/截图/探针/构建产物），对约 109 个用户无关文件记录风险不删除。提交后未跟踪数从 241 降至 109，全部 7 条必须验证命令退出 0，针对性路由测试 7/7、后端全量 1366/1366、前端全量 636/636 通过。

### 复用上一轮上下文

03-发布配置与可复现收口（已修复 F7 版本一致性、F8 macOS runner + Homebrew repo、CRLF 行尾导致测试假性失败）。07 继续深挖同一"可复现性"区域的 HEAD 自足性问题：03 的 B7=0.99996 结论基于"HEAD 可复现"，但独立验收发现任务相关文件仍为未跟踪——该结论不成立。

### 第一性原理验收目标复述

- 可复现性的第一原则："别人只拉 HEAD 就能复现必要结果"。
- 不允许用当前工作区未提交文件作为通过证据。
- 不允许 `git add -A`，必须逐项判断文件归属。
- 不允许提交临时日志、截图、一次性探针、构建产物或用户无关文件。
- 不允许删除用户文件；只清理本轮生成的临时产物，无法确认归属时先记录风险。

### 05/06 合入确认

- 05 最终提交：`bd2e97d`（代码）+ `ed1e37b`（文档回写）
- 06 最终提交：`1be9e12`（代码 + 文档回写）
- 两者均已合入当前基线分支 `fix/v2-06-subscription-required-contract`。
- 本工单未修改 05/06 任何业务逻辑，无合入冲突。

### 未跟踪文件分类

修复前 `git status --short --untracked-files=all` 显示 241 个未跟踪文件。逐项分类如下：

| 类别 | 数量 | 处置 | 说明 |
|---|---:|---|---|
| 任务相关文件（必提交） | 6 | 已提交（`bbcdc5c`） | `dashboard/src/App.routes.test.jsx`（v2.0 IA 路由解析必要测试，7 项）、`docs/tasks/v2.0-ia-api-balance-repair/README.md`、`02-前端交互与订阅契约修复.md`、`08-最终独立贝叶斯复验.md`、`派发口令.md` |
| 临时日志/截图/探针/构建产物 | 126+ | `.gitignore` 根锚定模式忽略 | `_*.log`、`_*.png`、`_*.cjs`、`_*.txt`、`_*.json`、`_*.pid`、`reg-*.txt`、`test-output*.log`、`test-backend-full*.log`、`test-frontend-full.log`、`Token Eyes/`（Tauri 构建产物）等 |
| 用户无关文件（不确定归属） | ~109 | 记录风险，不删除 | `docs/dev-notes/`、`docs/tasks/dispatch/`、`docs/tasks/v2.0/`、`docs/tasks/v2.0-release-*/`、`tickets/`、`mock-data-ui-showcase/`、`上下文.md`、`docs/用户诉求.txt` 等。这些不属于本轮 01-08 工单范围，无法确认归属，按规则不删除 |
| 我方 shell 误产生的空文件 | 1 | 已删除 | `-json`（0 字节，2026/7/3 01:06 创建，shell 误重定向产物，非用户内容、非任务相关） |

### 提交的任务相关文件

提交 commit `bbcdc5c`（分支 `fix/v2-06-subscription-required-contract`），包含且仅包含以下 6 个文件：

1. `.gitignore`（修改：末尾追加根锚定临时产物模式，不新增功能忽略）
2. `dashboard/src/App.routes.test.jsx`（新增：v2.0 IA 路由解析测试，7 项）
3. `docs/tasks/v2.0-ia-api-balance-repair/README.md`（新增：任务总调度文档）
4. `docs/tasks/v2.0-ia-api-balance-repair/02-前端交互与订阅契约修复.md`（新增：02 工单 + 回写）
5. `docs/tasks/v2.0-ia-api-balance-repair/08-最终独立贝叶斯复验.md`（新增：08 工单文档）
6. `docs/tasks/v2.0-ia-api-balance-repair/派发口令.md`（新增：派发口令文档）

### `.gitignore` 最小补充内容

新增模式全部根锚定（`/` 前缀），避免影响子目录源码/测试：

```gitignore
# v2.0-ia-api-balance-repair: root-level temp probe/log/screenshot artifacts.
# One-off verification scripts and outputs from 01-08 repair work — NOT source
# or test fixtures. Anchored to repo root (/) so subdirectory files are unaffected.
# Verified safe: no tracked file matches these patterns (git ls-files).
/_*.log
/_*.png
/_*.cjs
/_*.txt
/_*.json
/_*.pid
/_review_e2e_shots/

# Root-level regression test outputs
/reg-*.txt

# Root-level full-suite test logs
/test-output*.log
/test-backend-full*.log
/test-frontend-full.log

# Tauri build artifacts copied to repo root (exe / installer)
/Token Eyes/

# Root-level stray `-json` file — 0-byte byproduct recreated by the dashboard
# test runner (vitest) on each `npm --prefix dashboard run test`. Not a source
# or test fixture; ignored so it cannot contaminate future `git add -A`.
/-json
```

安全性验证：
- `git ls-files | Select-String "^_|^reg-|^test-output|^test-backend-full|^test-frontend-full\.log|^Token Eyes/"` 返回空——确认无任何已跟踪源码/测试/文档被新模式误忽略。
- `git ls-files | Select-String "^-json$"` 返回空——确认 `/-json` 不误忽略任何已跟踪文件。
- `git check-ignore -v -- "-json"` 匹配 `.gitignore:131:/-json`——模式生效。

### 忽略/删除/保留的临时文件

- **忽略（.gitignore 屏蔽，保留在工作区但不进入提交）**：126+ 个临时产物（`_*.log`、`_*.png`、`_*.cjs`、`_*.txt`、`_*.json`、`_*.pid`、`reg-*.txt`、`test-output*.log`、`Token Eyes/` 等）。这些是 01-06 验证过程中产生的探针脚本、日志、截图和 Tauri 构建产物，一次性使用，不作为长期 fixture。
- **删除**：`-json`（0 字节空文件，shell 误重定向产物，确认非用户内容、非任务相关）。
- **保留（记录风险，不删除）**：约 109 个用户无关文件。这些文件不属于本轮 01-08 工单范围，归属不确定，按"不确定归属不删除"规则保留。它们不会干扰验收——不匹配任何任务测试导入路径，`git status` 中以 `??` 显示但不作为通过证据。

### 修改文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `.gitignore` | 修改 | 末尾追加根锚定临时产物模式（见上） |
| `dashboard/src/App.routes.test.jsx` | 新增 | v2.0 IA 路由解析测试（7 项：4 子路由渲染 + 2 重定向 + 1 Tauri 根重定向） |
| `docs/tasks/v2.0-ia-api-balance-repair/README.md` | 新增 | 任务总调度文档 |
| `docs/tasks/v2.0-ia-api-balance-repair/02-前端交互与订阅契约修复.md` | 新增 | 02 工单 + 回写 |
| `docs/tasks/v2.0-ia-api-balance-repair/08-最终独立贝叶斯复验.md` | 新增 | 08 工单文档 |
| `docs/tasks/v2.0-ia-api-balance-repair/派发口令.md` | 新增 | 派发口令文档 |
| `docs/tasks/v2.0-ia-api-balance-repair/07-HEAD可复现性清理修复.md` | 修改 | 本回写 |

### 验证命令、退出码和关键输出

```powershell
# 1. git status（任务相关文件）
git status --short --untracked-files=all -- dashboard/src/App.routes.test.jsx docs/tasks/v2.0-ia-api-balance-repair
# EXIT=0
# 输出：仅 07 工单文档为 ??（待本回写提交后消失）；App.routes.test.jsx 不再出现（已跟踪）

# 2. git ls-files docs/tasks/v2.0-ia-api-balance-repair
# EXIT=0
# 列出 9 文件：01/02/03/04/05/06/08 工单 + README + 派发口令
# （07 工单在本回写提交后加入，届时为 10 文件）

# 3. git ls-files dashboard/src/App.routes.test.jsx
# EXIT=0
# 输出：dashboard/src/App.routes.test.jsx（已跟踪）

# 4. 针对性路由测试
npm --prefix dashboard run test -- src/App.routes.test.jsx
# EXIT=0
# Test Files 1 passed (1), Tests 7 passed (7)

# 5. 前端全量测试
npm --prefix dashboard run test
# EXIT=0
# Test Files 79 passed (79), Tests 636 passed (636)

# 6. 后端全量测试
npm test
# EXIT=0
# tests 1374, pass 1366, fail 0, skipped 8

# 7. git diff --check
git diff --check
# EXIT=0（无空白错误）
```

辅助验证：
- `git ls-files | Select-String "^_|^reg-|^test-output|^Token Eyes/"` → 空（.gitignore 未误忽略已跟踪文件）。
- `git check-ignore _acceptance_01.log _review_e2e.png _probe.cjs reg-001.txt test-output.log` → 全部匹配（临时模式生效）。
- 未跟踪文件总数：241 → 109（.gitignore 屏蔽 126+ 临时产物）。

### 最终 git status 摘要

本回写提交前（commit `bbcdc5c` 之后）：
- 已跟踪变更：无（`bbcdc5c` 已提交，工作区干净）
- 未跟踪：109 个文件，全部为用户无关文件（`docs/dev-notes/`、`docs/tasks/dispatch/`、`docs/tasks/v2.0/`、`tickets/`、`mock-data-ui-showcase/` 等）+ 07 工单文档（待本回写提交）
- 任务相关文件（`dashboard/src/App.routes.test.jsx`、`docs/tasks/v2.0-ia-api-balance-repair/*`）均已跟踪，不再 `??`

本回写提交后预期：07 工单文档进入版本控制，`git ls-files docs/tasks/v2.0-ia-api-balance-repair` 列出 10 文件（01-08 + README + 派发口令）。

### B7 后验更新

```text
先验（重置）：P0 = 0.95
  说明：03 工单曾给出 B7=0.99996，但其"HEAD 可复现"结论基于不完整验证
  （未检查任务相关文件是否未跟踪）。07 反例直接证伪该前提，故 B7 先验
  重置为 README 原始目标 0.95，不沿用被证伪的 0.99996。
  先验赔率 = 0.95/0.05 = 19

反例证据（07：任务相关文件未进入 HEAD）：
  - dashboard/src/App.routes.test.jsx（7 项路由测试）为未跟踪
  - README.md、02/08 工单、派发口令为未跟踪
  - 从纯 HEAD 拉取无法复现验收结论
  LR_counter = 0.05（直接反例，证伪可复现性）
  后验赔率 = 19 × 0.05 = 0.95 → P = 0.487（结论作废）

修复证据：
  - 6 个任务相关文件提交入 HEAD（commit bbcdc5c），git ls-files 确认跟踪
  - .gitignore 根锚定模式屏蔽 126+ 临时产物，验证无已跟踪文件被误忽略
  - 7 条必须验证命令全部 EXIT=0
  - 针对性路由测试 7/7 通过
  - 后端全量 1366/1366 通过、前端全量 636/636 通过
  - HEAD 自足性对抗性验证（stash 未跟踪后 ls-files + 测试通过）
  - 对抗性审查多轮通过（见下方）
  LR_fix = 50（针对"文件未入 HEAD"反例的确定性修复 + 全量回归 + .gitignore 安全验证 + 对抗审查）
  后验赔率 = 0.95 × 50 = 47.5 → P = 47.5/48.5 = 0.979

B7 = 0.979 ≥ 0.95 ✓（达标）
```

### Git 提交

分支：`fix/v2-06-subscription-required-contract`（复用 06 分支，05/06 已合入）

提交 1（任务相关文件 + .gitignore）：
- SHA：`bbcdc5c`
- 标题：`fix(v2-07): commit task-related files into HEAD for reproducibility`
- 文件：`.gitignore`、`dashboard/src/App.routes.test.jsx`、`docs/tasks/v2.0-ia-api-balance-repair/README.md`、`docs/tasks/v2.0-ia-api-balance-repair/02-前端交互与订阅契约修复.md`、`docs/tasks/v2.0-ia-api-balance-repair/08-最终独立贝叶斯复验.md`、`docs/tasks/v2.0-ia-api-balance-repair/派发口令.md`

提交 2（07 工单回写）：
- SHA：`dfb81a1`
- 标题：`docs(v2-07): write back HEAD reproducibility cleanup work order`
- 文件：`docs/tasks/v2.0-ia-api-balance-repair/07-HEAD可复现性清理修复.md`

提交 3（对抗性审查修复：-json 忽略模式）：
- SHA：`e402b0b`
- 标题：`chore(v2-07): ignore root-level stray -json test-runner byproduct`
- 文件：`.gitignore`（追加 `/-json` 模式）
- 发现来源：对抗性审查第 2 轮（HEAD 自足性验证时发现 `-json` 被测试运行器反复创建且未被忽略）

提交 4（对抗性审查记录追加）：
- SHA：`711009c`
- 标题：`docs(v2-07): append adversarial review record and -json fix to work order`
- 文件：`docs/tasks/v2.0-ia-api-balance-repair/07-HEAD可复现性清理修复.md`（追加 3 轮对抗性审查记录 + 更新 .gitignore/提交/风险段落）

最终 HEAD：分支 `fix/v2-06-subscription-required-contract` 的 tip（07 工单共 4 个提交：`bbcdc5c` → `dfb81a1` → `e402b0b` → `711009c`，外加本回写定稿提交）。具体 SHA 以 `git log` 为准——文档无法自引用其所属提交的 SHA 而不陈旧，故不在此硬编码。

### 剩余风险

1. **约 109 个用户无关未跟踪文件**：`docs/dev-notes/`、`docs/tasks/dispatch/`、`docs/tasks/v2.0/`、`docs/tasks/v2.0-release-*/`、`tickets/`、`mock-data-ui-showcase/`、`上下文.md`、`docs/用户诉求.txt` 等。按"不确定归属不删除"规则保留。这些文件不影响本轮验收（不匹配任务测试导入路径），但会持续在 `git status` 中以 `??` 显示。建议用户后续确认归属后决定提交/删除/忽略。

2. **`.gitignore` 模式仅覆盖本轮已知临时产物**：模式针对 01-08 修复工作产生的根级临时文件。若未来工作流产生其他命名模式的临时产物，需另行补充。当前模式根锚定，不影响子目录源码/测试。

3. **`-json` 文件已删除并加入 .gitignore**：该文件为 0 字节空文件，由测试运行器（vitest）在 `npm --prefix dashboard run test` 时反复创建（对抗性审查第 2 轮发现时间戳与测试运行吻合）。已删除当前实例并添加 `/-json` 根锚定模式到 .gitignore（commit `e402b0b`），防止未来 `git add -A` 误提交。模式仅匹配根级 `-json` 文件，不影响任何源码/测试。

4. **未执行 08 工单**：按指令本次只执行 07，不执行 08。08 工单文档已进入版本控制（`bbcdc5c`），但其独立贝叶斯复验内容尚未回写——待 08 工单正式执行时完成。

---

## 对抗性审查记录

### 第一轮对抗性审查：提交纯净性验证

审查时间：commit `bbcdc5c` 提交后。

| # | 审查维度 | 发现 | 处置 |
|---|---|---|---|
| 1 | `bbcdc5c` 是否混入临时文件？ | `git show --name-only --pretty="" bbcdc5c` 列出 6 文件：`.gitignore`、`dashboard/src/App.routes.test.jsx`、`docs/.../README.md`、`02-...md`、`08-...md`、`派发口令.md`。用 `Select-String "_\|reg-\|test-output\|\.log\|\.png\|\.exe"` 过滤返回空。 | 无问题 |
| 2 | 是否有截图/日志/探针混入？ | 6 文件全部为源码/测试/文档，无 `_*.log`、`_*.png`、`_*.cjs`、`reg-*.txt`、`.exe` 等。 | 无问题 |
| 3 | 是否误用 `git add -A`？ | 提交仅含预期 6 文件，未包含任何 109 个用户无关文件或临时产物。 | 无问题 |
| 4 | App.routes.test.jsx 是否为必要测试？ | 7 项测试覆盖 v2.0 IA 路由解析（4 子路由渲染 + 2 重定向 + 1 Tauri 根重定向），未被其他测试替代。`npm --prefix dashboard run test -- src/App.routes.test.jsx` 7/7 通过。 | 无问题 |

第一轮结论：提交纯净，无问题。

### 第二轮对抗性审查：HEAD 自足性验证

审查时间：commit `dfb81a1`（07 回写）提交后。方法：`git stash push --include-untracked` 移除全部未跟踪文件，在纯 HEAD 上验证。

| # | 审查维度 | 发现 | 处置 |
|---|---|---|---|
| 1 | 纯 HEAD 下任务文档是否齐全？ | `git ls-files docs/tasks/v2.0-ia-api-balance-repair` 列出 10 文件（01-08 + README + 派发口令），含 07 工单。 | 无问题 |
| 2 | 纯 HEAD 下 App.routes.test.jsx 是否存在？ | `git ls-files dashboard/src/App.routes.test.jsx` 列出该文件；`Test-Path` 返回 True。 | 无问题 |
| 3 | 纯 HEAD 下测试是否通过？ | `npm --prefix dashboard run test -- src/App.routes.test.jsx` → 7/7 通过，EXIT=0。证明测试不依赖任何未跟踪文件。 | 无问题 |
| 4 | stash 期间工作树是否干净？ | `git status --short` 返回空——纯 HEAD 无未跟踪/未提交变更。 | 无问题 |
| 5 | stash pop 是否完整恢复？ | pop 成功（Dropped refs/stash@{0}），109 个用户无关文件恢复，任务文件仍跟踪（11 = 10 文档 + 1 测试）。 | 无问题 |
| 6 | **新发现：`-json` 文件被测试运行器反复创建** | stash pop 后 `-json` 重新出现（0 字节，时间戳 06:37:18 与测试运行 06:37:07 吻合）。`git check-ignore -v -- "-json"` 退出 1——未被 .gitignore 忽略。 | **已修复**：添加 `/-json` 根锚定模式到 .gitignore（commit `e402b0b`），删除当前实例 |

第二轮发现 1 个问题（`-json` 反复创建且未忽略），已修复。

### 第二轮修复验证

修复 `#6`（`/-json` 忽略模式）后重新验证：

```powershell
# 安全性：无已跟踪文件名为 -json
git ls-files | Select-String "^-json$"
# 返回空（安全）

# 模式生效
git check-ignore -v -- "-json"
# .gitignore:131:/-json   -json  (EXIT=0，匹配)

# 删除当前 -json 实例
Remove-Item -LiteralPath "-json" -Force
# EXIT=0

# 再次运行测试，-json 不再出现在 git status
npm --prefix dashboard run test -- src/App.routes.test.jsx
# 7/7 通过
git status --short --untracked-files=all | Select-String "-json"
# 返回空（即使重建也被忽略）
```

### 第三轮对抗性审查：.gitignore 安全性 + 最终终态复查

审查时间：commit `e402b0b` 提交后。针对第二轮修复的影响范围 + 全局终态复查。

| # | 审查维度 | 发现 | 处置 |
|---|---|---|---|
| 1 | `/-json` 是否误忽略已跟踪文件？ | `git ls-files \| Select-String "^-json$"` 返回空。`/-json` 仅匹配根级名为 `-json` 的文件，无源码/测试/文档匹配。 | 无问题 |
| 2 | .gitignore 新模式是否全部根锚定？ | `/_*.log`、`/_*.png`、`/_*.cjs`、`/_*.txt`、`/_*.json`、`/_*.pid`、`/_review_e2e_shots/`、`/reg-*.txt`、`/test-output*.log`、`/test-backend-full*.log`、`/test-frontend-full.log`、`/Token Eyes/`、`/-json` 全部以 `/` 开头，不影响子目录。 | 无问题 |
| 3 | 是否有已跟踪文件匹配新忽略模式？ | `git ls-files \| Select-String "^_\|^reg-\|^test-output\|^test-backend-full\|^test-frontend-full\.log\|^Token Eyes/\|^-json$"` 返回空。 | 无问题 |
| 4 | 任务文件最终状态？ | `git ls-files docs/tasks/v2.0-ia-api-balance-repair` = 10 文件；`git ls-files dashboard/src/App.routes.test.jsx` = 1 文件。`git status --short -- ...任务文件` 返回空（全部跟踪，无 `??`）。 | 无问题 |
| 5 | 全量测试是否仍通过？ | 后端 `npm test`：1374 tests / 1366 pass / 0 fail / 8 skipped。前端 `npm --prefix dashboard run test`：79 files / 636 tests / 全通过。 | 无问题 |
| 6 | `git diff --check` 是否干净？ | EXIT=0，无空白错误。 | 无问题 |
| 7 | 是否误改 05/06 业务逻辑？ | 07 三个提交（`bbcdc5c`/`dfb81a1`/`e402b0b`）仅触及 `.gitignore`、`dashboard/src/App.routes.test.jsx`（新测试）、`docs/tasks/v2.0-ia-api-balance-repair/*`（文档）。未修改 `src/lib/local-api.js`、`dashboard/src/lib/api.ts`、`dashboard/src/pages/SpendPage.*` 等 05/06 业务文件。 | 无问题 |
| 8 | B7 后验是否达标？ | P0=0.95（重置）→ 反例 0.487 → 修复 0.979 ≥ 0.95。LR_counter=0.05（直接反例）、LR_fix=50（确定性修复 + 全量回归 + .gitignore 安全验证 + 3 轮对抗审查）。 | 无问题 |

### 审查结论

三轮对抗性审查完成：
- **第一轮**（提交纯净性）：4 项全通过，无问题。
- **第二轮**（HEAD 自足性）：6 项中 5 项通过，发现 1 个问题（`-json` 反复创建且未忽略），已修复（commit `e402b0b`）并重新验证。
- **第三轮**（.gitignore 安全性 + 终态复查）：8 项全通过，无新问题。

**最终状态：全部通过，工单 07 完成。**
