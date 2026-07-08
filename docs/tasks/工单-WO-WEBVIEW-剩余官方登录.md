# WO-WEBVIEW 剩余官方 WebView 登录（独立工单）

**状态**：待执行（新开窗口专用）  
**创建时间**：2026-07-08  
**前置工单**：2026-07-08 Token 套餐 GLM / Codex / 供应商 API 修复（安装包 SHA256 `75CFF648…`）  
**工作目录**：`D:\04-AI-Project\010-Token eye`  
**禁止**：在未实机验证前宣称「任务完成」；禁止用「请安装本地 CLI」作为最终方案。

---

## 一、本工单要解决什么

用户明确要求：**不依赖本机 CLI / 本地 auth.json**，在 Token Eyes 桌面端内通过 **官网 WebView 登录 + OAuth/会话 Cookie**，实现 Token 套餐的额度同步，并支持 **同一 Provider 多账户**（每条套餐记录独立绑定，备注区分，消耗可累计）。

上一轮已落地（**本工单不要再做**）：

| Provider | WebView / 同步 | 参考实现 |
|----------|----------------|----------|
| 小米 MiMo | ✅ | `src-tauri/src/xiaomi_mimo_session.rs` |
| 智谱 GLM | ✅ 余额 WebView；用量走 Coding Plan API Key | `src-tauri/src/glm_session.rs` + `glm-token-plan.js` |
| Codex | ✅ WebView + 每记录 `account_binding_id` | `src-tauri/src/codex_session.rs` + `TokenPlanSection.jsx` |

**本工单未实现（必须做）**：

| 子项 | Provider | 当前缺陷 | 目标 |
|------|----------|----------|------|
| WV-1 | **Claude** | 官方模式仍读 `~/.claude/.credentials.json`（需本机 Claude Code CLI 登录） | Tauri WebView 登录 Anthropic 控制台 → 拉 OAuth usage → 写入 `quota_windows` |
| WV-2 | **Cursor** | 读本机 Cursor IDE `vscdb` / `cli-config` Cookie | Tauri WebView 登录 cursor.com → 拉 `usage-summary` → 支持**无本地 IDE 安装**的多账户 |
| WV-3 | **Kimi Code** | 读本机 `~/.kimi-code` OAuth（需 `kimi` CLI） | Tauri WebView 登录 Kimi Code 控制台 → 拉 `api.kimi.com/coding/v1/usages` |

**明确不在本工单范围**（已有其他路径或另开）：

- Kimi `kimi_api_budget`：Moonshot API Key 余额检测（`kimi-token-plan.js` + secrets）— 已可用，无需 WebView
- MiniMax / 阿里云百炼：当前为 API Key 官方检测；若需 WebView 另开 WO-4 延伸
- Claude **路由模式**（`claude_routing`）：仅本地 Token 统计，**禁止伪造**官方额度同步
- Cockpit 式全局账号管理中心 / 应用内切号 UI

---

## 二、全局执行规则（从主工单继承）

### 第一性原理（每个子项开始前写进审查记录）

1. 用户要的是：**桌面内一键官网登录 → 真实额度 → 多账户备注区分 → 可刷新**，不要 CLI 话术。
2. 先定位层：Tauri session / local-api console / Node adapter / 前端 `TokenPlanSection`。
3. 最小改动：复制 MiMo / Codex 模式，不要重写 Token Plan 全模块。
4. 多账户：会话按 **`account_binding_id` 绑定到单条套餐记录**，不得全局单例覆盖（见 Codex 修复）。

### 对抗性审查（强制）

结束时写入 `docs/tasks/工单审查记录.md`：

```markdown
## WO-WEBVIEW 对抗性审查 — YYYY-MM-DD HH:mm
- 子项：WV-1 / WV-2 / WV-3
- 审查角色：无 CLI、双账户、旧脏数据、断网、登录窗中途关闭
- 通过项：
- 发现问题：
- 修复动作：
- 复审结论：通过 / 继续修复
```

