# 工单4：详情标签页增强 + 整体页面集成 + 测试验证

## 基本信息

- **工单编号**: TICKET-04
- **标题**: 详情标签页增强 + 整体页面集成 + 测试验证
- **优先级**: 高
- **依赖**: 工单2 + 工单3（需等待前两者完成后再做集成）
- **部分可前置**: 请求日志/Provider统计/模型统计的表格开发可以基于工单1先做，不依赖工单2/3的UI

## 对应需求点

- 需求1.3: 所有下游组件联动刷新
- 需求2.3: Provider 统计 Tab 详细展示
- 需求3.3: 模型统计 Tab 详细展示
- 需求4.3: 时间变化联动刷新
- 需求6.1: 请求日志 9 列完整信息
- 需求6.2: Provider 统计 6 列完整信息
- 需求6.3: 模型统计 6 列完整信息
- 需求6.4: Tab 切换交互
- 需求7.1: 数据口径三位一体一致
- 需求7.2: 三级筛选级联逻辑（验证）
- 需求7.3: 边界情况处理
- 需求7.4: 完整测试覆盖

## 项目背景

当前 Token Eye 的 Spend 页面已有请求日志、Provider 统计、模型统计三个 Tab，但内容比较简单，列数少，缺少成功率、延迟等关键指标。同时页面整体布局需要重新组织，将工单2的筛选栏、统计面板和工单3的趋势图整合进来，形成完整的使用统计页面。

## 技术栈

- React + TypeScript
- Tailwind CSS
- 数据：使用工单1提供的 Hooks
- UI 组件：复用项目现有组件

---

## 工作内容

### A. 请求日志表格增强

**组件**: `RequestUsageLog.jsx`（改造现有组件）
**路径**: `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`

#### A1. 表格列（从左到右共9列）

| 序号 | 列名 | 说明 | 对齐 |
|:---:|---|---|:---:|
| 1 | 时间 | 格式 `MM/DD HH:mm`，如 `06/26 21:42` | 左 |
| 2 | 供应商 | 显示名（如 "Claude (Session)"）+ 左侧小圆点（对应颜色） | 左 |
| 3 | 计费模型 | 模型名称 | 左 |
| 4 | 输入 | 主数字（大号）+ 下方小字缓存读取（灰色，如 `R40,704`） | 右 |
| 5 | 输出 | 数字 | 右 |
| 6 | 总成本 | 金额，带 $ 符号 | 右 |
| 7 | 用时/首字 | 合并列，格式 `总用时 / 首字时间`，如 `0.0s / 830ms`，无则显示 `-` | 右 |
| 8 | 状态 | HTTP 状态码，2xx 绿色，4xx/5xx 红色 | 右 |
| 9 | 来源 | 请求来源（如 `session_log`），灰色小字 | 左 |

#### A2. 顶部筛选栏

- 左侧："全部"下拉（按 agent 筛选，与全局筛选联动）
- 右侧：时间范围选择（与全局筛选联动，或独立）
- 与全局筛选栏的关系：保持联动，全局筛选变化时表格数据同步刷新

#### A3. 交互与功能

1. **分页/加载更多**：
   - 支持分页或滚动加载
   - 默认显示最近 N 条
   - 底部"加载更多"按钮

2. **排序**：
   - 点击列标题排序（可选，按时间、成本等）

3. **空状态**：
   - 无数据时显示友好提示

4. **加载状态**：
   - 骨架屏或 loading 动画

#### A4. 数据来源

- 使用工单1提供的 `useRequestUsageRecords` Hook
- 字段映射：
  - `timestamp` → 时间
  - `source_display_name` → 供应商
  - `model` → 计费模型
  - `input_tokens` + `cached_input_tokens` → 输入
  - `output_tokens` → 输出
  - `cost_usd` → 总成本
  - `latency_ms` + `first_token_ms` → 用时/首字
  - `status` → 状态
  - `request_source` → 来源

---

### B. Provider 统计表格增强

**组件**: `ProviderUsageTable.jsx`（从 SpendPage.jsx 内联函数抽离为独立组件）
**路径**: `dashboard/src/ui/dashboard/components/ProviderUsageTable.jsx`

#### B1. 表格列（共6列）

| 序号 | 列名 | 说明 | 对齐 |
|:---:|---|---|:---:|
| 1 | 供应商 | 显示名 + 左侧颜色小圆点 | 左 |
| 2 | 请求数 | 数字，千分位 | 右 |
| 3 | Tokens | 总 tokens，带单位（k/M/B） | 右 |
| 4 | 成本 | 金额，带 $ 符号 | 右 |
| 5 | 成功率 | 百分比，100% 绿色，<100% 橙色/红色 | 右 |
| 6 | 平均延迟 | 毫秒，如 `12228ms` | 右 |

