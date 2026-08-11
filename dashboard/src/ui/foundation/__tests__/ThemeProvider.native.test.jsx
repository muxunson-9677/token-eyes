import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useTheme } from "../../../hooks/useTheme.js";
import { getCachedNativeSystemDark } from "../../../lib/native-bridge.js";
import { ThemeProvider } from "../ThemeProvider.jsx";

const THEME_STORAGE_KEY = "tokentracker-theme";
const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalWebkitDescriptor = Object.getOwnPropertyDescriptor(window, "webkit");

function NativeThemeProbe() {
  const { resolvedTheme } = useTheme();
  return <span data-testid="resolved-theme">{resolvedTheme}</span>;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
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

it("uses native system appearance pushes and synchronizes native chrome", async () => {
  expect(getCachedNativeSystemDark()).toBeNull();
  localStorage.setItem(THEME_STORAGE_KEY, "system");
  window.matchMedia = vi.fn(() => ({
    matches: false,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const postMessage = vi.fn();
  window.webkit = {
    messageHandlers: {
      nativeBridge: { postMessage },
    },
  };

  render(
    <ThemeProvider>
      <NativeThemeProbe />
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
  expect(getCachedNativeSystemDark()).toBe(true);
  await waitFor(() => {
    expect(postMessage).toHaveBeenCalledWith({
      type: "setChromeAppearance",
      isDark: true,
      theme: "system",
    });
  });
});
