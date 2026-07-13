# Token Eyes 开发者排行榜预览测试包设计

日期：2026-07-14

状态：已实现并生成测试安装包

## 目标

在真实微信开放平台配置尚未部署时，生成一个可覆盖安装的 Windows 测试 EXE。该测试包允许开发者从排行榜页面直接进入一个明确标注的本地预览登录态，用于验证登录前后界面、榜单维度、个人排名和页面交互。

## 安全边界

- 开发者直登只由构建期变量 `VITE_TOKENTRACKER_DEV_LEADERBOARD_LOGIN=1` 开启；普通开发构建和正式发布构建默认关闭。
- 直登不创建 InsForge 用户、不签发云端令牌、不调用微信接口，也不上传本机真实用量。
- 预览登录态只在排行榜 URL 中使用 `dev_login=1&mock=1` 表示，刷新排行榜仍可保持；离开该 URL 后不会改变本地概览、统计、限制、成本或设置的数据来源。
- 页面必须明确显示“开发者预览”“模拟数据”“不会上传”，不能让测试人员把它误认为真实微信授权或正式排行榜上榜。
- 正式微信入口保留为不可用占位，现有真实微信 OAuth 代码不删除、不伪造成功回调。

## 交互

测试构建且尚未进入预览时，排行榜登录区域显示：

1. 微信登录占位按钮，不发起微信授权。
2. “开发者直登”按钮。
3. 说明该入口只用于本地模拟验证。

点击“开发者直登”后，在当前排行榜查询参数中加入 `dev_login=1&mock=1`，排行榜切换到已有的本地 Mock 数据源，并显示开发者预览已登录提示及退出按钮。点击退出后移除这两个参数，恢复登录占位状态。

## 实现范围

- 新增一个小型构建开关读取函数，集中判断开发者预览是否启用。
- 仅修改排行榜页面、对应 copy 文案和测试。
- 不修改 InsForge 认证上下文、云端接口、Edge Function、数据库或微信 OAuth 适配器。
- 不变更正式版本号；本地 NSIS 测试安装包沿用当前 `0.54.0`，用于覆盖安装验证，不发布到 GitHub Release。

## 验证标准

- 未设置构建开关时，开发者直登入口不存在。
- 设置构建开关后，直登入口出现，微信按钮保持占位且不会调用 `signInWithOAuth`。
- 点击直登后 URL 带有 `dev_login=1&mock=1`，显示预览登录态和模拟榜单。
- 点击退出后两个参数被移除。
- 相关 Vitest、copy 校验、变更文件 ESLint、Dashboard 生产构建和 Tauri Windows NSIS 打包通过。
- 最终交付 `src-tauri/target/release/bundle/nsis/` 下的安装 EXE、文件大小和 SHA-256。

## 非目标

- 不验证真实微信扫码、真实 InsForge 会话或真实排行榜同步。
- 不提供可用于正式环境的免认证入口。
- 不安装或修改 Token Eyes 项目目录以外的软件，也不操作 CC Switch。

## 实施与验证结果

- 普通构建不设置开关，开发者直登入口保持隐藏；测试安装包使用 `VITE_TOKENTRACKER_DEV_LEADERBOARD_LOGIN=1` 构建。
- 聚焦 Vitest：5 个测试文件、42 项测试全部通过。
- 变更文件 ESLint、copy 注册表、架构守卫和 Dashboard 生产构建通过。
- 编译后的排行榜代码包含 `function Bo(){return zo("1")}`，确认测试开关已注入本次安装包；应用版本信息中的 ProductName 和 FileDescription 均为 `Token Eyes`。
- NSIS 安装包：`src-tauri/target/release/bundle/nsis/Token Eyes_0.54.0_x64-setup.exe`。
- 安装包大小：35,664,115 字节（34.01 MiB）。
- SHA-256：`5E698B38A6352AFD57F694D66630A559ABB323BDB67EBD28D7C45605AF970643`。
- 附带检查 `validate:ui-hardcode` 仍报告本功能之前已存在的 3 个文件基线偏差：`TokenPlanSection.jsx`、`TokenServiceList.jsx`、`UsageOverview.jsx`；本次排行榜测试曾触发的新增偏差已消除。
