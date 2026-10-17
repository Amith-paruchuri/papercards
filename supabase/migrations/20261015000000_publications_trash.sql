-- My publications + Trash.
-- Apply to the PaperCards Supabase project ONLY (never Choti Copy / BAALANCE). Safe to re-run.

-- A paper the user wrote (shown under "My publications").
alter table public.papers add column if not exists is_mine boolean not null default false;

-- Soft delete: deleted papers sit in Trash and are removed for good after 30 days (purged by the app).
alter table public.papers add column if not exists deleted_at timestamptz;
create index if not exists papers_owner_deleted_idx on public.papers (owner_id, deleted_at);
create index if not exists papers_owner_mine_idx on public.papers (owner_id) where is_mine;

-- Where the user's publications come from.
alter table public.profiles add column if not exists orcid text;
alter table public.profiles add column if not exists scholar_url text;
alter table public.profiles add column if not exists researchgate_url text;
alter table public.profiles add column if not exists openalex_id text;
alter table public.profiles add column if not exists publications_synced_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_orcid_format') then
    alter table public.profiles add constraint profiles_orcid_format
      check (orcid is null or orcid ~ '^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$');
  end if;
end $$;

-- Existing grants cover new columns; RLS policies on both tables are unchanged (owner only).
