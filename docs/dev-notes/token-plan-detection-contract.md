# Token Plan Detection Contract (W03-R3A)

- **Task ID**: TE-NEXT-W03-R3A
- **Date**: 2026-06-25
- **Status**: Implemented

## Data Model

Each token plan record must express the following structure. Fields use snake_case.

```js
{
  id: "uuid",
  source: "hermes",
  provider_id: "xiaomi_mimo",
  plan_id: "xiaomi_mimo_standard_monthly",
  plan_label: "Standard（月付）",

  quota_kind: "credits",
  quota_unit: "credits",
  total_quota: 11000000000,
  total_quota_display: "11,000,000,000（11B）Credits",
  quota_catalog_version: "2026-06-25",
  quota_source: "catalog|provider_reported|custom_api|manual|manual_legacy",

  used_quota: 0,
  remaining_quota: 0,
  expires_at: "",

  detection_method: "official_account|custom_api|not_configured",
  detection_config: {
    official_account: {
      provider_home_url: "https://platform.xiaomimimo.com/token-plan",
      account_binding_id: "console-session-or-account-binding-id"
    },
    custom_api: {
      api_key_ref: "token-plan/xiaomi_mimo/custom-api/<uuid>",
      api_format: "json_path|openai_compatible|custom_mapping",
      request_url: "https://example.com/quota",
      official_url: "https://platform.xiaomimimo.com/token-plan",
      method: "GET|POST",
      response_mapping: {
        total_quota_path: "$.total",
        used_quota_path: "$.used",
        remaining_quota_path: "$.remaining",
        expires_at_path: "$.expires_at"
      }
    }
  },

  sync_status: "not_configured|auth_required|syncing|success|failed|reauth_required|unsupported",
  last_sync_attempt_at: "",
  last_synced_at: "",
  last_error_code: "",
  last_error_message: "",
  provider_reported_at: ""
}
```

## Old Field Compatibility

| Old Field | New Semantic |
|---|---|
| `refresh_method: "manual"` | `detection_method: "not_configured"`, `sync_status: "not_configured"` |
| `refresh_method: "official_api"` | `detection_method: "official_account"` |
| `credential_ref` | Read-only historical reference; never stored as plaintext |
| `last_refresh_status` | Mapped to `sync_status` |
| `last_refresh_at` | Mapped to `last_sync_attempt_at`; if status was "success", also `last_synced_at` |
| `last_refresh_error` | Mapped to `last_error_message` |

`refresh_*` fields are retained for backward compatibility but new code must not depend on them exclusively.

## Sensitive Field Boundaries

**Allowed** in config:
- `account_binding_id`
- `api_key_ref`
- `provider_home_url`
- `request_url`
- `official_url`
- `api_format`
- `response_mapping`
- Sync status, error codes, error messages
- Quota snapshots

**Forbidden** in config, API responses, logs, test snapshots, frontend lists:
- API Key plaintext
- Cookie plaintext
- Bearer token
- Authorization header
- Account passwords, verification codes, QR code content
- Recoverable secret fragments

Credential references must match: `token-plan/<provider_id>/<purpose>/<uuid>`

Example: `token-plan/xiaomi_mimo/custom-api/2e2c7f3d-7b9f-4c92-b2d2-c6e9f4a8c320`

## Local API Contracts

### 1. List Plan Records

```
GET /functions/tokentracker-token-plans
```

Response: `{ records: [TokenPlanRecord] }`

### 2. Create or Update Plan Record

```
POST /functions/tokentracker-token-plans
```

Request may contain `detection_method`, `detection_config`, and quota snapshot fields.

Request must NOT contain: `api_key`, `apiKey`, `cookie`, `authorization`, `authorization_header`, `bearer`, `token`, `password`

Response: `{ ok: true, record: TokenPlanRecord, records: [TokenPlanRecord] }`

### 3. Save Custom API Key

```
POST /functions/tokentracker-token-plan-secrets
```

Desktop-only (local auth required). Request:

```js
{
  provider_id: "xiaomi_mimo",
  purpose: "custom-api",
  secret: "user-input-api-key"
}
```

Response (only returns reference, never the secret):

```js
{
  ok: true,
  api_key_ref: "token-plan/xiaomi_mimo/custom-api/<uuid>"
}
```

No GET endpoint for secrets is provided.

### 4. Detect or Sync Plan Status

```
POST /functions/tokentracker-token-plans-refresh
```

Request: `{ id: "token-plan-record-id" }`

Response: `{ ok: true, plan: TokenPlanRecord, records: [TokenPlanRecord] }`

On failure, only updates:
- `sync_status`
- `last_sync_attempt_at`
- `last_error_code`
- `last_error_message`

Failure must NOT clear last successful:
- `total_quota`
- `used_quota`
- `remaining_quota`
- `expires_at`
- `provider_reported_at`

## Status Mapping

| Scenario | `sync_status` |
|---|---|
| No detection method selected | `not_configured` |
| Official account not bound or awaiting login | `auth_required` |
| Detection request in progress | `syncing` |
| Detection and parsing succeeded | `success` |
| Network error, format error, mapping missing | `failed` |
| Auth expired, 401, 403, session revoked | `reauth_required` |
| Provider has no reproducible quota data source | `unsupported` |

## Implementation Files

- `src/lib/token-plan-refresh.js` — Detection constants, normalization functions, forbidden field checks
- `src/lib/local-api.js` — Detection field integration in `normalizeTokenPlanRecord`, secrets endpoint, forbidden field validation in `upsertTokenPlanRecord`
- `test/token-plans-api.test.js` — W03-R3A test cases

## Verification

```bash
node --test test/token-plans-api.test.js test/token-plan-console-sessions.test.js
npm run validate:guardrails
```

## Dependents

- `TE-NEXT-W03-R3B-token-plan-form-provider-detection.md`
- `TE-NEXT-W03-R3C-custom-api-detection-config.md`

Both can be dispatched in parallel after this contract is implemented.
