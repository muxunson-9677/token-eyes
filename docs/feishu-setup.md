# 飞书配置说明

状态: 已完成 MVP 初始化,并已重建为 A-H 模块化进度跟进表。

飞书只用于 Token Eyes 项目的进度管理,不是 Token Eyes 产品功能。

## 当前决定

- 用户已提供 App ID 和 App Secret,Codex 已写入本机 `.env`。
- 已通过 tenant access token 鉴权验证。
- 已创建 `Token Eyes 进度表` 多维表格。
- 已创建 `V2.1工单` 表,并按 A-H 模块重建为 32 条进度记录。
- V2.1 简化版任务标题统一带 `[MVP]` 前缀; 后续完整版任务不带该前缀。
- 不要把凭证硬编码进代码或文档。
- 凭证只放在项目根目录 `.env`。当前 `.env` 已在 `.gitignore` 中,不得提交。

## 当前本地配置

- Base URL: `https://fcnvw6p38l87.feishu.cn/base/U5qAbqUcVakKVus3OmocQWHpnXf`
- 当前工单表: `V2.1工单`
- 当前工单表 ID: `tblDSTa3QdRXUrjQ`
- 默认表 ID: `tblVOSTCkniyBplD`

## 当前飞书字段

- 任务ID
- 模块ID
- 所属模块
- 任务标题
- 任务归属: `Codex任务` / `Claude Code任务` / `人工确认` / `Codex+人工`
- 负责执行方: `Codex` / `Claude Code` / `人工负责人`
- 派发对象
- 状态: `待分派` / `已分派` / `执行中` / `待审核` / `已审核` / `打回` / `阻塞`
- 当前阶段
- 分支名
- 工单文件
- 前置任务
- PR链接
- 验收标准摘要
- 进度说明
- 证据/报告
- 阻塞事项
- 备注

## 已执行初始化步骤

1. 用户创建或授权一个飞书自建应用,并授予多维表格读写权限。
2. 用户提供 App ID 和 App Secret。
3. Codex 把凭证写入 `.env`。
4. Codex 创建 `Token Eyes 进度表` 多维表格。
5. Codex 创建 `V2.1工单` 表。
6. Codex 写入并删除一条测试记录,验证读写权限。
7. Codex 把本地 V2.1 工单同步成飞书记录。
8. Codex 按用户要求重建进度表: 用 A-H 模块和 A01/A02/B01 格式拆分 Codex 任务、Claude Code 任务和人工确认任务。

## 后续使用纪律

1. 每次生成新工单前,先读取飞书表当前记录,避免重复或顺序错乱。
2. 每次审核 Claude Code 结果时,对照原工单验收标准更新状态; 审核通过后状态写 `已审核`,不是笼统写 `已完成`。
3. 不把飞书同步做成 Token Eyes 产品功能;它只服务项目进度管理。
4. 当前飞书表所有者仍是应用机器人。转移给用户需要用户提供飞书 `open_id` / `user_id` / `union_id` / 邮箱之一。
