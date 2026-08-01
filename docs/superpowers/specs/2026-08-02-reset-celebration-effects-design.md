# Reset Celebration Effects Design

Date: 2026-08-02
Status: Approved visual direction, pending written-spec confirmation

## Goal

Replace the current reset-celebration background effect with two user-selectable effects while preserving the existing official-reset message and event behavior.

- Default effect: meteor shower.
- Optional effect: fireworks.
- Message copy remains the existing official-reset title and summary.
- The effect selector is stored on the current device and works offline.

## Visual Sources of Truth

The implementation must be adapted from these user-provided HTML references, not recreated from memory:

- Meteor shower: `E:\下载\token-reset-meteor-only.html`, scene `meteors`.
- Fireworks: `E:\下载\token-reset-surprise-v7-5-celebration-rework.html`, scene `fireworks`.

Only those two scenes are in scope. Starfall, ribbons, prism, review controls, audio controls, and reference-page navigation are excluded.

## User Experience

### Effect selection

The Reset History page replaces the current text preview action with:

1. A compact field labelled “选择惊喜效果”.
2. Two choices: “流星雨（默认）” and “烟花”.
3. A small icon-only preview button immediately beside the field.

Changing the selection saves immediately on the current device. Previewing plays the selected effect without creating, acknowledging, or mutating a reset event.

### Actual reset event

When an eligible official reset arrives, the celebration provider reads the saved effect preference and plays it for 6 seconds. Missing, invalid, or legacy values normalize to `meteors`.

### Background treatment

The celebration must not replace Token Eyes with a pure black screen.

- The current Token Eyes interface remains visible behind a translucent dark veil.
- The canvas itself uses transparency instead of drawing an opaque black page.
- Meteor and fireworks highlights remain bright and saturated above the veil.
- The overlay remains pointer-transparent so it never blocks application interaction.

### Message card

The card keeps the existing title and summary but receives a proportionally larger, vertically expanded layout.

- Desktop CSS target: `width: min(480px, calc(100vw - 40px))` and `min-height: 150px`.
- Width must not expand into a banner.
- Vertical padding is the main source of the size increase.
- Mobile width: viewport minus 32 px; height and typography reduce proportionally.
- Desktop icon target: 64 px.

The leading icon becomes a high-contrast celebration gift with bow and starburst details. It uses a restrained float/celebration motion and has a static reduced-motion state.

### Theme-aware Apple glass

The card material follows Token Eyes' resolved theme, including when the app theme is set to system:

- Resolved light theme: white Apple-style frosted glass with dark text.
- Resolved dark theme: black Apple-style frosted glass with light text.

Both variants use:

- Real backdrop blur and increased saturation.
- A translucent material rather than an opaque fill.
- A bright double edge: cyan near glow, blue middle glow, restrained violet far glow.
- A fine specular highlight and soft depth shadow.

The card must update immediately when the resolved theme changes, including while a preview is open.

## Architecture

### Preference module

Create a small celebration-preference module with one responsibility: normalize, read, save, and notify changes to the selected effect.

- Allowed effect IDs: `meteors`, `fireworks`.
- Default: `meteors`.
- Storage: a versioned Token Eyes `localStorage` key.
- Storage failures fall back to the in-memory/default value without breaking reset handling.
- A same-document custom event keeps the Reset History page and provider synchronized.

### Renderers

Add two independent lazy-loaded canvas renderers behind the existing overlay:

- `MeteorCelebrationCanvas`
- `FireworksCelebrationCanvas`

Each renderer owns its particle state, resize behavior, RAF lifecycle, visibility handling, adaptive density, and cleanup. Shared low-level helpers are allowed only where both renderers genuinely use them.

The reference HTML must be adapted to React lifecycle boundaries. It must not be embedded through an iframe and must not expose review controls or global reference-page APIs.

### Overlay and provider

`ResetCelebrationOverlay` keeps ownership of the message card, resolved theme, reduced-motion behavior, and renderer fallback. It chooses the lazy renderer from the normalized effect ID.

`ResetCelebrationProvider` keeps event deduplication and route-change cleanup. It reads the saved preference for real events and accepts an explicit effect ID for side-effect-free previews.

The celebration lifetime changes from 4.2 seconds to 6 seconds. CSS and timers use the same duration source so the renderer, card, and unmount timing cannot drift.

## Performance and Accessibility

- Respect `prefers-reduced-motion: reduce`: show the themed frosted card and a static edge highlight, without particle animation.
- Keep the overlay non-interactive and preserve the existing `role="status"`, polite live region, and atomic announcement.
- Pause animation when the document is hidden and resume without a large delta-time jump.
- Cap render scale and particle density using the reference implementations' pixel budget and adaptive performance strategy.
- Release RAF, resize listeners/observers, canvases, cached sprites, and rendering resources on unmount.
- A renderer failure must leave the message card visible and fall back to the static treatment.
- No sound is added.

## Copy and Localization

All new labels and option names are registered in `dashboard/src/content/copy.csv` and translated in the existing locale files. No new user-facing strings are hardcoded in JSX or TypeScript.

## Testing

Automated coverage must verify:

- Preference normalization, defaulting, persistence failure, and change notification.
- Reset History selector default, selection persistence, and icon-only preview behavior.
- Real events use the saved preference; previews use the currently selected preference.
- Meteor and fireworks renderers mount only when selected and clean up on timeout, route changes, and unmount.
- Celebration duration is 6 seconds.
- Light and dark resolved themes select the correct glass material.
- Reduced motion and renderer failure keep the card visible without particles.
- The existing event deduplication and side-effect-free preview guarantees remain intact.
- Copy registry, UI-hardcode guard, TypeScript, frontend tests, production build, and relevant Tauri tests pass.

## Out of Scope

- Cloud or cross-device synchronization of the preference.
- Additional celebration effects.
- Audio, vibration, or operating-system notifications.
- Editing the reset-event title or summary.
- Reworking reset detection, claim semantics, or history data.
