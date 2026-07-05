# GLM Token Plan Live Detection Design

Date: 2026-07-03

## Product Principle

Token Eyes must report the provider's real account state: current plan usage, remaining quota, reset time, and account balance. Authentication is an implementation detail. The product must never call a model merely to infer quota, must never fabricate successful synchronization, and must preserve the last successful snapshot when a provider request fails.

## Scope

This change is limited to the Token Plan feature and its native credential/login bridge. It adds GLM live detection without changing request parsing, spend calculation, pricing, unrelated settings, or other providers.

The GLM catalog remains `provider_id: "glm"` with Lite, Pro, and Max. Live provider data overrides catalog estimates.

## Evidence

- The official `zai-org/zai-coding-plugins` usage plugin sends `ANTHROPIC_AUTH_TOKEN` to `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`. It does not call a model.
- The GLM console's vendor-owned frontend reads 5-hour and weekly token windows from the same quota endpoint. The response contains `limits[]` entries identified by `type: "TOKENS_LIMIT"` and window units `3` and `6`.
- The vendor-owned finance frontend reads account data from `GET /api/biz/account/query-customer-account-report` using the logged-in platform authorization token.
- Public API documentation does not expose an account-balance API authenticated only by a Coding Plan API Key. Balance therefore requires an official-console login unless a runtime API-key probe succeeds.

## Considered Approaches

### API Key only

Use the Coding Plan API Key for every query. This is preferred for usage, but account-balance authorization is not documented or verified. Shipping it as the only path would violate the accuracy requirement.

### Console session only

Use one logged-in WebView for both usage and balance. This minimizes setup, but session expiry and private console contracts make usage monitoring less durable than the official API-key flow.

### Hybrid provider-native detection

Use the Coding Plan API Key for quota usage and an official-console login for account balance. This is the selected approach because each datum comes from the strongest available source. The user approved the two-step setup.

## Architecture

### GLM usage adapter

Add a Token Plan provider adapter keyed by `provider_id`, not Agent `source`.

The adapter:

1. Resolves the GLM API Key from secure local storage.
2. Calls `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` with the provider-required Authorization header.
3. Strictly parses the 5-hour token window, weekly token window, percentage, and reset timestamps.
4. Returns a sanitized quota snapshot. Raw responses and credentials never enter logs or Token Plan records.

The adapter may probe the account-report endpoint with the same API Key. It accepts balance only when the response passes the strict balance schema. Authorization rejection is not treated as a usage failure; it activates the console-login requirement.

### GLM account binding

Extend the existing Token Plan console-session pattern with a GLM provider implementation.

1. Open `https://www.bigmodel.cn/coding-plan/personal/usage` in a provider-restricted WebView.
2. The user completes login on the official site. Token Eyes never receives the password, SMS code, or QR content.
3. Inside the WebView, call the official account-report endpoint using the page's existing authorization context.
4. Return only sanitized balance fields to Token Eyes: balance, available balance, credit balance, currency, and provider timestamp.
5. Keep the session in the native WebView for refresh. Do not persist raw cookies or platform authorization tokens in ordinary configuration.

Allowed navigation is restricted to exact GLM/BigModel authentication and console domains. Any unexpected domain fails closed.

### Unified Token Plan snapshot

The plan record gains a provider-reported `quota_windows` array while retaining existing flat fields for backward compatibility:

```json
{
  "quota_windows": [
    {
      "kind": "rolling_5_hour",
      "unit": "tokens",
      "total": 0,
      "used": 0,
      "remaining": 0,
      "percentage": 0,
      "resets_at": ""
    },
    {
      "kind": "rolling_weekly",
      "unit": "tokens",
      "total": 0,
      "used": 0,
      "remaining": 0,
      "percentage": 0,
      "resets_at": ""
    }
  ]
}
```

For compatibility, `total_quota`, `used_quota`, and `remaining_quota` mirror the weekly window. The account binding owns balance fields because balance is account-wide rather than plan-specific. A plan references it through `detection_config.official_account.account_binding_id`.

## Refresh Behavior

- Refresh immediately after saving credentials, completing login, opening the Token Plan page, or pressing Refresh.
- While the Token Plan page is visible, poll usage at most once per 60 seconds.
- Background refresh runs every 5 minutes.
- Deduplicate concurrent requests per plan.
- On 401/403 or provider auth error, set `reauth_required` without clearing the last snapshot.
- On 429 or transient network/server failure, retain data and back off to 2, 5, then 15 minutes.
- On response-structure drift, set `unsupported`, retain data, and show a provider-contract error.
- Display snapshot age so stale data cannot look live.

## Security

- GLM API Keys use the existing OS-backed provider credential vault, not the current process-memory-only Token Plan secret map.
- Persist only credential references in Token Plan records.
- No secret may appear in config files, API responses, logs, errors, subprocess arguments, test snapshots, or frontend state after submission.
- Provider requests are HTTPS GET requests to an explicit host/path allowlist with redirects disabled, a short timeout, and bounded response size.
- Console credentials remain inside the restricted native WebView. Only sanitized financial DTOs cross the native boundary.
- If secure storage or the native login bridge is unavailable, configuration fails visibly rather than falling back to plaintext.

## UI

For GLM, the existing Token Plan form shows one provider-native setup with two required states:

1. `GLM API Key`: saves the key securely and verifies quota access without a model call.
2. `GLM account`: opens the official login window and verifies account balance.

The record displays separate 5-hour and weekly quota windows, their reset times, account balance, last successful refresh, stale status, and a precise error for whichever source failed. Usage may remain healthy when balance requires reauthorization, and vice versa.

## Testing And Acceptance

Automated tests cover:

- Strict parsing of 5-hour and weekly GLM quota fixtures.
- Balance parsing and rejection of incomplete or malformed provider responses.
- API-key reference persistence with no plaintext leakage.
- Provider lookup by `provider_id` with legacy `source` fallback.
- Independent usage and balance failure states.
- 401/403, 429, timeout, response-size, redirect, and structure-drift behavior.
- Last-successful-snapshot preservation.
- Console domain allowlisting and sanitized native DTOs.
- Token Plan form setup, status, and refresh behavior.

Release acceptance requires one manual desktop validation with a real GLM account:

1. Save a Coding Plan API Key and verify both provider windows without a model invocation.
2. Complete official-console login and verify the displayed account balance against the GLM console.
3. Close and reopen Token Eyes, then verify secure credential persistence and refresh.
4. Revoke or invalidate each credential and verify `reauth_required` without data loss.

The feature is not declared production-ready until this real-account validation passes.
