# TE-NEXT 派单矩阵 - 2026-06-23

## 当前审核状态

- `P02`：已审核。Spend timeseries API 定向测试通过。
- `P03`：已审核。花销趋势图已接入，Codex 已补齐货币、错误隔离、刷新依赖和中文文案相关问题。
- `S02`：已审核。Dashboard 自动刷新相关定向验证通过。
- `T02`：已审核。Adapter registry 定向测试通过；大范围 parser smoke 只被本机缺少 `sqlite3` CLI 阻塞。
- `Q01/Q02`：已审核。账单模式标签与筛选已完成，`pay-as-you-go` 启发式边界已补齐。
- `R01/R02`：已审核。Codex 额度窗口展示复用现有 usage-limits 接口，失败态回退测试已补齐。
- `U01/U02`：已审核。请求级只读明细视图已完成，中文 copy、cached input、日期边界和 Codex data directory 配置化已补齐。
- `V00`：已审核。Token Eyes Tauri baseline 已恢复并推送，commit `d37d29cf2ddae6a0a5e3cce539dfd13392ef7325`。
- `V01`：已分派给人工负责人。下一步是在本机运行/安装 V00 产出的 Token Eyes Tauri 应用，验证三个数据目录按钮。

## 当前下一步

现在不要再派 `P02/P03/Q02/R02/S02/T02/U02/V00`。

当前唯一下一步是 `V01` 人工验证：

1. 使用 `claude/te-next-v00-tauri-baseline-restore` 分支或其产出的安装包。
2. 打开 Token Eyes Tauri 桌面应用。
3. 进入 Settings -> Data Directories。
4. 依次验证 Claude Code、Codex、Hermes Agent 三个“选择文件夹”按钮。
5. 每个按钮都要确认：能弹出系统目录选择器、选择后能回填路径、取消后不清空已有值。
6. 把截图或文字结果发给 Codex。

## 必须串行

- `V00 -> V01 -> V02`
- V00 已完成。
- V01 现在由用户人工验证。
- 只有 V01 失败并提供具体失败证据后，才生成/派发 V02 修复工单。

## 暂不派发

- `V02`：暂不派，等待 V01 手动验证失败证据。
- `R02/U02`：不再派发，已审核。
- `V00`：不再派发，已审核。

## 给 Claude Code 哪个文件

当前不要再给 Claude Code 新派 V00。

如果 V01 失败，Codex 会根据失败证据生成新的 V02 中文工单，再派给 Claude Code。

`TE-NEXT-DISPATCH-MATRIX-2026-06-23.md` 是项目派单矩阵，不是单个 Claude Code 的主工单；不要把它当作执行工单派出去。
