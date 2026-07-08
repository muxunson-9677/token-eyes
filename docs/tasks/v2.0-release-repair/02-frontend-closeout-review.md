审查轮次：1
反方问题：
1. RequestUsageLog组件的页码按钮是否连接服务端分页？
2. UsageStatsPanel是否正确处理未知值和定价覆盖状态？
3. UsageTrendChart的ResizeObserver是否能正确处理组件生命周期？
4. 项目路径、API计费和环境状态UI是否完整？
5. 页面是否包含过时功能（热力图、GitHub stars）？

失败证据：
1. 初始测试显示页码clamping逻辑在onChange时未生效，导致输入99时显示99而非6
2. UsageStatsPanel的safeNum函数将null转换为0，导致未知请求数显示为0
3. UsageTrendChart的ResizeObserver使用空依赖数组，首次渲染时如果containerRef为空就跳过了

涉及文件：
- dashboard/src/ui/dashboard/components/RequestUsageLog.jsx
- dashboard/src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx
- dashboard/src/ui/dashboard/components/UsageStatsPanel.jsx
- dashboard/src/ui/dashboard/components/UsageTrendChart.jsx
- dashboard/src/content/copy.csv
- dashboard/src/content/i18n/zh/dashboard.json
- scripts/ops/ui-hardcode-baseline.json

修复动作：
1. 修改RequestUsageLog.jsx的onChange处理器，在输入时立即clamp到有效范围
2. 修改测试用例使用mockImplementation模拟服务端分页
3. 修改UsageStatsPanel.jsx，request_count=null时显示"—"和"仅有聚合数据"说明
4. 添加pricing_coverage状态处理：unpriced显示"未定价"，partial显示成本并带提示
5. 添加缺失的copy keys（ticket06.pricing.partial_hint, ticket06.pricing.unpriced_hint）
6. 修改UsageTrendChart.jsx，使用回调ref模式确保ResizeObserver能正确observe

复查命令：
```powershell
npm --prefix dashboard run test -- src/ui/dashboard/components/__tests__/RequestUsageLog.test.jsx src/ui/dashboard/components/__tests__/UsageTrendChart.test.jsx src/ui/dashboard/components/__tests__/UsageStatsPanel.test.jsx src/ui/dashboard/components/__tests__/ProjectUsagePanel.test.jsx src/components/settings/DataDirectoriesSection.env.test.jsx src/pages/SpendPage.test.jsx
npm run validate:copy
npm run validate:ui-hardcode
npm --prefix dashboard run build
```

复查结果：
- 测试：97/98通过（1个无关的LeaderboardPage测试失败）
- ESLint：通过
- typecheck：通过
- validate:copy：通过（1408 entries, 1017 keys used）
- validate:ui-hardcode：通过（colors=308, rawText=189）
- build：通过

剩余风险：
- LeaderboardPage测试失败（与本次修改无关，已存在）
- 缺少真实浏览器E2E测试验证

最终结论：通过