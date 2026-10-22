# Windows 社区预览执行状态

执行合同：[2026-10-22-community-preview-main-release.md](./2026-10-22-community-preview-main-release.md)

更新时间：2026-10-22。当前阶段：合同已落盘，尚未执行 GitHub 配置、合并或新包构建。

## 验收状态

| 验收 | 状态 | 当前证据 |
| --- | --- | --- |
| A1 main 保护 | NOT_RUN | 起点 API protected=false |
| A2 修复审查与合并 | NOT_RUN | fixes HEAD 2f77c225；main 4be93371；差异 68 文件 |
| A3 新 main 构建 | NOT_RUN | 当前版本仍 0.54.49 |
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