#### B2. 交互与功能

1. **默认排序**：按 Tokens 降序排列
2. **点击排序**：支持按各列排序（点击列标题切换升序/降序）
3. **空状态**：无数据时友好提示
4. **加载状态**：骨架屏

#### B3. 数据来源

- 使用工单1提供的 `useProviderStats` Hook
- 字段映射：
  - `source_display_name` → 供应商
  - `request_count` → 请求数
  - `tokens` → Tokens
  - `cost_usd` → 成本
  - `success_rate` → 成功率
  - `avg_latency_ms` → 平均延迟

---

### C. 模型统计表格增强

**组件**: `ModelUsageTable.jsx`（从 SpendPage.jsx 抽离并增强）
**路径**: `dashboard/src/ui/dashboard/components/ModelUsageTable.jsx`

#### C1. 表格列（共6列）

| 序号 | 列名 | 说明 | 对齐 |
|:---:|---|---|:---:|
| 1 | 模型 | 模型名称 + 下方小字供应商名（灰色） | 左 |
| 2 | 请求数 | 数字，千分位 | 右 |
| 3 | Tokens | 总 tokens，带单位 | 右 |
| 4 | 成本 | 金额，带 $ 符号 | 右 |
| 5 | 成功率 | 百分比，颜色区分 | 右 |
| 6 | 平均延迟 | 毫秒 | 右 |

#### C2. 交互与功能

1. **默认排序**：按 Tokens 降序
2. **点击排序**：支持按各列排序
3. **空状态**：无数据时友好提示
4. **加载状态**：骨架屏

#### C3. 数据来源

- 使用工单1提供的 `useModelStats` Hook
- 字段映射：
  - `model` + `source_display_name` → 模型
  - `request_count` → 请求数
  - `tokens` → Tokens
  - `cost_usd` → 成本
  - `success_rate` → 成功率
  - `avg_latency_ms` → 平均延迟

---

### D. Tab 切换组件

**组件**: 可以复用现有或微调
**路径**: 集成在页面中

#### D1. 三个 Tab

1. **请求日志**：图标（列表/筛选图标）+ 文字
2. **Provider 统计**：图标（活动/趋势图标）+ 文字
3. **模型统计**：图标（柱状图图标）+ 文字

#### D2. 样式

- 选中 Tab：白色背景 + 阴影 + 深色文字
- 未选中 Tab：透明背景 + 灰色文字，悬停变深
- 背景：浅灰色圆角容器
- 整体：圆角按钮组样式

#### D3. 交互

- 点击切换 Tab
- 内容区域平滑过渡（可选）
- 记住用户选择（可选）

---

### E. 整体页面集成

**改造文件**: `dashboard/src/pages/SpendPage.jsx` 或 `dashboard/src/ui/dashboard/views/DashboardView.jsx`

#### E1. 页面布局（从上到下）

1. **顶部筛选栏**（工单2的 `UsageFilterBar`）
   - Agent 切换 + 来源筛选 + 模型筛选 + 刷新间隔 + 时间范围

2. **统计面板**（工单2的 `UsageStatsPanel`）
   - 大数字 + 4个维度卡片 + 右侧小卡片

3. **使用趋势图**（工单3的 `UsageTrendChart`）
   - 双 Y 轴多维度趋势图

4. **详情标签页**（本工单的内容）
   - Tab 切换
   - 请求日志 / Provider 统计 / 模型统计

#### E2. 状态管理

- 使用工单1提供的 `useUsageFilters` Hook 统一管理筛选状态
- 所有组件共享同一套筛选状态
- 筛选变化时所有组件自动刷新数据
- 确保数据流单向、状态一致

#### E3. 布局样式

- 各区块之间有适当间距
- 整体与侧边栏协调
- 响应式布局：
  - 桌面端：正常布局
  - 平板：统计面板可能换行
  - 手机：单列布局，横向滚动表格

#### E4. 深浅色主题

- 确保所有新增组件都支持深浅色主题
- 使用项目现有的主题变量
- 测试深浅色切换

---

### F. 测试与质量保证

#### F1. 数据一致性测试

验证三种统计口径数据完全一致：
1. 统计面板的 total_tokens / cost_usd
2. 趋势图所有数据点累加的 total_tokens / cost_usd
3. 请求日志 totals 中的 total_tokens / cost_usd

