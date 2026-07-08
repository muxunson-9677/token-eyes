# Token Eyes 产品图标替换

## 目标

在桌面应用、安装包/窗口、托盘和网页 favicon 中统一使用已确认的黄黑
Token Eyes 图标。服务商标识与功能性 UI 图标保持不变。

## 范围

将用户提供的黄黑图标保存为
`assets/branding/token-eyes-yellow-black.png`，作为唯一受版本控制的源文件。
派生图标需要裁掉原图外围的白色圆角区域。

完整彩色产品图标：

- `src-tauri/icons/` 中的 Tauri 打包图标。
- `dashboard/public/` 中的网页图标：`favicon.ico`、`favicon-16.png`、
  `favicon-32.png`、`apple-touch-icon.png`、`app-icon.png`、`icon-192.png`
  和 `icon-512.png`。
- 旧版 Windows 可执行文件和仪表盘窗口图标：
  `TokenTrackerWin/assets/trayicon.ico`。
- 旧版 macOS 应用图标源文件和回退文件：
  `TokenTrackerBar/TokenTrackerBar/AppIcon.icon` 与
  `TokenTrackerBar/TokenTrackerBar/AppIcon.icns`。

状态栏图标：

- Windows 托盘的 `tray-mascot-onLight.ico` 与
  `tray-mascot-onDark.ico` 使用在托盘尺寸下清晰可见的黄黑产品图标，替代
  Clawd 吉祥物。
- macOS 的 `MenuBarIcon.imageset` 使用 Token Eyes 的 `T` 轮廓作为
  `isTemplate` 图标。macOS 会按明暗菜单栏自动重着色，因此此处有意不保留
  黄黑填充色。

## 不包含的内容

- Claude、Codex、Gemini、Cursor 等服务商标识，以及
  `dashboard/public/brand-logos/` 或 macOS 服务商图片集中的文件。
- Lucide 图标、导航图标及其他功能性 UI 图标。
- 与产品应用图标无关的文档截图和营销图片资源。

## 实施规则

- 若现有 Windows 或 macOS 图标生成脚本会重新生成旧图标，则必须同步更新。
- 生成真实的多尺寸 ICO 文件。尤其网页 `favicon.ico` 必须包含其声明的
  图标数据，不能保留当前仅 57 字节的不完整文件。
- 保留本设计范围外的未提交改动。
- 不改变应用行为、服务商渲染或用户文案。

## 验证

在替换资源前新增资源校验 Node 测试。测试应先在当前旧版原生资源上失败，
并在修改后验证：

- 必需文件存在；
- PNG 资源尺寸符合声明；
- ICO 和 ICNS 具有有效文件签名及非空载荷；
- 网页 favicon 不再是 57 字节的不完整文件。

运行聚焦测试、仪表盘构建和 `npx tauri build --no-bundle`。Windows 环境无法
编译 macOS 应用，因此验证已提交 `.icns` 的签名，并确认源资源仍与现有 Xcode
项目配置兼容。

## 验收标准

- 浏览器标签页、Tauri 窗口/任务栏、Windows 安装包/窗口/托盘和 macOS 应用
  均显示已确认的 Token Eyes 图标。
- macOS 菜单栏状态图标保持相同的 `T` 轮廓，并在系统浅色和深色模式下可见。
- 不替换任何服务商或功能性 UI 图标。
