# Token Eyes V4 第 20260816 轮 UI 调整验收报告

## 一、验收身份

- 验收时间：2026-08-16 14:28（Asia/Shanghai）
- 工作树：`D:\04-AI-Project\010-Token eye\.worktrees\v4-ui-round-20260816`
- 分支：`codex/v4-ui-round-20260816`
- 正式基线：`0.54.40-V4` / `a07620482f4d6d10c83042184b4694105223c4be`
- 本轮验收提交：`3939259f1364942e8d0eccbada65a70d94c16519`
- 浏览器证据：由本提交源码重新执行生产构建后，通过本地生产预览取得；目录数据使用项目隔离夹具，成本设置使用本地 API 数据。
- 原生证据：由本工作树 `src-tauri\target\debug\token-eyes.exe` 启动并测量；未构建安装器、未发布。

## 二、结论

本轮 A1–A11 的源代码、自动化回归、生产构建和可在当前环境完成的真实交互检查均通过。没有发现横向溢出、深色大面积亮色残留、限制拖拽失效、热力图错位、Token 套餐折叠后残留大间距或成本设置重入整页空白。

仍有两项证据边界需要明确：

1. 没有使用用户真实官方账户重新拉取套餐数据；官方字段准确性由隔离夹具、字段来源约束和缺失态测试验证。真实账户核验需另行授权。
2. 没有构建或启动 NSIS 安装器；应用、安装器、卸载器图标路径已通过配置/资源契约测试，开发态原生标题栏图标已实测。安装包级验证应放到用户授权的发布阶段。

## 三、A1–A11 验收矩阵

| 编号 | 状态 | 本轮结果与反向条件 | 证据 |
| --- | --- | --- | --- |
| A1 | 通过 | 只给具备主操作的卡片补齐 `tt-pressable`/键盘语义；重置记录既有卡片规则未改。内部按钮保留独立事件边界。 | Card/页面目标 Vitest；完整 Dashboard 1419 项测试；重置记录与套餐行情截图。 |
| A2 | 通过（真实账户待授权） | 同账户不同模型分别读取自己的 5h/7d 重置与有效期；缺失官方字段显示“官方未提供”，不复制其他模型时间。 | TokenPlanSection 双模型隔离夹具和缺失字段测试；适配字段追踪测试。 |
| A3 | 通过 | 套餐行情压缩为与成本设置一致的紧凑卡片密度；11 家供应商仍在，展开样本 3 张套餐卡完整显示，1280 宽度无横向溢出。 | `light-plan-market-1280x800.png`；PlanMarketPage 内容回归测试。 |
| A4 | 通过 | Token 服务不再显示“同步成功”，异常/未配置状态保留；Token 服务和成本设置 Token 套餐按供应商/账户/模型窗口紧凑展示。 | TokenServiceList 22 项测试；TokenPlanSection 测试；深色 Token 服务截图。 |
| A5 | 通过 | 生产预览中 2 张套餐卡完成展开、折叠后，网格相邻间距为 14.39px，没有残留展开高度或额外延迟空白。实现未使用 `setTimeout`/强制重排。 | 真实浏览器矩形测量；TokenPlanSection.collapsible 测试。 |
| A6 | 通过 | 基础设置共 17 个限制项；键盘 ArrowDown 改序、重载后顺序保持，指针拖动也再次改变顺序。开关仍是独立控件。 | 生产预览真实键盘/鼠标旅程；use-limits-display-prefs 27 项测试。 |
| A7 | 通过 | 首次成本设置请求 8 个相关端点；重入只后台刷新 5 个端点，认证、重置事件和 Token 目录未重复。人为把后台接口延迟 1.2 秒后，四张概览摘要仍与离开前完全一致，且没有整页加载回退。 | 生产预览路由离开/返回旅程；缓存组件测试。 |
| A8 | 通过 | 1600×900、1280×800、1024×768 三档视口中，热力图右边缘与其目标统计分隔线的差均为 0px；三档均无文档横向溢出。 | 真实浏览器 DOM 几何测量；`dark-reset-history-1440x960.png`。 |
| A9 | 通过 | 概览、重置记录、套餐行情、基础设置、成本设置、Token 服务均完成深色整页审查；1280 成本设置实测根节点为 dark，页面底色 `rgb(20, 22, 26)`，无横向溢出。未发现大面积白底或随机亮色表面。 | 7 张深色截图；主题与页面样式测试；typecheck/build。 |
| A10 | 通过（安装包待授权） | 主配置与 Windows 覆盖配置均为客户区 1586×932、最小 900×600、可缩放。DPI 168 / 175% 下原生外框实测 1600×969 逻辑像素，对应约 2800×1695/1696 物理像素；Windows 取整产生 1px 差。标题栏显示正式黄黑图标。 | desktop shell 7/7；`native-startup-2800x1695.png`；原生窗口样式/尺寸测量。 |
| A11 | 通过 | 成本设置 4 个区块均同时存在左摘要槽和最右操作槽；标签/摘要全部在左，操作按钮统一在右。“自动比价/如何定价”收进“定价工具”入口。1280 宽度无横向溢出。 | DOM 槽位 4/4；`light-settings-cost-1280x800.png` 与深色图；Settings/Controls 测试。 |

