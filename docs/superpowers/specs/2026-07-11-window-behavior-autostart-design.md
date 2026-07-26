# Token Eyes 基础设置：窗口行为与开机自启

日期：2026-07-11  
状态：待用户确认后进入实现计划  
范围约束：**所有代码与文件增删改查仅限本仓库** `d:\04-AI-Project\010-Token eye`（及其子路径），不在仓库外创建或修改文件。

## 背景

参考 TokenStep 设置页中的「窗口行为」与「开机自启」。Token Eyes 桌面端（Tauri + `dashboard/`）当前基础设置（`/settings/basic`）尚无这两项；活动中的 `src-tauri` 壳也尚未接入系统托盘与开机自启。仓库内虽有未编入 Token Eyes 入口的旧托盘/自启相关文件，本设计明确不硬接那套依赖过重的模块。

## 目标（端到端）

1. 在「基础设置」中提供与参考产品一致的双卡片 UI。
2. 关闭按钮可配置：最小化到托盘，或直接退出。
3. 开机自启可开关；开启后可再配置「静默启动」（只驻托盘、不弹主窗口）。
4. 系统托盘最小可用：打开主窗口 / 退出；左键单击托盘图标打开主窗口。

## 非目标（本版不做）

- 不接入仓库内未使用的 CC Switch 巨型 `tray` / 代理状态托盘菜单。
- 不做 macOS / Linux 托盘与自启交付（当前以 Windows Token Eyes 为主）。
- 托盘菜单不加：立即同步、打开设置、托盘内勾选自启。
- 不把偏好存进安装目录；不把设置同步到云端。

## 产品决策（已确认）

| 项 | 决策 |
|---|---|
| 交付程度 | 端到端（UI + 原生行为） |
| UI 结构 | 两个独立卡片；关闭用下拉；自启用开关 |
| 静默启动 | 自启开启后显示子开关（方案 C） |
| 托盘菜单 | 打开主窗口 / 退出（最小） |
| 技术方案 | Token Eyes 轻量原生层（方案 1） |
| 默认值 | `minimizeToTrayOnClose=true`，`launchOnStartup=false`，`silentStartup=false` |
| UI 可见性 | 仅 `isTauriApp()` 为真时渲染 |
| 插入位置 | `/settings/basic`，「外观」之后 |

## UI 设计

### 窗口行为卡片

- 标题：窗口行为
- 行：关闭按钮行为
- 说明：点击窗口右上角 × 时：最小化到托盘保持后台运行，或直接退出程序
- 控件：下拉 — `最小化到托盘` | `直接退出`

### 开机自启卡片

- 标题：开机自启
- 行 1：开机时自动启动 — 登录 Windows 时自动启动 Token Eyes — 开关
- 行 2（仅自启开启时显示）：静默启动 — 开机自启时不弹出主窗口，只驻留托盘 — 开关

### 文案与组件

- 文案全部进入 `dashboard/src/content/copy.csv`（及既有 i18n 同步流程），禁止硬编码用户可见字符串。
- 复用现有 `SectionCard` / `SettingsRow` / `ToggleSwitch`；下拉使用与 Dashboard 一致的现有 Select 或原生 select 风格（实现时对齐 `Controls.jsx` 与周边设置页）。
- 新建组件建议：`dashboard/src/components/settings/WindowBehaviorSection.jsx`（可在同一文件内渲染两张卡片，或拆成两个导出组件），由 `SettingsBasicPage` 在 `<AppearanceSection />` 之后引入。

## 原生行为

### 关闭按钮

- `minimizeToTrayOnClose=true`：拦截关闭，隐藏主窗口，保留进程与托盘。
- `=false`：允许关闭并退出应用（移除托盘，停止本地 API 进程随主进程退出的既有行为保持一致）。

### 托盘

- 创建系统托盘图标（使用现有 Token Eyes 图标资源，路径在本仓库 `src-tauri/icons/`）。
- 菜单：打开主窗口；退出。
- 左键单击：显示并聚焦主窗口。

### 开机自启与静默启动

- Windows：为当前用户注册/取消开机启动项，指向 Token Eyes 可执行文件。
- `silentStartup=true` 且由开机启动项拉起时：启动项命令行携带 `--silent-start`；启动后主窗口保持隐藏，仅显示托盘。
- 手动启动（无静默参数）：始终显示主窗口，不受 `silentStartup` 影响。
- 关闭自启时：移除启动项；静默开关 UI 折叠；偏好中的 `silentStartup` **保留上次值**，便于再次打开自启时恢复。

## 数据与 API

### 持久化

