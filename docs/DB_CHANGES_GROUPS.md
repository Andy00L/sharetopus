# DB changes: channel groups (agency model)

Run these yourself. Nothing in the code applies migrations.

Two tables. `social_accounts` is deliberately left untouched: a join table
keeps the grouping reversible and avoids an ALTER on the busiest table in the
schema.

```sql
-- A client bucket owned by one principal.
create table if not exists public.channel_groups (
  id           uuid primary key default gen_random_uuid(),
  principal_id text not null references public.principals(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One bucket per name per owner, so "Acme" cannot exist twice and make
  -- the picker ambiguous.
  unique (principal_id, name)
);

create index if not exists channel_groups_principal_idx
  on public.channel_groups(principal_id);

-- Which channels sit in which bucket.
create table if not exists public.channel_group_members (
  id                uuid primary key default gen_random_uuid(),
  group_id          uuid not null references public.channel_groups(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  added_at          timestamptz not null default now(),
  -- A channel belongs to at most one client. This is what makes
  -- "filter by group" a partition rather than an overlapping tag.
  unique (social_account_id)
);

create index if not exists channel_group_members_group_idx
  on public.channel_group_members(group_id);
```

## Why `unique (social_account_id)` and not `unique (group_id, social_account_id)`

The agency model is one client per channel. A composite unique would let the
same channel sit in two client buckets, and every "post to Acme's channels"
query would then double-count it. Moving a channel between groups is an
update of the existing row, not a second insert.

## RLS

All access goes through `adminSupabase` (service role) with an explicit
`principal_id` filter in the query, matching how `social_accounts` and
`scheduled_posts` are handled. Add RLS policies before exposing these tables
to the anon key.

## Verifying afterwards

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name in ('channel_groups','channel_group_members');

select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'channel_group_members';
```

## Type edit

Already done by hand in `src/lib/types/database.types.ts` (that file is never
regenerated). The code compiles today and returns errors as values until you
run the SQL above.
