-- Atomic quota increment: closes the read-then-upsert race in
-- checkAndIncrementQuota (src/lib/mcp/entitlement.ts).
--
-- TODO: run `npx supabase gen types typescript` to regenerate
-- database.types.ts after applying this migration.

create or replace function atomic_increment_quota(
  _principal_id text,
  _period text,
  _action text,
  _cap integer
)
returns integer
language plpgsql
as $$
declare
  _new_count integer;
begin
  insert into usage_quotas (principal_id, period, action, count)
  values (_principal_id, _period, _action, 1)
  on conflict (principal_id, period, action)
  do update set count = usage_quotas.count + 1
  where usage_quotas.count < _cap
  returning count into _new_count;

  return _new_count;
end;
$$;

grant execute on function atomic_increment_quota(text, text, text, integer) to service_role;
