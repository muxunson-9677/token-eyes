export type MetricAvailability = "measured" | "aggregate_only" | "unavailable";
export type PricingCoverage = "complete" | "partial" | "unpriced";

export type SourceKind = "official_api" | "session_log" | "sqlite" | "hook" | "otel" | "cache" | "curated" | "estimated" | "mixed" | "third_party" | "unpriced" | "user_override";
export type EvidenceAccuracy = "exact" | "normalized" | "estimated" | "unknown";
export type EvidenceCoverage = "complete" | "partial" | "unavailable" | "unpriced";

export interface DataEvidenceV1 {
  source_kind: SourceKind;
  accuracy: EvidenceAccuracy;
  coverage: EvidenceCoverage;
  observed_at: string;
  source_updated_at: string | null;
  stale_after_seconds: number;
  is_stale: boolean;
  pricing_source: string | null;
  pricing_version: string | null;
  note_code: string | null;
}

export interface UsageDimensionsV1 {
  device_id: string;
  environment_id: string;
  environment_kind: "native" | "wsl" | "ssh" | "container" | "unknown";
  agent_id: string;
  account_scope: string | null;
  project_key: string | null;
  session_key: string | null;
  model_id: string | null;
}

export interface PricingCoverageFields {
  priced_tokens: number;
  unpriced_tokens: number;
  pricing_coverage: PricingCoverage;
}

export interface PricingProvenanceComponent {
  source_kind: SourceKind;
  record_count: number;
  priced_tokens: number;
  unpriced_tokens: number;
  cost_usd: number | null;
  estimated: boolean;
  is_stale: boolean;
  pricing_source: string | null;
  pricing_version: string | null;
  source_url: string | null;
  source_updated_at: string | null;
  match_kind: string | null;
  matched_model: string | null;
  note_code: string | null;
  observed_at: string | null;
}

export interface PricingProvenanceFields {
  pricing_source: string | null;
  pricing_version: string | null;
  source_kind: SourceKind | null;
  source_url: string | null;
  source_updated_at: string | null;
  observed_at: string | null;
  is_stale: boolean;
  estimated: boolean;
  match_kind: string | null;
  matched_model: string | null;
  note_code: string | null;
  pricing_components: PricingProvenanceComponent[];
}

export interface TokenTotals {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_output_tokens: number;
  cost_usd: number;
}

export interface TrendDataPoint {
  bucket: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
  cost_usd: number;
}

export interface ModelBucketEntry extends TokenTotals {
  model: string;
}

export interface SpendSeriesEntry extends TokenTotals {
  bucket_start: string;
  bucket_end: string;
  label: string;
  source: string;
  api_cost_usd: number;
  subscription_cost_usd: number;
  combined_usd: number;
  models: ModelBucketEntry[];
}

export interface SpendBySourceEntry extends TokenTotals {
  source: string;
  api_cost_usd: number;
  subscription_cost_usd: number;
  combined_usd: number;
}

export interface SpendTimeseriesTotals extends TokenTotals {
  api_cost_usd: number;
  subscription_cost_usd: number;
  combined_usd: number;
  api_cost_cny: number;
  subscription_cost_cny: number;
  combined_cny: number;
}

export interface SpendTimeseriesResponse {
  ok: boolean;
  from: string;
  to: string;
  bucket: string;
  timezone: string;
  currency: string;
  sources: string[];
  series: SpendSeriesEntry[];
  by_source: SpendBySourceEntry[];
  totals: SpendTimeseriesTotals;
}

export interface UsageRecord extends Omit<TokenTotals, "cost_usd">, PricingCoverageFields, PricingProvenanceFields {
  cost_usd: number | null;
  id: string;
  record_kind?: "request_event" | "aggregate_bucket";
  timestamp: string;
  hour_start: string;
  aggregate_bucket_start?: string;
  source: string;
  source_display_name: string;
  model: string;
  conversation_count?: number;
  status: number | null;
  latency_ms: number | null;
  first_token_ms: number | null;
  request_source: string;
  origin?: string;
}

export type RequestUsageRecord = UsageRecord;

export interface RequestUsageRecordsTotals extends Omit<TokenTotals, "cost_usd">, PricingCoverageFields, PricingProvenanceFields {
  cost_usd: number | null;
  request_count: number;
  success_count: number | null;
  interrupted_count: number;
  failure_count: number;
  success_rate: number | null;
  avg_latency_ms: number | null;
  cache_hit_rate: number;
  status_sample_count: number;
  latency_sample_count: number;
}

export interface RequestUsageRecordsAvailability {
  request_records: MetricAvailability;
  status: MetricAvailability;
  latency: MetricAvailability;
}

export interface RequestUsageRecordsPage {
  limit: number;
  returned_count: number;
  total_count: number;
  totals_scope: "all_matching";
}

