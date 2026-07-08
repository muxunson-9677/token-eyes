# PM-FEISHU-01 Token Eyes Progress Sync Implementation Plan

> **For agentic workers:** Execute this operational work order directly. Use the global Feishu credential loader; do not request or print credentials. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用已配置的全局飞书应用凭证，把 W03E-R3A 真实阻塞状态和后续 R3B/R3C/R3D/R3E 编排同步到 Token Eyes 进度表，并读回确认没有重复或误写。

**Architecture:** App ID/App Secret 只在运行时通过 `C:\Users\admin\.feishu\read-config.cjs` 的 `loadFeishuConfig()` 读取；项目 `.env` 只用于读取 `FEISHU_APP_TOKEN` 和 `FEISHU_TABLE_ID`。先读取表结构和现有记录，再按 `任务ID` upsert，最后重新读取并逐项核对。

**Tech Stack:** Node.js 20、飞书开放平台 tenant token API、多维表格 Bitable API、项目 `.env` 标识符。

---

## 0. 已验证前提

截至 2026-06-27，本机只读验证结果：

- `C:\Users\admin\.feishu\read-config.cjs` 可正常加载 `appId` / `appSecret`。
- tenant access token 请求返回 HTTP 200、`code=0`。
- 项目 `.env` 中 `FEISHU_APP_TOKEN`、`FEISHU_TABLE_ID` 均存在。
- 使用全局应用凭证和项目表标识读取多维表格返回 HTTP 200、`code=0`。

这些结论不代表写入已经完成。本工单仍需在写入前重新验证，并在写入后读回。

## 1. 安全规则

- 禁止输出、记录、复制或写入项目文件：App Secret、tenant access token、Authorization header。
- 禁止要求用户再次提供 App ID/App Secret。
- 禁止读取后把全局 secret 覆盖回项目 `.env`。
- 任何日志只能输出 HTTP 状态、飞书 `code/msg`、记录 ID 和非敏感任务字段。
- 任务字段中如存在负责人个人信息，不在最终消息中批量打印。
- 默认不修改本地项目文件；只写外部飞书表。
- 不执行 git 操作。

## 2. 数据来源

必读：

- `C:\Users\admin\.codex\AGENTS.md` 中 Feishu Global Credentials 规则
- `C:\Users\admin\.feishu\read-config.cjs`
- `docs/feishu-setup.md`
- `docs/tasks/dispatch/TE-NEXT-W03-R3-feishu-progress-sync-record.md`
- `docs/tasks/dispatch/TE-NEXT-W03E-R3-subagent-execution-map.md`
- `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`
- 本工单对应的 R3B/R3C/R3D/R3E 文件

配置来源：

| 配置 | 来源 |
|---|---|
| `appId` | `loadFeishuConfig()` |
| `appSecret` | `loadFeishuConfig()`，只在内存使用 |
| `FEISHU_APP_TOKEN` | 项目 `.env` |
| `FEISHU_TABLE_ID` | 项目 `.env` |

不得用项目 `.env` 中可能已经失效的 `FEISHU_APP_SECRET` 覆盖全局配置。

## 3. 目标记录

按 `任务ID` upsert 以下记录。表内已有同 ID 时更新，不存在时新增；不得创建重复 ID。

| 任务ID | 所属模块 | 任务标题 | 状态 | 当前阶段 | 前置任务 | 进度说明 |
|---|---|---|---|---|---|---|
| W03E-R3A | Token 套餐 | 小米 MiMo 官方控制台额度接口契约确认 | 阻塞 | 契约证据 | W03-R3D | 已完成只读调查；缺少官方控制台登录态网络证据，结论 BLOCKED，不得开始生产 adapter |
| W03E-R3B | Token 套餐 | 官方额度证据与安全会话能力解阻 | 待分派 | 技术验证 | W03E-R3A | 需要真实登录态证据和可执行 sessionFetch/callable boundary；允许 READY 或证据充分的 BLOCKED |
| W03E-R3C | Token 套餐 | 小米 MiMo 官方 quota adapter | 被阻塞 | 后端实现 | W03E-R3B | 仅在 R3B READY 后派发；401/403 映射 reauth_required，失败保留旧额度 |
| W03E-R3D | Token 套餐 | 官方同步 UI 与端到端验收 | 被阻塞 | 集成验收 | W03E-R3C,W03E-R3E | 等 adapter 和 legacy UI 收口完成后执行，不新增独立小米卡片 |
| W03E-R3E | Token 套餐 | 移除 legacy cookie_scrape 用户入口 | 待分派 | 前端清理 | W03-R3D | 可与 R3B 并行；不得与 R3D 并行编辑 TokenPlanSection |
| PM-FEISHU-01 | 项目管理 | 同步 W03E-R3 进度到飞书 | 进行中 | 进度同步 | 无 | 使用全局飞书凭证 upsert 并读回确认；不得泄露凭证 |

如果飞书单选字段不存在“被阻塞”等选项，不要擅自新增大量枚举。先读取字段元数据和现有同类记录，使用表内已有的等价状态，并在回报中写明映射。

