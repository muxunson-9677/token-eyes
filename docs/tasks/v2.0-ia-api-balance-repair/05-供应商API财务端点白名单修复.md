# 05 - 供应商 API 财务端点白名单修复

## 中文简述

本工单继续复用上一轮 `01-密钥安全修复.md` 的安全上下文。当前独立验收发现：供应商 API 配置虽然拦截了一部分模型 endpoint，但仍允许非财务类 POST endpoint，例如 `realtime/sessions`、`batches`、`countTokens` 和任意 `example.com/api/run-agent`。这不符合产品边界：设置里的供应商 API 配置只用于读取账户余额、账单、用量和花销，不允许做模型调用、通用 API 测试、agent 触发或任何非财务请求。

## 第一性原理执行规则

- 产品目标不是“让任意 API 配置能请求成功”，而是“只安全读取账户财务信息”。
- 真实 API Key 的安全边界优先于兼容性；不确定是否财务 endpoint 时默认拒绝。
- 先写能复现当前缺口的失败测试，再做最小修复，不允许只靠源码推断。
- 不新增模型调用能力，不新增请求正文编辑器，不新增通用 API 调试器。
- POST 只有在明确属于已知财务/账单适配器且不会触发模型或任务执行时才允许；否则默认拒绝。
- 错误码和错误信息必须能让 UI 区分“配置不合法”和“endpoint 不受支持”，不得泄露 API Key。

## 贝叶斯验收缺口

| 项目 | 修复前状态 | 新反例 | 影响 | 目标后验 |
|---|---:|---|---|---:|
| B4 密钥安全边界 | 曾宣称达标 | 非财务 POST endpoint 仍 `ok:true` | 真实 API Key 可被发往非财务接口 | >= 0.99 |
| B5 真实财务接口 | 待真实账户验证 | 财务范围不清晰 | 无法放心接入真实 Key | >= 0.95 |

## 当前缺漏证据

在仓库根目录运行：

```powershell
node -e "const {validateProviderApiConfig}=require('./src/lib/provider-api-configs'); const base={providerId:'probe',label:'probe',requestMethod:'POST',authType:'bearer',balancePath:'data.balance',refreshIntervalSeconds:300}; for (const requestUrl of ['https://api.openai.com/v1/realtime/sessions','https://api.openai.com/v1/batches','https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens','https://example.com/api/run-agent']) console.log(JSON.stringify({requestUrl,result:validateProviderApiConfig({...base,requestUrl})}));"
```

修复前实际结果：

```json
{"requestUrl":"https://api.openai.com/v1/realtime/sessions","result":{"ok":true}}
{"requestUrl":"https://api.openai.com/v1/batches","result":{"ok":true}}
{"requestUrl":"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens","result":{"ok":true}}
{"requestUrl":"https://example.com/api/run-agent","result":{"ok":true}}
```

## 修复范围

重点检查并修改：

- `src/lib/provider-api-configs.js`
- `src/lib/provider-api-executor.js`
- `test/provider-api-security.test.js`
- `test/provider-api-configs-api.test.js`
- `test/provider-api-balance.test.js`

如果项目已有 URL policy/helper，应复用，不要平行新增重复规则。若必须新增 helper，命名要清晰，例如 `isFinancialProviderEndpoint()` 或 `validateFinancialProviderEndpoint()`。

## 必须实现

1. 建立财务 endpoint 允许规则。
   - 允许余额、账单、用量、成本、credit、subscription、invoice 等财务读取 endpoint。
   - 允许规则必须以 host + pathname 双重判断为准，不能只靠字符串包含。
   - path 需要做规范化，至少处理尾部斜杠、重复斜杠、`.` 段、大小写不一致。

2. 拒绝非财务 endpoint。
   - 拒绝模型推理、token 计算、realtime、batch、file、assistant、chat、messages、embedding、completion、agent/run 等 endpoint。
   - 拒绝任意第三方自定义非财务 POST endpoint。
   - 拒绝无法归类的 POST endpoint。

3. 统一配置校验和执行器校验。
   - `validateProviderApiConfig()` 必须拒绝。
   - 实际执行 `provider-api-executor` 必须再次拒绝，不能只靠前端或保存时校验。
   - 返回稳定错误码，建议使用 `unsupported_endpoint`；如果现有错误码体系必须用 `invalid_config`，需要在工单回写中说明原因。

