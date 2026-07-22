# Leaderboard Email Authentication Design

## Goal

Replace the leaderboard's GitHub-only participation flow with email authentication that works without WeChat, a phone number, GitHub, Google, or a VPN. Guests keep every local feature and may view the leaderboard. Signing in means participating in the leaderboard.

## Confirmed user experience

- The leaderboard keeps a small `邮箱登录并参与排行榜` entry point.
- Clicking it opens a compact modal without leaving the leaderboard.
- The modal contains email authentication only. It does not show OAuth providers.
- New users enter an optional nickname, email address, and password, then enter the six-digit verification code sent by InsForge in the same modal.
- Successful code verification creates the session automatically and immediately enrolls the user in the leaderboard.
- Existing users sign in with email and password.
- Forgotten passwords continue to use the existing email-code reset flow.
- Anonymous users can view the leaderboard and use all local Token Eyes features.
- A public GitHub profile remains optional profile metadata and is not an authentication requirement.

## Architecture

Reuse the existing InsForge auth context and `LoginCard` rather than adding a second authentication implementation.

1. Extend `InsforgeAuthContext` with the platform SDK's `verifyEmail` and `resendVerificationEmail` methods.
2. Complete `LoginCard`'s code-verification state. It must read `verifyEmailMethod` from public auth configuration and keep code-based users in the verification flow after signup.
3. Add a focused mode to `LoginCard` that suppresses OAuth buttons while preserving email sign-in, signup, verification, and password reset.
4. Replace the leaderboard's GitHub OAuth handler and provider detection with a small button and modal containing the focused email card.
5. On authentication success, close the modal. Existing leaderboard enrollment and upload behavior continues to use the authenticated InsForge session.

No leaderboard database schema, ranking calculation, usage upload format, local data path, provider list, icon, or unrelated page is changed.

## Failure handling

- Invalid or expired verification codes remain in the code-entry state and show the SDK error.
- Users can resend the verification code, subject to the backend's existing 60-second email interval.
- Closing the modal does not sign in or upload anything.
- If cloud authentication is unavailable, guests retain full local functionality and leaderboard viewing.
- No paid email provider, SMS provider, or OAuth provider is added.

## Privacy and cost

Only the email account identity, optional nickname/avatar, and already-approved aggregate leaderboard statistics are stored in the cloud. Code, prompts, conversation content, project names, skills, MCP configuration, filenames, and keystrokes are never uploaded.

The linked InsForge organization is on the free plan with no subscription. Built-in authentication email delivery is available on the free plan. The application must never initiate a paid upgrade; exhaustion or service interruption degrades authentication instead of producing a charge.

## Verification

- Unit tests cover email signup, six-digit verification, resend, normal email/password sign-in, modal open/close, and absence of a GitHub login requirement on the leaderboard.
- Existing leaderboard anonymous-view and authenticated-participation tests continue to pass.
- Dashboard build, targeted Node tests, Rust `cargo check`, and the Windows NSIS build must succeed.
- The resulting installer remains an in-place upgrade over Token Eyes 0.54.7 and preserves existing local data.
