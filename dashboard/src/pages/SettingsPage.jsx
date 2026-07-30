import React, { lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Gauge } from "lucide-react";
import { LimitsSettingsPanel } from "../components/LimitsSettingsPanel.jsx";
import { DataDirectoriesSection } from "../components/settings/DataDirectoriesSection.jsx";
import { AgentPricingSection } from "../components/settings/AgentPricingSection.jsx";
import { AppearanceSection } from "../components/settings/AppearanceSection.jsx";
import { SectionCard, SegmentedControl } from "../components/settings/Controls.jsx";
import { MenuBarSection, NativeAppFooter } from "../components/settings/MenuBarSection.jsx";
import { LIMIT_DISPLAY_MODES, useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import { copy } from "../lib/copy";

const TokenPlanSection = lazy(() =>
  import("../components/settings/TokenPlanSection.jsx").then((module) => ({ default: module.TokenPlanSection })),
);
const ProviderApiConfigSection = lazy(() =>
  import("../components/settings/ProviderApiConfigSection.jsx").then((module) => ({ default: module.ProviderApiConfigSection })),
);
const OtherAiSpendSection = lazy(() =>
  import("../components/settings/OtherAiSpendSection.jsx").then((module) => ({ default: module.OtherAiSpendSection })),
);

function SettingsCostFallback() {
  return (
    <div className="tt-surface rounded-[var(--tt-card-radius)] px-5 py-8 text-center text-sm text-oai-gray-400 dark:text-oai-gray-500">
      {copy("settings.cost.loading")}
    </div>
  );
}

// v2.0 IA refactor (work order 01): the old single SettingsPage is split into
// two route components so each sub-module has its own URL.
//   - SettingsBasicPage (/settings/basic): appearance, menu bar,
//     data directories, agent pricing, limits display, native-app footer.
//   - SettingsCostPage (/settings/cost): TokenPlanSection plus a documented
//     insertion point for ProviderApiConfigSection (wired up by work order 03).
// TokenPlanSection MUST NOT appear in basic settings — no duplicate management
// entries. Neither sub-page duplicates the other's sections.

function LimitsDisplayModeControl({ prefs }) {
  return (
    <SegmentedControl
      options={[
        { value: LIMIT_DISPLAY_MODES.USED, label: copy("limits.settings.display_mode_used") },
        { value: LIMIT_DISPLAY_MODES.REMAINING, label: copy("limits.settings.display_mode_remaining") },
      ]}
      value={prefs.displayMode}
      onChange={prefs.setDisplayMode}
    />
  );
}

// ---------------------------------------------------------------------------
// /settings/basic — 基础设置
// ---------------------------------------------------------------------------

export function SettingsBasicPage() {
  const limitsPrefs = useLimitsDisplayPrefs();

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
              {copy("settings.basic.page.title")}
            </h1>
            <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.basic.page.subtitle")}
            </p>
          </div>

          <div className="space-y-4">
            <AppearanceSection />
            <MenuBarSection />
            <DataDirectoriesSection />
            <AgentPricingSection />
            <SectionCard
              title={copy("settings.section.limits")}
              icon={Gauge}
              iconTone="green"
              action={<LimitsDisplayModeControl prefs={limitsPrefs} />}
            >
              <LimitsSettingsPanel prefs={limitsPrefs} />
            </SectionCard>
          </div>

          <NativeAppFooter />
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /settings/cost — 成本设置
// ---------------------------------------------------------------------------

export function SettingsCostPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
              {copy("settings.cost.page.title")}
            </h1>
            <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.cost.page.subtitle")}
            </p>
          </div>

          <Suspense fallback={<SettingsCostFallback />}>
            <div className="space-y-4">
              <div id="codex-quota">
                <TokenPlanSection listOnly onNavigate={navigate} />
              </div>
            {/*
              v2.0 IA — work order 03 wires ProviderApiConfigSection here.
              The data-provider-api-config-anchor attribute is retained as a
              stable target for tests; do NOT render this section in basic
              settings (no duplicate management entry). API Key editing lives
              ONLY here — never on /spend/cost.
            */}
              <div data-provider-api-config-anchor>
                <ProviderApiConfigSection />
              </div>
              <OtherAiSpendSection />
            </div>
          </Suspense>
        </div>
      </main>
    </div>
  );
}
