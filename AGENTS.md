# Agent Instructions

Use [CLAUDE.md](./CLAUDE.md) as the single source of truth for this repository's project guidance, architecture notes, release workflow, and conventions.

The mandatory branch/worktree, quality/regression, and user-facing verification/delivery policies are in `CLAUDE.md` under **Project-wide**. They apply to every Token Eyes task before implementation, commit, push, merge, release, or handoff.

If any project-specific instructions appear to conflict across files, follow `CLAUDE.md` and update this file only to keep that pointer intact.

## 用户结果优先验收否决门（硬规则）

下面的规则是对 `CLAUDE.md` 中不可妥协交付边界的直接重申，不得弱化、替换，也不得当作可选流程建议。

- **解决用户可观察的问题，不得用代理指标替代。** 测试数量、lint、typecheck、编译、校验和、manifest、打包、解压、进程启动、后台健康、mock 调用和合成状态转换都只是辅助证据，永远不能替代用户明确要求的实际结果。
- **实现前把用户原话写成具有阻断力的验收合同。** 每一行必须写明最终运行时/制品、初始状态、正常鼠标或键盘操作、预期可见结果、必要时的持久化/刷新/重启结果、负向条件和所需证据。任何一行缺少当前证据，任务都不得判定完成。
- **必须执行两次相互独立的核对。** 第一审逐项核对实现结果是否满足用户验收合同；第二审从最终生产制品重新开始，以真实用户方式重走完整旅程。第二审不得复用第一审结论、只重跑同一组 mock 测试，或根据源码推断真实效果。
- **用户可见的原生或外部流程必须验证真实链路。** 依赖 native bridge、持久化、系统浏览器、OAuth、供应商 API、重启或安装器的控件，必须在最终安装版中真实跨过对应边界并观察最终 UI 状态。mock bridge 被调用或后台成功启动只能证明各自那一层。
- **安装 smoke 的证明范围必须严格收窄。** 构建、安装、解压、启动、运行时存活、版本或 SHA 校验成功，都不能证明按钮、UI 状态、浏览器授权、回调、持久化、刷新或故障恢复流程可用。
- **缺少真实能力时必须阻断，禁止找替代证据冒充。** 如果缺少 GUI 自动化、已授权测试账号、系统浏览器观察能力、供应商访问、安装权限或其他必要条件，必须准确标为 `blocked` 或 `partial` 并列出缺失证据；禁止把安装包、可执行文件或候选版本交给用户去替代理人发现是否可用。
- **禁止把用户变成最终测试环境。** 不得要求用户通过覆盖安装候选包来验证代理已经声称修复的问题。只有用户明确要求接收“未验证候选包”且制品被清晰标注为未验证时才可提供；绝不能将其描述为可验收交付物。
- **用户重复报告同一缺陷时，之前的完成结论自动撤回。** 必须重新打开原始验收行，旧制品和旧截图全部失去证据效力，按用户的精确操作路径重新复现；下一制品必须在两次 fresh 核对全部通过前禁止交付。
- **完成措辞和制品链接受证据硬门约束。** 只有交付的精确制品已通过全部用户验收行和两次独立核对，才允许说“完成”“已修复”“验收通过”“可以安装”，或提供作为完成交付的下载链接。
