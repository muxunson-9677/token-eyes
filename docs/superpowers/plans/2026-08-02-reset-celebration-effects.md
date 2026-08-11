# 重置庆祝特效实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将官方额度重置提醒改为可选的流星雨/烟花透明画布特效，并提供跟随 Token Eyes 明暗主题的黑白 Apple 毛玻璃提醒卡片。

**Architecture:** 用独立偏好模块负责特效 ID 的校验、版本化本地存储和同页通知；Provider 只管理事件去重、预览与 6 秒生命周期；Overlay 只负责主题、无障碍、降级和懒加载对应 Canvas2D 渲染器。两套渲染器复用一个只管理画布生命周期、暂停/恢复和密度上限的小型运行时，但各自保留独立粒子模型。

**Tech Stack:** React 18、TypeScript/JavaScript、Canvas 2D、Vitest、Testing Library、CSS backdrop-filter、现有 copy.csv 多语言流程。

---

### Task 1：特效偏好模块

**Files:**
- Create: `dashboard/src/ui/celebration/reset-celebration-preference.js`
- Create: `dashboard/src/ui/celebration/__tests__/reset-celebration-preference.test.js`

- [ ] **Step 1：先写默认值、非法值、存储异常和同页通知测试**

```js
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_RESET_CELEBRATION_EFFECT,
  RESET_CELEBRATION_EFFECT_CHANGE_EVENT,
  readResetCelebrationEffect,
  saveResetCelebrationEffect,
} from "../reset-celebration-preference.js";

describe("reset celebration preference", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults invalid or missing values to meteors", () => {
    expect(readResetCelebrationEffect()).toBe(DEFAULT_RESET_CELEBRATION_EFFECT);
    window.localStorage.setItem("token-eyes:reset-celebration-effect:v1", "lightfall");
    expect(readResetCelebrationEffect()).toBe("meteors");
  });

  it("persists a valid value and notifies the current document", () => {
    const listener = vi.fn();
    window.addEventListener(RESET_CELEBRATION_EFFECT_CHANGE_EVENT, listener);
    expect(saveResetCelebrationEffect("fireworks")).toBe("fireworks");
    expect(readResetCelebrationEffect()).toBe("fireworks");
    expect(listener.mock.calls[0][0].detail).toEqual({ effectId: "fireworks" });
    window.removeEventListener(RESET_CELEBRATION_EFFECT_CHANGE_EVENT, listener);
  });

  it("keeps working when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => saveResetCelebrationEffect("fireworks")).not.toThrow();
  });
});
```

- [ ] **Step 2：运行测试并确认因模块不存在而失败**

Run: `npm test -- src/ui/celebration/__tests__/reset-celebration-preference.test.js`

Expected: FAIL，提示无法解析 `reset-celebration-preference.js`。

- [ ] **Step 3：实现最小偏好模块**

```js
export const RESET_CELEBRATION_EFFECT_IDS = ["meteors", "fireworks"];
export const DEFAULT_RESET_CELEBRATION_EFFECT = "meteors";
export const RESET_CELEBRATION_EFFECT_STORAGE_KEY = "token-eyes:reset-celebration-effect:v1";
export const RESET_CELEBRATION_EFFECT_CHANGE_EVENT = "token-eyes:reset-celebration-effect-change";

export function normalizeResetCelebrationEffect(value) {
  return RESET_CELEBRATION_EFFECT_IDS.includes(value)
    ? value
    : DEFAULT_RESET_CELEBRATION_EFFECT;
}

export function readResetCelebrationEffect() {
  try {
    return normalizeResetCelebrationEffect(window.localStorage.getItem(RESET_CELEBRATION_EFFECT_STORAGE_KEY));
  } catch {
    return DEFAULT_RESET_CELEBRATION_EFFECT;
  }
}

export function saveResetCelebrationEffect(value) {
  const effectId = normalizeResetCelebrationEffect(value);
  try { window.localStorage.setItem(RESET_CELEBRATION_EFFECT_STORAGE_KEY, effectId); } catch { /* 本地存储不可用时仍允许本次选择 */ }
  window.dispatchEvent(new CustomEvent(RESET_CELEBRATION_EFFECT_CHANGE_EVENT, { detail: { effectId } }));
  return effectId;
}
```

- [ ] **Step 4：运行测试确认通过**

Run: `npm test -- src/ui/celebration/__tests__/reset-celebration-preference.test.js`

Expected: PASS。

- [ ] **Step 5：提交**

```powershell
git add dashboard/src/ui/celebration/reset-celebration-preference.js dashboard/src/ui/celebration/__tests__/reset-celebration-preference.test.js
git commit -m "feat: add reset celebration preference"
```