**未通过复审不得向用户汇报完成。**

---

## 三、统一技术模式（照抄 Codex / MiMo）

每个 Provider 交付物清单：

### Rust（Tauri）

1. 新模块：`src-tauri/src/<provider>_session.rs`
2. 命令：`open_<provider>_console_login(session_ref)`、`verify_<provider>_console_session(session_ref)`、`delete_<provider>_console_session(session_ref)`
3. 在 `src-tauri/src/lib.rs` 注册
4. 单元测试：状态机、quota 解析、错误码

### Node local API

1. `src/lib/local-api.js`：`ALLOWED_CONSOLE_PROVIDER_IDS` 加入 provider id
2. console session CRUD 已有，确保 `session_ref` 按记录隔离

### Dashboard

1. `dashboard/src/lib/api.ts`：绑定 Tauri 命令
2. `dashboard/src/components/settings/TokenPlanSection.jsx`：
   - `WEBVIEW_CONSOLE_PROVIDERS` 加入 provider
   - `resolveForm*Session` / `resolveConsoleSessionForRecord` 按 `account_binding_id` 查找
   - `handleConnect<Provider>`：连接并同步 → 保存 `account_binding_id` + `quota_windows`
   - 刷新按钮：优先 native `verify*` 再 fallback adapter
3. `dashboard/src/content/copy.csv`：文案不得出现「run xxx CLI」

### 后端 adapter

1. `official_account` 检测时：**禁止**再走仅本机文件路径；缺 WebView 会话时返回 `not_configured` + 明确中文提示
2. `src/lib/token-plan-refresh.js`：`mergeAdapterResultIntoRecord` 保留 catalog 参考总额度

### 测试

- Rust：`cargo test` 对应 session 模块
- Node：`node --test test/<provider>-token-plan.test.js`
- Dashboard：`npm test -- TokenPlanSection.test.jsx`

---

## 四、子任务明细

### WV-1 Claude 官方 WebView

**调研**：`docs/tasks/provider-sync/claude.md`（需更新 WebView 路径）

| 项目 | 内容 |
|------|------|
| 登录 URL | `https://console.anthropic.com/` 或 billing/settings（以实机可完成 OAuth 为准） |
| 额度 API | `GET https://api.anthropic.com/api/oauth/usage`，头 `anthropic-beta: oauth-2025-04-20` |
| 字段 | `five_hour.utilization`、`seven_day.utilization` → `quota_windows`（5h + weekly） |
| 双模式 | `claude_routing` / `claude_account_mode=routing` **不**走 WebView；UI 标明「仅 Token 统计」 |

**验收（V-WV-1）**

| ID | 标准 |
|----|------|
| 1 | 无 `~/.claude` 文件时，可通过 WebView 完成官方模式连接 |
| 2 | 刷新后卡片显示 5h/7d 窗口，与 Anthropic 控制台一致（误差仅四舍五入） |
| 3 | 两条 Claude 官方套餐（不同备注）可各自登录不同账户，互不复盖 |
| 4 | 路由模式不出现「需重新授权 / run claude」类 CLI 文案 |
| 5 | `npm test` + 新 Rust 测试全绿 |

---

### WV-2 Cursor 官方 WebView

**调研**：`docs/tasks/provider-sync/cursor.md`（需更新）

| 项目 | 内容 |
|------|------|
| 登录 URL | `https://www.cursor.com/settings` 或 usage 页（实机确认 Cookie 域） |
| 额度 API | `GET https://cursor.com/api/usage-summary`（Cookie：`WorkosCursorSessionToken`） |
| 字段 | `individualUsage.plan.*PercentUsed`、`billingCycleEnd` → 主窗口映射 `rolling_weekly` |
| 多账户 | 每条记录独立 session；**不得要求**本机安装 Cursor IDE |

**验收（V-WV-2）**

