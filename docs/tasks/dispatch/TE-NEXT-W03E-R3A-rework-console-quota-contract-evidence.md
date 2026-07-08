# TE-NEXT-W03E-R3A 返工：补齐控制台额度契约证据链

> 复制本文件全文给 Claude。当前 R3A 未通过审核，原因是结论缺少真实控制台登录态网络证据，并且把“接口依赖浏览器会话 Cookie”误写成“必须保存 Cookie”。

## 返工目标

更新：

`D:\04-AI-Project\010-Token eye\docs\dev-notes\xiaomi-mimo-console-quota-contract-2026-06-27.md`

本次返工只补证据和修正文档结论，不写前端，不写刷新 adapter，不改 `TokenPlanSection.jsx`，不接入生产同步。

## 必须先修正的审核问题

### P1：未完成真实控制台登录态网络探测

当前文档只写了：

- 官方文档审查
- 第三方社区验证
- 交叉验证

但工单要求的是：

> 使用官方控制台登录态观察网络请求，寻找真实额度接口。

你必须补充以下任一证据：

1. 使用 Token Eyes 的受控桌面会话打开小米 MiMo 官方控制台，记录同域 XHR/fetch 请求。
2. 使用用户提供的、已脱敏 HAR 文件，分析控制台页面加载额度时的网络请求。

如果两者都无法做到，结论必须是：

`BLOCKED：缺少官方控制台登录态网络证据`

不能仅凭“没有公开 API 文档”或“第三方文章说有接口”完成本工单。

### P1：修正 Cookie 概念混淆

当前文档把“接口需要 Cookie 认证”直接写成“需要保存 Cookie”，这是不严谨的。

项目允许的路径是：

- 用户在小米官方页面登录。
- Token Eyes 只保存 `session_ref`。
- Cookie 留在受控 WebView/桌面会话容器中。
- Node 配置、API 响应、日志、测试、文档都不保存 Cookie 原文。

项目禁止的是：

- 读取外部浏览器 Cookie。
- 让用户复制 Cookie。
- 把 Cookie/token/session secret 写进配置、日志、前端状态、API 响应或测试。

因此你必须把文档中的阻塞理由从：

`需要保存 Cookie`

改成更精确的判断：

- 如果只能靠复制/持久化 Cookie 才能请求：`BLOCKED`
- 如果受控 WebView sessionFetch 可以在不暴露 Cookie 的情况下请求：不能仅因 Cookie 认证判定阻塞，需要继续评估稳定性、字段完整性、错误状态和可复现性。
- 如果没有真实登录态网络证据：`BLOCKED：缺少证据`

### P2：补齐可审计来源

当前文档提到 CSDN、GitHub issue、开源工具，但没有可点击的精确链接。

请补齐：

- 官方文档链接
- GitHub issue / repo / commit / file 的精确 URL
- CSDN 文章精确 URL，如无法提供则删除该来源或标注“未能复核”

不要写“遍历全部文档”这种不可复核表述，除非列出实际检查的页面列表。

### P2：补齐自审和验证结果

在文档末尾新增：

## 自审结果

逐项回答：

- 是否保持 `新增套餐 -> 服务商 -> 套餐 -> 检测方式`
- 是否没有新增独立小米控制台连接卡片
- 是否没有把“打开窗口”当成同步成功
- 是否没有用 mock/人工额度冒充实时额度
- 是否没有保存 Cookie/token/secret
- 是否完成真实控制台登录态网络探测，或明确说明无法完成的阻塞原因

新增：

## 验证命令

列出实际运行命令和结果：

```powershell
npm.cmd run validate:guardrails
rg -n "cookie|authorization|set-cookie|bearer|session|secret|token|phone|email" "docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md" -S
```

如果敏感词扫描命中，逐条说明是字段名、脱敏占位符，还是必须删除的泄漏。

## 返工后的结论规则

只允许三种结论：

1. `READY`

   只有在真实控制台登录态或脱敏 HAR 证明存在稳定额度数据源，且无需保存 Cookie 原文，字段足够映射 Token Eyes 额度模型时才允许。

2. `BLOCKED：缺少官方控制台登录态网络证据`

   如果无法使用受控桌面会话，也没有脱敏 HAR，就用这个结论。

3. `BLOCKED：控制台数据源不可稳定同步`

   只有在已经完成真实控制台/HAR 探测，并证明接口不可稳定复现、字段不足、风控阻断或必须复制/持久化 Cookie 时才允许。

## 返回给 Codex

返回时必须包含：

1. 修改文件列表
2. 最终结论：`READY` 或具体 `BLOCKED`
3. 真实控制台/HAR 探测证据摘要
4. 是否使用受控 `session_ref`，以及是否保存任何 Cookie 原文
5. 验证命令和结果
6. 自审结果
