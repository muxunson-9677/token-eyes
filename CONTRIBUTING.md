# 参与 Token Eyes 共创

欢迎提交问题、复现步骤、文档改进和 PR。项目处于社区预览阶段，不要求贡献者先修完全部历史问题。

## 从这里开始

1. 搜索 [已有 Issue](https://github.com/muxunson-9677/token-eyes/issues)，避免重复。
2. 小修改可直接提交 PR；涉及数据模型、账号授权或采集口径的改动，先在 Issue 说明预期行为。
3. Fork 本仓库，在自己的分支修改，再向 `muxunson-9677/token-eyes` 的 `main` 提交 PR。

`main` 要求至少一位审核者批准、讨论解决后再合并；PR 有新提交时旧批准失效。普通贡献者不能直接推送、强推或删除 `main`。仓库所有者保留管理权限；所有者自己的 PR 无法自我批准，使用管理权限合并时仍须先完成独立审查并在 PR 留下依据。AI 代码审查不等同于另一位 GitHub 用户的批准。

## 开发环境

建议使用 Node.js 24（锁定依赖要求高于旧文档中的 Node 20）。

```bash
git clone https://github.com/muxunson-9677/token-eyes.git
cd token-eyes
npm ci
npm --prefix dashboard ci
npm run dashboard:dev
```

`dashboard:dev` 使用模拟接口。验证真实本地后端：

```bash
npm run dashboard:build
node bin/tracker.js serve --no-sync
```

`--no-sync` 用于避免开发启动时自动采集。需要验证采集时使用独立测试目录和脱敏日志，避免改写自己的真实历史。

Windows 桌面使用 `src-tauri/`（Tauri 2），界面在 `dashboard/`。开发需要 Rust 工具链、Microsoft C++ Build Tools、WebView2：

```bash
npm run tauri:dev
npm run tauri:build
```

打包过程会下载并内置 Node 运行时；普通安装包用户无需这些开发工具。根目录 `src/` 还有历史前端代码，不是当前 Tauri 的界面入口。

## 验证与 PR

按修改范围运行相关测试，PR 中如实写明命令、结果及没测到的范围：

```bash
node --test test/<相关测试>.test.js
npm --prefix dashboard run typecheck
npm --prefix dashboard run test
npm --prefix dashboard run build
```

完整检查为 `npm run ci:local`，Rust 检查为 `cargo test --manifest-path src-tauri/Cargo.toml`。当前 main 存在已知 CI 失败，不要把旧失败冒称为本次改动造成，也不要为了绿色结果删除有效断言。

- 一次 PR 尽量解决一个清楚的问题，附修改原因和验证方式。
- 新增界面文字走 `dashboard/src/content/copy.csv`。
- 提交信息沿用 Conventional Commits，例如 `fix: ...`、`docs: ...`。
- 采集测试使用独立目录，fixture 应脱敏；不要提交 API Key、Cookie、真实账号、完整对话或个人日志。
- 原作者和第三方版权声明应保留。

本轮采集修复已通过 PR #28 合入 `main`，请以最新 main 为贡献起点，避免重复劳动。维护者专用的 Agent 发布流程不要求首次贡献者搭建全部云服务或完成三平台验收。
