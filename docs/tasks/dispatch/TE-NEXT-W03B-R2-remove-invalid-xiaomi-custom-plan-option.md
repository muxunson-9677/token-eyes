# TE-NEXT-W03B-R2：移除小米 MiMo 的无效自定义套餐入口

> **给执行代理：** 请按本工单逐步执行。只修本工单列出的文件，不要顺手重构其它模块。所有新增或修改的 Markdown 内容必须使用中文。

## 目标

小米 MiMo 是已核验目录型服务商，选择 `xiaomi_mimo` 后只能选择目录中的 Lite / Standard / Pro / Max 套餐，不允许继续显示 `custom` 自定义套餐选项。后端已经会拒绝 `provider_id: "xiaomi_mimo"` + `plan_id: "custom"`，本工单要让前端不再暴露这条无效路径。

## 背景

W03B-R1 的后端校验已经通过：

- 伪造小米套餐返回 400。
- 伪造服务商返回 400。
- 小米目录套餐强制 `refresh_method: "manual"`。
- 小米目录套餐的已用额度、剩余额度、到期时间仍可手工维护。

当前剩余问题在前端：

- `dashboard/src/components/settings/TokenPlanSection.jsx` 的 `planOptions` 对所有服务商都追加了 `{ value: "custom" }`。
- `dashboard/src/components/settings/TokenPlanSection.test.jsx` 的测试还在断言小米服务商包含 `custom`。
- 用户选择小米后能看到一个保存必然失败的“自定义套餐”，这是无效 UI。

## 允许修改的文件

- `dashboard/src/components/settings/TokenPlanSection.jsx`
- `dashboard/src/components/settings/TokenPlanSection.test.jsx`

不要修改后端，不要修改目录 JSON，不要新增账号授权或 Cookie 逻辑。

## 实施步骤

### 1. 先修改测试，确认旧行为被测试挡住

修改 `dashboard/src/components/settings/TokenPlanSection.test.jsx` 中当前这条测试：

```jsx
it("selecting xiaomi_mimo provider shows only its catalog plans plus custom", async () => {
```

改成表达正确行为：

```jsx
it("selecting xiaomi_mimo provider shows only verified catalog plans", async () => {
```

并把断言从：

```jsx
expect(options).toContain("custom");
```

改为：

```jsx
expect(options).not.toContain("custom");
```

然后运行：

```powershell
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
```

预期：这一步应失败，因为前端还在追加 `custom`。

### 2. 修复前端套餐选项

修改 `dashboard/src/components/settings/TokenPlanSection.jsx` 的 `planOptions`。

当前逻辑类似：

```jsx
const planOptions = useMemo(() => {
  const plans = currentProvider?.plans || [];
  const opts = plans.map((p) => ({ value: p.plan_id, label: p.display_name }));
  opts.push({ value: "custom", label: copy("settings.token_plan.custom_plan") });
  return opts;
}, [currentProvider]);
```

改为只在自定义服务商下追加自定义套餐：

```jsx
const planOptions = useMemo(() => {
  const plans = currentProvider?.plans || [];
  const opts = plans.map((p) => ({ value: p.plan_id, label: p.display_name }));
  if (form.provider_id === "custom") {
    opts.push({ value: "custom", label: copy("settings.token_plan.custom_plan") });
  }
  return opts;
}, [currentProvider, form.provider_id]);
```

### 3. 修复切换服务商时的默认套餐

仍在 `dashboard/src/components/settings/TokenPlanSection.jsx`，检查 `updateField("provider_id")` 分支。

当前切换服务商时通常会写：

```jsx
next.plan_id = "custom";
next.plan_label = "";
next.quota_kind = "manual";
next.quota_unit = "tokens";
next.total_quota = 0;
next.total_quota_display = "";
next.quota_catalog_version = "";
next.quota_source = "manual";
```

保留清空逻辑，但把 `plan_id` 改成空字符串，避免小米服务商默认落到无效的 `custom`：

```jsx
next.plan_id = value === "custom" ? "custom" : "";
next.plan_label = "";
next.quota_kind = "manual";
next.quota_unit = "tokens";
next.total_quota = 0;
next.total_quota_display = "";
next.quota_catalog_version = "";
next.quota_source = "manual";
```

这样用户选择小米后必须明确选择一个目录套餐。

### 4. 重新验证

依次运行：

```powershell
npm --prefix dashboard run test -- TokenPlanSection.test.jsx
node --test test/token-plans-api.test.js
npm --prefix dashboard run typecheck
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
npm run dashboard:build
```

预期结果：

- `TokenPlanSection.test.jsx`：13 个测试通过。
- `token-plans-api.test.js`：9 个测试通过。
- `typecheck`：退出码 0。
- `validate:copy`：退出码 0；已有 unused copy warnings 可保留。
- `validate:ui-hardcode`：退出码 0。
- `validate:guardrails`：退出码 0。
- `dashboard:build`：构建成功；已有 Vite chunk 警告可保留。

## 验收标准

- 选择 `xiaomi_mimo` 后，套餐下拉框包含已核验目录套餐，例如 `xiaomi_mimo_standard_monthly`。
- 选择 `xiaomi_mimo` 后，套餐下拉框不包含 `custom`。
- 选择 `custom` 服务商后，套餐下拉框仍包含 `custom`。
- 小米目录套餐保存后仍强制手工刷新。
- 后端非法套餐与非法服务商测试仍通过。

## 不要做

- 不要新增 Cookie 抓取。
- 不要新增官网账号登录。
- 不要修改小米目录数据。
- 不要把 `custom` 从自定义服务商里删除。
- 不要修改与 Token 套餐无关的 UI。
