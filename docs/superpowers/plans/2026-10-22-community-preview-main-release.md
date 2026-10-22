# Token Eyes 主分支保护、修复审查与 Windows 社区预览执行合同

> 执行方式：按 `superpowers:executing-plans` 顺序执行；合并前按 `superpowers:requesting-code-review` 派发独立审查。用户已授权写完本文后直接执行，不重复请求选择执行方式。

**目标：** 只完成主分支保护、现有六个修复提交的审查合并、从合并后的 main 构建并发布一个新的 Windows 社区预览。

**实现方式：** 复用现有分支和工作区，GitHub PR 留下审核轨迹；本地构建 Windows x64 NSIS 包；GitHub Releases 提供公开下载。旧预览保留，新增预览不声称正式稳定或所有历史问题已修复。

**技术：** Git、GitHub CLI/API、Node/npm、React/Vite、Rust/Tauri、Windows NSIS/WebView2。

## 1. 授权、范围与优先级

用户原话：『按照接下来的任务写一份执行文档，文档用于约束和规范避免累积长上下文污染……不准夸大范围或者越做越偏，写完了文档再按文档来执行你说的这三件事。』

三件事严格定义为：

1. `main` 要求 PR 审核，禁止普通贡献者直接推送、强推和删除；保留仓库所有者必要管理权限。
2. 审查 `codex/token-eyes-05450-fixes` 的六个现有提交，通过后通过 PR 合并到 `main`。发现阻断问题时不得为了推进发布而写成通过。
3. 从合并后的 `main` 构建新 Windows x64 未签名社区预览，实际安装、打开窗口、检查基本页面，再发布新 tag 和安装包。

费用上限为新增现金支出 **0 元**。不购买签名、域名、服务器、GitHub 付费计划或付费 runner。不触发 npm 发布，不构建 macOS/Linux，不部署云端、不登录真实供应商账号、不修改用户队列/历史。这里的验证不承诺各供应商采集、OAuth、云同步或所有页面完整可用。

沿用用户明确的『早期公开共创』定位，不把历史全量正式验收作为发布前提。仍然禁止泄露秘密、伪造验收、拿旧包冒充新源码构建。明确的本次阻断项优先于赶进度。

## 2. 冻结起点（2026-10-22 实测）

| 项目 | 起点 |
| --- | --- |
| 仓库 | `muxunson-9677/token-eyes`，公开，默认分支 main，Issues/Discussions 已开 |
| 活跃工作区 | `E:\AgentData\Codex\worktrees\5430\010-Token eye` |
| 活跃分支 | `codex/community-preview`，干净 |
| main / 活跃 HEAD | `4be933713d457070ee0664775d4611b7cc84f56a` |
| 修复 HEAD | `2f77c2253a715847c65c0838219984c0ea848513` |
| 修复共祖 | `2f38d623578544833e3726c0ab81010939cfbeeb` |
| 修复提交 | `1df7fc77`、`2251be19`、`9945c00b`、`82966e2a`、`47515863`、`2f77c225` |
| 现有预览 | `v0.54.49`，保留，不覆盖、不挪 tag |
| 保护 | main 未保护，无现有 ruleset |
| 依赖 | 当前工作区 root/dashboard 的 node_modules 缺失，不能把缺依赖误算成源码失败 |

修复分支名字含 05450，但其清单版本仍为 0.54.49。新版本拟定 **0.54.50**；若远端已经存在此 tag 或 Release，则停止版本发布步骤，记录冲突，不覆盖它。

起点不是永远有效的事实。每次提交、推送、合并、打包、发布前重新检查 HEAD、工作树和远端。出现他人更新时先记录差异，对受影响内容重新审查，不覆盖他人工作。

## 3. 防上下文污染与变更纪律

本文规定范围；同目录 `2026-10-22-community-preview-main-release-status.md` 是唯一执行状态入口；原始日志放在项目内 `.tmp/community-main-release/`。旧 `TOKEN_EYES_FIX_STATUS.md` 和旧预览记录只用于追溯，不继承其 PASS。

接力/上下文压缩后只需先读本文、状态文档、核实 git/GitHub，再读取当前阻断项所需文件。状态记录必须含：阶段、精确 SHA、证据路径、命令/退出码、剩余项、下一动作。禁止只写『测试通过』『基本完成』。

允许改动：本文与状态、现有修复差异直接引入的阻断缺陷及相关测试、解决与 main 的真实冲突、新版本清单/锁文件、Windows 打包所必需的最小修复、README/下载链接/发布说明/贡献流程。

