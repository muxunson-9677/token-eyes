# 花销页 Provider 可见性与趋势浮层关闭修复

## 目标

将限制显示的 Provider 偏好作为花销页唯一的可见性来源，并确保使用趋势的
放大浮层能在 Windows WebView 和启用减少动画的环境中可靠关闭。

## Provider 可见性约定

`useLimitsDisplayPrefs().visibleOrdered` 是按用户排序的可见 Provider id
集合。花销页直接消费该值，不维护第二套可见性偏好，也不根据当前是否存在数据
推断可见性。

该约定应用于：

- 花销趋势图例和绘制序列。
- Provider 统计和既有的按来源拆分。
- 请求明细的来源选择框。
- 基于请求记录的模型统计。

Provider 级视图保持用户选择顺序，并包含每一个可见 Provider。没有花销数据的
可见 Provider 显式显示为零成本行和空趋势序列。因此启用 Claude、Codex、Hermes
时，会看到三项对应的 Provider 级内容。

模型统计仅包含可见 Provider 的真实请求记录。没有请求级记录的 Provider 不会
凭空生成模型行。

## 请求明细范围

选择框列出所有可见 Provider，并使用 `limits-providers` 中的标准名称。若当前
选中的 Provider 被关闭，则自动选中第一个剩余可见 Provider；若全部关闭，则
不发起请求。

本地请求明细接口目前只读取 Codex rollout。选择其他可见 Provider 时，在其拥有
请求日志解析器前，会显示既有的空状态，前端不得伪造请求记录。

`SpendPage` 仅汇总可见 Provider 的请求记录，并移除当前刷新流程中未定义的
`requestUsageResult` 引用。

## 趋势浮层关闭约定

趋势放大浮层会进入关闭状态以保留退出动画，但 `onClose` 必须通过可靠的后备机制
调用，不能只依赖 `animationend`。这覆盖 WebView 丢失动画事件以及
`prefers-reduced-motion` 禁用 CSS 动画的情况。重复点击、点击背景和按 Escape
必须幂等。

## 实施边界

- 保持现有 Provider id、名称和偏好持久化机制不变。
- 只在能消除重复过滤逻辑的位置增加聚焦的展示/数据辅助函数，不增加第二套
  全局 Provider 状态。
- 不扩展当前仅支持 Codex 的请求明细 API。
- 在动画事件可用时保留浮层退出动画。

## 测试

先编写失败测试，再修改生产代码，覆盖：

- 按可见 Provider 顺序过滤并补零花销 Provider 数据；
- 请求明细选项跟随可见 Provider 列表，且切换后传入正确 API 来源；
- Provider/模型统计不显示已关闭 Provider；
- 未触发动画结束事件时，趋势浮层仍会调用关闭回调。

运行聚焦仪表盘测试、仪表盘类型检查与构建，以及全新的
`npx tauri build --no-bundle`。手动验证：已启用但无数据的 Provider 在 Provider
级花销视图显示为零，而模型明细仍为空。

## 验收标准

- 在限制显示中切换 Provider 后，花销页所有 Provider 级界面均使用同一份有序
  Provider 集合。
- 已关闭 Provider 不出现在趋势、请求明细选择框、Provider 统计、模型统计或按来源
  拆分中。
- 已启用但没有花销数据的 Provider 在 Provider 级界面显示为零。
- 无论动画是否可用，趋势浮层的 `X`、背景点击和 Escape 均能关闭浮层。
