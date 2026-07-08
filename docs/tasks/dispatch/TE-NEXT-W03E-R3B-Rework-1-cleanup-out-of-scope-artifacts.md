# W03E-R3B-Rework-1 Cleanup Out-of-Scope Artifacts

> **For agentic workers:** Execute only this work order. This is a cleanup/rework task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 W03E-R3B 首轮交付中遗留的越界文件和调试残留，使工作区只保留 R3B 工单允许范围内的合格交付物。

**Architecture:** R3B 首轮结论为 BLOCKED（合格）。但交付物中包含两个越界问题：一个绕过 Tauri 构建脚本的退化副本源文件，以及一批调试残留二进制/文本文件。本工单只做删除和清理，不新增功能，不修改生产逻辑。

**Tech Stack:** Rust/Tauri 2、cargo test、文件系统操作。

---

## 0. 派发说明

本工单是 R3B 首轮验收后的打回重修。主调度者已完成验收，结论为：

- R3B 契约结论 BLOCKED：**合格交付**，不需要修改。
- `src-tauri/src/xiaomi_mimo_session.rs`：**合格**，保留不动。
- `src-tauri/src/lib.rs` 中 R3B 的修改（注册 `xiaomi_mimo_session` 模块和命令）：**合格**，保留不动。
- `src-tauri/Cargo.toml` / `Cargo.lock` 中 `url = "2.5"` 依赖：**合格**，保留不动。
- `docs/dev-notes/xiaomi-mimo-console-quota-contract-2026-06-27.md`：**合格**，保留不动。

需要清理的越界问题（且仅限以下两项）：

1. `src-tauri/src/xiaomi_mimo_session_pure.rs`：绕过 Tauri 构建脚本的纯 helper 副本，其 `is_official_xiaomi_url` 实现比 `xiaomi_mimo_session.rs` 原版退化（用 `url.contains(domain)` 而非 URL 解析，无法防御钓鱼域名）。实际 `cargo test xiaomi_mimo_session` 已能直接通过（15 passed），此副本已无必要。
2. 调试残留文件：`src-tauri/src/out.txt`、`src-tauri/src/xiaomi_mimo_session_pure_test`（二进制）、`src-tauri/src/xiaomi_mimo_session_pure_test.pdb`、`src-tauri/src/xiaomi_mimo_session_pure_test.txt`、`src-tauri/xiaomi_mimo_session_pure_test.pdb`。

**不属于本工单范围**（已由主调度者确认是 6/24 更早其他任务的既有工作区修改，R3B 正确保留了它们）：

- `src-tauri/src/commands.rs` 的 LocalServer 逻辑（6/24 修改，非 R3B 引入）
- `src-tauri/build.rs` 的 icon rerun-if-changed（6/24 修改，非 R3B 引入）
- `src-tauri/icons/*` 的图标变更（非 R3B 引入）
- 根目录 `test-output-*.txt`（属于 R3E 工单的调试残留，R3E 尚未审核，留待后续）
- `_read-test.cjs`、`_verify.cjs`（6/21 更早的调试脚本，非 R3B 引入）

## 1. 开始前必读

- `CLAUDE.md`
- `docs/tasks/dispatch/TE-NEXT-W03E-R3B-xiaomi-mimo-session-evidence-unblock.md`（原工单，理解允许范围）
- `src-tauri/src/xiaomi_mimo_session.rs`（确认原版实现完整，含 URL 解析和钓鱼防御）
- `src-tauri/src/xiaomi_mimo_session_pure.rs`（确认这是退化副本）

## 2. 允许的操作

- 删除 `src-tauri/src/xiaomi_mimo_session_pure.rs`
- 删除 `src-tauri/src/out.txt`
- 删除 `src-tauri/src/xiaomi_mimo_session_pure_test`（二进制，无扩展名）
- 删除 `src-tauri/src/xiaomi_mimo_session_pure_test.pdb`
- 删除 `src-tauri/src/xiaomi_mimo_session_pure_test.txt`
- 删除 `src-tauri/xiaomi_mimo_session_pure_test.pdb`

禁止修改任何其他文件。禁止 `git reset`、`git checkout`、`git clean`、`git add -A`、`git commit`。

## 3. 任务