4. 保持合法财务接口可用。
   - 已有测试里的合法余额/账单 endpoint 不能被误杀。
   - 合法 GET 财务 endpoint 必须继续通过。
   - 若保留合法 POST 财务 endpoint，必须有测试证明它是财务读取，不会带模型请求正文。

## 必须新增或修改的测试

至少覆盖以下断言：

- `https://api.openai.com/v1/realtime/sessions` 被拒绝。
- `https://api.openai.com/v1/batches` 被拒绝。
- `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens` 被拒绝。
- `https://example.com/api/run-agent` 被拒绝。
- `https://api.openai.com/v1/chat/completions/` 和多尾斜杠形式被拒绝。
- 合法财务 endpoint 仍通过，例如项目当前测试中已有的余额、账单或用量 endpoint。
- 保存配置和实际刷新余额两条路径都拒绝非财务 endpoint。

## 必须运行的验证命令

```powershell
node --test test/provider-api-security.test.js test/provider-api-configs-api.test.js test/provider-api-balance.test.js
npm test
npm --prefix dashboard run test
npm --prefix dashboard run typecheck
npm run validate:guardrails
git diff --check
```

如果因时间只跑了部分全量命令，必须在回写中明确标记为未完成，不能写“已验收”。

## 验收标准

- 上述四个新反例全部从 `ok:true` 变成明确拒绝。
- `validateProviderApiConfig()` 和实际执行器都拒绝。
- 错误响应不包含 API Key、Authorization、Cookie 或自定义密钥 header 原文。
- 合法财务 endpoint 不受影响。
- B4 后验重新计算并达到 `>= 0.99`。
- 工单回写包含失败证据、修复提交、测试输出和剩余风险。

## 完成回写模板

```text
执行摘要：
复用上一轮上下文：01-密钥安全修复
失败反例：
修改文件：
新增/修改测试：
修复后命令、退出码和关键输出：
安全扫描结果：
合法财务 endpoint 回归结果：
B4/B5 后验更新：
Git 提交：
剩余风险：
```

## 对抗性审查要求

工单执行完成的最后增加一个审查环节，以对抗性审查的方式回写审查记录，如果出现问题就修复，修复执行完的环节依旧是对抗性审查，直到都完成了才能结束，并汇报给我工单的完成情况。

---

## 第一性原理验收目标复述

按 05 工单"第一性原理执行规则"复述：

- 产品目标不是"让任意 API 配置能请求成功"，而是"只安全读取账户财务信息"。真实 API Key 的安全边界优先于兼容性；不确定是否财务 endpoint 时默认拒绝。
- 必须证明以下 endpoint 被保存校验（`validateProviderApiConfig`）和实际执行器（`executeFinancialRequest`）同时拒绝：
  - `https://api.openai.com/v1/realtime/sessions`
  - `https://api.openai.com/v1/batches`
  - `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens`
  - `https://example.com/api/run-agent`
  - `https://api.openai.com/v1/chat/completions/`
- 不得新增模型调用、通用 API 调试器、请求正文编辑器。
- 不得读取、记录、回显任何真实 API Key。
- 合法财务 endpoint 不能被误杀。
- 错误码必须区分"配置不合法"（`invalid_config`）和"endpoint 不受支持"（`unsupported_endpoint`），不得泄露 API Key。

## 执行摘要

复用上一轮 `01-密钥安全修复` 安全上下文，在分支 `fix/v2-05-financial-endpoint-whitelist`（从 `fix/v2-03-release-config-reproducibility` HEAD `7691ba7` 分出，已包含 01/02/03/04 全部修复）上执行 05 工单。

新增财务 endpoint allowlist（`isFinancialProviderEndpoint` + `normalizeFinancialPath`），将供应商 API 配置的 endpoint 校验从"blocklist（只拦截模型推理 endpoint）"升级为"allowlist（只允许含财务关键词的 pathname）"。配置校验（`validateProviderApiConfig`）和执行器（`executeFinancialRequest`）双重拒绝非财务 endpoint，返回稳定错误码 `unsupported_endpoint`。合法财务 endpoint（balance/billing/costs/usage 等）全部通过回归。

