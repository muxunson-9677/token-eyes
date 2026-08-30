-- InsForge grants newly created public tables to API roles by default.
-- The compact leaderboard keeps both server-owned tables behind project_admin.

alter table public.tokentracker_model_pricing enable row level security;
revoke all on table public.tokentracker_model_pricing from public, anon, authenticated;
grant all on table public.tokentracker_model_pricing to project_admin;

alter table public.tokentracker_leaderboard_snapshots_v2 enable row level security;
revoke all on table public.tokentracker_leaderboard_snapshots_v2 from public, anon, authenticated;
grant all on table public.tokentracker_leaderboard_snapshots_v2 to project_admin;
