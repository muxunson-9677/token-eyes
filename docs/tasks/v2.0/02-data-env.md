# 02 - 数据与环境检测

## 中文简述

本工单负责真实项目路径、请求日志分页数据、Agent 数据目录环境检测。它可以在 `01-product-ui.md` 完成后与 `03-cost-billing.md` 并行执行。

## 第一性原理执行规则

- 先确认每个数据字段最终服务哪个 UI 模块。
- 数据接口必须支持真实数据替换，不为假数据写死。
- 项目路径必须能解释清楚来源、归一化规则和点击行为。
- 环境检测必须明确区分 Windows、WSL Ubuntu、未检测到。
- 不在本工单实现成本累积和 API 计费。

## 新增任务要求

- 项目用量返回真实项目路径。
- 项目用量字段包含：项目名、真实路径、Token、成本、请求数、最后活动时间。
- 点击项目路径可打开或定位到本地项目目录。
- 支持 Windows 路径和 WSL Ubuntu 路径。
- 对同一项目的不同路径表示做归一化，避免重复统计。
- 请求日志接口支持分页：`page`、`pageSize`、`total`、`items`。
- 请求日志默认 `pageSize=10`。
- 设置页数据目录模块中，每个 Agent 卡片新增 `环境检测` 按钮。
- 点击后检测该 Agent 在 `Win` 还是 `WSL Ubuntu`。
- 检测成功显示 `已就绪`。
- 检测失败显示 `未检测到`。
- 环境检测卡片参考用户截图中的本地环境检查形式：Agent 名称、环境标签、当前版本、最新版本、状态。

## 建议数据契约

```ts
type ProjectUsageRow = {
  projectName: string;
  projectPath: string;
  pathKind: "win" | "wsl";
  tokens: number;
  costUsd: number;
  requestCount: number;
  lastActiveAt: string;
};

type RequestLogPage = {
  page: number;
  pageSize: number;
  total: number;
  items: RequestLogRow[];
};

type AgentEnvironmentStatus = {
  agent: string;
  environment: "win" | "wsl-ubuntu" | "not-detected";
  status: "ready" | "not-detected";
  currentVersion?: string;
  latestVersion?: string;
  executablePath?: string;
};
```

## 验收标准

- 项目用量能显示真实路径。
- 同一项目不会因 Win/WSL 路径差异重复出现。
- 请求日志分页接口返回总数和 10 条列表。
- 设置页每个 Agent 都有环境检测按钮。
- 检测结果能明确显示 `Win`、`WSL Ubuntu`、`已就绪`、`未检测到`。
- 未检测到时 UI 不报错，展示清晰原因。

## 对抗性审查记录

执行者完成后必须填写：

### 第 1 轮审查

```text
审查轮次：第 1 轮
发现问题：
  1. WSL_DISTRO_PREFIX 正则表达式错误，无法正确匹配 \\wsl$\distro\ 格式的路径（$ 后缺少 \）
  2. \\wsl.localhost\distro\ 和 \\wsl$\distro\ 两种 WSL 路径格式未归一化，导致同一项目被重复统计
修复动作：
  1. 修正 WSL_DISTRO_PREFIX 正则，在 $ 后添加 \\：/^\\\\wsl\$\\([^\\]+)\\/i
  2. 修改 normalizeToWinPath 函数，将 \\wsl$\distro\ 格式统一归一化为 \\wsl.localhost\distro\ 格式
复查结果：
  - 新增 3 个测试用例验证修复
  - 全部 24 个后端测试通过
  - 全部 12 个前端测试通过
  - TypeScript 类型检查通过
  - 前端构建成功
最终结论：修复验证通过，进入第 2 轮审查
```

### 第 2 轮审查

```text
审查轮次：第 2 轮
发现问题：无
  - 路径归一化：Windows 路径、WSL localhost 路径、WSL $ 路径、/mnt/c/ 路径均能正确识别和归一化
  - 分页接口：page、pageSize 参数校验正确，默认 pageSize=10，返回 total、items 等字段
  - 环境检测：5 个 Agent（claude/codex/hermes/cursor/openclaw）均支持，状态包括 ready/not-detected
  - 前端 UI：检测按钮、加载状态、成功/失败状态均正确显示
  - 错误处理：网络错误、路径不存在等异常情况均有优雅降级
修复动作：无
复查结果：全部功能验收通过
最终结论：无遗留问题
```

## 完成情况汇报

完成后回复：

- 项目路径数据从哪里来。
- Win/WSL 路径如何处理。
- 请求日志分页接口如何验证。
- Agent 环境检测覆盖了哪些 Agent。
- 对抗性审查做了几轮，最后结论是什么。