### Task 2：重置记录页选择器与无副作用预览

**Files:**
- Modify: `dashboard/src/pages/ResetHistoryPage.tsx`
- Modify: `dashboard/src/pages/ResetHistoryPage.test.tsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `dashboard/src/locales/zh-CN.json`
- Modify: `dashboard/src/locales/zh-TW.json`

- [ ] **Step 1：把现有 lightfall 预览测试改成选择、持久化和图标按钮测试**

```tsx
it("saves the selected surprise effect and previews it without reset side effects", async () => {
  const user = userEvent.setup();
  render(<ResetHistoryPage />);
  const selector = screen.getByLabelText("copy:reset_history.effect.label");
  expect(selector).toHaveValue("meteors");
  await user.selectOptions(selector, "fireworks");
  expect(localStorage.getItem("token-eyes:reset-celebration-effect:v1")).toBe("fireworks");
  await user.click(screen.getByRole("button", { name: "copy:reset_history.preview_celebration_aria" }));
  expect(previews).toEqual([{ effectId: "fireworks" }]);
});
```

- [ ] **Step 2：运行页面测试确认旧 UI 不满足新断言**

Run: `npm test -- src/pages/ResetHistoryPage.test.tsx`

Expected: FAIL，找不到 `选择惊喜效果` 对应控件。

- [ ] **Step 3：注册四个文案键并补全简体/繁体中文**

```csv
reset_history.effect.label,ui,ResetHistoryPage,ResetHistoryPage,effect_label,"Surprise effect",,active
reset_history.effect.meteors,ui,ResetHistoryPage,ResetHistoryPage,effect_meteors,"Meteor shower (default)",,active
reset_history.effect.fireworks,ui,ResetHistoryPage,ResetHistoryPage,effect_fireworks,"Fireworks",,active
reset_history.preview_celebration_aria,ui,ResetHistoryPage,ResetHistoryPage,preview_celebration_aria,"Preview surprise effect",,active
```

简体中文值分别为 `选择惊喜效果`、`流星雨（默认）`、`烟花`、`预览惊喜效果`；繁体中文使用对应繁体表达。

- [ ] **Step 4：实现紧凑选择器与相邻图标预览按钮**

```tsx
const [effectId, setEffectId] = useState(readResetCelebrationEffect);

<label className="grid gap-1 text-xs font-medium">
  <span>{copy("reset_history.effect.label")}</span>
  <select
    value={effectId}
    onChange={(event) => setEffectId(saveResetCelebrationEffect(event.target.value))}
  >
    <option value="meteors">{copy("reset_history.effect.meteors")}</option>
    <option value="fireworks">{copy("reset_history.effect.fireworks")}</option>
  </select>
</label>
<button
  type="button"
  aria-label={copy("reset_history.preview_celebration_aria")}
  onClick={() => triggerResetCelebrationPreview(effectId)}
>
  <Sparkles aria-hidden />
</button>
```

- [ ] **Step 5：运行页面测试、copy 守卫并确认通过**

Run: `npm test -- src/pages/ResetHistoryPage.test.tsx`

Run: `npm run verify:data-display-policy`

Expected: 两条命令均 PASS。

- [ ] **Step 6：提交**

```powershell
git add dashboard/src/pages/ResetHistoryPage.tsx dashboard/src/pages/ResetHistoryPage.test.tsx dashboard/src/content/copy.csv dashboard/src/locales/zh-CN.json dashboard/src/locales/zh-TW.json
git commit -m "feat: add reset effect selector"
```

### Task 3：透明 Canvas2D 生命周期与两套渲染器

**Files:**
- Create: `dashboard/src/ui/celebration/CelebrationCanvas.jsx`
- Create: `dashboard/src/ui/celebration/MeteorCelebrationCanvas.jsx`
- Create: `dashboard/src/ui/celebration/FireworksCelebrationCanvas.jsx`
- Create: `dashboard/src/ui/celebration/__tests__/CelebrationCanvas.test.jsx`
- Delete: `dashboard/src/ui/celebration/LightfallCanvas.jsx`

- [ ] **Step 1：写画布透明、DPR 上限、隐藏暂停、卸载清理和失败回调测试**

```jsx
it("uses an alpha canvas, caps render scale and cleans animation resources", () => {
  const draw = vi.fn();
  const view = render(<CelebrationCanvas className="test-canvas" drawFrame={draw} />);
  expect(HTMLCanvasElement.prototype.getContext).toHaveBeenCalledWith("2d", { alpha: true });
  expect(view.container.querySelector("canvas")).toHaveAttribute("data-render-scale", "1.5");
  view.unmount();
  expect(cancelAnimationFrame).toHaveBeenCalled();
  expect(removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
});
```

- [ ] **Step 2：运行测试确认共享画布组件不存在**

Run: `npm test -- src/ui/celebration/__tests__/CelebrationCanvas.test.jsx`

Expected: FAIL，无法解析 `CelebrationCanvas.jsx`。

- [ ] **Step 3：实现只负责生命周期的共享画布**

```jsx
export function CelebrationCanvas({ className, createScene, onFallback }) {
  const hostRef = useRef(null);
  useEffect(() => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) { onFallback?.(); return undefined; }
    hostRef.current.appendChild(canvas);
    const scene = createScene({ canvas, context });
    let rafId = 0;
    const frame = (time) => { if (!document.hidden) scene.draw(time); rafId = requestAnimationFrame(frame); };
    const resize = () => scene.resize(Math.min(devicePixelRatio || 1, 1.5));
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", scene.resetClock);
    resize();
    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", scene.resetClock);
      scene.destroy?.();
      canvas.remove();
    };
  }, [createScene, onFallback]);
  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
