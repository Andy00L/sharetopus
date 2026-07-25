# DB changes: provider registry

Run these yourself. Nothing in the code applies migrations.

## Step 0: find out what `platform` actually is

Memory says the live constraint was never verified, so check before writing.
This tells you whether `platform` is a Postgres enum or a text column with a
CHECK constraint, and the two paths below differ.

```sql
select
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name
from information_schema.columns c
where c.column_name = 'platform'
  and c.table_schema = 'public'
order by c.table_name;
```

- `data_type = 'USER-DEFINED'` and a `udt_name` like `platform` means it is an
  **enum**. Use path A.
- `data_type = 'text'` means it is a text column, almost certainly with a CHECK
  constraint. Use path B after listing the constraints:

```sql
select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
from pg_constraint
where contype = 'c'
  and pg_get_constraintdef(oid) ilike '%linkedin%';
```

## Path A: `platform` is an enum

Enum values cannot be added inside a transaction block that also uses them, and
they cannot be removed. Add all twenty in one go.

```sql
alter type platform add value if not exists 'bluesky';
alter type platform add value if not exists 'mastodon';
alter type platform add value if not exists 'telegram';
alter type platform add value if not exists 'discord';
alter type platform add value if not exists 'slack';
alter type platform add value if not exists 'devto';
alter type platform add value if not exists 'wordpress';
alter type platform add value if not exists 'reddit';
alter type platform add value if not exists 'tumblr';
alter type platform add value if not exists 'twitch';
alter type platform add value if not exists 'kick';
alter type platform add value if not exists 'hashnode';
alter type platform add value if not exists 'medium';
alter type platform add value if not exists 'lemmy';
alter type platform add value if not exists 'farcaster';
alter type platform add value if not exists 'listmonk';
alter type platform add value if not exists 'nostr';
alter type platform add value if not exists 'linkedin_page';
alter type platform add value if not exists 'dribbble';
alter type platform add value if not exists 'gmb';
-- 'threads' already exists in the union.
```

Note the ordering: `add value` appends to the end of the enum, which changes
nothing for equality checks but does change `order by platform`. If any query
sorts by that column and you care about the order, sort by label instead.

## Path B: `platform` is text with a CHECK constraint

Run this per table that has the constraint (the query in step 0 lists them,
expect `social_accounts`, `scheduled_posts`, `failed_posts`, `content_history`,
`social_connections`, and possibly `pending_direct_posts` and
`pending_tiktok_pulls`).

```sql
-- Replace <table> and <constraint_name> from the step 0 output.
alter table public.<table> drop constraint <constraint_name>;
alter table public.<table> add constraint <constraint_name>
  check (platform in (
    'linkedin','tiktok','pinterest','instagram','facebook','threads','youtube','x',
    'bluesky','mastodon','telegram','discord','slack','devto','wordpress',
    'reddit','tumblr','twitch','kick','hashnode','medium','lemmy','farcaster','listmonk',
    'nostr','linkedin_page','dribbble','gmb'
  ));
```

## No other schema change is needed for any of these providers

Provider configuration (Mastodon instance URL, Telegram chat ID, Discord
channel and guild IDs, Bluesky DID and service URL, Slack channel and team,
WordPress site URL) is stored in the existing
`social_accounts.extra` JSONB column. The posting credential goes in the
existing `access_token` column, and `refresh_token` / `token_expires_at` cover
Bluesky's session refresh. Nothing new is required.

`extra` is already `Json` in `src/lib/types/database.types.ts`, so no type edit
is needed for it either.

## After you run the SQL

Tell me and I will make the matching surgical edit to
`src/lib/types/database.types.ts`: adding the seven values to the `Platform`
union and to the `social_accounts` / `scheduled_posts` row and insert types.
Per your standing rule I will not regenerate that file, only edit those unions
by hand.

Until that edit lands, the new providers compile and run in isolation but
cannot be written to `social_accounts`, because the row type still rejects
their platform values.

## Verifying afterwards

```sql
-- Path A
select unnest(enum_range(null::platform));

-- Path B
select pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.social_accounts'::regclass and contype = 'c';
```

## Still to come (not yet needed)

Teams and invites, and the agency Groups model, both need new tables. I will
write that DDL when I build those features rather than guessing at it now.
