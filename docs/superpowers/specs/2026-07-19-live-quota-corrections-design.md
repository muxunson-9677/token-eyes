# Token Eyes live quota corrections

## Scope

This change is limited to the Token Eyes project and fixes four observed failures:

1. Custom spend summary cards must use a visibly compact four-column layout at ordinary desktop widths.
2. Token Service List must never show an expired plan. An exhausted plan is shown only when a valid future expiry/reset timestamp proves it is still current.
3. Cursor quota parsing must follow the official response shape used by the public Cockpit Tools implementation, including `totalSpend`/`total_spend` ratios and a browser-compatible request header.
4. TRAE CN OAuth must discover the official login host through `GetLoginGuidance`, open that host's `/authorization` route, and query current v2 entitlement endpoints before legacy fallbacks.

## Acceptance criteria

- Regression tests fail on the old implementation and pass after the fix.
- No hard-coded `https://api.trae.cn/authorization` remains.
- Xiaomi-style exhausted records without a verifiable future expiry are absent from Token Service List.
- Cursor fixtures containing `totalSpend` and `limit` return the correct non-zero percentage.
- TRAE authorization URLs use the guidance host, `auth_from=trae`, the current app version, and `/authorize` as the local callback.
- The final Windows installer is rebuilt only after focused tests and production builds pass.

## Non-goals

- Do not modify Cockpit Tools, CC Switch, installed applications, browser profiles, or files outside this repository.
- Do not report live account success from mock data. Account-specific verification remains a real installer smoke test using the user's own authorized accounts.
