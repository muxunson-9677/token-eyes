# Widget control design QA

- Source visual truth: `.codex-artifacts/widget-control-visual-audit/reference-basic-settings.png`
- Implementation screenshots: `.codex-artifacts/widget-control-visual-audit/widgets-toolbar-resting.png`, `.codex-artifacts/widget-control-visual-audit/widgets-toolbar-pressed.png`, `.codex-artifacts/widget-control-visual-audit/widgets-status-open.png`
- Combined comparison: `.codex-artifacts/widget-control-visual-audit/comparison.png`
- Primary viewport: 875 x 805, light theme, `/widgets`
- Secondary viewport: 1218 x 803, light theme, `/widgets`
- States: resting, pointer held, rebound/settled, dropdown open and option selected
- Console check: no JavaScript runtime exception occurred during the control interactions. The Vite-only preview still reports the existing local-data endpoint 502/404 responses when its desktop backend is unavailable; these responses do not affect the control rendering or interaction verified here.

**Findings**

- No remaining P0, P1, or P2 mismatch in the requested controls.
- The earlier implementation was blocked because `WidgetsPage` did not render the `.tt-reference-route-widgets` scope class. The route-scoped depth and animation rules therefore never matched the actual page even though stylesheet contract tests found the declarations.
- Post-fix evidence shows the Basic Settings reference controls and widget controls use the same `tt-raised-control` surface: identical border color, white-to-gray surface gradient, top highlight, and layered shadow.
- Pointer-down evidence shows a real `0.94` scale, `2px` downward translation, darker inset shadow, and subsequent return to rest. The same state was measured on the project-folder action and the Refresh Data action.
- All three toolbar dropdowns now use the same Base UI `Select` component as Basic Settings rather than native `<select>` controls. The status menu opened and changed from `状态：全部` to `活跃项目` in the browser run.

**Required fidelity surfaces**

- Fonts and typography: retained the existing widget toolbar font family, weight, size, icon sizing, truncation, and Chinese label wrapping. No clipping was visible at either viewport.
- Spacing and layout rhythm: existing control heights and toolbar wrapping were preserved. The raised surface adds depth without changing the table alignment or causing horizontal overflow at 875 x 805 and 1218 x 803.
- Colors and visual tokens: border, gradient, highlight, shadow, hover, and dark-theme values are now shared with the accepted Basic Settings controls through one class.
- Image and asset fidelity: no raster assets were introduced or replaced. Existing Lucide product icons remain sharp and aligned.
- Copy and content: labels and localized copy are unchanged. Dropdown selection behavior remains functional.

**Full-view comparison evidence**

- `.codex-artifacts/widget-control-visual-audit/widgets-resting.png`
- `.codex-artifacts/widget-control-visual-audit-1218x803/widgets-resting.png`

**Focused comparison evidence**

- `.codex-artifacts/widget-control-visual-audit/comparison.png` places the Basic Settings reference, widget resting state, and widget pressed state in one image.
- `.codex-artifacts/widget-control-visual-audit/report.json` records the computed border, gradient, shadow, dimensions, transform, dropdown selection, and refresh-button press state.

**Comparison history**

1. Earlier finding: widget rules existed in CSS but were never active because the route scope class was absent; native dropdowns also differed structurally from Basic Settings.
2. Fixes: added the real route scope, shared the accepted raised-control surface, replaced the three native selects with the shared Base UI `Select`, and retained a visible press/rebound response.
3. Post-fix evidence: 875 x 805 and 1218 x 803 captures show visible static elevation and a clearly compressed pressed frame; browser interaction confirms dropdown selection and Refresh Data press feedback.

**Open Questions**

- None for the requested control-depth and press-feedback scope.

**Implementation Checklist**

- [x] Basic Settings and Widgets share the same raised control surface.
- [x] Toolbar buttons have visible resting depth.
- [x] Toolbar dropdowns use the shared Select component and remain operable.
- [x] Refresh Data has the same resting depth and press response.
- [x] Pointer-down feedback is immediate and visibly changes scale, position, and inset shadow.
- [x] Reduced-motion users retain static feedback without the rebound animation.
- [x] Verified at both requested/current narrow viewport and a wider desktop viewport.

**Follow-up Polish**

- No task-scoped P3 follow-up is required.

final result: passed
