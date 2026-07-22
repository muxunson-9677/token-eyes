-- One pre-release local smoke test accidentally reached the device state for
-- the development account. Remove only that fixture's complete compact row;
-- do not remove or rewrite genuine OpenClaw usage.
with corrected as (
  select
    user_id,
    device_id,
    jsonb_set(
      payload,
      '{periods,total}',
      (
        select coalesce(jsonb_agg(item), '[]'::jsonb)
        from jsonb_array_elements(payload #> '{periods,total}') as item
        where item <> '["openclaw","gpt-5.3-codex","70","30","0","0","0"]'::jsonb
      )
    ) as new_payload
  from public.tokentracker_leaderboard_device_state
  where (payload #> '{periods,total}')
    @> '[["openclaw","gpt-5.3-codex","70","30","0","0","0"]]'::jsonb
)
update public.tokentracker_leaderboard_device_state as device
set
  payload = corrected.new_payload,
  summary_hash = encode(digest(corrected.new_payload::text, 'sha256'), 'hex'),
  updated_at = now()
from corrected
where device.user_id = corrected.user_id
  and device.device_id = corrected.device_id;
