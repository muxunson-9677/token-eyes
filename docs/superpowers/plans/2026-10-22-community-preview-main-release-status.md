# Windows 社区预览执行状态

执行合同：[2026-10-22-community-preview-main-release.md](./2026-10-22-community-preview-main-release.md)

更新时间：2026-10-23。当前阶段：main 保护、修复 PR 合并已完成；正在准备 0.54.50 精确 main 构建。

## 验收状态

| 验收 | 状态 | 当前证据 |
| --- | --- | --- |
| A1 main 保护 | PASS | 保护 API 回读要求1批准，禁止强推/删除，保留所有者管理权限 |
| A2 修复审查与合并 | PASS（社区预览范围） | PR #28，merge d31bfb418e2e59e3906bc2427a6ecbeedff3a468；已披露P2及3项旧失败 |
| A3 新 main 构建 | NOT_RUN | 0.54.50 版本清单及入口变更通过独立审查，待合并构建 |
| A4 新包原生安装与基本界面 | NOT_RUN | 旧包证据不继承 |
| A5 新预览匿名下载与复核 | NOT_RUN | 现有 v0.54.49 保留 |

## 执行记录

- 起点：`E:\AgentData\Codex\worktrees\5430\010-Token eye`，`codex/community-preview`，`4be933713d457070ee0664775d4611b7cc84f56a`，工作树干净。
- 当前 root/dashboard 缺 node_modules；在开始测试前按锁文件安装并记录结果，不视为代码失败。
- 下一动作：检查合同范围和格式，配置并回读 main 保护，然后开始精确修复差异审查。

## 后续问题（不自动纳入本次）

- 旧 main CI 的 PlanMarketPage 断言曾失败；修复分支包含对应测试改动，需本次运行后再判断。
- 旧 local API 的跨站读取防护未全面覆盖；六提交中若未改变该边界，作为已知预览限制，不据此启动架构重写。
- 真实供应商 OAuth、云端同步、macOS/Linux、全功能稳定性不在本次验收承诺内。

## 本次执行更新

- A1：PASS。GitHub main 保护配置已 PUT 后 GET 回读：1 approval、dismiss_stale_reviews=true、required_conversation_resolution=true、force/delete=false、enforce_admins=false。证据 `.tmp/community-main-release/main-protection-readback.json`。
- 文档独立范围审查通过；第二遍匿名下载为发布后核验，失败时保持 PARTIAL，不倒推第一遍通过。
- 根目录与 dashboard 的锁文件依赖安装成功（退出 0）。Node v26.5.1、npm 12.0.2、cargo 1.95.0；npm 12 阻止部分 esbuild 安装脚本，后续构建实测判定影响，不升级依赖。
- 旧 main 基线 Node：223 项，222 通过，1 失败：runtime bundler rejects unknown build identity in release verification mode。属于修复分支已有修改范围。日志 `.tmp/community-main-release/baseline-node.log`。
- dashboard 初次命令受 npm 12 参数处理影响未启动测试，第二次 worker 参数冲突；均为执行参数问题，不算产品失败。将用显式 min/max workers 重试。
- 修复草稿 PR：https://github.com/muxunson-9677/token-eyes/pull/28，精确 head 2f77c225，独立审查进行中。

### 2026-10-22 审查后执行决策

- 文档 PR #29 已合入 main（38fab329）；当前分支临时集成六提交，尚未提交集成结果、尚未合并 #28。
- 两名独立审查均未发现 P0/P1，但确认 3 个新增 P2：every-code/Claude 原地重写重复计数、时间字符串格式导致重叠桶重复。为了满足『审核后再合并』，本轮只补这三项最小回归修正；属于合同允许的待合并差异修正，不扩展到历史问题。修复后必须交叉复审。
- 原 fixes 工作区发现大量用户未提交修改，未触碰；仅使用远端已提交 head 2f77c225。后续将从当前集成分支把已审补丁快进推到同一远端 fixes 分支，更新 #28，不覆盖或改动该工作区。
- 旧 main dashboard 基线：123 项，122 通过、PlanMarketPage 1 失败。修复集成后6个关联测试文件177/177通过；typecheck退出0，build退出0（仅chunk大小提示）。
- 初次 Node 集成测试停在 sync fixture，未取得完整结果，因此不计通过。纯净 HOME/APPDATA/TEMP、去除继承 provider 目录变量重跑 collection-health/sync-discovery/windows-build 27/27通过。日志 focused-isolated.log。
- 时间戳 P2：新增3个交叉格式实际API fixture，RED3失败，GREEN51/51；原始日志 `.tmp/community-main-release/api-timestamp/`。
- A4必须在发布前通过；A5为公开后的匿名核验。尚未开始新版本构建/安装。

### 2026-10-23 安装候选检查与入口纠正

- main `9f10100f87176ba40410f66fdd3511d526165e80` 的 0.54.50 候选构建成功；内置 runtime、Rust runtime resolver、秘密扫描和隔离安装通过。安装后的 manifest 版本/SHA分别为0.54.50/该main SHA。
- 第一次隔离安装的 `/D=` 参数未按Windows空格路径原样传递，安装器更新了既有 `Token Eyes acceptance 0.54.48 ed42a6e3` 目录。已用保留且SHA匹配的0.54.49安装包恢复该目录，并核对注册表、快捷方式与版本；之后启用原样参数重新安装到项目内隔离目录成功。失败尝试及恢复结果保留在 `.tmp/community-main-release/`。
- 安装版原生窗口已完成首页、使用明细、实时会话及关闭重开检查；测试进程增加Node文件读取权限边界，只允许安装目录和项目内隔离profile，避免读取真实账号历史。
- 实际窗口发现页脚GitHub/Issue仍指向上游。该候选不得发布；只纠正当前Tauri静态页、分享页、GitHub Star默认仓库和CLI Star提示，合入新main后必须重新构建、安装及核对公开入口。

### 2026-10-23 范围收敛（替代上一条三项均修的尝试）

- 主代理拒绝合入试做的 rollout 去重迁移：旧游标变化时 ESTALE 可能长期阻塞整个来源，补全自动恢复会扩大本轮范围。只撤回该尝试，保留六提交原实现；不采用其测试结果证明最终版本。
- 保留已验证的时间格式规范化两行修正及3条回归。两项原地改写 P2 列为公开已知限制：every-code 在等长metadata原地修改后可能重复用量；Claude 同情形可能重复会话数。不是全部日志改写幂等已解决。
- 本轮 P0/P1 门限及快速社区预览定位不变；没有开展账本重建、历史数据迁移或用户数据修复。

### 合并前最终证据

- 最终保留补丁：仅 local-api.js 两行时间桶规范化与3条回归；rollout试做迁移已撤回。两位独立审查的原六提交结论为无P0/P1，保留已披露P2。
- 最终相关Node回归292/292通过，日志 final-focused.log。完整Node命令等价npm test，增加并发/超时限制：2636项，2632通过、3失败、1跳过；日志 final-node-suite.log。
- 以38fab329导出的修改前源码复跑失败文件，复现同样3项：两项Codex目录数量3≠2、一项Kimi刷新返回旧fixture凭据。日志preexisting-failures.log，属于旧失败，不修改测试断言、不纳入本次修复。
- 前端6个关联文件177/177、typecheck、build通过。原生安装和发布仍NOT_RUN。
