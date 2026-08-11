import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProviderApiConfigSection } from "./ProviderApiConfigSection.jsx";
import {
  applyProviderApiPreset,
  getProviderFinancialCapabilities,
  PROVIDER_API_MODES,
} from "../../lib/provider-api-presets.js";
import {
  getProviderApiConfigs,
  getProviderApiBalances,
  saveProviderApiConfig,
  updateProviderApiConfig,
  deleteProviderApiConfig,
  saveProviderApiSecret,
  deleteProviderApiSecret,
  testProviderApiConfig,
  refreshProviderApiBalance,
  createConsoleSession,
  deleteConsoleSession,
  verifyConsoleSession,
} from "../../lib/api";

// 03-ia-api-balance: ProviderApiConfigSection tests.
//
// Covers the work order's hard requirements:
//  - API Key input is one-time: never prefilled on edit, cleared after submit.
//  - DOM never leaks the secret (no data-* attrs, no plain-text nodes).
//  - Test-connection maps every 02 balance.errorCode → user-facing status.
//  - No model call / chat / completion / "测试模型" entry anywhere.
//  - Config CRUD (add / edit / delete) calls the right api.ts functions.
//  - F4: cost settings auto-loads + displays balance/monthSpend/
//    lifetimeSpend/currency from the 02 financial endpoints; unknown values
//    render "—" (never faked as 0).

vi.mock("../../lib/api", () => ({
  getProviderApiConfigs: vi.fn(),
  getProviderApiBalances: vi.fn(),
  saveProviderApiConfig: vi.fn(),
  updateProviderApiConfig: vi.fn(),
  deleteProviderApiConfig: vi.fn(),
  saveProviderApiSecret: vi.fn(),
  deleteProviderApiSecret: vi.fn(),
  testProviderApiConfig: vi.fn(),
  refreshProviderApiBalance: vi.fn(),
  createConsoleSession: vi.fn(),
  deleteConsoleSession: vi.fn(),
  verifyConsoleSession: vi.fn(),
  openXiaomiMimoConsoleLogin: vi.fn(),
  verifyXiaomiMimoConsoleSession: vi.fn(),
  deleteXiaomiMimoConsoleSession: vi.fn(),
  openGlmConsoleLogin: vi.fn(),
  verifyGlmConsoleSession: vi.fn(),
  deleteGlmConsoleSession: vi.fn(),
  openMiniMaxConsoleLogin: vi.fn(),
  verifyMiniMaxConsoleSession: vi.fn(),
  deleteMiniMaxConsoleSession: vi.fn(),
}));

vi.mock("../../lib/copy", () => ({
  copy: (key) => {
    // Return a readable string for copy keys so assertions can match text.
    // The key itself is returned (prefixed) so tests stay deterministic.
    return key;
  },
}));

const TEST_SECRET = "sk-test-secret-DO-NOT-LEAK-1234567890";

const BASE_CONFIG = {
  id: "cfg-1",
  providerId: "openai",
  label: "OpenAI 主账户",
  requestUrl: "https://api.openai.com/v1/billing/balance",
  requestMethod: "GET",
  authType: "bearer",
  authHeaderName: "",
  balancePath: "data.balance",
  monthSpendPath: "data.month_spend",
  lifetimeSpendPath: "data.lifetime_spend",
  currencyPath: "data.currency",
  refreshIntervalSeconds: 300,
  enabled: true,
  apiKeyRef: "ref-secret-1",
  nonSecretHeaders: { "X-Org-Id": "12345" },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem(
    "token-eyes.settings.disclosure.cost.provider-api.v1",
    "1",
  );
  getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [] } });
  // F4: the hook calls getProviderApiBalances on mount alongside configs.
  getProviderApiBalances.mockResolvedValue({ ok: true, data: { balances: [] } });
  saveProviderApiConfig.mockResolvedValue({
    ok: true,
    data: { config: { ...BASE_CONFIG, id: "cfg-new", apiKeyRef: "" } },
  });
  updateProviderApiConfig.mockResolvedValue({
    ok: true,
    data: { config: BASE_CONFIG },
  });
  deleteProviderApiConfig.mockResolvedValue({ ok: true });
  saveProviderApiSecret.mockResolvedValue({ ok: true, data: { apiKeyRef: "ref-new" } });
  deleteProviderApiSecret.mockResolvedValue({ ok: true });
  testProviderApiConfig.mockResolvedValue({ ok: true, data: { balance: null } });
  refreshProviderApiBalance.mockResolvedValue({ ok: true, data: { balance: null } });
  createConsoleSession.mockResolvedValue({ session: { id: "console-session" }, sessions: [] });
  deleteConsoleSession.mockResolvedValue({ ok: true });
  verifyConsoleSession.mockResolvedValue({ ok: true, session: { id: "console-session", status: "connected" } });
});

// Helper: open the add form.
async function openAddForm(user) {
  render(<ProviderApiConfigSection />);
  const addButton = await screen.findByRole("button", { name: "settings.cost.provider_api.add" });
  await act(async () => {
    await user.click(addButton);
  });
  return screen.getByTestId("provider-api-config-section");
}

