# Limit Account Provider Capabilities (O2)

Survey of Token Eyes authorized bindings vs official rate-limit reads.
Multi-account is only "supported" when Token Eyes can query each account
read-only without switching the active login. Fixture-only coverage is
experimental.

| Provider | Token Eyes multi-binding stored? | Per-account read-only quota query? | Query changes current account? | Real dual-account verified? | O2 status |
|---|---|---|---|---|---|
| codex | Console sessions / plan bindings possible | No — one Codex auth bundle | Must stay no | No | Single-account via CLI auth; matrix-ready experimental |
| claude | Console sessions / plan bindings possible | No — one Claude Code access token | Must stay no | No | Single-account via CLI auth; matrix-ready experimental |
| cursor | Console sessions / plan bindings possible | No — one Cursor session | Must stay no | No | Single-account via CLI auth; matrix-ready experimental |
| kimi | Console sessions / plan bindings possible | No — one credentials set | Must stay no | No | Single-account via CLI auth; matrix-ready experimental |
| gemini | No console multi-binding | No — single CLI account | Must stay no | No | Single-account |
| kiro | No | No | Must stay no | No | Single-account |
| antigravity | No | No | Must stay no | No | Single-account |
| copilot | No | No | Must stay no | No | Single-account |
| grok | No | No | Must stay no | No | Single-account |

Notes:

- Adapters enumerate the currently authorized CLI/desktop login only.
- They do not read CC Switch or other external account switchers.
- `consoleSessions` remain for token-plan / verify flows; Limits O2 does not
  treat them as official multi-account quota sources until a provider can be
  queried per binding without mutating the active login.
- The matrix UI and `LimitAccountV2` schema already accept multiple rows per
  provider; adapters may return more than one account when a real read-only
  multi-account source exists.