| ID | 标准 |
|----|------|
| 1 | 未安装 Cursor IDE 的机器上，仅 Token Eyes 内 WebView 登录即可同步 |
| 2 | 账单周期用量 % 与 Cursor 网页一致 |
| 3 | 双账户两条套餐记录独立刷新 |
| 4 | API 结构漂移时 `unsupported` + 中文说明，不假 0 |
| 5 | 测试全绿 |

---

### WV-3 Kimi Code 官方 WebView

**调研**：`docs/tasks/provider-sync/kimi.md`（需更新）

| 项目 | 内容 |
|------|------|
| 登录 URL | `https://www.kimi.com/code` 或平台控制台（实机确认） |
| 额度 API | `GET https://api.kimi.com/coding/v1/usages`（Bearer OAuth access token） |
| 字段 | weekly + 5h（`limits[0].detail`）→ 对齐现有 `kimi-token-plan.js` 解析 |
| 排除 | `kimi_api_budget` 仍用 API Key，本工单不改 |

**验收（V-WV-3）**

| ID | 标准 |
|----|------|
| 1 | 无 `~/.kimi-code` 时 WebView 可连接 Kimi Code 套餐 |
| 2 | 5h/周窗口与 Kimi 控制台一致 |
| 3 | 多账户备注区分 + 独立 `account_binding_id` |
| 4 | 与 `kimi_api_budget` 套餐互不干扰 |
| 5 | 测试全绿 |

---

## 五、文档同步（子项完成后）

更新以下文件，删除「待 R-xxx-01」若已实机通过：

- `docs/tasks/provider-sync/claude.md`
- `docs/tasks/provider-sync/cursor.md`
- `docs/tasks/provider-sync/kimi.md`
- `docs/tasks/provider-sync/codex.md`（改为 WebView 为主路径，CLI 降为可选）
- `进度表.md`：增加 WO-WEBVIEW 行

---

## 六、推荐执行顺序

```
WV-1 Claude（OAuth usage API 文档最清晰）
  → WV-3 Kimi Code（与 Codex 同为 OAuth Bearer）
  → WV-2 Cursor（Cookie 域与内部 API 风险最高，放最后）
  → 打包 npm run tauri:build → 给用户新 setup.exe + SHA256
  → WO-WEBVIEW 总对抗性审查
```

---

## 七、打包与交付

1. `npm test` + `npm --prefix dashboard test` + `cargo test`（session 相关）
2. `npm run tauri:build`
3. 输出路径：`src-tauri/target/release/bundle/nsis/Token Eyes_0.54.0_x64-setup.exe`
4. 汇报必须包含：**SHA256**、三项子任务实机截图清单、已知限制

---

## 八、新窗口派发口令（复制即用）

```
请执行 docs/tasks/工单-WO-WEBVIEW-剩余官方登录.md（WO-WEBVIEW）。

目标：为 Claude、Cursor、Kimi Code 实现与 MiMo/GLM/Codex 同级的 Tauri WebView 官网登录 + Token 套餐额度同步，支持每条套餐记录独立 account_binding_id 多账户；禁止依赖本地 CLI/auth.json 作为唯一路径。

参考：xiaomi_mimo_session.rs、glm_session.rs、codex_session.rs、TokenPlanSection.jsx 中 Codex 多账户修复。

按 WV-1 → WV-3 → WV-2 顺序实现；每项完成后对抗性审查写入 docs/tasks/工单审查记录.md；全部通过后 tauri:build 并给出新安装包 SHA256。未实机验证不得汇报完成。
```

---

## 九、与主工单索引关系

| 主工单 | 关系 |
|--------|------|
| WO-4 套餐官方同步 | GLM 已完成；Kimi **Code** WebView 本工单补齐；MiniMax/百炼不在此单 |
| WO-9 Codex/Claude/Cursor | Codex WebView 已完成；Claude/Cursor WebView 本工单补齐 |
| 2026-07-08 热修 | 本工单建立在安装包 `75CFF648…` 之上，勿回退 catalog/GLM API 修复 |
