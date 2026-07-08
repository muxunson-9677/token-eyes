# Token Eyes Windows 外发返工总调度（R0）

## 目标

本目录用于修复 `docs/tasks/windows-client-release/review-records.md` 中 05 终审退回的问题，直到 Windows Tauri 客户端重新具备“可外部安装验证”的前置条件。

本轮只解决外发验收缺口，不做产品功能扩展，不 push，不发布 Release，不向第三方分发安装包。

## 本轮失败来源

必须先读取旧终审失败记录：

- `docs/tasks/windows-client-release/review-records.md` 中 `工单 05 / 第 1 轮独立贝叶斯终审 / 2026-07-05 04:45 +08:00 / HEAD 39bb69a7d6450173ab3dc36de9c453cd0c7b8af7`

该记录确认的主要问题：

- P0：Tauri Release 仍通过 `find_repo_root()` 和 `Command::new("node")` 依赖源码仓库与系统 Node。
- P1：dashboard production audit 存在 `engine.io-client -> ws` high。
- P1：RustSec 存在 `quick-xml 0.39.4` 两个 high。
- P1：本轮 `tauri:build` 未产出最终 MSI/NSIS。
- P1：EXE/MSI/NSIS 均 `NotSigned`。
- P1：release workflow 上传前缺 audit、cargo audit、runtime manifest、签名 Valid 和 SHA256SUMS fail-closed 门禁。
- BLOCKED：缺第二个干净 Windows 快照/沙箱/VM 证据。

## 贝叶斯维度与硬门禁

验收假设：`H = 当前 Token Eyes Windows 客户端可以作为受控外部体验版交给别人安装验证`。

| 编号 | 验收假设 | 先验 P(H) | 权重 | 最低后验 | 负责工单 |
|---|---:|---:|---:|---:|---|
| B1 | 发布 HEAD 和构建输入可复现 | 0.20 | 15% | 0.99 | R3、R4、R5 |
| B2 | 安装包自包含 Node、CLI、Dashboard 与运行依赖 | 0.01 | 20% | 0.99 | R1、R3、R5 |
| B3 | 本地 API、同步、持久化和故障恢复真实可用 | 0.55 | 15% | 0.99 | R1、R3、R5 |
| B4 | 依赖、密钥、日志、产物无未关闭高危风险 | 0.25 | 15% | 0.99 | R2、R4、R5 |
| B5 | EXE/MSI/NSIS 身份、版本、签名和发布资产可信一致 | 0.05 | 10% | 0.99 | R2、R3、R5 |
| B6 | 无 Node/无源码干净 Windows 安装生命周期通过 | 0.05 | 15% | 0.99 | R3、R4、R5 |
| B7 | 用户可见故障、全量测试、构建和发布流水线无回归 | 0.40 | 10% | 0.95 | R1、R2、R3、R4、R5 |

计算规则：

```text
先验赔率 = P(H) / (1 - P(H))
后验赔率 = 先验赔率 × 相对独立 LR
后验概率 = 后验赔率 / (1 + 后验赔率)
加权总后验 = Σ(维度后验 × 维度权重)
```

相同测试、同一安装包清单、同一日志换一种描述只能计一次。任一 P0/P1、硬门禁失败、证书缺失、干净机器缺失、最终产物缺失或命令无法执行，优先于数值，结论必须是 `不可外发` 或 `BLOCKED`。

## 统一第一性原理执行规则

每个 R1-R4 执行工单开始前，必须把以下内容复制到该工单“执行回写”下方，形成本轮开始记录：

```text
执行前声明：
- 当前工单：
- 执行上下文身份：
- 是否复用上一工单上下文：
- 开始 HEAD：
- 分支 / worktree：
- Windows / Node / npm / Rust / cargo 版本：
- 本轮第一性原理：
  1. 失败证据优先于修复动作；先复现或定位旧 05 反例，再改代码。
  2. 最小修改；每个改动必须映射到本工单 P0/P1 或硬门禁。
  3. 不用旧安装包、旧截图、旧日志冒充本轮证据。
  4. 不读取、记录、截图、提交 API Key、Cookie、令牌、`.env` 值、用户提示词或消息正文。
  5. 每个命令记录原命令、退出码、关键输出和证据路径。
  6. 任一命令、证书、干净机器或工具缺失，必须写 BLOCKED，不能降级为通过。
```

R5 是全新独立终审，不能复用 R1-R4 上下文，不能参与修复。

