-- Generated from src/db/schema.ts on 2026-09-25 (REST_AUDIT_OUTCOMES gained
-- client_error), then edited by hand: the lock timeout is not expressible
-- in schema.ts.
--
-- withRestEndpoint recorded every 4xx other than 400, 401, 403 and 429
-- (404 not found, 409 conflict) as internal_error, so client mistakes
-- showed up as server failures. They now record client_error. Every
-- existing row already holds one of the old values, so the new check
-- validates without a data change.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "rest_audit_log" DROP CONSTRAINT "rest_audit_log_outcome_check";--> statement-breakpoint
ALTER TABLE "rest_audit_log" ADD CONSTRAINT "rest_audit_log_outcome_check" CHECK (outcome = ANY (ARRAY['success'::text, 'validation_error'::text, 'auth_error'::text, 'rate_limited'::text, 'client_error'::text, 'internal_error'::text]));
