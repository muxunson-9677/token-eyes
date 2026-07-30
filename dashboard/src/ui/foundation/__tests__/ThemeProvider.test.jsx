import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useTheme } from "../../../hooks/useTheme.js";
import { ThemeProvider } from "../ThemeProvider.jsx";

const THEME_STORAGE_KEY = "tokentracker-theme";

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

it("uses native system appearance pushes and synchronizes native chrome", async () => {
  localStorage.setItem(THEME_STORAGE_KEY, "system");
  const postMessage = vi.fn();
  window.webkit = {
    messageHandlers: {
      nativeBridge: { postMessage },
    },
  };

  render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );

  expect(postMessage).toHaveBeenCalledWith({ type: "getSystemAppearance" });

  act(() => {
    window.dispatchEvent(
      new CustomEvent("native:systemAppearanceChanged", {
        detail: { isDark: true },
      }),
    );
  });

  expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
  expect(document.documentElement).toHaveClass("dark");
  await waitFor(() => {
    expect(postMessage).toHaveBeenCalledWith({
      type: "setChromeAppearance",
      isDark: true,
      theme: "system",
    });
  });
});

it("loads the Apple glass foundations after the legacy styles", () => {
  const stylesheetPath = resolve("src/ui/foundation/apple-glass.css");
  const mainSource = readFileSync(resolve("src/main.jsx"), "utf8");

  expect(existsSync(stylesheetPath)).toBe(true);
  expect(mainSource.indexOf('import "./styles.css";')).toBeGreaterThanOrEqual(0);
  expect(mainSource.indexOf('import "./ui/foundation/apple-glass.css";')).toBeGreaterThan(
    mainSource.indexOf('import "./styles.css";'),
  );
});
