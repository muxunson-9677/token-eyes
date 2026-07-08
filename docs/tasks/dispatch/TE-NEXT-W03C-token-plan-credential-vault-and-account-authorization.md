# TE-NEXT-W03C - Token 套餐账号授权与本机凭证保管

## 任务 ID

`TE-NEXT-W03C`

## 所属模块

Token 套餐 / 账号授权 / 本机安全存储

## 前置依赖

`TE-NEXT-W03A` 已明确小米 MiMo 的官方授权方式或明确声明没有官方授权方式；`TE-NEXT-W03B` 已完成结构化 `provider_id` 与 `plan_id` 保存。

## 任务目标

为套餐记录建立可撤销的“账号绑定”能力。应用只保存不含秘密内容的绑定元数据和凭证引用；真正的授权令牌或用户明确导入的会话凭证只能保存在 Windows 当前用户可访问的安全存储中。设置页允许用户发起官方授权、查看绑定状态、重新授权和删除绑定。

本工单提供通用本机凭证边界与 UI，不实现小米额度抓取；小米适配器由 `TE-NEXT-W03D` 完成。

## 安全决策

授权方式按以下优先级实现：

1. 官方 OAuth、设备码或官方控制台生成的只读令牌。
2. 用户在官方控制台手动创建的 API Key。
3. 仅当 W03A 证明目标服务条款允许且没有官方替代方案时，允许用户在本应用的受保护输入框手动粘贴已登录会话凭证。

禁止自动读取 Chrome、Edge、Firefox 或 WebView 的 Cookie 数据库；禁止拦截账号密码、验证码、二维码、浏览器登录请求或“抓取”用户浏览器中的 Cookie。手动导入会话凭证不是默认路径，必须有显式风险提示、一次确认和随时删除入口。

## 开始前必读

1. `CLAUDE.md`
2. `docs/tasks/dispatch/TE-NEXT-W03A-xiaomi-mimo-plan-contract-discovery.md`
3. `docs/tasks/dispatch/TE-NEXT-W03B-token-plan-provider-catalog-and-form.md`
4. `src-tauri/Cargo.toml`
5. `src-tauri/src/lib.rs`
6. `src-tauri/src/commands.rs`
7. `src-tauri/tauri.conf.json`
8. `src/lib/local-api.js`
9. `src/lib/token-plan-refresh.js`
10. `dashboard/src/lib/api.ts`
11. `dashboard/src/components/settings/TokenPlanSection.jsx`

## 允许修改的文件

- 新增：`src-tauri/src/credential_vault.rs`
- 新增：`src-tauri/src/credential_vault_test.rs`，或在 `credential_vault.rs` 的 `#[cfg(test)]` 模块中编写测试
- 修改：`src-tauri/Cargo.toml`
- 修改：`src-tauri/src/lib.rs`
- 修改：`src-tauri/src/commands.rs`
- 新增：`src/lib/token-plan-credentials.js`
- 新增：`test/token-plan-credentials.test.js`
- 修改：`src/lib/local-api.js`
- 修改：`test/token-plans-api.test.js`
- 修改：`dashboard/src/lib/api.ts`
- 修改：`dashboard/src/components/settings/TokenPlanSection.jsx`
- 修改：`dashboard/src/components/settings/TokenPlanSection.test.jsx`
- 修改：`dashboard/src/content/copy.csv`
- 修改：`dashboard/src/content/i18n/zh/dashboard.json`，仅在 copy 流程要求时修改

如当前 Tauri 与本地 Node 服务之间没有安全命令桥，先在本工单中最小化建立桥；不得把秘密退化为写入 `tracker-config.json`、环境变量、日志或普通 JSON 文件。

## 确定的数据规范

本地配置只保存下面的绑定元数据：

```js
{
  id: "uuid",
  provider_id: "xiaomi_mimo",
  display_name: "小米 MiMo 主账号",
  auth_kind: "official_oauth|api_key|manual_session",
  credential_ref: "token-plan/xiaomi_mimo/<uuid>",
  status: "connected|expired|revoked|unsupported",
  connected_at: "2026-06-25T00:00:00.000Z",
  last_verified_at: "",
  last_error_code: "",
  last_error_message: ""
}
```

凭证保险库接口固定为：

```text
setTokenPlanCredential(reference, secret) -> void
getTokenPlanCredential(reference) -> string | null
deleteTokenPlanCredential(reference) -> void
```

约束：

- `reference` 只能匹配 `token-plan/<provider_id>/<uuid>`。
- `secret` 不可通过任意 GET API、前端状态、浏览器控制台日志、测试快照或 tracker config 返回。
- `credential_ref` 不再使用旧的 `codex_auth_json`/`claude_credentials_json` 固定白名单；允许上述受控引用格式。
- 删除绑定必须先删除保险库内容，再删除配置元数据。
- 仅原生桌面运行时可创建和读取秘密。网页或 Vite 开发环境必须返回“仅桌面应用支持账号绑定”，不能假装成功。

## 任务 1：先写凭证保险库的失败测试

### 1.1 Rust 单元测试

为保险库后端选择一个支持 Windows 当前用户安全存储的实现。测试需覆盖：

1. 合法引用可写入后读取到原值。
2. 非法引用被拒绝。
3. 删除后读取返回空值。
4. 错误信息不包含秘密原文。

如果真实 Windows 凭证管理器不适合 CI，抽象一个 `CredentialStore` trait；测试用内存实现，生产实现调用 Windows 当前用户安全存储。测试不得创建明文凭证文件。

