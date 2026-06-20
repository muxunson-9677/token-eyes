import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocale } from "../../../hooks/useLocale.js";
import { setCopyLocale, copy } from "../../../lib/copy";
import { EN_LOCALE, LOCALE_STORAGE_KEY, SYSTEM_LOCALE, ZH_CN_LOCALE } from "../../../lib/locale";
import { LocaleProvider } from "../LocaleProvider.jsx";

function createStorage(seed = {}) {
  const store = { ...seed };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((key) => delete store[key]);
    },
  };
}

function LocaleProbe() {
  const { locale, setLocale } = useLocale();

  return (
    <>
      <span data-testid="active-locale">{locale}</span>
      <span data-testid="language-label">{copy("settings.appearance.language.label")}</span>
      <button type="button" onClick={() => setLocale(SYSTEM_LOCALE)}>
        system
      </button>
      <button type="button" onClick={() => setLocale(ZH_CN_LOCALE)}>
        zh
      </button>
      <button type="button" onClick={() => setLocale("en")}>
        en
      </button>
    </>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorage({ [LOCALE_STORAGE_KEY]: "en" }),
  });
  document.documentElement.lang = "";
  setCopyLocale(EN_LOCALE);
});

it("keeps localized copy in Simplified Chinese for legacy language choices", async () => {
  const user = userEvent.setup();

  render(
    <LocaleProvider>
      <LocaleProbe />
    </LocaleProvider>,
  );

  expect(screen.getByTestId("active-locale")).toHaveTextContent(ZH_CN_LOCALE);
  expect(screen.getByTestId("language-label")).toHaveTextContent("语言");
  expect(document.documentElement.lang).toBe(ZH_CN_LOCALE);

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "system" }));
  });

  expect(screen.getByTestId("language-label")).toHaveTextContent("语言");
  expect(document.documentElement.lang).toBe(ZH_CN_LOCALE);

  await act(async () => {
    await user.click(screen.getByRole("button", { name: "en" }));
  });

  expect(screen.getByTestId("active-locale")).toHaveTextContent(ZH_CN_LOCALE);
  expect(screen.getByTestId("language-label")).toHaveTextContent("语言");
  expect(document.documentElement.lang).toBe(ZH_CN_LOCALE);
});