## 4. Task 1：安全加载配置

Node 脚本必须直接调用：

```js
const { loadFeishuConfig } = require("C:/Users/admin/.feishu/read-config.cjs");
const { appId, appSecret } = loadFeishuConfig();
```

- [ ] 用本地解析逻辑读取项目 `.env` 的 `FEISHU_APP_TOKEN` 和 `FEISHU_TABLE_ID`。
- [ ] 不 `console.log(config)`，不打印任何配置值。
- [ ] 仅输出配置项是否存在，不输出长度也不是必需。
- [ ] 缺少表标识时报告准确路径和缺少的 key，不要求用户重新输入 App Secret。

## 5. Task 2：取得 tenant token

调用：

```text
POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
```

请求体在内存中使用 `app_id`、`app_secret`。日志只输出：

```json
{
  "http_status": 200,
  "code": 0,
  "msg": "ok",
  "token_present": true
}
```

- [ ] `code != 0` 时停止，不执行任何表写入。
- [ ] 不打印响应中的 `tenant_access_token`。
- [ ] token 只保存在当前进程变量中。

## 6. Task 3：读取字段和现有记录

先读取字段元数据，再读取全部记录；处理分页，不能只读第一页。

API：

```text
GET /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/fields
GET /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records?page_size=500
```

- [ ] 确认表内存在 `任务ID` 字段。
- [ ] 建立 `任务ID -> record_id` 映射。
- [ ] 检查目标六个 ID 是否已有重复记录。
- [ ] 如已有重复 ID，停止写入并报告 record_id 列表，不自行删除。
- [ ] 读取状态/阶段/任务归属等字段类型和可用单选值。
- [ ] 只保留完成 upsert 所需的字段，不转储整张表。

## 7. Task 4：按任务 ID upsert

更新已有记录：

```text
PUT /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/{record_id}
```

新增记录：

```text
POST /open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records
```

- [ ] 写入前根据字段元数据构造 payload，不能猜测人员、多选或单选字段格式。
- [ ] 只更新本工单列出的目标任务字段，不覆盖表内备注、负责人或其他人工字段，除非值为空且现有同步规范明确要求。
- [ ] 每次写入检查 HTTP status 和飞书 `code`。
- [ ] 任一写入失败后停止后续批量写入，报告已成功和未执行的任务 ID。
- [ ] 最后把 PM-FEISHU-01 状态更新为表内等价“已完成”，前提是其他目标记录均写入成功。

## 8. Task 5：读回验收

- [ ] 重新分页读取记录。
- [ ] 对六个任务 ID 逐项确认仅有一条记录。
- [ ] 对比标题、状态、当前阶段、前置任务和进度说明。
- [ ] 确认 W03E-R3A 是 BLOCKED/表内等价状态，不是 READY 或已完成。
- [ ] 确认 R3C/R3D 仍显示依赖阻塞，不能被误写为可开工。
- [ ] 输出非敏感读回摘要，不输出 token、配置值或整表内容。

完成判定：全部写入返回 `code=0`，并且读回数据与目标矩阵一致。

## 9. 失败处理

| 情况 | 动作 |
|---|---|
| 全局配置无法读取 | 报告 `C:\Users\admin\.feishu\read-config.cjs` 的具体访问/格式错误 |
| tenant token `code != 0` | 停止，报告 code/msg，不打印凭证 |
| app token/table id 无效 | 停止，报告飞书 code/msg |
| 表结构字段缺失 | 停止，不自动创建字段 |
| 同一任务 ID 重复 | 停止，不自动删除记录 |
| 单选值不匹配 | 使用已有等价值或停止并报告，禁止大规模改表结构 |
| 部分写入失败 | 停止，列出成功/失败/未执行任务 ID，随后只读核对 |

## 10. 禁止事项

- 不读取或使用项目 `.env` 中旧 App Secret 覆盖全局 secret。
- 不输出 secret/token/Authorization。
- 不修改本地代码和任务文件。
- 不创建、删除或重命名飞书字段/表。
- 不删除重复记录。
- 不把 R3A 改成 READY。
- 不把尚未满足依赖的 R3C/R3D 改成进行中或完成。
- 不提交 git。

## 11. 返回模板

```markdown
## PM-FEISHU-01 结果
- 结论：COMPLETED / BLOCKED / PARTIAL
- 全局配置读取：成功 / 失败
- tenant token：code=0 / 失败 code（不输出 token）
- 表读取：code=0 / 失败

## Upsert 摘要
- 新增任务 ID：
- 更新任务 ID：
- 未执行任务 ID：
- 重复任务 ID：无 / 列表

## 读回验收
- 六个任务是否各一条：
- R3A 是否保持 BLOCKED：
- R3C/R3D 依赖状态是否正确：

## 安全检查
- 是否输出 App Secret/tenant token：否
- 是否修改本地文件：否

## 剩余问题
- 无；如有则逐项填写
```
