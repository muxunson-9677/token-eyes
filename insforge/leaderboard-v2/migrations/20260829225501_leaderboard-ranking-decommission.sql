-- Decommission the legacy pageable public ranking RPC.
-- Public leaderboard reads now use signed fixed Top-50 static objects.

drop function if exists public.leaderboard_ranked(
  text,
  text,
  text,
  integer,
  integer,
  text,
  text[]
);