```

- [ ] **Step 4：分别适配用户 HTML 中的流星和烟花粒子模型**

```jsx
export default function MeteorCelebrationCanvas(props) {
  return <CelebrationCanvas {...props} className="tt-reset-celebration__canvas" createScene={createMeteorScene} />;
}

export default function FireworksCelebrationCanvas(props) {
  return <CelebrationCanvas {...props} className="tt-reset-celebration__canvas" createScene={createFireworksScene} />;
}
```

`createMeteorScene` 只移植 `token-reset-meteor-only.html` 的流星生成、尾迹、亮核和分层速度；`createFireworksScene` 只移植 `token-reset-surprise-v7-5-celebration-rework.html` 的升空、爆炸、火花衰减和色相。二者清屏必须使用 `clearRect`/透明渐隐，不得填充黑色背景；粒子数量按画布像素和 `hardwareConcurrency` 自适应。

- [ ] **Step 5：运行渲染器测试确认通过**

Run: `npm test -- src/ui/celebration/__tests__/CelebrationCanvas.test.jsx`

Expected: PASS，且流星/烟花分别生成可识别的 `data-effect-renderer`。

- [ ] **Step 6：提交**

```powershell
git add dashboard/src/ui/celebration/CelebrationCanvas.jsx dashboard/src/ui/celebration/MeteorCelebrationCanvas.jsx dashboard/src/ui/celebration/FireworksCelebrationCanvas.jsx dashboard/src/ui/celebration/__tests__/CelebrationCanvas.test.jsx dashboard/src/ui/celebration/LightfallCanvas.jsx
git commit -m "feat: add meteor and fireworks renderers"
```

### Task 4：Provider、Overlay、主题毛玻璃卡片与 6 秒生命周期

**Files:**
- Modify: `dashboard/src/ui/celebration/ResetCelebrationProvider.jsx`
- Modify: `dashboard/src/ui/celebration/ResetCelebrationOverlay.jsx`
- Modify: `dashboard/src/ui/celebration/reset-celebration.css`
- Modify: `dashboard/src/ui/celebration/__tests__/ResetCelebrationOverlay.test.jsx`

- [ ] **Step 1：重写 Provider/Overlay 测试覆盖保存偏好、两种渲染器、主题和 6 秒清理**

```jsx
it("uses saved fireworks for a real reset and removes it after six seconds", async () => {
  saveResetCelebrationEffect("fireworks");
  renderProvider();
  dispatchCelebration();
  await flushLazyRender();
  expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute("data-effect-id", "fireworks");
  expect(document.querySelector("[data-effect-renderer='fireworks']")).not.toBeNull();
  act(() => vi.advanceTimersByTime(6_000));
  expect(document.querySelector(".tt-reset-celebration")).toBeNull();
});

it("keeps a themed static glass card for reduced motion", () => {
  renderProvider({ reducedMotion: true, theme: "dark" });
  dispatchCelebration();
  expect(screen.getByRole("status")).toBeVisible();
  expect(document.querySelector(".tt-reset-celebration")).toHaveAttribute("data-theme", "dark");
  expect(document.querySelector("canvas")).toBeNull();
});
```

- [ ] **Step 2：运行测试确认 4.2 秒/lightfall 旧实现失败**

Run: `npm test -- src/ui/celebration/__tests__/ResetCelebrationOverlay.test.jsx`

Expected: FAIL，实际时长/特效 ID/渲染器与新断言不符。

- [ ] **Step 3：Provider 改为 6 秒并让真实事件读取已保存偏好**

```jsx
export const RESET_CELEBRATION_DURATION_MS = 6_000;