- [ ] 运行 `git status --short`，记录基线。
- [ ] 确认 `src-tauri/src/xiaomi_mimo_session.rs` 原版 `is_official_xiaomi_url` 使用 `url::Url::parse` 进行完整 URL 解析和子域名校验（第 91-104 行），能防御钓鱼域名。
- [ ] 确认 `src-tauri/src/xiaomi_mimo_session_pure.rs` 的 `is_official_xiaomi_url` 仅用 `url.contains(domain)`（第 38-40 行），无法防御钓鱼域名，是退化副本。
- [ ] 删除 `src-tauri/src/xiaomi_mimo_session_pure.rs`。
- [ ] 删除 `src-tauri/src/out.txt`。
- [ ] 删除 `src-tauri/src/xiaomi_mimo_session_pure_test`（二进制，无扩展名）。
- [ ] 删除 `src-tauri/src/xiaomi_mimo_session_pure_test.pdb`。
- [ ] 删除 `src-tauri/src/xiaomi_mimo_session_pure_test.txt`。
- [ ] 删除 `src-tauri/xiaomi_mimo_session_pure_test.pdb`。
- [ ] 确认 `src-tauri/src/lib.rs` 中**没有** `mod xiaomi_mimo_session_pure;` 声明（如果有则删除该行；预期没有，因为原版只用 `mod xiaomi_mimo_session;`）。
- [ ] 确认 `src-tauri/Cargo.toml` 中没有引用 `xiaomi_mimo_session_pure`。

## 4. 验证

```powershell
cargo test --manifest-path src-tauri/Cargo.toml xiaomi_mimo_session
```

预期：**15 passed, 0 failed**（与清理前一致，证明删除副本不影响测试）。

```powershell
npm.cmd run validate:guardrails
```

预期：`Guardrails ok: no violations found`。

确认以下文件已不存在：

```powershell
Test-Path "src-tauri/src/xiaomi_mimo_session_pure.rs"
Test-Path "src-tauri/src/out.txt"
Test-Path "src-tauri/src/xiaomi_mimo_session_pure_test"
Test-Path "src-tauri/src/xiaomi_mimo_session_pure_test.pdb"
Test-Path "src-tauri/src/xiaomi_mimo_session_pure_test.txt"
Test-Path "src-tauri/xiaomi_mimo_session_pure_test.pdb"
```

预期：全部返回 `False`。

```powershell
git status --short -- src-tauri/src/xiaomi_mimo_session_pure.rs src-tauri/src/out.txt "src-tauri/src/xiaomi_mimo_session_pure_test*" "src-tauri/xiaomi_mimo_session_pure_test*"
```

预期：这些文件不再出现在 `??` 未跟踪列表中。

## 5. 禁止事项

- 不修改 `src-tauri/src/xiaomi_mimo_session.rs`（合格，保留）。
- 不修改 `src-tauri/src/lib.rs`（除非需要删除 `mod xiaomi_mimo_session_pure;`，预期不需要）。
- 不修改 `src-tauri/src/commands.rs`、`src-tauri/build.rs`（既有工作区修改，非 R3B 范围）。
- 不修改契约文档。
- 不清理根目录 `test-output-*.txt`、`_read-test.cjs`、`_verify.cjs`（非本工单范围）。
- 不执行 `git reset`、`git checkout`、`git clean`、`git add -A`、`git commit`。

## 6. 完成标准

- 六个越界/残留文件全部删除。
- `cargo test xiaomi_mimo_session` 仍为 15 passed, 0 failed。
- `validate:guardrails` 通过。
- `xiaomi_mimo_session.rs` 原版实现未被触碰。
- 没有其他文件被修改。

## 7. 返回模板

```markdown
## W03E-R3B-Rework-1 结果
- 结论：COMPLETED / BLOCKED
- 删除的文件：
- 未删除的文件（如有，说明原因）：

## 验证
- cargo test xiaomi_mimo_session：passed / failed 数量
- validate:guardrails：通过 / 失败
- 文件存在性检查：全部 False / 有残留

## 边界
- 是否修改 xiaomi_mimo_session.rs：否
- 是否修改 lib.rs：否（或仅删除 mod 声明行）
- 是否修改工单外文件：否
- 是否执行提交：否
```
