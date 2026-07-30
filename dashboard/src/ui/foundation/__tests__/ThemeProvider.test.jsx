import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { useTheme } from "../../../hooks/useTheme.js";
import { ThemeProvider } from "../ThemeProvider.jsx";

const THEME_STORAGE_KEY = "tokentracker-theme";
const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalWebkitDescriptor = Object.getOwnPropertyDescriptor(window, "webkit");

function createMatchMedia(initiallyDark = false) {
  let matches = initiallyDark;
  const listeners = new Set();
  const mediaQuery = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: (listener) => listeners.add(listener),
    removeListener: (listener) => listeners.delete(listener),
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    dispatchEvent: () => true,
  };

  return {
    matchMedia: () => mediaQuery,
    setDark(nextMatches) {
      matches = nextMatches;
      listeners.forEach((listener) => listener({ matches }));
    },
  };
}

function ThemeProbe() {
  const { theme, resolvedTheme, setTheme, toggleTheme } = useTheme();

  return (
    <>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme("light")}>light</button>
      <button type="button" onClick={() => setTheme("dark")}>dark</button>
      <button type="button" onClick={() => setTheme("system")}>system</button>
      <button type="button" onClick={toggleTheme}>toggle</button>
    </>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  delete window.webkit;
  const media = createMatchMedia();
  window.matchMedia = vi.fn(media.matchMedia);
});

afterEach(() => {
  cleanup();
  if (originalMatchMediaDescriptor) {
    Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
  } else {
    delete window.matchMedia;
  }
  if (originalWebkitDescriptor) {
    Object.defineProperty(window, "webkit", originalWebkitDescriptor);
  } else {
    delete window.webkit;
  }
});

it("restores a persisted dark theme", () => {
  localStorage.setItem("tokentracker-theme", "dark");

  render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );

  expect(document.documentElement).toHaveClass("dark");
  expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
});

it("restores a persisted light theme", () => {
  localStorage.setItem(THEME_STORAGE_KEY, "light");
  const media = createMatchMedia(true);
  window.matchMedia = vi.fn(media.matchMedia);

  render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );

  expect(document.documentElement).not.toHaveClass("dark");
  expect(screen.getByTestId("theme")).toHaveTextContent("light");
  expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
});

it("resolves and follows the browser system appearance", async () => {
  localStorage.setItem(THEME_STORAGE_KEY, "system");
  const media = createMatchMedia(false);
  window.matchMedia = vi.fn(media.matchMedia);

  render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );

  expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");

  act(() => media.setDark(true));

  expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
  expect(document.documentElement).toHaveClass("dark");
});

it("switches themes and persists with the existing storage key", async () => {
  const user = userEvent.setup();

  render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "dark" }));
  });

  expect(screen.getByTestId("theme")).toHaveTextContent("dark");
  expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
  expect(document.documentElement).toHaveClass("dark");
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "toggle" }));
  });

  expect(screen.getByTestId("resolved-theme")).toHaveTextContent("light");
  expect(document.documentElement).not.toHaveClass("dark");
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
});

it("loads the Apple glass foundations after the legacy styles", () => {
  const stylesheetPath = resolve("src/ui/foundation/apple-glass.css");
  const mainSource = readFileSync(resolve("src/main.jsx"), "utf8");

  expect(existsSync(stylesheetPath)).toBe(true);
  expect(mainSource.indexOf('import "./styles.css";')).toBeGreaterThanOrEqual(0);
  expect(mainSource.indexOf('import "./ui/foundation/apple-glass.css";')).toBeGreaterThan(
    mainSource.indexOf('import "./styles.css";'),
  );

  const stylesheet = postcss.parse(readFileSync(stylesheetPath, "utf8"));
  const customProperties = new Set();
  stylesheet.walkDecls(/^--tt-/, (declaration) => customProperties.add(declaration.prop));
  expect([...customProperties].sort()).toEqual([
    "--tt-canvas",
    "--tt-card-radius",
    "--tt-control-radius",
    "--tt-surface",
    "--tt-surface-blur",
    "--tt-surface-border",
    "--tt-surface-nested",
    "--tt-surface-outline",
    "--tt-surface-shadow",
  ]);

  const rootRule = stylesheet.nodes.find((node) => node.type === "rule" && node.selector === ":root");
  const darkRule = stylesheet.nodes.find((node) => node.type === "rule" && node.selector === ":root.dark");
  expect(rootRule.nodes.find((node) => node.prop === "--tt-canvas")?.value).toBe("#f4f5f6");
  expect(darkRule.nodes.find((node) => node.prop === "--tt-canvas")?.value).toBe("#14161a");

  for (const selector of [".tt-surface", ".tt-surface-nested", ".tt-pressable"]) {
    expect(
      stylesheet.nodes.some((node) => node.type === "rule" && node.selector === selector),
    ).toBe(true);
  }

  const reducedMotion = stylesheet.nodes.find(
    (node) =>
      node.type === "atrule" &&
      node.name === "media" &&
      node.params === "(prefers-reduced-motion: reduce)",
  );
  expect(reducedMotion).toBeDefined();

  const reducedTransition = reducedMotion.nodes.find(
    (node) => node.type === "rule" && node.selector === ".tt-pressable",
  );
  expect(reducedTransition.nodes.find((node) => node.prop === "transition")?.value).toBe("none");

  for (const state of [":hover", ":active", '[aria-pressed="true"]', '[aria-current="page"]']) {
    const stateRule = reducedMotion.nodes.find(
      (node) => node.type === "rule" && node.selector.includes(state),
    );
    expect(stateRule.nodes.find((node) => node.prop === "transform")?.value).toBe("none");
  }
});
