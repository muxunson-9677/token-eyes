-- Token Eyes WeChat custom OAuth adapter persistence.
--
-- Apply before deploying tokentracker-wechat-oauth.ts. Bearer material and
-- stable provider identifiers are stored only as SHA-256 digests. Temporary
-- display profile rows are reachable only through the service-role function.

BEGIN;

CREATE TABLE IF NOT EXISTS tokentracker_wechat_oauth_flows (
  state_hash text PRIMARY KEY,
  client_id text NOT NULL,
  client_state text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokentracker_wechat_oauth_codes (
  code_hash text PRIMARY KEY,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL,
  subject text NOT NULL,
  internal_email text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokentracker_wechat_oauth_tokens (
  token_hash text PRIMARY KEY,
  subject text NOT NULL,
  internal_email text NOT NULL,
  display_name text NOT NULL,
  avatar_url text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tokentracker_wechat_oauth_flows_expiry_idx
  ON tokentracker_wechat_oauth_flows (expires_at);
CREATE INDEX IF NOT EXISTS tokentracker_wechat_oauth_codes_expiry_idx
  ON tokentracker_wechat_oauth_codes (expires_at);
CREATE INDEX IF NOT EXISTS tokentracker_wechat_oauth_tokens_expiry_idx
  ON tokentracker_wechat_oauth_tokens (expires_at);

CREATE OR REPLACE FUNCTION tokentracker_prune_wechat_oauth()
RETURNS bigint
LANGUAGE sql
VOLATILE
SET search_path = public
AS $func$
  WITH deleted_flows AS (
    DELETE FROM tokentracker_wechat_oauth_flows
    WHERE expires_at <= now()
    RETURNING 1
  ),
  deleted_codes AS (
    DELETE FROM tokentracker_wechat_oauth_codes
    WHERE expires_at <= now()
    RETURNING 1
  ),
  deleted_tokens AS (
    DELETE FROM tokentracker_wechat_oauth_tokens
    WHERE expires_at <= now()
    RETURNING 1
  )
  SELECT
    (SELECT count(*) FROM deleted_flows) +
    (SELECT count(*) FROM deleted_codes) +
    (SELECT count(*) FROM deleted_tokens)
$func$;

COMMENT ON FUNCTION tokentracker_prune_wechat_oauth()
  IS 'Deletes expired Token Eyes WeChat OAuth flow, code, token and temporary profile rows.';

ALTER TABLE tokentracker_wechat_oauth_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE tokentracker_wechat_oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tokentracker_wechat_oauth_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE tokentracker_wechat_oauth_flows FROM PUBLIC;
REVOKE ALL ON TABLE tokentracker_wechat_oauth_codes FROM PUBLIC;
REVOKE ALL ON TABLE tokentracker_wechat_oauth_tokens FROM PUBLIC;

COMMIT;
