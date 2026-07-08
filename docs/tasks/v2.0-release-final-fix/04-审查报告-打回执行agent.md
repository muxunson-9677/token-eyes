# 03 独立最终验收审查报告 — 打回执行 agent 修复

> **审查角色**：独立最终验收 subagent（全新上下文，未采信主线结论）
> **审查时间**：2026-07-01
> **基线 SHA**：`f12cb7884a0afd08289a2deae7c9d94acfeeed9d`
> **最终结论**：⛔ **不可上线**
> **完整审查记录**：见 `review-records.md` 的 03 段（含对抗性审查 2 轮）

---

## 一、阻断问题清单（必须修复后才能上线）

### 🔴 阻断问题 1：A9 Git 可复现硬门禁失败（核心阻断）

**问题摘要**：当前工作区有 **194 个发布关键文件**未进入 Git 提交历史，`git clone` 后全部丢失，干净检出无法复现构建和测试。

**详细分类**：

| 类别 | 数量 | Git 状态 | 含义 |
|---|---:|---|---|
| 新增文件已暂存未提交 | 68 | `A ` | `git add` 已执行，但未 `git commit`，clone 后不存在 |
| 已修改文件未暂存 | 126 | ` M` | 工作区有修改，`git add` 未执行，commit 不会包含，clone 后是旧版本 |
| A8 修复未重新暂存 | 1 | `AM` | 我在审查中修复了 entitlements 路径，但修复在工作区，暂存区仍是旧路径 |

**68 个 staged 新文件中包含的发布关键文件**（部分列举）：
- `.github/workflows/npm-publish.yml`
- `.github/workflows/release-dmg.yml`
- `.github/workflows/release-windows.yml`
- `src/lib/project-path.js`（01 工单核心修复）
- `src/lib/agent-env-detect.js`
- `src/lib/api-billing.js`
- `src/lib/token-plan-catalog/index.js`
- 42 个 dashboard 源码/测试文件
- 13 个 test 文件

**126 个 unstaged 修改文件中包含的发布关键文件**（部分列举）：
- `src/lib/local-api.js` — path_status 字段添加
- `src/lib/rollout.js` — 项目路径解析
- `src/lib/pricing/index.js` — 定价 fallback
- `src/commands/serve.js`
- `dashboard/src/App.jsx` — Vercel 脚本条件渲染
- `dashboard/src/ui/dashboard/components/DataDetails.jsx` — ProjectUsagePanel 接入
- `dashboard/src/ui/dashboard/components/ProjectUsagePanel.jsx` — 远程仓库显示
- `dashboard/src/ui/dashboard/views/DashboardView.jsx`
- `dashboard/src/pages/SpendPage.jsx`
- `dashboard/src/content/copy.csv` — 新增文案
- `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/src/lib.rs`
- 多个 test 文件

**验证命令（执行 agent 可自行复现）**：
```bash
# 确认文件不在 HEAD 中
git cat-file -e HEAD:.github/workflows/release-dmg.yml   # 应失败：path exists on disk, but not in 'HEAD'
git cat-file -e HEAD:src/lib/project-path.js             # 应失败

# 统计未暂存修改文件数
git diff --name-only | wc -l   # 应输出 126

# 统计 staged 新文件数
git diff --cached --name-only --diff-filter=A | wc -l   # 应输出 68
```

---

### 🟡 阻断问题 2：A8 entitlements 路径错误（已修复但未暂存）

**问题摘要**：`release-dmg.yml` 第 73 行 codesign 命令引用的 entitlements 文件路径错误，CI 中 macOS 构建会失败。

**错误路径**：`TokenTrackerBar/TokenTrackerBar.entitlements`
**正确路径**：`TokenTrackerBar/TokenTrackerBar/TokenTrackerBar.entitlements`

**原因**：
- codesign 命令在仓库根目录运行（无 `working-directory`）
- 文件实际在 `TokenTrackerBar/TokenTrackerBar/TokenTrackerBar.entitlements`（嵌套目录）
- `project.yml` 中 `path: TokenTrackerBar/TokenTrackerBar.entitlements` 是相对于 `TokenTrackerBar/` 目录（xcodegen 语义），解析后与实际文件位置一致
- 但 workflow 的 codesign 路径是相对于仓库根目录，少了一层 `TokenTrackerBar/`

**当前状态**：独立验收 subagent 已用 Edit 修复该路径（工作区已正确），但修复未 `git add`，暂存区仍是旧路径。文件状态为 `AM`。

**验证命令**：
```bash
git diff .github/workflows/release-dmg.yml
# 应显示：
# -          codesign --sign - --force --entitlements TokenTrackerBar/TokenTrackerBar.entitlements "$APP_PATH"
# +          codesign --sign - --force --entitlements TokenTrackerBar/TokenTrackerBar/TokenTrackerBar.entitlements "$APP_PATH"
```

