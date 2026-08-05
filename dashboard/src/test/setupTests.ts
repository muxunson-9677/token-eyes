import "@testing-library/jest-dom/vitest";
import { setCopyLocale } from "../lib/copy";

// Keep component tests isolated from the module-level copy locale. Tests that
// exercise English opt in explicitly; the long-standing product test baseline
// remains Simplified Chinese.
beforeEach(() => {
  setCopyLocale("zh-CN");
});

// Node 26 exposes an experimental global `localStorage` accessor that returns
// undefined unless the process receives --localstorage-file. In Vitest's
// jsdom environment that accessor can mask jsdom's Storage implementation, so
// install a deterministic browser-compatible store for component tests.
if (!window.localStorage) {
  class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length() {
      return this.values.size;
    }

    clear() {
      this.values.clear();
    }

    getItem(key: string) {
      return this.values.has(String(key))
        ? this.values.get(String(key)) ?? null
        : null;
    }

    key(index: number) {
      return Array.from(this.values.keys())[index] ?? null;
    }

    removeItem(key: string) {
      this.values.delete(String(key));
    }

    setItem(key: string, value: string) {
      this.values.set(String(key), String(value));
    }
  }

  Object.defineProperty(window, "Storage", {
    configurable: true,
    value: MemoryStorage,
  });
  Object.defineProperty(globalThis, "Storage", {
    configurable: true,
    value: MemoryStorage,
  });

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
}

global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// jsdom does not implement Element.prototype.scrollIntoView. Components that
// keep the active row in view (e.g. CommandPalette) call it inside an effect;
// without this polyfill those renders throw in tests.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

// jsdom lacks window.matchMedia, which motion/react's useReducedMotion and
// other components read at render time.
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
