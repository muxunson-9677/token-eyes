# Token Eyes 供应商 API 简化与真实财务能力实施计划

> 日期：2026-07-13  
> 范围：原始事项 6；只修改 Token Eyes 仓库，不触碰 CC Switch 或任何仓库外软件/文件。

## 目标与判断

用户希望像 CC Switch 一样，只填写 API 模式、API 端点和 API Key，就能看到供应商真实提供的余额与花销数据。实现必须以供应商公开接口的真实能力为边界，不能通过模型调用冒充连接检测，也不能把套餐 Token 配额当成现金余额。

当前审计结论：

- DeepSeek 官方 `GET /user/balance` 能返回分币种余额；该接口不提供当月花销或累计充值，因此后二者应显示“不支持自动查询”，不能显示 0。
- 智谱公开文档提供模型 API 与控制台计费查询入口，但没有可验证的公开现金余额、当月花销、累计充值 API。现有 `/api/monitor/usage/quota/limit` 是 Coding Plan 套餐配额接口，不能映射成现金余额。
- 未收录供应商仍保留折叠的高级配置，供用户显式配置真实财务 endpoint 与字段路径。

## 成功标准

1. 基础表单可见字段为名称、API 模式、API 端点、API Key、启用状态；高级字段默认折叠。
2. DeepSeek 仅凭基础字段即可规范化到官方余额 endpoint，并通过响应 fixture 解析真实余额与币种。
3. 每个配置展示余额、当月花销、累计花销和套餐 Token 额度的能力状态；不支持项显示“不支持自动查询”，未知值继续显示“—”。
4. 智谱新配置在保存前明确提示没有公开财务查询能力；后端也拒绝绕过前端的保存请求。
5. 已存在的智谱 quota 配置不再读取密钥、不再发起财务请求，返回 `unsupported_endpoint`，且不再把剩余 Token 显示为余额。
6. 401、403、429、超时、HTML 登录页和响应结构变化继续返回已有的可理解错误；API Key 仍只写入系统凭据存储引用，不在接口、DOM 或日志回显。
7. 聚焦 Node/Vitest、Dashboard 构建、copy 校验与差异检查通过；真实账号连接保留为用户授权后的人工验收，不把 fixture 测试写成“真实连接成功”。

## 实施步骤

### 1. 固化供应商能力契约

涉及文件：

- `src/lib/provider-api-configs.js`
- `dashboard/src/lib/provider-api-presets.js`
- `test/provider-api-configs-api.test.js`

先写失败测试，再为已知供应商增加派生能力：现金余额、当月花销、累计花销、套餐 Token 额度。能力是适配器元数据，不持久化为用户可编辑字段。DeepSeek 标记为仅余额支持；智谱标记为财务查询不支持、套餐额度转由 Token 套餐设置。

### 2. 阻断智谱 quota 冒充余额

涉及文件：

- `src/lib/provider-api-balance.js`
- `src/lib/local-api.js`
- `test/provider-api-balance.test.js`
- `test/provider-api-configs-api.test.js`

先把现有“GLM quota → balance”测试改成“不支持”的回归测试，再让刷新管理器在读取凭据和网络请求之前短路。列表缓存接口也直接返回 `unsupported`，确保旧配置不会继续请求。

### 3. 简化表单并展示能力

涉及文件：

- `dashboard/src/components/settings/ProviderApiConfigSection.jsx`
- `dashboard/src/components/settings/ProviderApiConfigSection.test.jsx`
- `dashboard/src/content/copy.csv`

新增基础层的 API 模式选择和自动识别提示。已知适配器显示能力状态；DeepSeek 的月度/累计数据明确为不支持；智谱显示说明并禁用财务配置保存。自定义供应商继续使用折叠高级配置。

### 4. 验证、复审与进度回写

运行聚焦 Node/Vitest、生产构建、copy/UI 文案校验和 `git diff --check`。随后进行独立对抗审查，修复 Critical/Important 问题，并更新 `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md` 的 D 状态、验证证据、剩余人工验收与下一步。

