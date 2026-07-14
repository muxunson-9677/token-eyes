# Token Eyes 安装客户端五项修复实施计划

> 对应设计：`docs/superpowers/specs/2026-07-14-installed-client-remediation-design.md`

状态：六个任务均已完成；需要真实供应商密钥、微信开放平台和安装后点击体验的部分保留为人工验收。

## Task 1：排行榜入口与 Token 服务过滤

- 修改 `dashboard/src/ui/components/Sidebar.jsx` 及测试，增加排行榜入口。
- 修改 `dashboard/src/ui/dashboard/components/TokenServiceList.jsx` 及测试，展示未过期的 100% 套餐。
- 验证：相关 Vitest、copy 校验、Dashboard 构建。

## Task 2：OpenCode 数据目录

- 先扩展数据目录和 agent registry 测试。
- 增加 `opencode` 覆盖键、自动候选路径和有效性检测。
- 让同步流程消费统一解析后的 `opencodeHome`。
- 验证：数据目录、sync 与契约测试。

## Task 3：OpenCode token-only 限制显示

- 先为本地 API 汇总和限制组件增加失败测试。
- 将 OpenCode 纳入 token-only 汇总，前端显示真实 Token 消耗。
- 验证：usage limits Node/Vitest 测试和 Dashboard 构建。

## Task 4：Codex 本机官方登录优先

- 为检测策略增加失败测试：本机有效登录优先、无登录才要求 OAuth、授权与额度状态分离。
- 复用现有 `codex-token-plan` 官方用量实现，移除 `official_account` 对本机凭据路径的无条件拒绝。
- 仅在本机凭据不可用时启动 Tauri app-server 会话；保留 OAuth 重试和手动回调兜底。
- 验证：Node、Dashboard 和 Rust 相关测试。

## Task 5：供应商官方余额适配器复核

- 逐一核对 DeepSeek、Kimi、阿里云 BSS、火山 Billing、MiniMax、智谱 GLM 的实现和表单。
- 对缺少的成功解析、签名、凭据最小字段和错误分类先补失败测试，再做最小修复。
- 验证：fixture、确定性签名、401/403/429/超时/HTML/结构变化测试。

## Task 6：全量验证与测试 EXE

- 运行 Node、Dashboard、Rust、copy、guardrails、ESLint 和生产构建。
- 构建 Windows 安装 EXE，仅保存在仓库构建目录，不自动安装。
- 更新总进度文档：本次完成、验证证据、未完成人工验收和下一步。