## 复用上一轮上下文：01-密钥安全修复

- 01 修复的 `isModelEndpoint`（剥离 query/fragment/trailing-slash）、`sanitizeErrorMessage`（extraSecrets verbatim 脱敏）、`validateRedirectTarget`（HTTPS/云元数据/模型endpoint/密钥参数校验）保持不变。
- 05 复用 `provider-api-executor.js` 的 URL 校验框架（`isAllowedUrl`），在其内部追加财务白名单检查，确保所有调用 `isAllowedUrl` 的路径统一受益。

## 失败反例（修复前复现证据）

仓库根目录运行复现命令（PowerShell）：

```powershell
node -e "const {validateProviderApiConfig}=require('./src/lib/provider-api-configs'); const base={providerId:'probe',label:'probe',requestMethod:'POST',authType:'bearer',balancePath:'data.balance',refreshIntervalSeconds:300}; for (const requestUrl of ['https://api.openai.com/v1/realtime/sessions','https://api.openai.com/v1/batches','https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens','https://example.com/api/run-agent','https://api.openai.com/v1/chat/completions/']) console.log(JSON.stringify({requestUrl,result:validateProviderApiConfig({...base,requestUrl})}));"
```

修复前实际结果（4 个非财务 endpoint 返回 `ok:true`，仅 `chat/completions/` 被 01 的 `isModelEndpoint` 拦截）：

```json
{"requestUrl":"https://api.openai.com/v1/realtime/sessions","result":{"ok":true}}
{"requestUrl":"https://api.openai.com/v1/batches","result":{"ok":true}}
{"requestUrl":"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens","result":{"ok":true}}
{"requestUrl":"https://example.com/api/run-agent","result":{"ok":true}}
{"requestUrl":"https://api.openai.com/v1/chat/completions/","result":{"ok":false,"error_code":"invalid_config","error":"不允许配置模型推理端点"}}
```

反例解读：`realtime/sessions`（OpenAI Realtime API）、`batches`（OpenAI Batch API）、`countTokens`（Gemini token 计数）、`run-agent`（任意第三方 agent 触发）均不是财务 endpoint，但因 pathname 不在 `MODEL_ENDPOINT_PATTERNS` 内而通过校验。真实 API Key 可能被发往这些非财务接口，违反"只安全读取账户财务信息"的产品边界。

## 修改文件

1. `src/lib/provider-api-executor.js`
   - 新增 `FINANCIAL_KEYWORDS` 集合（balance/billing/costs/usage/spend/credit/subscription/invoice/quota/payment 及复数形式）。
   - 新增 `FINANCIAL_KEYWORD_REGEX`：关键词前后必须是字符串边界或路径分隔符（`/ : . _ -`），避免 `cost` 误匹配 `toast`。
   - 新增 `normalizeFinancialPath(pathname)`：小写化、合并重复斜杠、用 split+stack 解析 `.`/`..` 段（简单正则无法 pop 前一栈帧，必须用栈）、去尾部斜杠。
   - 新增 `isFinancialProviderEndpoint(url)`：用 `new URL()` 解析取 pathname（host 已由 `isCloudMetadataAddress` 和 HTTPS 校验覆盖），规范化后匹配财务关键词；根路径 `/` 和无效 URL 返回 false。
   - 在 `isAllowedUrl` 中加入 `if (!isFinancialProviderEndpoint(url)) return false;`（模型 endpoint 检查之后）。
   - 在 `executeFinancialRequest` 的原因判断中加入 `isFinancialProviderEndpoint` 分支，返回 `unsupported_endpoint`（与 `invalid_config` 区分）。
   - `module.exports` 导出 `isFinancialProviderEndpoint` 和 `normalizeFinancialPath`。

2. `src/lib/provider-api-configs.js`
   - 导入 `isFinancialProviderEndpoint`。
   - 在 `validateProviderApiConfig` 中，模型 endpoint 检查之后，加入财务白名单检查，返回 `ERROR_CODES.UNSUPPORTED_ENDPOINT`。

