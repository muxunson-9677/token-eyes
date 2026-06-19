# 飞书配置说明

状态: 已完成 MVP 初始化。

飞书只用于 Token Eyes 项目的进度管理,不是 Token Eyes 产品功能。

## 当前决定

- 用户已提供 App ID 和 App Secret,Codex 已写入本机 `.env`。
- 已通过 tenant access token 鉴权验证。
- 已创建 `Token Eyes 进度表` 多维表格。
- 已创建 `V2.1工单` 表并同步 10 条 V2.1 MVP 工单记录。
- 不要把凭证硬编码进代码或文档。
- 凭证只放在项目根目录 `.env`。当前 `.env` 已在 `.gitignore` 中,不得提交。

## 当前本地配置

- Base URL: `https://fcnvw6p38l87.feishu.cn/base/U5qAbqUcVakKVus3OmocQWHpnXf`
- 当前工单表: `V2.1工单`
- 当前工单表 ID: `tblDSTa3QdRXUrjQ`
- 默认表 ID: `tblVOSTCkniyBplD`

## 需要创建的飞书字段

- 任务ID
- 所属模块
- 任务标题
- 负责执行方: `Claude Code`
- 状态: `待分派` / `已分派` / `执行中` / `待审核` / `已完成` / `打回`
- 分支名
- 工单文件
- PR链接
- 验收标准摘要
- 备注

## 已执行初始化步骤

1. 用户创建或授权一个飞书自建应用,并授予多维表格读写权限。
2. 用户提供 App ID 和 App Secret。
3. Codex 把凭证写入 `.env`。
4. Codex 创建 `Token Eyes 进度表` 多维表格。
5. Codex 创建 `V2.1工单` 表。
6. Codex 写入并删除一条测试记录,验证读写权限。
7. Codex 把本地 V2.1 工单同步成飞书记录。

## 后续使用纪律

1. 每次生成新工单前,先读取飞书表当前记录,避免重复或顺序错乱。
2. 每次审核 Claude Code 结果时,对照原工单验收标准更新状态。
3. 不把飞书同步做成 Token Eyes 产品功能;它只服务项目进度管理。
