import React from "react";
import { Atom, DollarSign, Orbit, Package } from "lucide-react";
import { copy } from "../../lib/copy";

function formatCny(value) {
  return `¥ ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function OverviewCard({ id, tone, icon: Icon, title, badge, value, subtitle, rows }) {
  return (
    <article className="tt-cost-overview-card tt-pressable" data-tone={tone} data-testid={`cost-overview-card-${id}`}>
      <header className="tt-cost-overview-card-header">
        <span className="tt-cost-overview-card-icon"><Icon aria-hidden="true" /></span>
        <div className="tt-cost-overview-card-heading">
          <h2>{title}</h2>
          <strong>{value}</strong>
          <span>{subtitle}</span>
        </div>
        <span className="tt-cost-overview-card-badge">{badge}</span>
      </header>
      <div className="tt-cost-overview-card-rows">
        {rows.map((row) => (
          <div key={row.label}>
            <span>{row.label}</span>
            <strong data-tone={row.tone || tone}>{row.value}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

export function CostSettingsOverview({ summary }) {
  const pricing = summary?.pricing || {};
  const plans = summary?.plans || {};
  const providers = summary?.providers || {};
  const other = summary?.other || {};
  return (
    <section className="tt-cost-overview-grid" data-testid="cost-overview-grid" aria-label={copy("settings.cost.overview.aria_label")}>
      <OverviewCard
        id="pricing"
        tone="green"
        icon={DollarSign}
        title={copy("settings.cost.overview.pricing.title")}
        badge={copy("settings.cost.overview.pricing.badge")}
        value={`${pricing.configuredCount || 0} ${copy("settings.cost.overview.unit")}`}
        subtitle={copy("settings.cost.overview.pricing.subtitle")}
        rows={[
          { label: copy("settings.cost.overview.pricing.catalog"), value: `${pricing.configuredCount || 0} ${copy("settings.cost.overview.item")}` },
          { label: copy("settings.cost.overview.pricing.custom"), value: `${pricing.customCount || 0} ${copy("settings.cost.overview.item")}` },
        ]}
      />
      <OverviewCard
        id="plans"
        tone="blue"
        icon={Package}
        title={copy("settings.cost.overview.plans.title")}
        badge={plans.attentionCount > 0
          ? copy("settings.cost.overview.plans.attention", { count: plans.attentionCount })
          : copy("settings.cost.overview.normal")}
        value={`${plans.activeCount || 0} ${copy("settings.cost.overview.unit")}`}
        subtitle={copy("settings.cost.overview.plans.subtitle")}
        rows={[
          { label: copy("settings.cost.overview.plans.watch"), value: `${plans.attentionCount || 0} ${copy("settings.cost.overview.unit")}`, tone: plans.attentionCount > 0 ? "amber" : "green" },
          { label: copy("settings.cost.overview.plans.cost"), value: formatCny(plans.costCny), tone: "blue" },
        ]}
      />
      <OverviewCard
        id="providers"
        tone="violet"
        icon={Orbit}
        title={copy("settings.cost.overview.providers.title")}
        badge={providers.disconnected > 0
          ? copy("settings.cost.overview.providers.attention")
          : copy("settings.cost.overview.providers.normal")}
        value={`${providers.connected || 0} / ${providers.disconnected || 0} ${copy("settings.cost.overview.unit")}`}
        subtitle={copy("settings.cost.overview.providers.subtitle")}
        rows={[
          { label: copy("settings.cost.overview.providers.total"), value: `${providers.total || 0} ${copy("settings.cost.overview.unit")}`, tone: "violet" },
          { label: copy("settings.cost.overview.providers.balance"), value: formatCny(providers.totalBalanceCny), tone: "violet" },
        ]}
      />
      <OverviewCard
        id="other"
        tone="orange"
        icon={Atom}
        title={copy("settings.cost.overview.other.title")}
        badge={copy("settings.cost.overview.normal")}
        value={`${other.groupCount || 0} ${copy("settings.cost.overview.unit")}`}
        subtitle={copy("settings.cost.overview.other.subtitle")}
        rows={[
          { label: copy("settings.cost.overview.other.month"), value: formatCny(other.currentMonthCny), tone: "orange" },
          { label: copy("settings.cost.overview.other.records"), value: `${other.recordCount || 0} ${copy("settings.cost.overview.record")}`, tone: "green" },
        ]}
      />
    </section>
  );
}