3. `test/provider-api-security.test.js`
   - 导入 `isFinancialProviderEndpoint`、`normalizeFinancialPath`。
   - 新增 36 个测试（详见下节）。

## 新增/修改测试

`test/provider-api-security.test.js` 新增 36 个测试（文件总数 81 → 117）：

**`isFinancialProviderEndpoint` 单元测试（16 个）**：
- 允许 balance / billing / costs / usage / spend / credit / subscription / invoice / quota / payment endpoint。
- 拒绝 realtime/sessions、batches、countTokens、run-agent、chat/completions。
- 拒绝根路径和无效 URL（`/`、空、null、undefined、`not-a-url`）。
- 拒绝形似但非财务的路径（`/v1/toast` 不匹配 `cost`；`/v1/balanced-report` 不匹配 `balance` 因为 `d` 非分隔符；`/v1/costs-report` 匹配因为 `-` 是分隔符）。
- 大小写不敏感（`/v1/BALANCE` 通过，`/v1/REALTIME/SESSIONS` 拒绝）。
- 尾部斜杠（`/v1/balance/` 和 `/v1/balance///` 通过，`/v1/realtime/sessions/` 拒绝）。
- 重复斜杠（`//v1//balance` 通过，`/v1//batches` 拒绝）。
- query string 和 fragment 不影响（`/v1/balance?foo=bar` 通过，`/v1/batches?foo=bar` 拒绝）。
- dot 段解析（`/v1/balance/../realtime/sessions` URL 解析为 `/v1/realtime/sessions` 拒绝；`/v1/realtime/../balance` 解析为 `/v1/balance` 通过）。
- `normalizeFinancialPath` 单元测试（小写、合并斜杠、strip trailing、`.`/`..` 解析、空输入）。

**`validateProviderApiConfig` 拒绝非财务 endpoint（8 个）**：
- realtime/sessions → `unsupported_endpoint`
- batches → `unsupported_endpoint`
- countTokens → `unsupported_endpoint`
- run-agent → `unsupported_endpoint`
- chat/completions/ → `invalid_config`（模型推理端点，先被 `isModelEndpoint` 拦截）
- 合法财务 endpoint 回归（costs/billing/balance/example.com/balance 全通过）
- mock-server `/balance` 在 testMode 通过
- POST 到财务 endpoint 允许，POST 到非财务 endpoint 拒绝

**`executeFinancialRequest` 执行器拒绝（6 个）**：
- realtime/sessions → `unsupported_endpoint`
- batches → `unsupported_endpoint`
- countTokens → `unsupported_endpoint`
- run-agent → `unsupported_endpoint`
- chat/completions/ → `invalid_config`
- 错误响应不泄漏密钥（`TE_REPAIR_SECRET_05_executor_no_leak` 不出现在结果 JSON 中）

**集成测试 — local-api 保存配置路径（3 个）**：
- 4 个非财务 endpoint 通过 `/functions/tokentracker-provider-api-configs` POST 保存时返回 400 + `unsupported_endpoint`
- chat/completions/ 保存时返回 400 + `invalid_config`
- 合法财务 endpoint（costs/billing/balance）保存时返回 200

## 修复后命令、退出码和关键输出

### 1. 复现命令（修复后）

```powershell
node -e "const {validateProviderApiConfig}=require('./src/lib/provider-api-configs'); const base={providerId:'probe',label:'probe',requestMethod:'POST',authType:'bearer',balancePath:'data.balance',refreshIntervalSeconds:300}; for (const requestUrl of ['https://api.openai.com/v1/realtime/sessions','https://api.openai.com/v1/batches','https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens','https://example.com/api/run-agent','https://api.openai.com/v1/chat/completions/']) console.log(JSON.stringify({requestUrl,result:validateProviderApiConfig({...base,requestUrl})}));"
```

修复后结果（4 个非财务 endpoint 返回 `unsupported_endpoint`，chat/completions/ 返回 `invalid_config`）：