运行：

```bash
cd src-tauri
cargo test credential_vault
```

预期：在实现前失败，之后通过。

### 1.2 Node 桥接测试

新建 `test/token-plan-credentials.test.js`，以可注入的桥接函数测试：

```js
test("凭证引用校验拒绝原始 Cookie", async () => {
  await assert.rejects(
    () => saveCredential({ reference: "raw-cookie=secret", secret: "secret" }),
    /credential reference/i,
  );
});

test("列表接口永不返回凭证原文", async () => {
  const record = await createBinding({ provider_id: "xiaomi_mimo", secret: "do-not-leak" });
  assert.equal(JSON.stringify(record).includes("do-not-leak"), false);
});
```

测试开始时应失败，不能以 mock 直接绕过引用校验。

## 任务 2：实现原生保险库与受限桥接

1. 在 Tauri 侧实现 `set`、`get`、`delete` 三个受限命令，只接受合法引用。
2. 使用当前 Windows 用户范围的系统凭证保管能力；Rust 依赖必须选择有维护状态且支持 Windows 的库。
3. 原生命令的返回值只返回状态和错误码；`set`/`delete` 永不回显秘密。
4. `get` 只允许受信任的本地后端桥调用，不能暴露为浏览器可直接调用的通用“读秘密”接口。
5. 在 Node 层封装 `src/lib/token-plan-credentials.js`：负责引用校验、运行时检测和对受限桥的调用，不持久化秘密。
6. 修改 `src/lib/token-plan-refresh.js`：移除固定凭证白名单，改为仅接受受控引用格式；刷新时将 `credentialRef` 传给适配器，适配器通过受限凭证服务获取秘密。

不可为“方便调试”增加明文 fallback。非原生运行时应返回结构化的 `desktop_required` 错误。

## 任务 3：账号绑定本地 API

在 `src/lib/local-api.js` 增加以下端点，所有变更请求必须沿用本地授权校验：

```text
GET    /functions/tokentracker-token-plan-bindings
POST   /functions/tokentracker-token-plan-bindings
DELETE /functions/tokentracker-token-plan-bindings?id=<binding-id>
POST   /functions/tokentracker-token-plan-bindings/<binding-id>/verify
```

响应中的绑定对象必须严格只包含“确定的数据规范”中的元数据字段。创建时：

1. 检查 `provider_id` 是否在服务商目录中。
2. 检查 `auth_kind` 是否是 W03A 为该服务商确认的方式。
3. 使用保险库保存秘密；成功后才写入绑定元数据。
4. 返回 `connected` 或 W03A 已知的 `unsupported`，不把秘密写入响应。

为端点新增测试：未授权返回 `401`、无效服务商返回 `400`、创建后 GET 无秘密、删除后保险库删除被调用、网页运行时返回 `desktop_required`。

## 任务 4：账号绑定 UI

在 Token 套餐设置区域新增“绑定账号”入口，满足：

1. 选择服务商后显示其支持的授权方式及 W03A 的官方链接。
2. 官方 OAuth/设备码存在时，按钮仅打开官方授权流程并展示回调成功、过期和撤销状态。
3. API Key 与手动会话凭证必须使用密码型受保护输入；输入提交后立即从 React state 清空。
4. 手动会话凭证方案必须显示风险提示、用途说明、服务条款提示和确认框；未确认不能保存。
5. 已绑定账号显示账号别名、连接状态、最后验证时间、重新授权和删除按钮；不显示密钥、Cookie 或 token 片段。
6. 套餐记录只通过 `account_binding_id` 关联绑定；不得让用户手填 `credential_ref`。

全部新增文案进入 `copy.csv`。测试至少覆盖：网页运行时禁用绑定、创建请求不回显秘密、删除绑定按钮调用 DELETE、手动会话凭证未确认不能提交。

## 最终验证

运行：

```bash
cd src-tauri
cargo test credential_vault
cd ..
node --test test/token-plan-credentials.test.js test/token-plans-api.test.js test/token-plan-refresh.test.js
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
npx tauri build --no-bundle
```

人工安全检查：

```powershell
rg -n -i "<测试秘密>|raw-cookie=secret|do-not-leak" "$HOME\.tokentracker" src-tauri\target dashboard\dist
```

预期：没有命中。测试使用的秘密变量应由测试清理，不能遗留在用户目录。

## 验收标准

1. 真正的凭证只在 Windows 当前用户安全存储中存在，不在 JSON、日志、网络响应或前端状态中出现。
2. 绑定元数据可创建、列出、验证和删除；删除后无法再读取凭证。
3. 用户可以看见授权状态、重试和删除入口，不能看见秘密内容。
4. 网页环境不会提供伪账号绑定能力。
5. 旧 Token Plan 记录仍可读取和手动刷新。
6. 所有最终验证命令通过。

## 禁止事项

- 不自动抓取浏览器 Cookie，不读取 Chrome/Edge/Firefox 数据库。
- 不采集账号密码、验证码或二维码，不模拟登录，不绕过风控。
- 不将秘密写入 `tracker-config.json`、`.env`、命令行参数、测试截图或错误日志。
- 不将 Tauri 的通用秘密读取命令暴露给任意页面 JavaScript。
- 不实现小米的用量 HTTP 请求；该工作属于 W03D。

## 完成后报告

回复包括：所选 Windows 凭证保管实现、绑定 API 清单、秘密不落盘检查结果、每条自动化验证结果、已知受限授权方式和新的 EXE 路径。