export interface RequestUsageRecordsResponse {
  ok: boolean;
  records: UsageRecord[];
  totals: RequestUsageRecordsTotals;
  granularity: "request_event" | "aggregate_bucket" | "mixed";
  aggregate_only_sources: string[];
  availability: RequestUsageRecordsAvailability;
  page: RequestUsageRecordsPage;
  queue_baseline_totals?: TokenTotals & PricingCoverageFields;
}

export interface UsageSummary extends TokenTotals, PricingCoverageFields {
  request_count: number | null;
  display_request_count?: number;
  request_count_basis?: "request_count" | "conversation_count";
  success_count: number | null;
  success_rate: number | null;
  avg_latency_ms: number | null;
  cache_hit_rate: number;
  conversation_count: number;
  metric_availability: MetricAvailability;
  total_cost_usd?: number | string;
}

export interface UsageSummaryResponse {
  ok: boolean;
  totals?: UsageSummary;
  summary?: UsageSummary;
  from?: string;
  to?: string;
  days?: number;
  scope?: string;
  excluded_sources?: Array<{ source: string; source_scope: string; reason: string }>;
  sources?: string[];
  models?: string[];
  rolling?: {
    last_7d?: { from: string; to: string; active_days: number; totals: { billable_total_tokens: number; conversation_count: number } };
    last_30d?: { from: string; to: string; active_days: number; totals: { billable_total_tokens: number; conversation_count: number }; avg_per_active_day: number };
  };
}

export type ProviderRequestCountBasis = "request_event" | "unavailable";

export type ProviderCostBasis =
  | {
    authority: "local_list_price_estimate";
    accuracy: Extract<EvidenceAccuracy, "estimated">;
  }
  | {
    authority: "official_invoice";
    accuracy: Extract<EvidenceAccuracy, "exact">;
  };

export interface ProviderBreakdown {
  id: string;
  display_name: string;
  tokens: number;
  request_count: number | null;
  cost_usd: number | null;
}

export interface ProviderPeriod {
  from: string;
  to: string;
  days: number;
  time_zone: string;
}

export interface ProviderDailyUsage {
  date: string;
  agents: ProviderBreakdown[];
  models: ProviderBreakdown[];
  tokens: number;
  request_count: number | null;
  request_count_basis: ProviderRequestCountBasis;
  cost_usd: number;
  cost_basis: ProviderCostBasis;
  period: ProviderPeriod;
}

export interface ProviderBalance {
  amount: number;
  currency: string | null;
  observed_at: string | null;
}

export interface ProviderStat extends PricingCoverageFields {
  provider_id: string;
  display_name: string;
  account_label: string | null;
  account_ref: string | null;
  agents: ProviderBreakdown[];
  models: ProviderBreakdown[];
  period: ProviderPeriod;
  daily: ProviderDailyUsage[];
  balance: ProviderBalance | null;
  request_count: number | null;
  request_count_basis: ProviderRequestCountBasis;
  conversation_count: number;
  tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  reasoning_output_tokens: number;
  cost_usd: number;
  cost_basis: ProviderCostBasis;
  success_count: number | null;
  interrupted_count: number;
  failure_count: number;
  success_rate: number | null;
  avg_latency_ms: number | null;
  status_sample_count: number;
  success_rate_sample_count: number;
  latency_sample_count: number;
  availability: {
    status: Extract<MetricAvailability, "measured" | "unavailable">;
    latency: Extract<MetricAvailability, "measured" | "unavailable">;
  };
  metric_availability: MetricAvailability;
}

export interface ProviderStatsTotals extends TokenTotals, PricingCoverageFields {
  provider_count: number;
  conversation_count: number;
  request_count: number | null;
}

export interface ProviderStatsResponse {
  ok: boolean;
  view: "range" | "recent_api_7d";
  from: string;
  to: string;
  requested_from?: string | null;
  requested_to?: string | null;
  period: ProviderPeriod;
  totals_scope: "all_provider_attributed" | "api_key_attributed_official_billed_cost_positive";
  providers: ProviderStat[];
  totals: ProviderStatsTotals;
  scope?: string;
  excluded_sources?: Array<{ source: string; source_scope: string; reason: string }>;
  sources?: string[];
  models?: string[];
}

export interface ModelStat extends PricingCoverageFields {
  model: string;
  source: string;
  source_display_name: string;
  request_count: number | null;
  conversation_count: number;
  tokens: number;
  cost_usd: number;
  success_rate: number | null;
  avg_latency_ms: number | null;
  metric_availability: MetricAvailability;
}

export interface ModelStatsResponse {
  ok: boolean;
  from: string;
  to: string;
  models: ModelStat[];
  totals: TokenTotals & PricingCoverageFields;
  scope?: string;
  excluded_sources?: Array<{ source: string; source_scope: string; reason: string }>;
  sources?: string[];
}

export interface UsageFilterParams {
  from?: string;
  to?: string;
  timeZone?: string;
  tzOffsetMinutes?: number;
  sources?: string[];
  models?: string[];
  agentIds?: string[];
}