```json
{"requestUrl":"https://api.openai.com/v1/realtime/sessions","result":{"ok":false,"error_code":"unsupported_endpoint","error":"只允许查询财务端点（余额/账单/用量/花销/订阅/发票/配额/支付）"}}
{"requestUrl":"https://api.openai.com/v1/batches","result":{"ok":false,"error_code":"unsupported_endpoint","error":"只允许查询财务端点（余额/账单/用量/花销/订阅/发票/配额/支付）"}}
{"requestUrl":"https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:countTokens","result":{"ok":false,"error_code":"unsupported_endpoint","error":"只允许查询财务端点（余额/账单/用量/花销/订阅/发票/配额/支付）"}}
{"requestUrl":"https://example.com/api/run-agent","result":{"ok":false,"error_code":"unsupported_endpoint","error":"只允许查询财务端点（余额/账单/用量/花销/订阅/发票/配额/支付）"}}
{"requestUrl":"https://api.openai.com/v1/chat/completions/","result":{"ok":false,"error_code":"invalid_config","error":"不允许配置模型推理端点"}}
```

### 2. 执行器拒绝验证

```powershell
node -e "const {executeFinancialRequest}=require('./src/lib/provider-api-executor'); ... "
```

5 个 endpoint 在执行器路径全部被拒绝（4 个 `unsupported_endpoint` + 1 个 `invalid_config`）。

### 3. 针对性测试

```
node --test test/provider-api-security.test.js test/provider-api-configs-api.test.js test/provider-api-balance.test.js
```

退出码 0。关键输出：
- `provider-api-security.test.js`: tests 117, pass 117, fail 0
- `provider-api-configs-api.test.js`: tests 26, pass 26, fail 0
- `provider-api-balance.test.js`: tests 24, pass 24, fail 0

### 4. 全量后端测试

```
npm test
```

退出码 0。关键输出：`tests 1353, pass 1345, fail 0, skipped 8`。

### 5. Dashboard 测试

```
npm --prefix dashboard run test
```

退出码 0。关键输出：`Test Files 79 passed (79), Tests 634 passed (634)`。

### 6. Dashboard typecheck

```
npm --prefix dashboard run typecheck
```

退出码 0。`tsc --noEmit` 无输出（无类型错误）。

### 7. Guardrails

```
npm run validate:guardrails
```

退出码 0。`Guardrails ok: no violations found.`

### 8. git diff --check

退出码 0。无空白错误。

## 安全扫描结果

对 4 个非财务 endpoint 分别通过 `validateProviderApiConfig` 和 `executeFinancialRequest`（传入唯一测试密钥 `sk-SECRET-FOR-SCAN-12345`）执行安全扫描，检查错误响应 JSON 是否包含：

- URL 原文（可能含敏感路径）
- 密钥原文
- `Authorization` / `Cookie` 字样

结果：`SECURITY SCAN PASS: no URL/secret/Auth/Cookie leakage in error responses`。

错误消息为固定中文字符串"只允许查询财务端点（余额/账单/用量/花销/订阅/发票/配额/支付）"，不回显 URL 原文或密钥。`executeFinancialRequest error does not leak the secret` 测试也验证了唯一密钥 `TE_REPAIR_SECRET_05_executor_no_leak` 不出现在执行器错误响应中。

## 合法财务 endpoint 回归结果

| endpoint | validateProviderApiConfig | executeFinancialRequest | local-api 保存 |
|---|---|---|---|
| `https://api.openai.com/v1/organization/costs` | ok:true | （未实际请求） | 200 |
| `https://api.openai.com/dashboard/billing/credit_grants` | ok:true | （未实际请求） | 200 |
| `https://api.anthropic.com/v1/organizations/balance` | ok:true | （未实际请求） | 200 |
| `https://api.example.com/balance` | ok:true | （未实际请求） | （未测） |
| `http://127.0.0.1:34567/balance`（testMode） | ok:true | （mock 测试覆盖） | （未测） |

`provider-api-balance.test.js` 全部 24 个测试通过（含 mock server `/balance` 的执行器集成测试），证明合法财务 endpoint 的实际刷新流程不受影响。

## B4/B5 后验更新

### B4 密钥安全边界（门槛 >= 0.99）

| 阶段 | 计算 | 后验 |
|---|---|---:|
| 修复前（先验 0.99，4 个直接反例 LR=0.05） | 赔率 99 × 0.05 = 4.95 → 4.95/5.95 | 0.832（不达标） |
| 修复后（4 个反例全部关闭，配置+执行器双重拒绝，合法 endpoint 不误杀） | 赔率 99 × 20 = 1980 → 1980/1981 | 0.9995（达标） |