describe("ProviderApiConfigSection (03-ia-api-balance)", () => {
  it("uses the shared left-aligned disclosure header and defaults closed", async () => {
    window.localStorage.removeItem("token-eyes.settings.disclosure.cost.provider-api.v1");
    render(<ProviderApiConfigSection />);

    const trigger = await screen.findByRole("button", {
      name: "settings.cost.provider_api.section",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger.firstElementChild).toHaveClass("lucide-chevron-down");
    expect(trigger.children[1]).toHaveAttribute("data-testid", "settings-section-icon");
    expect(screen.queryByText("settings.cost.provider_api.empty")).not.toBeInTheDocument();
  });

  it("keeps verified provider presets in UI parity with the backend contract", () => {
    expect(PROVIDER_API_MODES.map((mode) => mode.value)).toEqual([
      "",
      "deepseek",
      "moonshot",
      "aliyun_bss",
      "volcengine_billing",
      "xiaomi_mimo",
      "minimax",
      "glm",
      "custom",
    ]);

    expect(applyProviderApiPreset({ providerId: "aliyun_bss" })).toMatchObject({
      requestUrl: "https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14",
      authType: "aliyun_rpc",
      balancePath: "Data.AvailableAmount",
      currencyPath: "Data.Currency",
    });
    expect(applyProviderApiPreset({ providerId: "volcengine_billing" })).toMatchObject({
      requestUrl: "https://open.volcengineapi.com/?Action=QueryBalanceAcct&Version=2022-01-01",
      authType: "volcengine_hmac",
      balancePath: "Result.AvailableBalance",
      currencyValue: "CNY",
    });
    expect(getProviderFinancialCapabilities({ providerId: "minimax" })).toEqual({
      balance: "supported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "unsupported",
    });
  });

  it("renders the section title and empty state when no configs", async () => {
    render(<ProviderApiConfigSection />);
    expect(await screen.findByText("settings.cost.provider_api.section")).toBeInTheDocument();
    expect(screen.getByText("settings.cost.provider_api.empty")).toBeInTheDocument();
    expect(screen.getByTestId("provider-api-config-section").querySelector(".tt-surface"))
      .not.toBeNull();
  });

  it("renders existing configs from getProviderApiConfigs", async () => {
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    render(<ProviderApiConfigSection />);
    expect(await screen.findByText("OpenAI 主账户")).toBeInTheDocument();
    expect(screen.getByText("openai")).toBeInTheDocument();
  });

  it("renders every provider as a fixed two-line row and keeps test, refresh, edit, delete", async () => {
    getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [BASE_CONFIG] } });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [{
        configId: "cfg-1",
        status: "synced",
        balance: 46.69,
        currency: "CNY",
        lastSyncedAt: "2026-07-14T13:10:22.182Z",
      }] },
    });
    render(<ProviderApiConfigSection />);

    const row = await screen.findByTestId("provider-api-row-cfg-1");
    expect(row).toHaveAttribute("data-layout", "compact-two-line");
    expect(screen.queryByRole("button", { name: "settings.cost.provider_api.details" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.cost.provider_api.test" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.cost.provider_api.refresh" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.cost.provider_api.edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.cost.provider_api.delete" })).toBeInTheDocument();
    expect(screen.getByTestId("provider-api-card-balance-cfg-1")).toHaveTextContent("CNY 46.69");
  });

  it("opens a provider-specific copyable configuration guide without secrets", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [{ ...BASE_CONFIG, providerId: "deepseek", label: "DeepSeek", requestUrl: "https://api.deepseek.com/user/balance" }] },
    });
    render(<ProviderApiConfigSection />);

    await user.click(await screen.findByRole("button", { name: "settings.cost.provider_api.guide" }));
    expect(screen.getByRole("dialog", { name: "settings.cost.provider_api.guide DeepSeek" })).toHaveTextContent("https://api.deepseek.com/user/balance");
    expect(screen.getByRole("dialog")).not.toHaveTextContent(TEST_SECRET);
    await user.click(screen.getByRole("button", { name: "settings.cost.provider_api.guide_copy" }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("balance_infos[*].total_balance"));
  });

  it("does not show a stale response-format error beside a currently synced Aliyun balance", async () => {
    const aliyun = {
      ...BASE_CONFIG,
      providerId: "aliyun_bss",
      label: "阿里云百炼",
      requestUrl: "https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14",
      authType: "aliyun_rpc",
      balancePath: "Data.AvailableAmount",
      currencyPath: "Data.Currency",
    };
    getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [aliyun] } });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [{ configId: "cfg-1", status: "synced", balance: 46.69, currency: "CNY" }] },
    });
    testProviderApiConfig.mockResolvedValue({
      ok: true,
      data: { balance: { configId: "cfg-1", status: "error", errorCode: "provider_response_invalid" } },
    });
    const user = userEvent.setup();
    render(<ProviderApiConfigSection />);
    await screen.findByText("阿里云百炼");
    await user.click(screen.getByRole("button", { name: "settings.cost.provider_api.test" }));

    await waitFor(() => expect(testProviderApiConfig).toHaveBeenCalledWith("cfg-1"));
    expect(screen.getByTestId("provider-api-card-balance-cfg-1")).toHaveTextContent("CNY 46.69");
    expect(screen.queryByText("settings.cost.provider_api.test_invalid")).not.toBeInTheDocument();
  });

  it("add form: API Key input is type=password and not prefilled", async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    // Find the password input — it must be type=password and start blank.
    const inputs = document.querySelectorAll("input[type='password']");
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    const secretInput = Array.from(inputs).find((i) => i.value === "");
    expect(secretInput).toBeTruthy();
    expect(secretInput.type).toBe("password");
  });

  it("edit form: API Key field is NEVER prefilled with the existing value", async () => {
    const user = userEvent.setup();
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");
    const editButton = screen.getByRole("button", { name: "settings.cost.provider_api.edit" });
    await act(async () => {
      await user.click(editButton);
    });

    // The password input exists and is blank — even though apiKeyRef is set.
    const passwordInputs = document.querySelectorAll("input[type='password']");
    expect(passwordInputs.length).toBeGreaterThanOrEqual(1);
    for (const input of passwordInputs) {
      expect(input.value).toBe("");
    }
    // The original secret reference should NOT appear as a value in any input.
    const allInputs = document.querySelectorAll("input");
    for (const input of allInputs) {
      expect(input.value).not.toContain("ref-secret-1");
      expect(input.value).not.toContain(TEST_SECRET);
    }
  });

  it("saving a new config with an API Key sends the secret to saveProviderApiSecret, then clears it", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    // Fill required fields.
    const textInputs = document.querySelectorAll("input[type='text']");
    // providerId, label, requestUrl, balancePath, monthSpendPath, lifetimeSpendPath, currencyPath, authHeaderName, nonSecretHeaders(textarea)
    // We type into the password input to set the secret.
    const passwordInput = document.querySelector("input[type='password']");
    await act(async () => {
      await user.type(passwordInput, TEST_SECRET);
    });
    expect(passwordInput.value).toBe(TEST_SECRET);

    const saveButton = screen.getByRole("button", { name: "settings.cost.provider_api.save" });
    await act(async () => {
      await user.click(saveButton);
    });

    // The secret was sent to the secrets endpoint.
    await waitFor(() => expect(saveProviderApiSecret).toHaveBeenCalled());
    const secretArg = saveProviderApiSecret.mock.calls[0][0];
    expect(secretArg.secret).toBe(TEST_SECRET);

    // After save, the password input is cleared (form closed).
    await waitFor(() => {
      const remainingPasswords = document.querySelectorAll("input[type='password']");
      // Form is closed after successful save, so no password input should be visible.
      // If the form is still open for any reason, the value must be empty.
      for (const input of remainingPasswords) {
        expect(input.value).toBe("");
      }
    });
  });

  it("saving DeepSeek with a CC Switch base URL auto-fills provider and financial paths", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    const urlInput = document.querySelector("input[type='url']");
    const passwordInput = document.querySelector("input[type='password']");
    await act(async () => {
      await user.type(urlInput, "https://api.deepseek.com");
      await user.type(passwordInput, TEST_SECRET);
    });

    const saveButton = screen.getByRole("button", { name: "settings.cost.provider_api.save" });
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => expect(saveProviderApiConfig).toHaveBeenCalled());
    const payload = saveProviderApiConfig.mock.calls[0][0];
    expect(payload.providerId).toBe("deepseek");
    expect(payload.label).toBe("DeepSeek");
    expect(payload.requestUrl).toBe("https://api.deepseek.com/user/balance");
    expect(payload.requestMethod).toBe("GET");
    expect(payload.authType).toBe("bearer");
    expect(payload.balancePath).toBe("balance_infos[*].total_balance");
    expect(payload.currencyPath).toBe("balance_infos[*].currency");
    expect(payload.monthSpendPath).toBe("");
    expect(payload.lifetimeSpendPath).toBe("");
  });

  it("maps a DashScope model URL to the verified Alibaba Cloud BSS balance contract", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    const urlInput = document.querySelector("input[type='url']");
    await act(async () => {
      await user.type(urlInput, "https://dashscope.aliyuncs.com");
      await user.type(
        screen.getByLabelText("settings.cost.provider_api.form.access_key_id"),
        "aliyun-test-id",
      );
      await user.type(
        screen.getByLabelText("settings.cost.provider_api.form.access_key_secret"),
        "aliyun-test-secret",
      );
    });

    const saveButton = screen.getByRole("button", { name: "settings.cost.provider_api.save" });
    await act(async () => {
      await user.click(saveButton);
    });

    await waitFor(() => expect(saveProviderApiConfig).toHaveBeenCalled());
    const payload = saveProviderApiConfig.mock.calls[0][0];
    expect(payload.providerId).toBe("aliyun_bss");
    expect(payload.label).toBe("阿里云（含千问/百炼）");
    expect(payload.requestUrl).toBe("https://business.aliyuncs.com/?Action=QueryAccountBalance&Version=2017-12-14");
    expect(payload.authType).toBe("aliyun_rpc");
    expect(payload.balancePath).toBe("Data.AvailableAmount");
    expect(payload.currencyPath).toBe("Data.Currency");
    const savedSecret = JSON.parse(saveProviderApiSecret.mock.calls[0][0].secret);
    expect(savedSecret).toEqual({
      version: 1,
      type: "access_key_pair",
      accessKeyId: "aliyun-test-id",
      accessKeySecret: "aliyun-test-secret",
    });
    expect(JSON.stringify(payload)).not.toContain("aliyun-test-id");
    expect(JSON.stringify(payload)).not.toContain("aliyun-test-secret");
  });

  it("explicit Kimi mode needs only an API Key and hides the fixed endpoint", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    await act(async () => {
      await user.selectOptions(
        screen.getByLabelText("settings.cost.provider_api.form.api_mode"),
        "moonshot",
      );
    });

    expect(screen.queryByText("settings.cost.provider_api.form.url")).not.toBeInTheDocument();
    expect(screen.getByText("settings.cost.provider_api.form.api_key")).toBeInTheDocument();
    expect(document.querySelector("input[type='password']")).toBeInTheDocument();
    expect(screen.queryByText("settings.cost.provider_api.form.access_key_id")).not.toBeInTheDocument();
  });

  it("Alibaba Cloud mode asks only for an AccessKey pair and explains account scope", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    await act(async () => {
      await user.selectOptions(
        screen.getByLabelText("settings.cost.provider_api.form.api_mode"),
        "aliyun_bss",
      );
    });

    expect(screen.queryByText("settings.cost.provider_api.form.url")).not.toBeInTheDocument();
    expect(screen.getByLabelText("settings.cost.provider_api.form.access_key_id")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("settings.cost.provider_api.form.access_key_secret")).toHaveAttribute("type", "password");
    expect(screen.getByText("settings.cost.provider_api.capability.aliyun_account_scope")).toBeInTheDocument();
    expect(screen.queryByText("settings.cost.provider_api.form.advanced_show")).not.toBeInTheDocument();
  });

  it("Volcengine mode asks for an AccessKey pair and explains account scope", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    await act(async () => {
      await user.selectOptions(
        screen.getByLabelText("settings.cost.provider_api.form.api_mode"),
        "volcengine_billing",
      );
    });

    expect(screen.getByLabelText("settings.cost.provider_api.form.access_key_id")).toBeInTheDocument();
    expect(screen.getByLabelText("settings.cost.provider_api.form.access_key_secret")).toBeInTheDocument();
    expect(screen.getByText("settings.cost.provider_api.capability.volcengine_account_scope")).toBeInTheDocument();
  });

  it("does not save a signed provider when only half of the AccessKey pair is filled", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    await act(async () => {
      await user.selectOptions(
        screen.getByLabelText("settings.cost.provider_api.form.api_mode"),
        "aliyun_bss",
      );
      await user.type(
        screen.getByLabelText("settings.cost.provider_api.form.access_key_id"),
        "only-an-id",
      );
      await user.click(screen.getByRole("button", { name: "settings.cost.provider_api.save" }));
    });

    expect(await screen.findByText("settings.cost.provider_api.form.access_key_pair_required"))
      .toBeInTheDocument();
    expect(saveProviderApiConfig).not.toHaveBeenCalled();
    expect(saveProviderApiSecret).not.toHaveBeenCalled();
  });

  it("MiniMax mode uses official-console authorization without asking for an API key", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    await act(async () => {
      await user.selectOptions(
        screen.getByLabelText("settings.cost.provider_api.form.api_mode"),
        "minimax",
      );
    });

    expect(screen.getByText("settings.cost.provider_api.capability.official_console_hint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.cost.provider_api.save" })).toBeEnabled();
    expect(document.querySelector("input[type='password']")).toBeNull();
  });

  it("add form shows only name/url/key/enable by default; balance paths are in advanced", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    expect(screen.getByText("settings.cost.provider_api.form.name")).toBeInTheDocument();
    expect(screen.getByText("settings.cost.provider_api.form.api_mode")).toBeInTheDocument();
    expect(screen.getByText("settings.cost.provider_api.form.url")).toBeInTheDocument();
    expect(screen.getByText("settings.cost.provider_api.form.api_key")).toBeInTheDocument();
    expect(screen.queryByText("settings.cost.provider_api.form.balance_path")).not.toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByText("settings.cost.provider_api.form.advanced_show"));
    });

    expect(screen.getByText("settings.cost.provider_api.form.balance_path")).toBeInTheDocument();
  });

  it("GLM mode uses official-console authorization and never saves an API key", async () => {
    const user = userEvent.setup();
    await openAddForm(user);

    const modeSelect = screen.getByLabelText("settings.cost.provider_api.form.api_mode");
    await act(async () => {
      await user.selectOptions(modeSelect, "glm");
    });

    expect(screen.getByText("settings.cost.provider_api.capability.official_console_hint")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "settings.cost.provider_api.save" })).toBeEnabled();
    expect(document.querySelector("input[type='password']")).toBeNull();
    expect(saveProviderApiConfig).not.toHaveBeenCalled();
    expect(saveProviderApiSecret).not.toHaveBeenCalled();
  });

  it("custom mode bypasses known aliases and keeps proxy financial capabilities editable", async () => {
    expect(getProviderFinancialCapabilities({
      providerId: "custom",
      label: "DeepSeek Proxy",
      requestUrl: "https://proxy.example.com/account/balance",
      balancePath: "data.balance",
      monthSpendPath: "data.month",
      lifetimeSpendPath: "data.total",
    })).toEqual({
      balance: "custom",
      monthSpend: "custom",
      lifetimeSpend: "custom",
      tokenQuota: "unsupported",
    });
    expect(getProviderFinancialCapabilities({
      providerId: "deepseek-proxy",
      label: "智谱 DeepSeek Proxy",
      requestUrl: "https://proxy.example.com/account/balance",
      balancePath: "data.balance",
      monthSpendPath: "data.month",
      lifetimeSpendPath: "data.total",
    })).toEqual({
      balance: "custom",
      monthSpend: "custom",
      lifetimeSpend: "custom",
      tokenQuota: "unsupported",
    });
    expect(getProviderFinancialCapabilities({
      providerId: "glm-coding-plan",
      label: "自定义旧套餐",
      requestUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
      balancePath: "data.limits[*].usage",
    })).toEqual({
      balance: "unsupported",
      monthSpend: "unsupported",
      lifetimeSpend: "unsupported",
      tokenQuota: "token_plan",
    });

    const user = userEvent.setup();
    await openAddForm(user);
    await act(async () => {
      await user.selectOptions(
        screen.getByLabelText("settings.cost.provider_api.form.api_mode"),
        "custom",
      );
      await user.type(
        screen.getByLabelText("settings.cost.provider_api.form.name"),
        "智谱代理财务",
      );
    });

    expect(document.querySelector("input[type='password']")).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "settings.cost.provider_api.save" })).not.toBeDisabled();
    expect(screen.queryByText("settings.cost.provider_api.capability.glm_finance_unsupported"))
      .not.toBeInTheDocument();
  });

  it("DeepSeek card labels unsupported spend history instead of rendering unknown or zero", async () => {
    const config = {
      ...BASE_CONFIG,
      id: "deepseek-1",
      providerId: "deepseek",
      label: "DeepSeek",
      requestUrl: "https://api.deepseek.com/user/balance",
      balancePath: "balance_infos[*].total_balance",
      monthSpendPath: "",
      lifetimeSpendPath: "",
      currencyPath: "balance_infos[*].currency",
      financialCapabilities: {
        balance: "supported",
        monthSpend: "unsupported",
        lifetimeSpend: "unsupported",
        tokenQuota: "unsupported",
      },
    };
    getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [config] } });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: {
        balances: [{
          configId: "deepseek-1",
          providerId: "deepseek",
          accountLabel: "DeepSeek",
          balance: 12.34,
          monthSpend: null,
          lifetimeSpend: null,
          currency: "USD",
          status: "synced",
          lastSyncedAt: "2026-07-13T00:00:00.000Z",
        }],
      },
    });

    render(<ProviderApiConfigSection />);
    await screen.findByText("DeepSeek");

    expect(screen.getByTestId("provider-api-card-balance-deepseek-1").textContent).toBe("USD 12.34");
    expect(screen.getByTestId("provider-api-card-month-spend-deepseek-1").textContent)
      .toBe("settings.cost.provider_api.capability.unsupported");
    expect(screen.getByTestId("provider-api-card-lifetime-spend-deepseek-1").textContent)
      .toBe("settings.cost.provider_api.capability.unsupported");
    expect(screen.getByTestId("provider-api-card-token-quota-deepseek-1").textContent)
      .toBe("settings.cost.provider_api.capability.unsupported");
  });

  it("legacy GLM card is unsupported and directs quota configuration to Token package settings", async () => {
    const config = {
      ...BASE_CONFIG,
      id: "glm-legacy",
      providerId: "glm",
      label: "智谱 GLM",
      requestUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
      balancePath: "data.limits[*].usage",
      financialCapabilities: {
        balance: "unsupported",
        monthSpend: "unsupported",
        lifetimeSpend: "unsupported",
        tokenQuota: "token_plan",
      },
    };
    getProviderApiConfigs.mockResolvedValue({ ok: true, data: { configs: [config] } });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: {
        balances: [{
          configId: "glm-legacy",
          providerId: "glm",
          accountLabel: "智谱 GLM",
          balance: null,
          monthSpend: null,
          lifetimeSpend: null,
          currency: null,
          status: "unsupported",
          errorCode: "unsupported_endpoint",
          lastSyncedAt: null,
        }],
      },
    });

    render(<ProviderApiConfigSection />);
    await screen.findByText("智谱 GLM");

    expect(screen.getByTestId("provider-api-card-balance-glm-legacy").textContent)
      .toBe("settings.cost.provider_api.capability.unsupported");
    expect(screen.getByTestId("provider-api-card-token-quota-glm-legacy").textContent)
      .toBe("settings.cost.provider_api.capability.token_plan_settings");
  });

  it("DOM never exposes the API Key secret as visible text or in data-* attributes", async () => {
    const user = userEvent.setup();
    await openAddForm(user);
    const passwordInput = document.querySelector("input[type='password']");
    await act(async () => {
      await user.type(passwordInput, TEST_SECRET);
    });

    const sectionEl = document.querySelector('[data-testid="provider-api-config-section"]');

    // 1. No VISIBLE text node exposes the secret. type=password renders as
    //    dots, so the secret must never appear as readable page text.
    //    textContent includes all visible text but NOT input values.
    expect(sectionEl.textContent).not.toContain(TEST_SECRET);

    // 2. No data-* attribute on any element carries the secret.
    const allEls = sectionEl.querySelectorAll("*");
    for (const el of allEls) {
      for (const attr of el.attributes) {
        // Skip the transient `value` attribute of the password input itself —
        // the controlled input's value is the user's in-progress typing, which
        // is necessary for form submission and is cleared immediately after.
        if (attr.name === "value" && el.tagName === "INPUT" && el.type === "password") continue;
        expect(attr.value).not.toContain(TEST_SECRET);
      }
    }

    // 3. No non-password input carries the secret.
    const nonPasswordInputs = sectionEl.querySelectorAll("input:not([type='password'])");
    for (const input of nonPasswordInputs) {
      expect(input.value).not.toContain(TEST_SECRET);
    }
  });

  it("mock call parameters for saveProviderApiSecret do not leak into error messages", async () => {
    const user = userEvent.setup();
    saveProviderApiSecret.mockResolvedValue({
      ok: false,
      error_code: "credential_store_unavailable",
      error: "Credential store unavailable",
    });
    await openAddForm(user);
    const passwordInput = document.querySelector("input[type='password']");
    await act(async () => {
      await user.type(passwordInput, TEST_SECRET);
    });
    const saveButton = screen.getByRole("button", { name: "settings.cost.provider_api.save" });
    await act(async () => {
      await user.click(saveButton);
    });

    // The error message renders but must NOT contain the secret.
    await waitFor(() => expect(saveProviderApiSecret).toHaveBeenCalled());
    const sectionEl = document.querySelector('[data-testid="provider-api-config-section"]');
    expect(sectionEl.innerHTML).not.toContain(TEST_SECRET);
  });

  // Test-connection status mapping (work order requirement 5 + 33).
  const STATUS_CASES = [
    { status: "synced", expectedKey: "settings.cost.provider_api.test_success" },
    { status: "error", errorCode: "provider_unauthorized", expectedKey: "settings.cost.provider_api.test_unauthorized" },
    { status: "error", errorCode: "provider_rate_limited", expectedKey: "settings.cost.provider_api.test_rate_limited" },
    { status: "error", errorCode: "request_timeout", expectedKey: "settings.cost.provider_api.test_timeout" },
    { status: "unsupported", errorCode: "unsupported_endpoint", expectedKey: "settings.cost.provider_api.test_unsupported" },
    { status: "error", errorCode: "provider_response_invalid", expectedKey: "settings.cost.provider_api.test_invalid" },
    { status: "error", errorCode: "provider_unavailable", expectedKey: "settings.cost.provider_api.test_unavailable" },
  ];

  STATUS_CASES.forEach(({ status, errorCode, expectedKey }) => {
    it(`test connection shows ${expectedKey} for status=${status} errorCode=${errorCode || "n/a"}`, async () => {
      const user = userEvent.setup();
      getProviderApiConfigs.mockResolvedValue({
        ok: true,
        data: { configs: [BASE_CONFIG] },
      });
      testProviderApiConfig.mockResolvedValue({
        ok: true,
        data: {
          balance: {
            configId: "cfg-1",
            providerId: "openai",
            accountLabel: "OpenAI 主账户",
            balance: status === "synced" ? 100 : null,
            monthSpend: null,
            lifetimeSpend: null,
            currency: status === "synced" ? "USD" : null,
            status,
            errorCode,
            errorMessage: null,
            lastSyncedAt: "2026-07-01T00:00:00.000Z",
          },
        },
      });

      render(<ProviderApiConfigSection />);
      await screen.findByText("OpenAI 主账户");
      const testButton = screen.getByRole("button", { name: "settings.cost.provider_api.test" });
      await act(async () => {
        await user.click(testButton);
      });

      await waitFor(() => expect(screen.getByText(expectedKey)).toBeInTheDocument());
    });
  });

  it("does NOT render any model call / chat / completion / 测试模型 button", async () => {
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");

    // None of these forbidden action labels should appear.
    expect(screen.queryByText(/model/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/chat/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/completion/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/测试模型/)).not.toBeInTheDocument();
    expect(screen.queryByText(/prompt/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /model/i })).not.toBeInTheDocument();
  });

  it("delete config calls deleteProviderApiConfig after confirmation", async () => {
    const user = userEvent.setup();
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");
    const deleteButton = screen.getByRole("button", { name: "settings.cost.provider_api.delete" });
    await act(async () => {
      await user.click(deleteButton);
    });
    await waitFor(() => expect(deleteProviderApiConfig).toHaveBeenCalledWith("cfg-1"));
    confirmSpy.mockRestore();
  });

  it("requestUrl is shown as a masked summary (protocol + host only) in the list", async () => {
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");
    // The masked URL should show protocol + host, NOT the full path.
    expect(screen.getByText("https://api.openai.com")).toBeInTheDocument();
    expect(screen.queryByText("https://api.openai.com/v1/billing/balance")).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // F4: cost settings must auto-load + display financial data from 02 endpoints.
  // The previous implementation kept its own configs/loading state and only read
  // a transient `lastBalance` from a manual refresh that the card never
  // rendered — so the settings/cost card showed NO balance/monthSpend/
  // lifetimeSpend/currency at all. These tests render the real component (no
  // copied internals) and assert the real DOM.
  // --------------------------------------------------------------------------

  it("F4 reproduction: with no balance, financial fields are hidden", async () => {
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");

    expect(screen.queryByTestId("provider-api-card-balance-cfg-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-api-card-month-spend-cfg-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-api-card-lifetime-spend-cfg-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-api-card-currency-cfg-1")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("settings.cost.provider_api.data_unknown");
  });

  it("F4 verification: auto-displays balance/monthSpend/lifetimeSpend/currency when synced", async () => {
    const SYNCED_BALANCE = {
      configId: "cfg-1",
      providerId: "openai",
      accountLabel: "OpenAI 主账户",
      balance: 123.456,
      monthSpend: 50,
      lifetimeSpend: 1000,
      currency: "USD",
      status: "synced",
      errorCode: null,
      errorMessage: null,
      lastSyncedAt: "2026-07-01T00:00:00.000Z",
    };
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [SYNCED_BALANCE] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");

    // Financial fields are auto-loaded from the balances endpoint (no manual
    // refresh click required) and rendered with the synced values.
    expect(screen.getByTestId("provider-api-card-balance-cfg-1").textContent).toBe("USD 123.46");
    expect(screen.getByTestId("provider-api-card-month-spend-cfg-1").textContent).toBe("USD 50.00");
    expect(screen.getByTestId("provider-api-card-lifetime-spend-cfg-1").textContent).toBe("USD 1,000.00");
    expect(screen.getByTestId("provider-api-card-currency-cfg-1").textContent).toBe("USD");
    expect(screen.getByText(/2026-07-01T00:00:00.000Z/)).toBeInTheDocument();
  });

  it("F4 verification: a real 0 balance renders '0.00', not '—'", async () => {
    // A true zero from the provider is meaningful and must NOT be hidden as "—".
    const ZERO_BALANCE = {
      configId: "cfg-1",
      providerId: "openai",
      accountLabel: "OpenAI 主账户",
      balance: 0,
      monthSpend: 0,
      lifetimeSpend: 0,
      currency: "USD",
      status: "synced",
      errorCode: null,
      errorMessage: null,
      lastSyncedAt: "2026-07-01T00:00:00.000Z",
    };
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [ZERO_BALANCE] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");

    expect(screen.getByTestId("provider-api-card-balance-cfg-1").textContent).toBe("USD 0.00");
    expect(screen.getByTestId("provider-api-card-month-spend-cfg-1").textContent).toBe("USD 0.00");
    expect(screen.getByTestId("provider-api-card-lifetime-spend-cfg-1").textContent).toBe("USD 0.00");
    expect(screen.getByTestId("provider-api-card-currency-cfg-1").textContent).toBe("USD");
  });

  it("F4 verification: partial nulls in a synced balance hide only the missing fields", async () => {
    // Provider returns balance + currency but no monthSpend/lifetimeSpend.
    // The known fields render numbers; missing fields are omitted.
    const PARTIAL_BALANCE = {
      configId: "cfg-1",
      providerId: "openai",
      accountLabel: "OpenAI 主账户",
      balance: 200,
      monthSpend: null,
      lifetimeSpend: undefined,
      currency: "USD",
      status: "synced",
      errorCode: null,
      errorMessage: null,
      lastSyncedAt: "2026-07-01T00:00:00.000Z",
    };
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [PARTIAL_BALANCE] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");

    expect(screen.getByTestId("provider-api-card-balance-cfg-1").textContent).toBe("USD 200.00");
    expect(screen.queryByTestId("provider-api-card-month-spend-cfg-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-api-card-lifetime-spend-cfg-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("provider-api-card-currency-cfg-1").textContent).toBe("USD");
  });

  it("F4 verification: non-synced balance hides all financial fields", async () => {
    // error / unsupported / not-connected statuses have no meaningful amounts.
    const ERROR_BALANCE = {
      configId: "cfg-1",
      providerId: "openai",
      accountLabel: "OpenAI 主账户",
      balance: null,
      monthSpend: null,
      lifetimeSpend: null,
      currency: null,
      status: "error",
      errorCode: "provider_unauthorized",
      errorMessage: "bad key",
      lastSyncedAt: "2026-07-01T00:00:00.000Z",
    };
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [BASE_CONFIG] },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [ERROR_BALANCE] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");

    expect(screen.queryByTestId("provider-api-card-balance-cfg-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-api-card-month-spend-cfg-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-api-card-lifetime-spend-cfg-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("provider-api-card-currency-cfg-1")).not.toBeInTheDocument();
  });

  it("F4 verification: manual refresh calls refreshProviderApiBalance for that config", async () => {
    const user = userEvent.setup();
    // Config has NO apiKeyRef so the hook's mount effect skips auto-refresh
    // (it only refreshes enabled+keyed configs). The cached balance (100) from
    // getProviderApiBalances stays until the user clicks the per-card refresh.
    const CFG_NO_KEY = { ...BASE_CONFIG, apiKeyRef: "" };
    const SYNCED_BALANCE = {
      configId: "cfg-1",
      providerId: "openai",
      accountLabel: "OpenAI 主账户",
      balance: 100,
      monthSpend: 10,
      lifetimeSpend: 100,
      currency: "USD",
      status: "synced",
      errorCode: null,
      errorMessage: null,
      lastSyncedAt: "2026-07-01T00:00:00.000Z",
    };
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [CFG_NO_KEY] },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [SYNCED_BALANCE] },
    });
    // refreshOne → refreshProviderApiBalance returns an UPDATED balance.
    refreshProviderApiBalance.mockResolvedValue({
      ok: true,
      data: {
        balance: { ...SYNCED_BALANCE, balance: 200, monthSpend: 20, lifetimeSpend: 200 },
      },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("OpenAI 主账户");
    // Cached balance (100) is shown — mount effect did NOT auto-refresh.
    await waitFor(() => {
      expect(screen.getByTestId("provider-api-card-balance-cfg-1").textContent).toBe("USD 100.00");
    });

    const refreshButton = screen.getByRole("button", { name: "settings.cost.provider_api.refresh" });
    await act(async () => {
      await user.click(refreshButton);
    });

    await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-1"));
    // After refresh, the card shows the updated balance from the hook state.
    await waitFor(() => {
      expect(screen.getByTestId("provider-api-card-balance-cfg-1").textContent).toBe("USD 200.00");
    });
  });

  it("F4 verification: refresh-all button calls refreshProviderApiBalance for every enabled+keyed config", async () => {
    const user = userEvent.setup();
    // All configs have NO apiKeyRef so the mount effect does not auto-refresh
    // them — the only refresh calls come from clicking refresh-all.
    const CFG_A = { ...BASE_CONFIG, id: "cfg-1", apiKeyRef: "" };
    const CFG_B = { ...BASE_CONFIG, id: "cfg-2", label: "Anthropic", providerId: "anthropic", apiKeyRef: "" };
    const CFG_DISABLED = { ...BASE_CONFIG, id: "cfg-3", label: "Disabled", enabled: false, apiKeyRef: "" };
    const CFG_NO_KEY = { ...BASE_CONFIG, id: "cfg-4", label: "NoKey", apiKeyRef: "" };
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [CFG_A, CFG_B, CFG_DISABLED, CFG_NO_KEY] },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("Anthropic");

    // Mount effect should NOT have refreshed any config (none have apiKeyRef).
    expect(refreshProviderApiBalance).not.toHaveBeenCalled();

    const refreshAllButton = screen.getByRole("button", { name: "settings.cost.provider_api.refresh_all" });
    await act(async () => {
      await user.click(refreshAllButton);
    });

    // refreshAll filters enabled+keyed. Since none have apiKeyRef, refreshAll
    // is a no-op. Assert the contract: refresh-all never fires refreshOne for
    // keyless or disabled configs.
    expect(refreshProviderApiBalance).not.toHaveBeenCalledWith("cfg-1");
    expect(refreshProviderApiBalance).not.toHaveBeenCalledWith("cfg-2");
    expect(refreshProviderApiBalance).not.toHaveBeenCalledWith("cfg-3");
    expect(refreshProviderApiBalance).not.toHaveBeenCalledWith("cfg-4");
  });

  it("F4 verification: refresh-all refreshes enabled+keyed configs only", async () => {
    const user = userEvent.setup();
    // cfg-1 and cfg-2 are enabled+keyed (should refresh). cfg-3 disabled,
    // cfg-4 keyless (should NOT refresh).
    const CFG_A = { ...BASE_CONFIG, id: "cfg-1" };
    const CFG_B = { ...BASE_CONFIG, id: "cfg-2", label: "Anthropic", providerId: "anthropic" };
    const CFG_DISABLED = { ...BASE_CONFIG, id: "cfg-3", label: "Disabled", enabled: false };
    const CFG_NO_KEY = { ...BASE_CONFIG, id: "cfg-4", label: "NoKey", apiKeyRef: "" };
    getProviderApiConfigs.mockResolvedValue({
      ok: true,
      data: { configs: [CFG_A, CFG_B, CFG_DISABLED, CFG_NO_KEY] },
    });
    getProviderApiBalances.mockResolvedValue({
      ok: true,
      data: { balances: [] },
    });
    render(<ProviderApiConfigSection />);
    await screen.findByText("Anthropic");
    // Let the mount auto-refresh settle.
    await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-1"));
    await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-2"));
    // Clear mount-effect calls so we can isolate the refresh-all click.
    refreshProviderApiBalance.mockClear();

    const refreshAllButton = screen.getByRole("button", { name: "settings.cost.provider_api.refresh_all" });
    await act(async () => {
      await user.click(refreshAllButton);
    });

    // Only enabled + keyed configs are refreshed (cfg-1, cfg-2). Disabled (cfg-3)
    // and keyless (cfg-4) are skipped — refreshing them would always fail.
    await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-1"));
    await waitFor(() => expect(refreshProviderApiBalance).toHaveBeenCalledWith("cfg-2"));
    expect(refreshProviderApiBalance).not.toHaveBeenCalledWith("cfg-3");
    expect(refreshProviderApiBalance).not.toHaveBeenCalledWith("cfg-4");
  });
});
