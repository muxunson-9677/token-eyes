# Provider Account Balances Implementation Plan

> **For agentic workers:** Execute task-by-task with test-driven development. Keep every secret in the existing secure credential store and never persist raw credentials in `config.json`.

**Goal:** Make Token Eyes reliably query the remaining balance for Kimi, Alibaba Cloud (including Qwen/Model Studio usage), and Volcengine (including Doubao/Ark usage), while showing MiniMax as truthfully unsupported when no public balance API exists.

**Official capability findings (verified 2026-07-13):**

- Kimi exposes `GET https://api.moonshot.cn/v1/users/me/balance` with a Bearer API key and returns `data.available_balance` in CNY.
- Alibaba Cloud exposes `QueryAccountBalance` through BSS OpenAPI at `business.aliyuncs.com`; it requires a RAM AccessKey ID/Secret pair and RPC HMAC-SHA1 signing. A DashScope model API key is not the documented credential for this financial API.
- Volcengine exposes `QueryBalanceAcct` at `open.volcengineapi.com`; it requires an AccessKey ID/Secret pair and HMAC-SHA256 request signing. An Ark model API key is not the documented credential for this financial API.
- MiniMax documents balance only in its authenticated Billing/Balance console. Its complete public API index contains no balance endpoint, so Token Eyes must not invent one or call a model as a proxy test.

**Architecture:** Preserve the existing provider-config, secure-secret, executor, and balance DTO pipeline. Add two deterministic signing helpers for Alibaba Cloud and Volcengine, store paired credentials as one versioned JSON envelope inside the existing OS credential store, and add provider-specific presets/parsers. The UI keeps a short provider selector and renders only the credentials required by the selected provider; custom URL/path fields stay under Advanced.

---

### Task 1: Replace speculative presets with verified capability contracts

**Files:**
- Modify: `src/lib/provider-api-configs.js`
- Modify: `dashboard/src/lib/provider-api-presets.js`
- Modify: `test/provider-api-configs-api.test.js`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.test.jsx`

- [x] Write failing server/UI parity tests for Kimi, Alibaba Cloud BSS, Volcengine Billing, and MiniMax unsupported.
- [x] Replace the undocumented DashScope balance preset with an Alibaba Cloud BSS signed preset.
- [x] Add the Volcengine Billing signed preset and exact financial result paths.
- [x] Add MiniMax as a known unsupported balance provider so it cannot fall through to a fake custom adapter.
- [x] Keep Kimi on its official balance endpoint and attach the documented CNY currency.
- [x] Run the focused preset tests and commit.

### Task 2: Add secure deterministic financial request signing

**Files:**
- Create: `src/lib/provider-api-signing.js`
- Create: `test/provider-api-signing.test.js`
- Modify: `src/lib/provider-api-executor.js`
- Modify: `src/lib/provider-api-configs.js`
- Modify: `src/lib/provider-api-balance.js`
- Modify: `test/provider-api-security.test.js`
- Modify: `test/provider-api-balance.test.js`

- [x] Write RED tests using the Alibaba Cloud published HMAC-SHA1 vector and deterministic Volcengine HMAC-SHA256 request values.
- [x] Implement strict credential-envelope parsing and both signing algorithms using only Node `crypto`.
- [x] Allow only the exact official financial RPC actions on the two root-path endpoints; keep all other root/query endpoints denied.
- [x] Ensure signed requests cannot redirect credentials/signatures to another origin and redact both credential components from all errors.
- [x] Parse `Data.AvailableAmount`/`Data.Currency`, `Result.AvailableBalance`, and Kimi CNY without mixing provider balances with local estimates.
- [x] Run signing/security/balance tests and commit.

### Task 3: Render only the required credential fields

**Files:**
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.jsx`
- Modify: `dashboard/src/components/settings/ProviderApiConfigSection.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [x] Write RED component tests proving Kimi asks for one API key, Alibaba Cloud and Volcengine ask for AccessKey ID + Secret, and MiniMax shows an unsupported notice with no save path.
- [x] Hide preset URLs and response paths from the basic form; retain them under Advanced for custom configurations only.
- [x] Save paired credentials as a versioned secure envelope, clear both one-time input states immediately, and never include them in config payloads or DOM attributes.
- [x] Explain that Alibaba/Volcengine balances are cloud-account balances that include, but are not limited to, Qwen/Doubao spend.
- [x] Run component, copy, and production-build verification and commit.

### Task 4: Record evidence and remaining real-account checks

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-token-eyes-fixes-1-6-design.md`
- Modify: this plan

- [x] Run focused Node/Vitest tests, Dashboard production build, copy validation, and `git diff --check`.
- [x] Record Kimi as implemented, Alibaba Cloud/Volcengine as implemented with signed AK/SK adapters, and MiniMax as explicitly unsupported by current public APIs.
- [x] Keep real-account comparison pending until the user provides credentials through the app; never place credentials in tests or shell history.
- [x] Commit verification documentation.