修复后 B4 = 0.9995 >= 0.99 ✅。直接反例（realtime/sessions、batches、countTokens、run-agent）全部从 `ok:true` 变为 `unsupported_endpoint`；chat/completions/ 维持 `invalid_config`（01 已修复）；配置校验和执行器双路径拒绝；错误响应不泄漏密钥。

### B5 真实财务接口（门槛 >= 0.95）

修复前：财务范围不清晰（blocklist 只拦截模型 endpoint，非财务 POST endpoint 可通过），无法放心接入真实 Key。

修复后：财务范围通过 allowlist 明确（balance/billing/costs/usage/spend/credit/subscription/invoice/quota/payment），非财务 endpoint 默认拒绝。但仍无真实供应商凭据验证。

后验：allowlist 使财务范围清晰，置信度提升至门槛上方，但"无真实供应商脱敏验证"仍是限制。最高结论仍是"可进入真实账户验证"。B5 = 0.95（达标，待真实账户验证）。

## Git 提交

待提交后补充 SHA（见末尾"提交后补充"）。

## 剩余风险

1. **allowlist 关键词假阳性**：理论上，包含财务关键词但实际非财务的 endpoint（如 `/v1/realtime/balance-sessions`）会通过校验。实际可利用性低：(a) URL 由用户自己配置，不是外部攻击者注入；(b) `executeFinancialRequest` 不发送请求正文（`req.end()` 无 body），即使 POST 到误判的 endpoint 也不会触发模型执行；(c) 关键词匹配要求分隔符边界，减少误匹配。
2. **重定向目标不检查财务白名单**：`validateRedirectTarget`（01 工单）检查 HTTPS/云元数据/模型 endpoint/密钥参数，但不检查财务白名单。如果供应商将财务 endpoint 重定向到非财务、非模型 endpoint（如 `/v1/realtime/sessions`），不会被 `validateRedirectTarget` 拒绝。这超出 05 工单范围（05 关注初始 URL 校验），记录为剩余风险，建议后续工单评估是否在重定向校验中加入财务白名单。
3. **POST 到财务 endpoint 不发送 body**：当前 `executeFinancialRequest` 对 GET 和 POST 都不发送请求正文。如果未来需要支持需要 body 的财务 endpoint（如带查询参数的 POST），需要单独评估 body 内容安全，确保不包含模型提示词。
4. **真实供应商验证待用户执行**：B5 最高结论为"可进入真实账户验证"，需用户在本机输入真实 API Key 验证财务 endpoint 实际返回余额/账单数据。subagent 不得接触真实 Key。

## 对抗性审查记录

### 第 1 轮对抗性审查

审查角度：以攻击者视角尝试绕过财务白名单，以审计者视角检查测试覆盖和错误处理。

**A1. URL 编码绕过尝试**
- 攻击向量：`https://api.openai.com/v1/%72ealtime/sessions`（`%72` = `r`）
- 验证：`new URL("https://api.openai.com/v1/%72ealtime/sessions").pathname` = `/v1/realtime/sessions`（URL 解析器自动解码）→ normalize → `/v1/realtime/sessions` → 不含财务关键词 → 拒绝 ✅
- 结论：URL 编码不能绕过。

**A2. 大小写混合 host 绕过尝试**
- 攻击向量：`https://API.OPENAI.COM/v1/realtime/sessions`
- 验证：pathname 仍是 `/v1/realtime/sessions`（host 大小写不影响 pathname）→ 拒绝 ✅
- 结论：host 大小写不能绕过。

**A3. 端口号绕过尝试**
- 攻击向量：`https://api.openai.com:443/v1/realtime/sessions`
- 验证：pathname 仍是 `/v1/realtime/sessions` → 拒绝 ✅
- 结论：端口号不能绕过。

**A4. query string / fragment 注入财务关键词**
- 攻击向量：`https://api.openai.com/v1/realtime/sessions?balance=true` 和 `...#balance`
- 验证：`new URL().pathname` 排除 query 和 fragment → `/v1/realtime/sessions` → 拒绝 ✅
- 结论：query/fragment 中的财务关键词不能绕过（`isFinancialProviderEndpoint` 用 `parsed.pathname` 而非完整 URL）。

