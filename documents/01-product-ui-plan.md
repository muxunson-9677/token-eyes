# 01-product-ui.md 执行计划

## Context

本工单负责把 2.0 的页面目录和前端展示结构定下来，并把使用统计 UI 向 CC Switch 对齐。它是后续所有 2.0 工单的前置串行任务。

主要改造点：
1. 移除概览页热力图（ActivityHeatmap）
2. 支出页拆分为"使用统计"和"成本累积"两个二级Tab
3. 请求日志分页从"加载更多"改为页码跳转，每页10条
4. "新增订阅记录"改名为"订阅记录"
5. 成本卡片缩小
6. 使用趋势图右侧完整拓展

---

## 任务分解

### Task 1: 移除概览页热力图

**修改文件:**
- `dashboard/src/pages/DashboardPage.jsx`
  - 移除 `useActivityHeatmap` import (L4)
  - 移除 `heatmap` 数据获取 (L600-618)
  - 移除 `activityHeatmapBlock` 变量定义 (L1033-1041)
- `dashboard/src/ui/dashboard/views/DashboardView.jsx`
  - 移除 `activityHeatmapBlock` 渲染 (L295-299)
- `dashboard/src/ui/dashboard/components/ActivityHeatmap.jsx`
  - 保留组件文件本身（可能被其他地方引用）

**验证:** `npm run dashboard:build` 成功，概览页不再显示热力图

---

### Task 2: 支出页拆分为两个二级Tab

**目标结构:**
```
支出
├── 使用统计 (UsageStats)
│   ├── 真实消耗 Tokens
│   ├── 成本卡片
│   ├── 使用趋势
│   ├── Provider 统计
│   ├── 模型统计
│   └── 请求日志分页
└── 成本累积 (CostAccumulation)
    ├── Token 套餐
    ├── API 计费
    └── 订阅记录
```

**修改文件:**
- `dashboard/src/pages/SpendPage.jsx`
  - 新增一级Tab状态: `activeSpendTab` ('usage' | 'cost')
  - 新增Tab切换组件
  - 将现有内容分为 UsageStatsSection 和 CostAccumulationSection
  - 订阅记录表单和列表移到 CostAccumulationSection

- `dashboard/src/content/copy.csv`
  - 新增一级Tab文案:
    - `spend.tab.usage` = "使用统计"
    - `spend.tab.cost` = "成本累积"

**验证:** Tab切换正常，两个Section都正确显示

---

### Task 3: 请求日志分页改为页码跳转（每页10条）

**修改文件:**
- `dashboard/src/ui/dashboard/components/RequestUsageLog.jsx`
  - `PAGE_SIZE` 从 50 改为 10
  - 新增页码状态: `currentPage`
  - 移除 `visibleCount` + "加载更多" 按钮
  - 新增页码导航组件: 首页/上一页/页码按钮/下一页/末页
  - 重新计算 `pagedRecords`

**页码组件逻辑:**
```javascript
const totalPages = Math.ceil(sortedRecords.length / PAGE_SIZE);
const visibleRecords = sortedRecords.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
```

**验证:** 分页器正确显示，点击页码正确跳转

---

### Task 4: "新增订阅记录" 改名为 "订阅记录"

**修改文件:**
- `dashboard/src/content/copy.csv`
  - L1040: `spend.add_record` 从 "新增订阅记录" 改为 "订阅记录"
  - 对应 `dashboard/src/pages/SpendPage.jsx` 中的表单标题

**验证:** 表单标题显示为"订阅记录"

---

### Task 5: 成本卡片缩小

**修改文件:**
- `dashboard/src/pages/SpendPage.jsx`
  - L479: `SummaryTile` 网格布局调整 (`sm:grid-cols-2 lg:grid-cols-4` 改为更紧凑的布局)
  - 减小卡片padding和字体大小

**当前样式:**
```jsx
<div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
  <SummaryTile ... />
</div>
```

**目标:** 卡片更紧凑，不占据过大空间

---

### Task 6: 使用趋势图右侧完整拓展

**修改文件:**
- `dashboard/src/ui/dashboard/components/UsageTrendChart.jsx`
  - 检查图表容器宽度是否full width
  - 确认right padding足够 (`PADDING.right = 56`)

**验证:** 图表右侧不留空、不截断、不挤压

---

## 实施顺序

1. Task 4 (改名) - 最简单，先完成
2. Task 1 (移除热力图) - 独立改动
3. Task 3 (分页) - 独立改动
4. Task 5 (卡片缩小) - 独立改动
5. Task 6 (图表拓展) - 独立改动
6. Task 2 (Tab拆分) - 最复杂，最后完成

---

## 验证清单

- [ ] `npm run dashboard:build` 构建成功
- [ ] TypeScript编译 `npx tsc --noEmit` 无错误
- [ ] 热力图已从概览页移除
- [ ] 支出页显示两个一级Tab
- [ ] 请求日志每页10条，显示页码跳转
- [ ] 订阅记录表单标题显示"订阅记录"
- [ ] 成本卡片尺寸明显缩小
- [ ] 使用趋势图右侧完整显示