**测试盲点**：`test/release-dmg-workflow.test.js` 只检查 workflow YAML 文本包含 `TokenTrackerBar.entitlements` 字符串，未验证文件是否真实存在。修复路径后仍包含该子字符串，所以测试通过——但测试无法发现路径错误。

---

### 🟡 阻断问题 3：A10 飞书 2.0-03 状态失真（已修正）

**问题摘要**：飞书 2.0-03 被提前标记为"通过/已完成"，但独立验收正在进行且发现 A9 阻断点。

**当前状态**：独立验收 subagent 已用 `_feishu_fix_03_status.cjs` 修正为"进行中/独立验收中"，读回确认。

**执行 agent 注意**：修复 A9 并重验通过后，需要将 2.0-03 飞书状态更新为"通过/已验收"（仅在所有门禁通过后）。

---

## 二、已通过的门禁（无需改动，仅供参考）

| 编号 | 门禁 | 结论 | 证据 |
|---|---|---|---|
| A1 | 项目真实数据 UI | ✅ | 3 真实路径 + 3 远程仓库 + 成本 + 定价状态 |
| A2 | 项目 API 契约 | ✅ | path_status + path_kind 枚举一致 |
| A3 | 请求日志 | ✅ | 10 条/页，5000 总数，500 页 |
| A4 | 成本累积 | ✅ | API/订阅/累计成本分区显示 |
| A5 | 环境检测 | ✅ | 5 检测按钮 + 75/0 单元测试 |
| A6 | 浏览器质量 | ✅ | 0 pageerror，无横向溢出 |
| A7 | 完整测试 | ✅ | 后端 1164/0/8skip，前端 545/0/0 |

---

## 三、修复步骤（执行 agent 照做）

### Step 1：暂存 A8 修复（entitlements 路径）

```bash
# 确认工作区的 A8 修复已就绪
git diff .github/workflows/release-dmg.yml

# 暂存 A8 修复
git add .github/workflows/release-dmg.yml
```

### Step 2：暂存全部 126 个未暂存的已修改发布关键文件

```bash
# 方式 A：暂存全部已修改文件（推荐，因为 126 个文件都是 v2.0 修复）
git add -u

# 方式 B：如需排除某些无关文件，逐个添加发布关键文件
# git add src/lib/local-api.js src/lib/rollout.js src/lib/pricing/index.js
# git add src/commands/serve.js src/commands/sync.js
# git add dashboard/src/App.jsx dashboard/src/pages/SpendPage.jsx
# git add dashboard/src/ui/dashboard/components/DataDetails.jsx
# git add dashboard/src/ui/dashboard/components/ProjectUsagePanel.jsx
# git add dashboard/src/ui/dashboard/views/DashboardView.jsx
# git add dashboard/src/content/copy.csv
# git add src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/src/lib.rs src-tauri/src/commands.rs
# git add test/pricing.test.js test/release-dmg-workflow.test.js test/release-windows-workflow.test.js
# ...（其余见 git diff --name-only 输出）
```

**⚠️ 注意**：`git add -u` 会暂存所有已跟踪文件的修改（126 个），但不会暂存未跟踪的新文件。68 个 staged 新文件已经 `git add` 过了，无需重复。执行前用 `git status` 确认。

### Step 3：确认暂存区完整

```bash
# 确认暂存区包含 68 新增 + 126 修改 + A8 修复
git diff --cached --name-only | wc -l   # 应输出约 194+

# 确认关键文件都在暂存区
git diff --cached --name-only | grep -E "release-dmg|project-path|local-api|DataDetails|App.jsx"
# 应输出：
# .github/workflows/release-dmg.yml
# dashboard/src/App.jsx
# dashboard/src/ui/dashboard/components/DataDetails.jsx
# src/lib/local-api.js
# src/lib/project-path.js
```

### Step 4：提交

```bash
# 提交全部暂存文件
git commit -m "fix(v2.0): final release — project path, cost accumulation, release workflows, dashboard fixes

- A1-A6: project path display, cost accumulation, request log pagination
- A7: full test suite (backend 1164 pass, frontend 545 pass)
- A8: fix entitlements path in release-dmg.yml (TokenTrackerBar/TokenTrackerBar/TokenTrackerBar.entitlements)
- A9: commit all 194 publish-critical files for clean checkout reproducibility
- 68 new files + 126 modified files + A8 entitlements path fix"
```

### Step 5：干净检出重验（A9 核心验证）