## 四、真实交互与几何记录

### 4.1 限制列表

- 项目数：17。
- 键盘排序：首项按 ArrowDown 后顺序改变。
- 持久化：页面重载后保持键盘调整结果。
- 指针排序：拖动第二项到第一项位置后顺序再次改变。
- 反向检查：拖拽所有权在手柄，开关没有被改造成拖拽触发区。

### 4.2 热力图

| CSS 视口 | 热力图目标右边缘差 | 位于视口内 | 文档横向溢出 |
| --- | ---: | --- | --- |
| 1600×900 | 0px | 是 | 否 |
| 1280×800 | 0px | 是 | 否 |
| 1024×768 | 0px | 是 | 否 |

“目标右边缘”是热力图所在第一网格列与后续统计列分隔线；后续两列统计信息仍位于热力图右侧，因此不应拿整块活动数据容器的最右边作为热力图边界。

### 4.3 成本设置重入

- 初次相关请求：8 个。
- 重入后台请求：5 个。
- 重入未重复：`/api/auth/refresh`、重置事件、Token 套餐目录。
- 重入仍后台更新：本地设置、供应商余额、供应商配置、其他花销、用量限制。
- 将这些后台请求延迟 1.2 秒后：成本概览仍立即显示离开前的 27 项定价、2 个套餐等摘要；没有出现“正在加载成本设置…”整页回退。

### 4.4 Token 套餐折叠

- 生产预览取得 2 张真实本地套餐卡。
- 展开后再次折叠并等待布局动画收敛，相邻网格间距 14.39px。
- 卡片在同一行时按水平边缘计算；不再用第二张卡顶边减第一张卡底边的错误算法。

### 4.5 原生窗口

| 项目 | 结果 |
| --- | --- |
| Windows DPI | 168 |
| 缩放比例 / DPR | 1.75 |
| 客户区逻辑尺寸 | 1586×932 |
| 外框逻辑尺寸 | 1600×969 |
| 外框物理尺寸 | 2800×1695，按逻辑换算四舍五入为 2800×1696 |
| 可缩放 | 是 |
| 最大化按钮 | 有效 |
| 标题栏图标 | 正式黄黑 Token Eyes 图标 |

## 五、自动化与构建结果

| 检查 | 结果 |
| --- | --- |
| Dashboard Vitest | 152 个测试文件，1419/1419 通过 |
| 根目录 Node 测试 | 1842 项：1834 通过、8 跳过、0 失败，73 个 suite |
| TypeScript | `tsc --noEmit` 通过 |
| 生产构建 | Vite 3801 个模块转换，构建成功 |
| 桌面壳层契约 | 7/7 通过 |
| 差异格式 | `git diff --check` 通过 |

已知但未新增的非失败输出：

- Vitest/jsdom 会输出 `canvas.getContext`、`window.scrollTo` 未实现提示和若干 React `act(...)` 警告；测试汇总仍为 0 失败。
- Vite 会提示 `local-api-auth.ts` 同时被静态/动态导入，以及少数 chunk 超过 500kB；构建退出码为 0。
- Tauri 开发构建有 23 条既有 Rust `dead_code` 警告；开发程序成功编译并启动。

## 六、截图索引

- `screenshots/native-startup-2800x1695.png`：原生开发态启动窗口和正式标题栏图标；目标截图为 2800×1696，差 1px 来自 Windows DPI 取整。
- `screenshots/light-plan-market-1280x800.png`：套餐行情紧凑卡片与完整文案。
- `screenshots/light-settings-cost-1280x800.png`：成本设置左摘要、右操作布局。
- `screenshots/dark-settings-cost-1280x800.png`：较小桌面宽度的深色成本设置。
- `screenshots/dark-overview-1440x960.png`
- `screenshots/dark-reset-history-1440x960.png`
- `screenshots/dark-plan-market-1440x960.png`
- `screenshots/dark-settings-basic-1440x960.png`
- `screenshots/dark-settings-cost-1440x960.png`
- `screenshots/dark-token-services-1440x960.png`

## 七、本轮提交清单

1. `804e8158 docs: add v4 ui round implementation plan`
2. `21165ba9 docs: record v4 ui baseline`
3. `20cac401 feat: unify card press feedback`
4. `188bf950 fix: render token plan quota facts per model`
5. `db97d221 feat: compact service and plan market cards`
6. `cf210237 feat: align cost settings controls and cache`
7. `45c12b3b fix: enable limit sorting and align reset heatmap`
8. `692330ab fix: unify dark mode surfaces`
9. `3939259f fix: align desktop launch icon and size`

本报告和截图将作为第 10 个、也是本轮最后一个本地验收提交。此处停止在用户预览关口；未经单独授权，不推送、不合并 `0.54.40-V4`、不发版、不删除分支或工作树。
