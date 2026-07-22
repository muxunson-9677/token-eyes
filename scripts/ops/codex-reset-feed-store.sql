CREATE TABLE IF NOT EXISTS tokentracker_codex_reset_feed_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  envelope jsonb NOT NULL,
  last_openai_checked_at timestamptz,
  last_tavily_checked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tokentracker_codex_reset_feed_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tokentracker_codex_reset_feed_state FROM anon, authenticated;

INSERT INTO tokentracker_codex_reset_feed_state (singleton, envelope)
VALUES (
  true,
  '{"version":1,"payload_b64":"eyJnZW5lcmF0ZWRfYXQiOiIyMDI2LTA3LTIyVDA0OjI3OjI4LjM2MVoiLCJhbm5vdW5jZW1lbnRzIjpbXX0","signature_b64":"8AF61SRIQ7t8D5OogiXPNxnG06iIBFiRumlgA7N1CZw_AVnCKx72t6mH1gck_yomnxiQnPZ-F5EvzYqR5U5JCA"}'::jsonb
)
ON CONFLICT (singleton) DO NOTHING;