```bash
# 在临时目录干净检出
cd /tmp   # 或其他临时目录
git clone <repo-url> token-eye-verify
cd token-eye-verify
git checkout <commit-sha>   # 使用 Step 4 生成的 commit SHA

# 安装依赖
npm ci
npm ci --prefix dashboard

# 运行完整门禁
npm run ci:local                    # 包含 npm test + validate + dashboard build
npm --prefix dashboard run test     # 前端完整测试
cargo check --manifest-path src-tauri/Cargo.toml

# 确认退出码全部为 0
echo "EXIT: $?"
```

### Step 6：重跑两套完整测试 + 真实 API + 浏览器 E2E

```bash
# 后端完整测试
npm test
# 预期：tests 1172, pass 1164, fail 0, skipped 8

# 前端完整测试
npm --prefix dashboard run test
# 预期：72 files, 545 tests, 545 pass, 0 fail

# 启动服务
node bin/tracker.js serve --port 17680 --no-open --no-sync &

# API 验收
curl -s http://127.0.0.1:17680/functions/tokentracker-project-usage-summary | python -m json.tool
# 预期：5 entries，path_status + path_kind 枚举一致

# 浏览器 E2E（使用 _acceptance_e2e_r4.cjs 或等效脚本）
node _acceptance_e2e_r4.cjs
# 预期：3 project-path + 3 project-remote + 0 pageerror + 无横向溢出
```

### Step 7：飞书状态更新（仅全部通过后）

```bash
# 仅在 Step 5-6 全部通过后执行
# 将 2.0-03 飞书状态从"进行中/独立验收中"更新为"通过/已验收"
node _feishu_upsert_v2.cjs   # 或等效脚本，更新 2.0-03 状态
```

### Step 8：回写审查记录

在 `review-records.md` 的 03 段追加"执行 agent 修复后重验记录"，包含：
- commit SHA
- 干净检出路径和结果
- 两套完整测试结果
- API/E2E 结果
- 飞书读回

---

## 四、验收标准（执行 agent 自查清单）

执行 agent 完成修复后，需逐项确认：

- [ ] A8：`release-dmg.yml` codesign entitlements 路径为 `TokenTrackerBar/TokenTrackerBar/TokenTrackerBar.entitlements`
- [ ] A8：workflow 测试 58/0 通过
- [ ] A9：`git cat-file -e HEAD:.github/workflows/release-dmg.yml` 成功（文件在 HEAD 中）
- [ ] A9：`git cat-file -e HEAD:src/lib/project-path.js` 成功
- [ ] A9：`git diff --name-only` 输出为空（无未暂存修改）
- [ ] A9：干净检出后 `npm ci` + `npm ci --prefix dashboard` 成功
- [ ] A9：干净检出后 `npm test` 退出码 0（1164+ pass / 0 fail）
- [ ] A9：干净检出后 `npm --prefix dashboard run test` 退出码 0（545 pass / 0 fail）
- [ ] A9：干净检出后 `cargo check` 退出码 0
- [ ] A9：干净检出后 API 返回 5 entries + path_status 枚举一致
- [ ] A9：干净检出后 E2E 0 pageerror + 无横向溢出
- [ ] A10：飞书 2.0-03 状态更新为"通过/已验收"（仅全部通过后）
- [ ] A11：审查记录已回写

**全部勾选后，将本报告和 review-records.md 交回独立验收 subagent 进行最终复验。**

---

## 五、剩余风险（非阻断，但建议关注）

| 风险 | 说明 | 建议 |
|---|---|---|
| A8 CI 实际执行未验证 | workflow YAML 通过文本测试但未在 GitHub Actions 中真实执行 | 建议在 GitHub 上触发一次 dry-run workflow_dispatch 验证 |
| A5 环境检测未实际点击 | E2E 验证了按钮存在 + 单元测试验证路径判断，但未实际点击按钮验证检测状态 | 建议补充 Playwright 点击检测按钮的 E2E |
| A8 测试盲点 | `release-dmg-workflow.test.js` 未验证 entitlements 文件存在性 | 建议增加 `fs.existsSync` 断言 |
| 贝叶斯后验 85.7% | 低于 95% 上线门槛，主要受 A9 拖累 | A9 修复后需重新计算，预计可达 95%+ |

---

## 六、贝叶斯复算（当前状态）

- 假设 H：当前产品可以正式上线
- 先验赔率 O(H) = 1
- 证据似然比：A1-A6 ×5, A7 ×8, A8 ×2, A9 ×0.05, A10 ×1.5
- 后验赔率 = 1 × 5 × 8 × 2 × 0.05 × 1.5 = 6
- 后验概率 = 85.7%
- **硬门禁优先**：A9 失败，贝叶斯不覆盖。A9 修复后需重算

---

**审查人**：独立最终验收 subagent
**报告接收人**：执行 agent（主线修复 subagent）
**期望动作**：按 Step 1-8 修复后，交回独立验收 subagent 复验