禁止顺手改动：产品设计、页面布局重构、新供应商、新账号能力、旧安全架构大改、云数据库、依赖批量升级、历史证据清理、其它应用、无关分支或工作树。新发现的既有问题只入状态文档的『后续问题』，不得自动进入实施列表。若直接阻断必须扩大范围，先写清因果与最小方案；超出上述允许项则请求用户决定。

沿用现有 `codex/community-preview` 与修复分支，不新建额外分支/工作树。不动另一工作区的本地 main。必要的依赖、缓存、隔离测试数据及产物只放项目内；不在 D 盘根目录或项目旁边建目录。外部安装仅限本次明确要求的 Token Eyes 隔离安装测试；不覆盖日常安装。

## 4. 可阻断的验收合同

| ID | 最终对象、初态与操作 | 必须观察的结果 | 负向条件与证据 |
| --- | --- | --- | --- |
| A1 | GitHub main；普通共创分支提交 PR | 要求至少 1 个批准；新提交使旧批准失效；会话需解决；禁止强推/删除 | 保护 API 回读完整配置；管理员例外公开记录，不能声称所有人都无法绕过 |
| A2 | 六提交对应的 PR；审查精确 head 与实际 main 集成差异 | 独立审查、相关测试与构建记录；无未解决的本次 P0/P1；PR 合并到 main | AI 审查不是另一个 GitHub 用户批准；不得虚构 review；远端 main 包含修复 SHA |
| A3 | 干净已提交 main 的 0.54.50 新 NSIS 包 | 版本和 SHA 在源清单、构建 manifest、安装后 manifest 一致 | 旧 0.54.49 或另一工作树产物不算；记录 SHA256、时间、工具版本 |
| A4 | 新包安装到项目内隔离目录；打开安装后 EXE | 安装退出正常，实际窗口显示，首页可见；鼠标/键盘可进入请求记录/实时会话页；关闭重开仍可进入 | 空数据允许，白屏/不可操作/启动崩溃不允许；截图及操作记录；隔离 HOME，不读真实账户 |
| A5 | 全新匿名下载者打开新 Release、下载安装包；贡献者打开仓库 | Release 非草稿、预发布；下载成功且 SHA256 一致；源码/tag/main 对齐；Issue/PR入口指本仓库 | 不称 GitHub stable latest；不覆盖旧 tag；说明未签名、已知问题、未验证范围 |

两次核对：第一遍核对配置、审查、构建和安装证据；第二遍从公开 Release 重新匿名取得精确安装包，核对哈希与来源，并重新打开已安装的同哈希制品核对基本窗口/页面。第二遍不复用第一遍结论，不扩大为全供应商正式双审。任何缺失项保留 `NOT_RUN` / `PARTIAL` / `BLOCKED`，不得发布完成措辞。

## 5. 顺序执行清单

### 任务一：保护 main 并固化文档

- [ ] 保存本文和状态文档，检查 `git diff --check`，记录起点。
- [ ] 用 GitHub API 读现有保护配置并保存。向 `repos/muxunson-9677/token-eyes/branches/main/protection` PUT 下列配置；若发现已有更强规则则合并保留，不降低保护：

```json
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
```

调用使用 `gh api --method PUT ... --input <项目内JSON文件>`。再 GET 核对 A1。当前 CI 未配置 PR 触发且有历史失败，本次不凭空设不存在的 required check，不关闭已有 CI、不更换付费 runner。

- [ ] 贡献说明补充：Fork/分支 → PR → 维护者审核 → 合并。所有者自建 PR 无法自己批准；本次只有独立审查通过后才使用保留的管理员权限合并，并在 PR 正文说明。
- [ ] 文档提交到现有 community-preview 分支，开 PR 合入 main；文档审查确认无秘密、范围准确。提交前 `git diff --check`，禁止顺手夹带功能修改。

### 任务二：审查并合并六个修复提交

