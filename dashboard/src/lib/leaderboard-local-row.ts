type CompactRow = [string, string, ...Array<string | number>];

type LocalStateResponse = {
  state?: {
    periods?: Record<string, CompactRow[]>;
  };
};

type BuildOptions = {
  period: string;
  source: string;
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  estimatedCostUsd?: number | null;
  actualCostUsd?: number | null;
};

const LEGACY_TOKEN_FIELDS: Record<string, string> = {
  codex: "gpt_tokens",
  claude: "claude_tokens",
  cursor: "cursor_tokens",
  gemini: "gemini_tokens",
  opencode: "opencode_tokens",
  openclaw: "openclaw_tokens",
  hermes: "hermes_tokens",
  kiro: "kiro_tokens",
  copilot: "copilot_tokens",
  "kimi-code": "kimi_tokens",
  kimi: "kimi_tokens",
};

const ALL_LEGACY_FIELDS = [
  "gpt_tokens",
  "claude_tokens",
  "gemini_tokens",
  "cursor_tokens",
  "opencode_tokens",
  "openclaw_tokens",
  "hermes_tokens",
  "kiro_tokens",
  "copilot_tokens",
  "kimi_tokens",
  "other_tokens",
];

const PUBLIC_SOURCE_FILTERS = new Set(["codex", "claude", "cursor", "gemini", "opencode"]);

function tokenValue(value: unknown): bigint {
  const normalized = typeof value === "string" ? value.trim() : String(value ?? "");
  return /^\d+$/.test(normalized) ? BigInt(normalized) : 0n;
}

function finiteCost(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function shanghaiDateKey(now: Date): string {
  const parts = Object.fromEntries(
    shanghaiDateFormatter
      .formatToParts(now)
      .filter((part) => part.type === "year" || part.type === "month" || part.type === "day")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getLeaderboardPeriodDateRange(period: string, now = new Date()) {
  const to = shanghaiDateKey(now);
  if (period === "today") return { from: to, to };
  if (period === "month") return { from: `${to.slice(0, 7)}-01`, to };
  if (period === "week") {
    const monday = new Date(`${to}T00:00:00.000Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return { from: monday.toISOString().slice(0, 10), to };
  }
  return { from: "1970-01-01", to };
}

export function buildLocalLeaderboardRow(response: LocalStateResponse, options: BuildOptions) {
  const periodRows = response?.state?.periods?.[options.period];
  const rows = Array.isArray(periodRows) ? periodRows : [];
  const selectedSource = String(options.source || "all").trim().toLowerCase();
  const bySource = new Map<string, bigint>();

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const source = String(row[0] || "").trim().toLowerCase();
    const selected = selectedSource === "all"
      || source === selectedSource
      || (selectedSource === "other" && !PUBLIC_SOURCE_FILTERS.has(source));
    if (!source || !selected) continue;
    const total = row.slice(2, 7).reduce<bigint>((sum, value) => sum + tokenValue(value), 0n);
    bySource.set(source, (bySource.get(source) || 0n) + total);
  }

  const legacyTotals: Record<string, bigint> = Object.fromEntries(
    ALL_LEGACY_FIELDS.map((field) => [field, 0n]),
  );
  let totalTokens = 0n;
  for (const [source, total] of bySource) {
    const field = LEGACY_TOKEN_FIELDS[source] || "other_tokens";
    legacyTotals[field] += total;
    totalTokens += total;
  }

  return {
    user_id: options.userId,
    display_name: options.displayName || null,
    avatar_url: options.avatarUrl || null,
    rank: null,
    is_me: true,
    is_local_pending: true,
    is_public: false,
    ...Object.fromEntries(
      Object.entries(legacyTotals).map(([field, total]) => [field, total.toString()]),
    ),
    total_tokens: totalTokens.toString(),
    estimated_cost_usd: finiteCost(options.estimatedCostUsd),
    actual_cost_usd: finiteCost(options.actualCostUsd),
    source_breakdown: Array.from(bySource, ([source, total]) => ({
      source,
      total_tokens: total.toString(),
    })),
  };
}