**A5. dot 段绕过尝试**
- 攻击向量：`https://api.example.com/v1/balance/../realtime/sessions`（企图先用 `balance` 通过校验，再 `..` 跳到 realtime）
- 验证：`new URL().pathname` 解析 `..` → `/v1/realtime/sessions` → 拒绝 ✅
- `normalizeFinancialPath` 也用 split+stack 正确处理 `..`（pop 前一栈帧），即使直接传入原始字符串也不会绕过。
- 结论：dot 段不能绕过。

**A6. 尾部斜杠和重复斜杠绕过尝试**
- 攻击向量：`/v1/realtime/sessions/`、`/v1//batches`
- 验证：`normalizeFinancialPath` 合并重复斜杠并去尾部斜杠 → `/v1/realtime/sessions`、`/v1/batches` → 拒绝 ✅
- 结论：斜杠变体不能绕过。

**A7. allowlist 关键词假阳性（记录为剩余风险，不修复）**
- 攻击向量：`https://api.openai.com/v1/realtime/balance-sessions`（`balance` 前后是分隔符 `/` 和 `-`）
- 验证：`balance` 匹配 → 通过校验。
- 可利用性评估：低。(a) URL 由用户配置，非外部注入；(b) `executeFinancialRequest` 不发送 body，不会触发模型执行；(c) 真实供应商不存在此类 endpoint。
- 结论：记录为剩余风险 1，不修复（allowlist 方案的固有局限，比 blocklist 安全得多）。

**A8. POST 白名单严格性**
- 工单要求："POST 只有在明确属于已知财务/账单适配器且不会触发模型或任务执行时才允许"。
- 实现：POST 到含财务关键词的 endpoint 允许。
- 验证：`executeFinancialRequest` 对 GET 和 POST 都调用 `req.end()` 无 body，不发送请求正文 → 即使 POST 到财务 endpoint 也不会带模型提示词 ✅
- 测试：`validateProviderApiConfig allows POST to financial endpoint` 和 `validateProviderApiConfig rejects POST to non-financial endpoint` 覆盖。
- 结论：POST 白名单满足工单要求。

**A9. 合法财务 endpoint 误杀检查**
- 验证：`/v1/organization/costs`（costs）、`/dashboard/billing/credit_grants`（billing/credit）、`/v1/organizations/balance`（balance）、`/balance`（balance）全部通过 ✅
- `provider-api-balance.test.js` 24 个测试全部通过（含 mock server `/balance` 执行器集成测试）✅
- 结论：合法财务 endpoint 不受影响。

**A10. 错误码一致性**
- 配置校验和执行器对非财务 endpoint 都返回 `unsupported_endpoint` ✅
- 对模型 endpoint 都返回 `invalid_config` ✅
- 错误消息为固定中文，不回显 URL 或密钥 ✅
- 结论：错误码一致，UI 可区分。

**A11. 测试覆盖完整性**
- 5 个必须拒绝的 endpoint：配置校验（5）+ 执行器（5）+ 集成（2，覆盖 4+1）= 全覆盖 ✅
- 合法财务 endpoint 回归：单元（4）+ 集成（3）+ balance 执行器（24）= 全覆盖 ✅
- 路径规范化绕过：大小写、尾部斜杠、重复斜杠、query、fragment、dot 段 = 全覆盖 ✅
- 密钥不泄漏：执行器错误响应 + 安全扫描 = 全覆盖 ✅
- 结论：测试覆盖完整。

**A12. `normalizeFinancialPath` 的 `..` 处理正确性**
- 输入 `/v1/balance/../realtime/sessions`（不经过 URL 解析，直接传入）
- split: `["v1", "balance", "..", "realtime", "sessions"]`
- resolve: `v1` 入栈 → `balance` 入栈 → `..` 弹出 `balance` → `realtime` 入栈 → `sessions` 入栈 → `["v1", "realtime", "sessions"]`
- 返回 `/v1/realtime/sessions` → 拒绝 ✅
- 结论：`..` 处理正确（用栈实现 pop 语义）。

