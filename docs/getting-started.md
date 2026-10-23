# Windows 社区预览使用指南

## 下载安装

1. 打开 [v0.54.50 发布页](https://github.com/muxunson-9677/token-eyes/releases/tag/v0.54.50)。
2. 在 Assets 中选择 `Token-Eyes-0.54.50-Windows-x64-setup.exe`。不要把 `Source code` 压缩包当安装包。
3. 运行安装器，安装后打开 Token Eyes。普通用户无需安装 Node.js、Rust 或购买云服务。

当前发布面向 Windows 10/11 x64；这不代表已覆盖所有系统版本测试。安装包未签名。出现 SmartScreen 时，先确认来源和文件校验值；若有“更多信息”，可查看发布者信息和“仍要运行”选项。组织策略不允许运行时请联系管理员，不必关闭系统安全防护。

## 校验下载文件

在安装包所在文件夹打开 PowerShell：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\Token-Eyes-0.54.50-Windows-x64-setup.exe'
```

结果应与同一 Release 的 `SHA256SUMS.txt` 一致。0.54.50 的值为：

```text
93b321cb53a6010df6b90f3b20969dff5bb14618e84ac270c71983c4e2266368
```

不一致时不要运行该文件，应重新从本仓库下载；其他版本应使用其各自的校验文件。

## 第一次打开

1. 等待首次检测完成，查看哪些 AI 工具已有可读取日志。
2. 点击“查看我的用量”进入概览。本地查看无需注册 Token Eyes 云账号。
3. 打开“使用与成本 → 使用明细”，检查时间范围、来源与模型筛选；“实时会话”提供另一种查看入口。
4. 数据源路径不正确时，在“设置 → 基础设置”检查数据目录；异常状态可从“设置 → 数据与诊断”开始排查。

没有日志、筛选范围内没有记录、未配置或未授权时可能显示空数据。首次检测到来源不等于已经验证其统计完整性；如果已有用量仍一直为空，请按下方方式反馈，不必反复清空数据或重新安装。

## 常见问题

| 现象 | 下一步 |
| --- | --- |
| 下载后只有源代码 | 回到 Release 的 Assets，选择 `Windows-x64-setup.exe` |
| 提示未知发布者 | 确认仓库地址并校验 SHA256；这是未签名预览包 |
| 用量为 0 | 检查 AI 工具是否生成日志、数据目录和时间筛选；仍异常时提交 Issue |
| 费用与账单不同 | 界面费用为估算，折扣、套餐和供应商实际计费可能不同 |
| 在线排行榜等功能不可用 | 这些功能依赖外部服务；记录时间、页面和错误后反馈 |
| 无法启动或白屏 | 记录 Windows 版本、应用版本及报错截图；若提示缺 WebView2，请按提示检查该运行时 |

## 反馈与共创

先搜索[已有问题](https://github.com/muxunson-9677/token-eyes/issues)，再用[问题反馈模板](https://github.com/muxunson-9677/token-eyes/issues/new?template=bug_report.yml)填写：应用版本、Windows 版本、涉及的 AI 工具、复现步骤、期望与实际结果。截图先遮盖用户名、私人路径和账号信息；不要上传完整日志、Cookie、API Key 或对话正文。

使用疑问和想法可放到 [Discussions](https://github.com/muxunson-9677/token-eyes/discussions)。想改代码或文档，请看[贡献指南](../CONTRIBUTING.md)。

## 截图与验证范围

README 截图来自 2026-10-23 匿名下载的 0.54.50 安装版原生概览窗口，浅色主题，隔离测试资料，空数据状态；构建提交为 `2a864bc70d7fced8d99b25ef0991c0bb9a3d4237`。图片只用于展示界面，不证明真实供应商采集或费用准确性。

本版验证覆盖隔离安装、首次检测、基础页面导航与结束进程后重开。实际检查摘要见 [Release 附件](https://github.com/muxunson-9677/token-eyes/releases/download/v0.54.50/preview-verification.json)，已知问题见 [README](../README.md#这个预览包的边界)。后续仅文档提交不会改变这个安装包的构建 SHA。