- [ ] `git fetch origin` 后记录 main/fixes SHA、`git diff --stat origin/main...origin/codex/token-eyes-05450-fixes`、`git diff --check origin/main...origin/codex/token-eyes-05450-fixes`。创建修复 PR（已存在则复用）。
- [ ] 独立审查固定六提交：采集游标/回滚/文件变化/重复计费、local API与请求记录过滤、实时界面及 Windows runtime 打包。审查人只读代码，输出可复现的文件/行号/严重性；不能将未改动的历史问题当作本次新增回归。
- [ ] 在当前工作区集成修复分支用于测试，保留 main 的社区入口改动。执行前先记录依赖缺失；通过锁文件 `npm ci --cache .tmp/community-main-release/npm-cache` 与 dashboard 的 `npm ci` 安装，禁止 npm audit fix 或修改依赖范围。
- [ ] 运行修复差异涉及的 Node 测试；至少包括 `test/rollout-parser.test.js`、`test/rollout-recovery.test.js`、`test/collection-health.test.js`、`test/sync-discovery-isolation.test.js`、`test/request-usage-records-api.test.js`、`test/usage-attribution.test.js`、`test/windows-build-script-safety.test.js`。
- [ ] 在 dashboard 运行变更测试（请求记录 hook、RequestUsageLog、RealtimeSessionsPage、realtime-chart、DesktopWidgetPage、PlanMarketPage），随后 `npm --prefix dashboard run typecheck` 与 `npm --prefix dashboard run build`。所有 fixture/TEMP/HOME 在项目内。
- [ ] 运行 `npm test`，保留原始退出码。历史或平台不适用失败单列因果；不得删测试求绿，也不得无限扩展修复。与本次修复有关的失败阻断合并。
- [ ] 审查发现本次 P0/P1 或相关测试失败时，PR 保留未合并；只修最小缺陷并重新审查/测试。确需超范围工作则停止依赖步骤并报告。
- [ ] 通过后按精确 head SHA 合并修复 PR；远端回读确认 ancestry 和 merge commit。维护者自有 PR 的管理员合并例外明确写入记录，不伪造批准。

### 任务三：新 main 制品与公开下载

- [ ] 确认 `v0.54.50` 不存在。在 community-preview 分支更新 root package/package-lock、dashboard 清单（若其中独立版本与应用一致）、Cargo.toml/Cargo.lock 的应用版本、tauri.conf.json，更新 README/营销页中 Windows 安装下载地址到新 tag。不改依赖版本。
- [ ] 版本/入口变更开 PR，经独立核对和相关版本/链接检查后合入 main。同步当前工作分支到该 main SHA；构建前工作树必须干净，HEAD 必须等于刚核实的 origin/main。版本字段不一致则禁止构建。
- [ ] 本地 `npx tauri build --bundles nsis`（沿用仓库 beforeBuildCommand）；记录 Node/Rust/npm 版本、开始时间、main SHA；设置 `TOKEN_EYES_GIT_SHA` 为该 SHA。不调用自动清旧 installer 或多平台发布流程。失败先定性为环境/源码/外部下载问题，只处理直接必要项。
- [ ] 检查 NSIS 新包、运行 `npm run tauri:verify-runtime`，检查 runtime-manifest 的版本和 SHA；生成 SHA256 与 provenance。扫描新增包中运行配置/日志，不能带真实密钥、会话、用户队列；不照搬旧包扫描结果。
- [ ] 阅读实际生成 NSIS 脚本，验证隔离 `/S /NS /D=<项目内绝对目录>` 不触发旧安装卸载；先备份相关注册表和捷径，安装后对比并恢复。若不能保证不破坏日常安装，则停止安装步骤。
- [ ] 用新包执行 A4：隔离 TEMP/HOME 与原生验收变量，打开安装版实际窗口，首页及请求记录/实时会话页面操作、关闭重开；保存截图/操作日志。不能用 HTTP 200、进程存活或浏览器开发页替代原生窗口证据。缺 GUI 观察能力时记 BLOCKED，不声称已安装验收。
- [ ] 准备中文 Release：Windows x64、未签名 SmartScreen 提示、社区共创、精确 main SHA、实际检查范围、已知限制、Issue/PR 链接。新 tag 指构建 SHA，以 prerelease 发布 EXE、SHA256SUMS 与不含私密路径的 provenance；保留 v0.54.49 不动。
- [ ] 匿名下载新公开安装包并重新算 hash，回读 Release/tag/main、Issue/PR 链接。完成 A5 与第二遍核对；最终状态按 A1–A5 逐行记录。

## 6. 停止条件和恢复

新增付款要求、远端非预期更新、真实凭据暴露、无法隔离真实用户数据/安装、审查发现未解决 P0/P1、相关测试失败、精确 SHA/版本不匹配、原生界面白屏或缺少必要观察能力，均阻断依赖步骤。先保存已完成事实及下一步，禁止降级证据偷偷通过。

下载超时/包管理网络失败等可重试或换官方免费源；不能因此换功能范围、升级全体依赖或换一个旧包发布。与本次无关的历史问题记录，不要求用户为所有历史缺陷补验收。

回滚原则：不强推 main、不改旧 tag、不删除已公开历史。错误保护配置恢复到记录的原配置；尚未公开的失败候选保留项目内；已公开新预览若有严重问题则明确标注并停止推荐，再通过新提交/新版本修复。

## 7. 最终交付格式

提供执行文档、状态文档、保护结果、合并 PR 与精确 main SHA、新 Release、版本与 SHA256，以及剩余未验证项。只按 A1–A5 的实际证据宣告结果；不以代码行数、测试数量或模糊百分比代替完成度。
