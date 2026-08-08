import React, { lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { CircleCheck, Download, Shield, Upload } from "lucide-react";
import { LimitsSettingsPanel } from "../components/LimitsSettingsPanel.jsx";
import { AgentPricingSection } from "../components/settings/AgentPricingSection.jsx";
import { AppearanceSection } from "../components/settings/AppearanceSection.jsx";
import { SectionCard } from "../components/settings/Controls.jsx";
import { DataDirectoriesSection } from "../components/settings/DataDirectoriesSection.jsx";
import { MenuBarSection, NativeAppFooter } from "../components/settings/MenuBarSection.jsx";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
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
//     data directories, limits display, native-app footer.
//   - SettingsCostPage (/settings/cost): pricing, plans, provider API,
//     and other AI spend configuration.
// TokenPlanSection MUST NOT appear in basic settings — no duplicate management
// entries. Neither sub-page duplicates the other's sections.

function LimitsDisplayModeControl({ prefs }) {
  const displayedProviders = prefs.order.slice(0, 6);
  const enabledCount = displayedProviders.filter((id) => prefs.visibility[id] !== false).length;
  return (
    <div className="tt-limits-header-actions">
      <span>已启用 {enabledCount}/{displayedProviders.length}</span>
      <button type="button" onClick={prefs.reset}>{copy("settings.reference.reset_default")}</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// /settings/basic — 基础设置
// ---------------------------------------------------------------------------

export function SettingsBasicPage() {
  const limitsPrefs = useLimitsDisplayPrefs();

  return (
    <div
      className="tt-reference-route-settings-basic flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white"
      data-testid="settings-basic-page"
    >
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-8" data-testid="settings-basic-heading">
            <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
              {copy("settings.basic.page.title")}
            </h1>
            <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.basic.page.subtitle")}
            </p>
          </div>

          <div className="space-y-4">
            <div id="settings-appearance"><AppearanceSection /></div>
            <div id="settings-menubar"><MenuBarSection /></div>
            <div id="data-directories">
              <DataDirectoriesSection />
            </div>
            <div id="settings-limits">
              <SectionCard
                className="tt-settings-limits-card"
                title={copy("settings.section.limits")}
                subtitle="选择要在排行榜、图表和小组件中显示的模型提供商。"
                icon={Shield}
                iconTestId="settings-limits-icon"
                iconTone="violet"
                action={<LimitsDisplayModeControl prefs={limitsPrefs} />}
              >
                <LimitsSettingsPanel prefs={limitsPrefs} />
              </SectionCard>
            </div>
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
    <div
      data-testid="settings-cost-page"
      className="tt-settings-cost-page flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white"
    >
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="tt-settings-cost-shell">
          <div className="tt-settings-cost-heading" data-testid="settings-cost-heading">
            <div>
              <h1 className="tracking-tight text-oai-black dark:text-white">
                {copy("settings.cost.page.title")}
              </h1>
              <p>
                {copy("settings.cost.page.subtitle")}
              </p>
            </div>
            <div className="tt-settings-cost-actions">
              <button type="button"><Upload aria-hidden="true" />{copy("settings.reference.import")}</button>
              <button type="button"><Download aria-hidden="true" />{copy("settings.reference.export")}</button>
              <button type="button"><CircleCheck aria-hidden="true" />{copy("settings.reference.validate")}</button>
            </div>
          </div>

          <Suspense fallback={<SettingsCostFallback />}>
            <div className="tt-settings-cost-sections space-y-4">
              <AgentPricingSection />
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
