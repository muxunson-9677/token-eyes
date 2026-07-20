-- Token Eyes leaderboard dynamic ranking migration.
--
-- Adds the two aggregates needed for cache-exclusive and per-Agent ranking,
-- then exposes one service-role RPC that selects the score, ranks the full
-- participant set, and only then applies pagination. The edge function calls
-- this RPC; browsers never call it directly.
--
-- Apply after scripts/ops/leaderboard-usage-grouped-rpc.sql and deploy the
-- refreshed leaderboard edge functions immediately afterwards.

BEGIN;

ALTER TABLE tokentracker_leaderboard_snapshots
  ADD COLUMN IF NOT EXISTS total_without_cache_tokens bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS tokentracker_leaderboard_latest_window_idx
  ON tokentracker_leaderboard_snapshots (period, to_day DESC, generated_at DESC);

DROP FUNCTION IF EXISTS leaderboard_ranked(text, text, text, integer, integer, text, text[]);

CREATE OR REPLACE FUNCTION leaderboard_ranked(
  p_period text DEFAULT 'total',
  p_agent text DEFAULT 'all',
  p_metric text DEFAULT 'with_cache',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_user_id text DEFAULT NULL,
  p_blocked_user_ids text[] DEFAULT ARRAY[]::text[]
) RETURNS jsonb
LANGUAGE sql STABLE
AS $func$
  WITH latest_window AS (
    SELECT
      s.period,
      s.from_day,
      s.to_day,
      MAX(s.generated_at) AS generated_at
    FROM tokentracker_leaderboard_snapshots s
    WHERE s.period = p_period
    GROUP BY s.period, s.from_day, s.to_day
    ORDER BY s.to_day DESC, MAX(s.generated_at) DESC
    LIMIT 1
  ),
  raw_scores AS (
    SELECT
      s.*,
      CASE
        WHEN p_agent = 'all' AND p_metric = 'with_cache'
          THEN s.total_tokens::numeric
        WHEN p_agent = 'all' AND p_metric = 'without_cache'
          THEN s.total_without_cache_tokens::numeric
        WHEN p_agent = 'all' AND p_metric = 'estimated_cost'
          THEN s.estimated_cost_usd::numeric
        WHEN p_metric = 'with_cache'
          THEN COALESCE((s.agent_metrics -> p_agent ->> 'with_cache_tokens')::numeric, 0)
        WHEN p_metric = 'without_cache'
          THEN COALESCE((s.agent_metrics -> p_agent ->> 'without_cache_tokens')::numeric, 0)
        WHEN p_metric = 'estimated_cost'
          THEN COALESCE((s.agent_metrics -> p_agent ->> 'estimated_cost_usd')::numeric, 0)
        ELSE 0::numeric
      END AS score
    FROM tokentracker_leaderboard_snapshots s
    JOIN latest_window w
      ON w.period = s.period
     AND w.from_day = s.from_day
     AND w.to_day = s.to_day
     AND w.generated_at = s.generated_at
    WHERE NOT (
      s.user_id::text = ANY(COALESCE(p_blocked_user_ids, ARRAY[]::text[]))
    )
  ),
  participants AS (
    SELECT *
    FROM raw_scores
    WHERE total_tokens > 0
  ),
  eligible AS (
    SELECT *
    FROM raw_scores
    WHERE score > 0
  ),
  ranked AS (
    SELECT
      eligible.*,
      ROW_NUMBER() OVER (
        ORDER BY score DESC, total_tokens DESC, user_id ASC
      ) AS dynamic_rank
    FROM eligible
  ),
  ranked_payload AS (
    SELECT
      ranked.user_id,
      ranked.dynamic_rank,
      ranked.score,
      ranked.total_tokens,
      jsonb_build_object(
        'user_id', ranked.user_id,
        'period', ranked.period,
        'from_day', ranked.from_day,
        'to_day', ranked.to_day,
        'rank', ranked.dynamic_rank,
        'gpt_tokens', ranked.gpt_tokens,
        'claude_tokens', ranked.claude_tokens,
        'gemini_tokens', ranked.gemini_tokens,
        'cursor_tokens', ranked.cursor_tokens,
        'opencode_tokens', ranked.opencode_tokens,
        'openclaw_tokens', ranked.openclaw_tokens,
        'hermes_tokens', ranked.hermes_tokens,
        'kiro_tokens', ranked.kiro_tokens,
        'copilot_tokens', ranked.copilot_tokens,
        'kimi_tokens', ranked.kimi_tokens,
        'other_tokens', ranked.other_tokens,
        'total_tokens', ranked.total_tokens,
        'without_cache_tokens', ranked.total_without_cache_tokens,
        'estimated_cost_usd', ranked.estimated_cost_usd,
        'agent_metrics', ranked.agent_metrics,
        'score', ranked.score,
        'display_name', ranked.display_name,
        'avatar_url', ranked.avatar_url,
        'github_url', ranked.github_url,
        'is_public', ranked.is_public,
        'generated_at', ranked.generated_at
      ) AS payload
    FROM ranked
  ),
  page_rows AS (
    SELECT *
    FROM ranked_payload
    ORDER BY dynamic_rank
    LIMIT GREATEST(LEAST(p_limit, 100), 1)
    OFFSET GREATEST(p_offset, 0)
  ),
  summary AS (
    SELECT
      (SELECT COUNT(*)::bigint FROM participants) AS participant_count,
      (SELECT COUNT(*)::bigint FROM ranked) AS ranked_entry_count,
      (SELECT COALESCE(SUM(score), 0::numeric) FROM ranked) AS total_score,
      (SELECT COALESCE(SUM(total_tokens), 0::numeric) FROM participants) AS aggregate_total_tokens,
      (SELECT COALESCE(SUM(estimated_cost_usd), 0::numeric) FROM participants) AS aggregate_total_cost_usd
  )
  SELECT jsonb_build_object(
    'entries', COALESCE(
      (SELECT jsonb_agg(page_rows.payload ORDER BY page_rows.dynamic_rank) FROM page_rows),
      '[]'::jsonb
    ),
    'me', (
      SELECT ranked_payload.payload
      FROM ranked_payload
      WHERE ranked_payload.user_id::text = p_user_id
      LIMIT 1
    ),
    'participant_count', (SELECT summary.participant_count FROM summary),
    'ranked_entry_count', (SELECT summary.ranked_entry_count FROM summary),
    'total_score', (SELECT summary.total_score FROM summary),
    'aggregate_total_tokens', (SELECT summary.aggregate_total_tokens FROM summary),
    'aggregate_total_cost_usd', (SELECT summary.aggregate_total_cost_usd FROM summary),
    'from', (SELECT latest_window.from_day FROM latest_window),
    'to', (SELECT latest_window.to_day FROM latest_window),
    'generated_at', (SELECT latest_window.generated_at FROM latest_window)
  )
$func$;

COMMENT ON FUNCTION leaderboard_ranked(text, text, text, integer, integer, text, text[])
  IS 'Ranks aggregate Token Eyes snapshots by period, Agent, and cache/cost metric before paging.';

COMMIT;