setActiveEvent({
  ...detail,
  eventId,
  effectId: readResetCelebrationEffect(),
});
```

- [ ] **Step 4：Overlay 懒加载两套画布并保留静态降级**

```jsx
const LazyMeteorCanvas = lazy(() => import("./MeteorCelebrationCanvas.jsx"));
const LazyFireworksCanvas = lazy(() => import("./FireworksCelebrationCanvas.jsx"));
const Renderer = effectId === "fireworks" ? LazyFireworksCanvas : LazyMeteorCanvas;

<div className="tt-reset-celebration__veil" aria-hidden="true" />
{!reducedMotion && !rendererFailed ? (
  <RendererBoundary onFallback={handleFallback}>
    <Suspense fallback={null}><Renderer durationMs={durationMs} onFallback={handleFallback} /></Suspense>
  </RendererBoundary>
) : null}
```

- [ ] **Step 5：用 SVG 礼物图标替换圆点，并实现黑白主题毛玻璃**

```jsx
<span className="tt-reset-celebration__notice-mark" aria-hidden="true">
  <svg viewBox="0 0 64 64"><path d="M10 27h44v28H10z" /><path d="M7 19h50v12H7z" /><path d="M32 19v36" /></svg>
</span>
```

关键 CSS：

```css
.tt-reset-celebration { animation-duration: 6s; }
.tt-reset-celebration__veil { position:absolute; inset:0; background:rgba(3, 10, 24, .28); }
.tt-reset-celebration__notice {
  top: max(28px, env(safe-area-inset-top));
  width: min(480px, calc(100vw - 40px));
  min-height: 150px;
  padding: 28px 30px;
  border-radius: 32px;
  background: rgba(247, 250, 255, .68);
  backdrop-filter: blur(34px) saturate(1.65);
  box-shadow: 0 0 0 1px rgba(121, 231, 255, .95), 0 0 22px rgba(53, 180, 255, .72), 0 0 58px rgba(121, 80, 255, .32);
}
.tt-reset-celebration[data-theme="dark"] .tt-reset-celebration__notice {
  color:#f7fbff;
  background:rgba(10, 14, 23, .70);
}
.tt-reset-celebration__notice-mark { width:64px; height:64px; }
```

- [ ] **Step 6：运行 Overlay 测试确认两套效果、主题、降级、去重和清理均通过**

Run: `npm test -- src/ui/celebration/__tests__/ResetCelebrationOverlay.test.jsx`

Expected: PASS。

- [ ] **Step 7：提交**

```powershell
git add dashboard/src/ui/celebration/ResetCelebrationProvider.jsx dashboard/src/ui/celebration/ResetCelebrationOverlay.jsx dashboard/src/ui/celebration/reset-celebration.css dashboard/src/ui/celebration/__tests__/ResetCelebrationOverlay.test.jsx
git commit -m "feat: refresh reset celebration experience"
```

### Task 5：完整验证与实际视觉检查

**Files:**
- Modify: `docs/superpowers/specs/2026-08-02-reset-celebration-effects-design.md`
- Modify only if verification finds a requirement gap: files from Tasks 1–4

- [ ] **Step 1：运行庆祝功能的聚焦测试**

Run: `npm test -- src/ui/celebration src/pages/ResetHistoryPage.test.tsx`

Expected: PASS。

- [ ] **Step 2：运行前端静态检查与完整测试**

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm test`

Expected: 全部 PASS；若存在仓库原有失败，记录具体命令、失败测试和与本次改动的关系。

- [ ] **Step 3：运行生产构建**

Run: `npm run build`

Expected: Vite production build succeeds。

- [ ] **Step 4：启动本地预览并用浏览器检查四个组合**

Run: `npm run dev -- --host 127.0.0.1`

检查：亮色×流星、亮色×烟花、暗色×流星、暗色×烟花。每个组合确认应用底界面可见、卡片约 480×150、礼物图标醒目、发光双描边清晰、选择器与图标按钮紧邻、6 秒后自动消失、页面仍可点击。

- [ ] **Step 5：检查降低动态效果**

在浏览器中模拟 `prefers-reduced-motion: reduce`，确认只显示静态主题卡片和边缘高光，不创建 Canvas。

- [ ] **Step 6：将设计稿状态更新为已实现并提交最终变更**

```powershell
git add docs/superpowers/specs/2026-08-02-reset-celebration-effects-design.md dashboard/src
git commit -m "test: verify reset celebration effects"
```

