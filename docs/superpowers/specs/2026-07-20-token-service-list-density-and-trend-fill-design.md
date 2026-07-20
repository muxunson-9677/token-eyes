# Token Service List Density and Trend Fill Design

**Status:** Awaiting review on 2026-07-20

## Goal

Make the usage-trend and token-service region dense, aligned, and scalable without hiding live quota data:

- show exactly five token services per page;
- render every service as a visually complete compact card with a clear boundary;
- retain every quota lane, including Cursor Total Usage, Auto + Composer Usage, and API Usage;
- keep the usage-trend and token-service outer cards aligned at both the top and bottom;
- let the trend chart use the available vertical space instead of leaving a large blank area below it.

## Selected direction

Use independent bordered mini-cards in a fixed five-item page. This preserves all account and quota information while making the service boundary explicit. Pagination remains visible at the bottom of the token-service panel.

The alternatives were rejected because a collapsed summary would hide quota lanes and an internally scrolling list would conflict with the requested page-based navigation.

## Layout

### Shared two-panel region

`SpendPage` keeps the usage-trend card on the left and the token-service card on the right at desktop widths. The grid continues to stretch both children to the same row height, so the two outer borders share one top edge and one bottom edge. Narrow layouts continue to stack the panels.

No fixed pixel height will be added to force apparent alignment. The token-service content establishes the row height, and the chart consumes the height made available by that row.

### Token-service panel

The page size is fixed at five services. Each item becomes an independent mini-card with:

- a visible border and restrained background contrast;
- a small consistent corner radius;
- a real gap from the next item rather than only a divider;
- provider icon, service name, plan name, and account label in a compact header;
- every quota lane shown as a dense row containing its label, percentage, thin progress bar, and quota values;
- one compact reset/validity footer when reset information is shared by the lanes.

The service list uses the panel's available middle space. The panel title stays at the top and the pagination controls stay at the bottom. Five ordinary services must fit without clipping, ellipsizing required quota amounts, or shrinking text below the existing readable small-text scale.

Providers with multiple quota lanes remain one service card. The design reduces repeated spacing and metadata rather than hiding lanes. A page with fewer than five services keeps the same card treatment and does not fabricate empty placeholders.

### Pagination

Pagination uses the existing ordered service data and stable global rank numbering. It displays five services per page, clamps the current page after data/filter changes, and keeps previous/next actions disabled at their respective boundaries. The page indicator remains visible even when only one page exists.

### Usage-trend panel

The usage-trend root becomes a full-height flex column. Its header and legend retain their natural height, while the plot region receives all remaining height.

The chart observes both the available width and height of its plot container. Its SVG and plotting bounds use that measured height with a sensible minimum for stacked/narrow layouts. This removes the regression where the outer card stretches to match the service list but the fixed-height SVG remains near the top and leaves unused space below the legend.

The data series, axes, tooltip, date range, colors, and formatting remain unchanged.

## Data and interaction behavior

- No provider, account, plan, quota, reset, or synchronization values are synthesized or removed.
- No quota lane is collapsed behind a click.
- Filtering and ordering behavior remain unchanged.
- Existing pagination becomes explicitly fixed at five entries per page.
- Cursor, TRAE, Codex, and manually configured subscriptions continue to use their existing data sources.
- TRAE authentication and live quota repair are a separate implementation track and are not simulated by this layout change.

## Failure baselines and automated verification

Before implementation, tests must demonstrate the current failures:

1. service rows are separated only by dividers and do not expose independent card boundaries;
2. a five-service page cannot satisfy the compact-card height contract when multi-lane services are present;
3. the chart SVG keeps a fixed height while its stretched outer card is taller, leaving unused vertical space;
4. panel alignment is not coupled to a plot region that consumes the remaining card height.

The minimal repair must then make tests pass for:

- exactly five service cards on the first page and the remainder on later pages;
- stable ranks and boundary-disabled pagination;
- an independent border and inter-card gap for every service;
- complete rendering of all Cursor quota lanes and their values;
- a compact shared reset footer when lane resets are identical;
- equal-height outer panels in the desktop grid;
- a full-height trend-card flex layout and a plot region that grows with available height;
- chart measurement updates when container height changes;
- the existing narrow stacked layout.

## Installed-app verification

After automated tests and a diagnostic build, the formal installed application must be checked with real token-service data:

- the first page contains no more than five complete service cards;
- six or more services create an accessible second page;
- service boundaries remain visually distinct at normal display scaling;
- all quota values remain readable and uncropped;
- the usage-trend and token-service outer cards align at the top and bottom;
- the chart extends into the available lower space without a large blank band;
- no data line, axis label, tooltip, legend, or pagination control overlaps or clips.

Evidence must record the installed executable identity, content width, active page, visible service count, and screenshot path. Fixtures and component-only previews do not replace this installed-app check.

## Non-goals

- no hidden summary/expand interaction;
- no internal scrolling as a replacement for pagination;
- no change to quota calculations or provider synchronization semantics;
- no hardcoded TRAE quota sample values;
- no unrelated redesign of the spend page;
- no final installer before all original rework acceptance gates pass.