测试各种筛选组合：
- 全部 Agent vs 单个 Agent
- 全部来源 vs 单个来源
- 全部模型 vs 单个模型
- 不同时间范围
- 组合筛选

#### F2. 边界情况测试

1. **空数据**：
   - 无任何请求记录时各组件的展示
   - 筛选后无结果时的展示

2. **单条数据**：
   - 只有 1 条记录时图表和表格的渲染

3. **大数据量**：
   - 10万+ 条记录时的性能
   - 长列表滚动性能
   - 图表渲染性能

4. **异常数据**：
   - 负数 tokens
   - 异常大的数值
   - 缺失字段
   - 乱序时间戳

#### F3. 交互测试

1. 所有筛选控件交互正常
2. 三级筛选级联逻辑正确
3. Tab 切换正常
4. 图表交互正常（tooltip、图例、缩放等）
5. 表格排序、分页正常
6. 自动刷新功能正常
7. 深浅色主题切换正常

#### F4. 响应式测试

- 桌面端（>1280px）
- 平板（768px - 1280px）
- 手机（<768px）

#### F5. 性能测试

- 首屏加载时间
- 筛选切换响应时间
- 大数据量下的帧率
- 内存使用

#### F6. Bug 修复与打磨

- 修复测试中发现的所有 bug
- 视觉细节打磨（间距、对齐、颜色、动画）
- 代码清理和优化
- 确保 lint 全部通过

---

## 涉及文件清单

### 改造/增强
- `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`（改造，增强列和功能）
- `dashboard/src/ui/dashboard/components/ProviderUsageTable.jsx`（从 SpendPage 抽离并增强）
- `dashboard/src/ui/dashboard/components/ModelUsageTable.jsx`（从 SpendPage 抽离并增强）
- `dashboard/src/pages/SpendPage.jsx`（整体集成改造）

### 集成的组件（来自其他工单）
- `UsageFilterBar`（工单2）
- `UsageStatsPanel`（工单2）
- `UsageTrendChart`（工单3）

### 数据 Hooks（来自工单1）
- `useUsageFilters`
- `useUsageSummary`
- `useUsageTrend`
- `useProviderStats`
- `useModelStats`
- `useRequestUsageRecords`

### 参考文件
- `dashboard/src/pages/SpendPage.jsx`（现有 Spend 页面）
- `dashboard/src/ui/dashboard/views/DashboardView.jsx`（现有 Dashboard 视图）
- `dashboard/src/ui/dashboard/components/UsageOverview.jsx`（现有概览组件）

---

## 验收标准

### 功能验收
- [ ] 请求日志 9 列信息完整，格式与 CC Switch 一致
- [ ] Provider 统计 6 列信息完整，排序正确
- [ ] 模型统计 6 列信息完整，排序正确
- [ ] Tab 切换交互流畅
- [ ] 顶部筛选栏与所有下游组件联动正确
- [ ] 统计面板、趋势图、详情表格数据口径一致
- [ ] 三级筛选级联逻辑正确，无状态矛盾
- [ ] 自动刷新功能正常

### 体验验收
- [ ] 加载状态、空状态、错误状态处理完善
- [ ] 响应式布局正常（桌面/平板/手机）
- [ ] 深浅色主题适配
- [ ] 与 CC Switch 视觉风格对齐
- [ ] 操作流畅，无明显卡顿

### 质量验收
- [ ] 所有测试用例通过
- [ ] 数据一致性验证通过
- [ ] 边界情况处理完善
- [ ] 代码符合项目规范（lint 通过）
- [ ] 无控制台错误和警告
- [ ] 现有功能不受影响

---

## 注意事项

1. **先看现有代码**：开工前先完整阅读 `SpendPage.jsx` 和 `RequestUsageLog.jsx`，了解现有实现方式。
2. **渐进式改造**：不要一上来就全删重写，在现有基础上逐步增强。
3. **工单依赖**：
   - 表格部分（A/B/C）只依赖工单1，可以先做
   - 集成部分（E）依赖工单2和工单3，需要等前两者完成
   - 如果前序工单未完成，先用 mock 数据开发
4. **数据一致性是重点**：务必确保三个地方的数据对得上，这是需求7的核心。
5. **样式一致性**：表格样式、卡片样式、按钮样式都要与项目现有风格统一。
6. **性能考虑**：长列表用虚拟滚动或分页，不要一次性渲染几万条。
7. **向后兼容**：确保改造后现有功能不受影响，旧的 API 调用仍然正常。
