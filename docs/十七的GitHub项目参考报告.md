# 十七的 GitHub 项目参考报告

调研日期：2026-07-09

调研对象：[canyexuanfan/TokenStep-Windows](https://github.com/canyexuanfan/TokenStep-Windows) 及其 [Releases](https://github.com/canyexuanfan/TokenStep-Windows/releases)。

## 结论

TokenStep-Windows 对当前 Token Eyes / TokenTracker 项目有参考价值，但应选择性吸收，不适合整体照搬。它和当前项目都围绕本地 AI token 用量统计、Windows 托盘/桌面体验、Tauri 2 + Rust + WebView2 交付展开；但当前项目的数据模型、Dashboard、CLI 嵌入运行时、Token Plan 和发布链路更复杂，直接迁移代码风险较高。

优先参考顺序：

1. Windows NSIS 覆盖安装体验。
2. CC Switch 代理请求日志作为新增用量数据源。
3. 图表、分享卡、今日页统计口径等产品展示细节。

不建议优先参考：Token 生财榜单、SmartScreen 自签名说明、整套 TokenStep UI 或构建流程。

## 外部项目概况

TokenStep-Windows 是 TokenStep macOS 版的 Windows 移植分支，项目说明中明确定位为“像记录步数一样记录每天的 AI Token 消耗”的 Windows 桌面应用。其 Windows 版使用 Tauri 2 + Rust 构建，提供托盘常驻、今日/历史/统计/隐私/设置页面、Codex / Claude Code 本地用量读取、截图分享、CSV 导出、活动墙和多语言界面。

截至本次查看，Release 页面显示：

- 最新版本为 `v0.1.4-windows`，发布于 2026-06-25，主要修复节奏分享卡和波形图视觉细节。
- `v0.1.3-windows` 重点修复 30 天柱状图、目标参考线、堆叠顺序和活动墙。
- `v0.1.2-Windows` 参考价值最高，包含 CC Switch 代理流量采集、Claude Code 额度卡片、Codex 配额窗口识别修复、Token 榜单、今日客户端/模型拆分、按客户端分色堆叠活动柱图，以及 NSIS 静默覆盖安装。

## 与当前项目的关系

当前仓库的项目指导以 `CLAUDE.md` 为准：Token Eyes Windows 工作走 Tauri 栈，即 Rust 工具链 + Node.js + WebView2 Runtime，不应把旧 `TokenTrackerWin/` 的 .NET SDK 作为 Token Eyes 前置条件。

当前本地项目已经具备：

- `src-tauri/`：Token Eyes Tauri Windows 路径。
- `dashboard/`：React + Vite + TypeScript Dashboard。
- `src/`：Node CLI、同步解析、本地 API。
- `TokenTrackerWin/`：旧 .NET Windows 包装路径，仅作为历史路径，不应作为当前 Token Eyes 主线。
- `src-tauri/windows/nsis-hooks.nsh`：已有安装前停止运行中 `token-eyes.exe` 与内嵌 `node.exe` 的 NSIS hook。

因此，TokenStep-Windows 最适合作为“Windows Tauri 桌面交付与用量统计体验”的对照样本，而不是替代当前项目架构。

## 可借鉴点 1：NSIS 静默覆盖安装

TokenStep-Windows 在 `v0.1.2-Windows` 中明确提到：升级安装新版本时不再弹出“是否卸载旧版本”的确认页，新版本直接覆盖旧版文件，用户设置位于安装目录之外，因此不受影响。其构建脚本思路是 patch Tauri 生成的 `installer.nsi`，在 `Function PageReinstall` 中注入 `Abort`，再重新运行 `makensis` 生成安装包。

当前项目已有 `src-tauri/windows/nsis-hooks.nsh`，但它解决的是“安装前停止运行中的进程”，不等价于跳过 Tauri 默认的 reinstall/uninstall 确认页。

建议：

- 新增或扩展 Windows release 构建脚本，在 `tauri build` 后检查生成的 `installer.nsi`。
- 只在检测到预期 `PageReinstall` 结构时注入跳过逻辑，避免 Tauri 模板升级后误 patch。
- patch 后重新执行 `makensis`，并在 CI / 本地 release 记录中输出是否命中 patch。
- 验证标准：安装旧版后运行新版安装包，不出现卸载确认页；运行中程序能被安装前 hook 关闭；安装完成后设置和本地数据仍保留。

优先级：高。

## 可借鉴点 2：CC Switch 代理流量采集

TokenStep-Windows `v0.1.2-Windows` 新增读取 `~/.cc-switch/cc-switch.db`，把通过 CC Switch 代理的 Claude / Codex / Gemini 流量统计进来，并优先使用代理日志中的真实成本。

当前项目在供应商配置、余额接口和文案中已有大量 CC Switch 相关概念，但核心 `src/lib/rollout.js` / `src/commands/sync.js` 未看到 `~/.cc-switch/cc-switch.db` 作为本地用量数据源的接入。若用户同时使用 CC Switch 代理，当前 TokenTracker 可能漏掉这部分真实 API 消耗，或者只能依赖其他日志间接估算。

建议：

- 先做 schema 调研：确认 `cc-switch.db` 中请求日志表名、字段、时间戳单位、token 字段、模型字段、app/source 字段、真实成本字段。
- 将其作为独立 source 接入同步链路，例如 `claude-via-cc-switch` / `codex-via-cc-switch` / `gemini-via-cc-switch`，避免与官方 CLI 日志混淆。
- 若数据库有真实成本字段，需决定是否扩展 queue schema 或在 spend 聚合层单独承载真实成本；不能简单塞进 token 定价估算，否则会破坏现有 `computeRowCost` 口径。
- 必须有重复统计防护：同一次请求不应同时被官方 CLI 日志和 CC Switch 代理日志重复计入。

优先级：中高。价值取决于目标用户中 CC Switch 代理使用比例。

## 可借鉴点 3：额度窗口识别

TokenStep-Windows 提到按窗口时长区分 Codex 5 小时 / 7 天窗口，不再盲目依赖 primary / secondary 顺序。

当前项目已经有类似处理：

- `src/lib/codex-token-plan.js` 按 `limit_window_seconds` 区分 `18000` 秒与 `604800` 秒。
- `src-tauri/src/codex_session.rs` 的 WebView 路径也按窗口秒数分类。
- `src/lib/usage-limits.js` 和相关测试覆盖了窗口顺序变化的情况。

因此这块主要是“确认方向一致”，不建议重复移植 TokenStep 实现。后续只需保持测试覆盖，防止新后端字段变化导致退化。

优先级：低，当前已基本覆盖。

## 可借鉴点 4：Claude Code 额度展示

TokenStep-Windows 在今日页新增 Claude Code 5 小时 / 7 天额度卡片，读取本机 Claude Code 登录凭证调用 Anthropic usage API，并做 10 分钟缓存。

当前项目已经有 Token Plan 和 Tauri WebView 官方账号路径相关实现，例如 `src-tauri/src/claude_session.rs`、`src/lib/claude-token-plan.js`、`dashboard/src/components/settings/TokenPlanSection.jsx`。因此 TokenStep 的价值不在实现照搬，而在产品呈现：

- 在今日页或 Limits 区域并列展示 Codex / Claude 的实时额度。
- 未登录时给出非阻断提示，不影响其他统计。
- 缓存刷新要清晰，避免用户误以为额度是实时毫秒级数据。

优先级：中。

## 可借鉴点 5：图表和分享卡体验

TokenStep-Windows 的 `v0.1.3` 和 `v0.1.4` 主要围绕视觉细节：30 天堆叠柱图、目标参考线、空日占位、活动墙默认滚动到今天、Canvas 自绘分享卡、平滑波形和峰值胶囊。

这些对当前 Dashboard 有产品参考价值，尤其是：

- 最近 30 天活动按客户端分色堆叠。
- 今日客户端 / 模型拆分只展示今日，累计分布留在统计页。
- 分享卡用稳定 Canvas 输出，避免 DOM 截图受布局和字体影响。
- 图表和导出图使用同一套数据与颜色顺序，避免用户看到的图与导出的图不一致。

优先级：中低。只有在统计口径稳定后再做。

## 不建议优先借鉴的点

### Token 生财榜单

TokenStep-Windows 接入 `scys.com/tokenrank` 榜单，可显示榜首和个人排名。该功能会引入外部请求，也会改变产品心智，从“本地隐私优先的用量工具”偏向“社交排名工具”。

当前项目强调隐私和本地统计。若未来要做，建议必须满足：

- 默认关闭。
- 设置页明确标注会访问第三方服务。
- 不上传本地 token 明细、prompt、对话或项目路径。
- 榜单展示与核心统计解耦，第三方不可用时不影响主流程。

### 自签名发布说明

TokenStep-Windows release 中提到自签名证书和 SmartScreen 提示。该说明适合个人分发早期项目，但当前项目更应该维护正式发布可信链路。不要把“自签名 + 让用户点仍要运行”作为长期方案。

## 建议后续工单

### 工单 A：Windows NSIS 覆盖安装体验修复

目标：新版安装包覆盖安装旧版时，不出现卸载确认页，同时保留用户设置和数据。

验收：

- 构建日志能显示 NSIS reinstall page patch 是否命中。
- 安装旧版后执行新版安装包，无卸载确认页。
- 运行中的 `token-eyes.exe` / 内嵌 `node.exe` 能被停止。
- 安装完成后应用可启动，设置和本地数据保留。

### 工单 B：CC Switch DB 用量数据源调研

目标：确认 `~/.cc-switch/cc-switch.db` 是否可作为 TokenTracker 同步数据源。

验收：

- 输出数据库 schema 调研记录。
- 明确哪些字段可映射到 queue entry。
- 明确真实成本字段如何进入 spend 口径。
- 明确重复统计风险和规避策略。

### 工单 C：图表与分享卡体验对齐评估

目标：选取 TokenStep 中适合当前 Dashboard 的展示策略，而不是整体换 UI。

验收：

- 列出当前 Dashboard 已有图表与 TokenStep 可参考项差异。
- 明确哪些改动只影响展示，哪些会影响 API 数据结构。
- 优先做不会改变统计口径的视觉改进。

## 最终判断

TokenStep-Windows 对当前项目最大的价值不是“代码资产”，而是“Windows 桌面用量工具的边界案例清单”：安装升级、代理流量、额度窗口、图表一致性、分享图稳定输出。

短期最值得落地的是 NSIS 静默覆盖安装，因为它范围小、收益明确、和当前 `src-tauri/windows/nsis-hooks.nsh` 形成互补。中期可以调研 CC Switch DB 数据源，它有机会补齐代理流量真实成本。UI 和榜单类功能应放在统计准确性与发布链路稳定之后。

