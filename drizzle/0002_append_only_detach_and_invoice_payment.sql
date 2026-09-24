-- Generated from src/db/schema.ts on 2026-09-24 (the DROP NOT NULL), then
-- edited by hand: the lock timeout and the function and trigger changes are
-- not expressible in schema.ts.
--
-- 1. Deleting a user failed whenever an append-only table held one of their
--    rows: ON DELETE SET NULL nulls the row's foreign key with an UPDATE, and
--    reject_mutation refused every UPDATE. Its trigger arguments now name the
--    foreign key columns ON DELETE SET NULL may null. Such an update has to
--    run inside the foreign key's own trigger and change nothing else.
-- 2. stripe_invoices: an invoice whose payment failed and was later paid may
--    turn from failed to succeeded, and user_id may be nulled when the user is
--    deleted (the column was NOT NULL, which its ON DELETE SET NULL
--    contradicted). Deletes stay refused.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "stripe_invoices" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.reject_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('app.allow_append_only_delete', true), 'off') = 'on' then
    return old;
  end if;
  -- ON DELETE SET NULL updates the row from inside the foreign key's
  -- trigger, so pg_trigger_depth() is above 1. It may only null the columns
  -- named in the trigger arguments. Generated columns are skipped: a BEFORE
  -- trigger sees them unset in NEW.
  if tg_op = 'UPDATE' and tg_nargs > 0 and pg_trigger_depth() > 1 and not exists (
    select 1
    from jsonb_each(to_jsonb(new)) as new_field
    where new_field.value is distinct from to_jsonb(old) -> new_field.key
      and (new_field.key <> all (tg_argv) or jsonb_typeof(new_field.value) <> 'null')
      and new_field.key not in (
        select generated_column.attname::text
        from pg_catalog.pg_attribute as generated_column
        where generated_column.attrelid = tg_relid and generated_column.attgenerated <> ''
      )
  ) then
    return new;
  end if;
  raise exception 'Table % is append-only; UPDATE/DELETE not permitted', tg_table_name;
end;
$function$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.stripe_invoices_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path = ''
AS $function$
begin
  -- Two updates are allowed, each limited to its own columns: a failed
  -- invoice that is later paid becomes succeeded (status, amount, currency),
  -- and deleting the user nulls user_id (ON DELETE SET NULL, which runs
  -- inside the foreign key's trigger).
  if not exists (
    select 1
    from jsonb_each(to_jsonb(new)) as new_field
    where new_field.value is distinct from to_jsonb(old) -> new_field.key
      and not (
        (old.status = 'failed' and new.status = 'succeeded'
          and new_field.key in ('status', 'amount_paid_cents', 'currency'))
        or (pg_trigger_depth() > 1 and new_field.key = 'user_id'
          and jsonb_typeof(new_field.value) = 'null')
      )
  ) then
    return new;
  end if;
  raise exception 'stripe_invoices is append-only: only a failed invoice may become succeeded';
end;
$function$;--> statement-breakpoint
DROP TRIGGER "block_stripe_invoices_mutation" ON "stripe_invoices";--> statement-breakpoint
CREATE TRIGGER "block_stripe_invoices_mutation" BEFORE DELETE ON "stripe_invoices" FOR EACH ROW EXECUTE FUNCTION public.reject_mutation();--> statement-breakpoint
CREATE TRIGGER "guard_stripe_invoices_update" BEFORE UPDATE ON "stripe_invoices" FOR EACH ROW EXECUTE FUNCTION public.stripe_invoices_guard();--> statement-breakpoint
DROP TRIGGER "block_audit_mutation" ON "mcp_audit_log";--> statement-breakpoint
CREATE TRIGGER "block_audit_mutation" BEFORE DELETE OR UPDATE ON "mcp_audit_log" FOR EACH ROW EXECUTE FUNCTION public.reject_mutation('principal_id', 'api_key_id', 'oauth_client_id');--> statement-breakpoint
DROP TRIGGER "block_x402_log_mutation" ON "x402_access_log";--> statement-breakpoint
CREATE TRIGGER "block_x402_log_mutation" BEFORE DELETE OR UPDATE ON "x402_access_log" FOR EACH ROW EXECUTE FUNCTION public.reject_mutation('principal_id', 'wallet_id', 'charge_id');--> statement-breakpoint
DROP TRIGGER "block_refunds_mutation" ON "x402_refunds";--> statement-breakpoint
CREATE TRIGGER "block_refunds_mutation" BEFORE DELETE OR UPDATE ON "x402_refunds" FOR EACH ROW EXECUTE FUNCTION public.reject_mutation('initiated_by');
