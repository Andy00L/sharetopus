BEGIN;

-- scheduled_posts: drop existing CHECK by lookup (name may have
-- been auto-generated), recreate with 'queued' added.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.scheduled_posts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%scheduled%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.scheduled_posts DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE public.scheduled_posts
    ADD CONSTRAINT scheduled_posts_status_check
    CHECK (status IN ('scheduled','queued','processing','posted','failed','cancelled'));
END $$;

-- failed_posts: same treatment. failed_posts inherits via LIKE
-- INCLUDING ALL with an auto-generated name; lookup-then-drop.
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.failed_posts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%scheduled%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.failed_posts DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE public.failed_posts
    ADD CONSTRAINT failed_posts_status_check
    CHECK (status IN ('scheduled','queued','processing','posted','failed','cancelled'));
END $$;

-- Update partial indexes that reference status, so dispatched-but-
-- not-yet-claimed rows stay in the planner's hot path.
DROP INDEX IF EXISTS public.idx_scheduled_posts_status_due;
CREATE INDEX idx_scheduled_posts_status_due
  ON public.scheduled_posts (status, scheduled_at)
  WHERE status IN ('scheduled','queued','processing');

DROP INDEX IF EXISTS public.idx_scheduled_posts_principal_platform_window;
CREATE INDEX idx_scheduled_posts_principal_platform_window
  ON public.scheduled_posts (principal_id, platform, scheduled_at)
  WHERE status IN ('scheduled','queued','processing');

COMMIT;
