# DB changes: teams and invites

Not built ([ROADMAP.md](./ROADMAP.md) open issue 6). If this gets built, the three tables are declared in `src/db/schema.ts` and `bun run db:generate` writes the migration (see [DATABASE.md](./DATABASE.md#schema-changes)); the SQL below is the design to follow. A first draft of the code (supabase-js, never wired to a route) was deleted on 2026-09-24 and stays in git history at commit `32fe79e`.

Three tables. They hang off `principals`, not off `users`, so a wallet
principal can belong to a team later without a second model.

```sql
-- A team. Exactly one owner, who is always also a row in team_members.
create table if not exists public.teams (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(name) between 1 and 80),
  owner_principal_id text not null references public.principals(id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists teams_owner_idx on public.teams(owner_principal_id);

-- Membership. The unique constraint is what makes "accept twice" a no-op
-- instead of a duplicate row.
create table if not exists public.team_members (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  principal_id  text not null references public.principals(id) on delete cascade,
  role          text not null check (role in ('owner','admin','member')),
  joined_at     timestamptz not null default now(),
  unique (team_id, principal_id)
);

create index if not exists team_members_principal_idx
  on public.team_members(principal_id);

-- Invites. The raw token is never stored: only its sha256, exactly like
-- api_keys.token_hash. token_hash is unique so a lookup is a single
-- indexed read and a replayed accept loses the race.
create table if not exists public.team_invites (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  email         text not null check (position('@' in email) > 1),
  role          text not null check (role in ('admin','member')),
  token_hash    text not null unique,
  invited_by_principal_id text not null references public.principals(id) on delete cascade,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by_principal_id text references public.principals(id) on delete set null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists team_invites_team_idx on public.team_invites(team_id);

-- One live invite per email per team. Partial index so revoked and
-- accepted invites do not block re-inviting someone.
create unique index if not exists team_invites_live_email_idx
  on public.team_invites(team_id, lower(email))
  where accepted_at is null and revoked_at is null;
```

## Why the invite role check excludes 'owner'

An invite can only grant `admin` or `member`. Ownership transfer is a
separate, deliberate action; letting an invite mint an owner would make an
account takeover one leaked link away.

## RLS

The code queries through the Drizzle client, which bypasses RLS, and scopes
by `principal_id` in the query itself. That matches how `social_accounts` and
`scheduled_posts` are already handled. If you later expose these tables to
the anon key, they need RLS policies first.

## Verifying afterwards

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('teams','team_members','team_invites');

select indexname from pg_indexes
where schemaname = 'public' and tablename = 'team_invites';
```