路径：Tauri 应用数据目录下的 `window-prefs.json`（例如 `%APPDATA%/com.tokeneyes.desktop/window-prefs.json`，以 Tauri `app_data_dir` 为准）。

```json
{
  "minimizeToTrayOnClose": true,
  "launchOnStartup": false,
  "silentStartup": false
}
```

读写失败时回退默认值，不阻断应用启动。

### Invoke 命令

| 命令 | 作用 |
|---|---|
| `get_window_prefs` | 返回三字段；`launchOnStartup` 以系统实际注册状态为准校正并回写偏好（若可安全校正） |
| `set_minimize_to_tray_on_close` | 更新偏好；立即影响后续关闭行为 |
| `set_launch_on_startup` | 更新偏好 + 启用/禁用系统自启；失败则回滚 UI 并返回错误 |
| `set_silent_startup` | 仅更新偏好（下次自启生效） |

### 前端数据流

1. 挂载时若 `isTauriApp()`：`invoke('get_window_prefs')` 填充控件。
2. 用户变更：立即 `invoke` 对应 set；成功更新本地 state，失败 toast + 回滚控件。
3. 非 Tauri：不渲染组件，不发请求。

## 仓库内落点（仅本仓库）

| 区域 | 变更 |
|---|---|
| `dashboard/src/pages/SettingsPage.jsx` | 插入 Window 相关 section |
| `dashboard/src/components/settings/*` | 新建 UI 组件 |
| `dashboard/src/content/copy.csv` | 新增文案键 |
| `dashboard/src/lib/*` | 可选：薄封装 invoke |
| `src-tauri/src/lib.rs` | 注册命令、关闭拦截、静默启动、创建托盘 |
| `src-tauri/src/window_prefs.rs` | 新建：偏好读写 |
| `src-tauri/src/auto_launch.rs` | **替换**仓库内未编入 Token Eyes 的旧文件为精简 Windows 自启实现（见下方「旧文件处理」） |
| `src-tauri/src/tray.rs` | **替换**同上：最小托盘实现 |
| `src-tauri/Cargo.toml` / `tauri.conf.json` | 按需开启 tray 等 feature |
| 测试 | Settings 页相关单测 + copy/硬编码校验 |

**禁止：**在仓库外路径创建文件；把实现依赖复制到桌面/临时目录等外部位置作为“正式源”。

### 旧文件处理

`src-tauri/src/tray.rs`、`src-tauri/src/auto_launch.rs` 等目前存在于仓库但**未**被 Token Eyes 的 `lib.rs` 编译引用，且依赖过重。实现时：

1. 在本仓库内用 Token Eyes 精简实现**覆盖**这两个文件内容（或先删后写同名文件），不要另开仓库外副本。
2. 仅在 Token Eyes `lib.rs` 中 `mod` + 接线所需符号。
3. 不得为了“复用”而把旧代理/供应商托盘逻辑重新编进当前二进制。
4. 若覆盖后发现其它未引用文件产生干扰，只在本仓库内做最小清理（删除死引用或改名隔离），不扩大到无关重构。

静默启动参数统一为：`--silent-start`（无“同等约定”歧义）。

## 错误处理

- 自启系统 API 失败：开关回滚；toast 使用 copy 键（如 `settings.window.auto_launch_failed`）。
- 偏好文件损坏/不可写：用默认值继续；可记日志。
- 托盘创建失败：仍允许主窗口运行；关闭“最小化到托盘”时降级为直接退出（并尽量提示），避免卡死无法退出。

## 验证计划

1. 非 Tauri（浏览器 `dashboard:dev`）：基础设置不出现两块。
2. Tauri 实机：下拉切到最小化 → 点 × → 进托盘；托盘“打开主窗口”恢复；“退出”结束进程。
3. 下拉切到直接退出 → 点 × → 进程结束。
4. 开自启 → 注销/登录或模拟启动项 → 进程拉起；静默开时无主窗口、有托盘；静默关时有主窗口。
5. 关自启 → 启动项消失。
6. `npm run validate:copy` / UI 硬编码校验通过；相关前端测试通过。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| Windows 自启权限/杀软拦截 | 失败明确提示；不静默失败 |
| 关闭拦截与退出路径纠缠 | “退出”菜单与“直接退出”设置统一走真正 exit；托盘隐藏与 exit 分支清晰分离 |
| 旧未使用 Rust 文件干扰 | 新建精简模块并在 `lib.rs` 显式 `mod`；不编入旧巨型 tray |

## 实现顺序（供后续计划引用）

1. Rust：prefs + close 拦截 + 最小托盘
2. Rust：auto-launch + silent-start 参数
3. Dashboard：文案 + UI + invoke 接线
4. 测试与实机验收清单