## 统一对抗性审查闭环

R1-R4 完成前必须执行至少三轮完成前审查：

1. 正常路径复验：跑本工单必跑命令和目标验收路径。
2. 负向探针：主动制造缺文件、旧版本、audit 失败、签名失败、端口占用、无 Node 等与工单相关的反例。
3. 干净输入复验：在干净 checkout/worktree 或干净 Windows 快照中复跑关键路径。

如果任一轮发现问题：

```text
记录失败 -> 最小修复 -> 重新构建/签名/哈希/安装（如受影响） -> 从受影响轮次重新对抗性审查
```

不能把“修复后跑了一条通过命令”当作完成。最后一轮必须无新 P0/P1、无缺证、无输出冲突，才能结束该工单。

R5 发现问题时只写 `RETURNED`，不得修复；修复后必须新建另一个全新 R5 终审上下文。

## 推荐派发矩阵

| Subagent | 执行方式 | 发哪些文件 | 说明 |
|---|---|---|---|
| Subagent-A Runtime | 并行 | `README.md` + `R1-自包含运行时.md` + `review-records.md` | 独立 worktree；只处理 Tauri 自包含运行时、本地 API、故障可见性。 |
| Subagent-B Security | 并行 | `README.md` + `R2-安全签名门禁.md` + `review-records.md` | 独立 worktree；只处理 audit、签名、workflow fail-closed。 |
| Subagent-C Integration | 串行 | `README.md` + `R3-合流安装验收.md` + R1/R2 完成报告 + `review-records.md` | 复用主线集成上下文；合流 R1/R2，构建最终安装包并跑干净 Windows 生命周期。 |
| Subagent-C Integration | 串行复用 | `README.md` + `R4-完成前总复审.md` + R3 完成报告 + `review-records.md` | 建议复用 R3 上下文；只做返工前最后主线对抗性复核，可做最小集成修复。 |
| Subagent-D Final | 等 R4 完成后执行 | `README.md` + `R5-独立贝叶斯终审.md` + R1-R4 完成报告 + `review-records.md` | 必须全新上下文；只审查，不修复，不采信主线结论。 |

## 执行顺序

```text
先：R1 || R2（并行，必须不同 worktree / 不同上下文）

再：R3（串行，主线合流上下文）

再：R4（串行，建议复用 R3 上下文，做完成前强审查和返工收口）

最后：R5（串行，全新独立终审上下文）
```

不要让 R5 和 R1-R4 共用上下文。R1 和 R2 可以并行，但不能共享脏工作区，不能互相覆盖文件。

## 文件边界总览

- R1 可改：`src-tauri/scripts/**`、`src-tauri/src/**`、`src-tauri/tauri.conf.json`、`dashboard/src/lib/local-api-url.ts`、故障 UI/copy、相关测试、`package.json` 的 runtime build 脚本。
- R2 可改：`dashboard/package*.json`、`src-tauri/Cargo.*`、`.github/workflows/release-*.yml`、release workflow tests、签名/校验脚本、README 资产名。
- R3 可改：合流冲突、最小集成修复、安装验收脚本/记录、最终 SHA256SUMS。
- R4 可改：R3 后发现的最小集成修复；架构性问题必须退回 R1/R2/R3。
- R5 不改代码、不改产物；只允许追加审查记录。

## 统一完成汇报模板

```text
工单：
执行状态：COMPLETED / BLOCKED / RETURNED
开始 HEAD / 最终 HEAD：
任务提交 SHA：
修改文件：
新增/修改测试：
必跑命令、退出码、关键输出：
产物路径 / 版本 / 发布者 / SHA256：
干净 Windows / 截图 / 日志 / 解包证据路径：
对抗性审查轮次：
发现并修复的问题：
未关闭 P0/P1/P2：
B 维度、先验赔率、LR、后验赔率、后验概率：
是否具备下一工单前置条件：
给用户的完成汇报：
```

## 禁止事项

- 禁止 `git reset --hard`、`git checkout --`、`git clean`。
- 禁止 `git add -A`；必须逐文件核对。
- 禁止使用未签名或自签名包得到外发通过结论。
- 禁止把旧 0.1.0/旧 0.54.0 artifacts 当作最终产物。
- 禁止 release、push 或分发安装包，除非用户另行明确批准。
- 禁止隐藏失败记录；失败记录只能追加，不能改写。

## 执行回写

尚未执行。执行者从本行之后追加，不得覆盖正文。