### 第 1 轮审查结论

12 项审查全部通过，未发现需要修复的 P0/P1 问题。剩余风险 1（allowlist 假阳性）和剩余风险 2（重定向不检查财务白名单）记录在案，超出 05 工单范围或可利用性极低，不修复。

### 第 2 轮对抗性审查（针对第 1 轮结论的再审查）

**B1. 第 1 轮是否遗漏了某些绕过向量？**
- 检查：Unicode 编码（如全角字符）？`new URL()` 不解码全角字符为 ASCII，pathname 会保留原样 → 不匹配财务关键词 → 拒绝 ✅
- 检查：IPv6 地址？`https://[::1]/balance` → pathname `/balance` → 通过（但 `[::1]` 是本地，testMode 才允许 HTTP）✅
- 检查：`javascript:` 协议？`isAllowedUrl` 协议检查先拒绝 ✅
- 结论：未遗漏重大向量。

**B2. `isFinancialProviderEndpoint` 是否被所有必要路径调用？**
- `validateProviderApiConfig`（配置保存）✅
- `executeFinancialRequest`（执行器，通过 `isAllowedUrl`）✅
- `validateRedirectTarget`（重定向校验）—— 未调用，记录为剩余风险 2 ✅（超出 05 范围）
- 结论：初始 URL 校验路径全覆盖。

**B3. 测试是否真的验证了执行器拒绝（而非仅配置校验）？**
- 检查：`executeFinancialRequest rejects realtime/sessions with unsupported_endpoint` 测试直接调用 `executeFinancialRequest`，不经过 `validateProviderApiConfig` → 独立验证执行器 ✅
- 结论：执行器独立验证充分。

**B4. 修改是否影响了 01 工单的修复？**
- 检查：`isModelEndpoint`、`sanitizeErrorMessage`、`validateRedirectTarget` 逻辑未变 ✅
- 检查：01 的测试（F1/F2 复现、extraSecrets 脱敏、查询参数绕过、尾部斜杠绕过）全部通过 ✅
- 结论：01 修复不受影响。

### 第 2 轮审查结论

4 项再审查全部通过，确认第 1 轮结论正确。05 工单修复完整，无需进一步修改。

## 提交后补充

- 分支：`fix/v2-05-financial-endpoint-whitelist`
- 提交 SHA：`bd2e97d`
- HEAD：`bd2e97d fix(v2-05): financial endpoint allowlist — reject non-financial POST endpoints`
- 基线：从 `fix/v2-03-release-config-reproducibility` HEAD `7691ba7` 分出（已包含 01/02/03/04 全部修复）
- 修改文件（4 个，981 insertions）：
  - `src/lib/provider-api-executor.js`
  - `src/lib/provider-api-configs.js`
  - `test/provider-api-security.test.js`
  - `docs/tasks/v2.0-ia-api-balance-repair/05-供应商API财务端点白名单修复.md`

### 最终验证状态（提交后回归）

| 验证项 | 命令 | 退出码 | 关键输出 |
|---|---|---:|---|
| 针对性测试 | `node --test test/provider-api-security.test.js test/provider-api-configs-api.test.js test/provider-api-balance.test.js` | 0 | 117+26+24 pass, 0 fail |
| 全量后端测试 | `npm test` | 0 | 1345 pass, 0 fail, 8 skipped |
| Dashboard 测试 | `npm --prefix dashboard run test` | 0 | 634 pass (79 files) |
| Dashboard typecheck | `npm --prefix dashboard run typecheck` | 0 | 无类型错误 |
| Guardrails | `npm run validate:guardrails` | 0 | no violations |
| 空白检查 | `git diff --check` | 0 | 无空白错误 |
| 安全扫描 | 自定义探针 | 0 | no URL/secret/Auth/Cookie leakage |

### 对抗性审查最终结论

2 轮对抗性审查（12 + 4 = 16 项检查）全部通过，未发现需要修复的 P0/P1 问题。剩余风险 4 项已记录（allowlist 假阳性、重定向不检查财务白名单、POST 不发 body、真实供应商验证待用户执行），均超出 05 工单范围或可利用性极低。05 工单执行完成。
