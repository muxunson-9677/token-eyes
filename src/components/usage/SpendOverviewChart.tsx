import { useTranslation } from "react-i18next";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Loader2 } from "lucide-react";
import { fmtUsd, parseFiniteNumber } from "./format";
import type {
  CostLedgerQuery,
  CostLedgerSummary,
  SpendOverviewViewModel,
} from "@/types/usage";
import { useCostLedgerSummary } from "@/lib/query/usage";

interface SpendOverviewChartProps {
  params?: CostLedgerQuery;
  refreshIntervalMs?: number;
}

const COLORS = {
  period: "#3b82f6",
  cumulative: "#22c55e",
};

function buildViewModel(data: CostLedgerSummary): SpendOverviewViewModel {
  return {
    monthlyUsd: data.totalCostUsd,
    cumulativeUsd: data.cumulativeTotalCostUsd,
    bars: [
      {
        key: "period",
        label: "本周期",
        valueUsd: parseFiniteNumber(data.totalCostUsd) ?? 0,
        rawUsd: data.totalCostUsd,
      },
      {
        key: "cumulative",
        label: "累计",
        valueUsd: parseFiniteNumber(data.cumulativeTotalCostUsd) ?? 0,
        rawUsd: data.cumulativeTotalCostUsd,
      },
    ],
    byAgent: data.byAgent,
  };
}

export function SpendOverviewChart({
  params,
  refreshIntervalMs = 30000,
}: SpendOverviewChartProps) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useCostLedgerSummary(params, {
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });

  if (isLoading) {
    return (
      <div className="flex h-[350px] items-center justify-center rounded-xl bg-card/40 border border-border/50">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/30" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex h-[350px] items-center justify-center rounded-xl bg-card/40 border border-border/50">
        <p className="text-muted-foreground">
          {t("usage.error", "加载失败")}
        </p>
      </div>
    );
  }

  const vm = buildViewModel(data);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const entry = payload[0];
      return (
        <div className="rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur-md">
          <p className="font-medium">{entry.payload.label}</p>
          <p className="text-sm text-muted-foreground">
            {fmtUsd(entry.value, 6)}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-6 backdrop-blur-sm">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {t("usage.spendOverview", "花销概览")}
        </h3>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-lg bg-background/50 p-4">
          <p className="text-sm text-muted-foreground">
            {t("usage.periodCost", "本周期花销")}
          </p>
          <p className="text-2xl font-bold text-primary">
            {fmtUsd(parseFiniteNumber(vm.monthlyUsd) ?? 0, 4)}
          </p>
        </div>
        <div className="rounded-lg bg-background/50 p-4">
          <p className="text-sm text-muted-foreground">
            {t("usage.cumulativeCost", "累计花销")}
          </p>
          <p className="text-2xl font-bold text-primary">
            {fmtUsd(parseFiniteNumber(vm.cumulativeUsd) ?? 0, 4)}
          </p>
        </div>
      </div>

      <div className="h-[200px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={vm.bars}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="hsl(var(--border))"
              opacity={0.4}
            />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              dy={10}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
              tickFormatter={(value) => `$${value}`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="valueUsd" name="花销" radius={[4, 4, 0, 0]}>
              {vm.bars.map((entry) => (
                <Cell
                  key={entry.key}
                  fill={COLORS[entry.key]}
                  data-testid={`bar-${entry.key}`}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
