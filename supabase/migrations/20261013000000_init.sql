-- PaperCards initial schema.
-- Every table has row-level security; every row is owned by one user (owner_id = auth.uid()).
-- Apply to the PaperCards Supabase project ONLY (never Choti Copy / BAALANCE).

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.paper_status as enum ('to_read', 'reading', 'read', 'annotated');
create type public.study_type as enum (
  'original', 'review', 'systematic_review', 'meta_analysis', 'case_report', 'preprint', 'other'
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile row whenever a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, ''), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- papers (cards)
-- ---------------------------------------------------------------------------
create table public.papers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default 'Untitled',
  authors jsonb not null default '[]'::jsonb,          -- [{ "family": "...", "given": "..." }]
  year integer check (year is null or year between 1000 and 3000),
  journal text,
  volume text,
  issue text,
  pages text,
  publisher text,
  doi text,
  url text,
  abstract text,
  item_type text not null default 'article',           -- article | book | chapter | preprint | thesis | other
  study_type public.study_type,
  site text,                                            -- study site / country
  subjects text[] not null default '{}',
  status public.paper_status not null default 'to_read',
  priority smallint not null default 0 check (priority between 0 and 3),
  pdf_path text,                                        -- storage path in bucket "pdfs": {owner_id}/{paper_id}.pdf
  pdf_sha256 text,
  pdf_size bigint,
  legacy_id text,                                       -- id from the single-file prototype, for idempotent import
  search tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint papers_authors_is_array check (jsonb_typeof(authors) = 'array'),
  constraint papers_doi_lowercase check (doi is null or doi = lower(doi))
);

create unique index papers_owner_doi_key on public.papers (owner_id, doi) where doi is not null;
create unique index papers_owner_legacy_key on public.papers (owner_id, legacy_id) where legacy_id is not null;
create index papers_owner_updated_idx on public.papers (owner_id, updated_at desc);
create index papers_owner_status_idx on public.papers (owner_id, status);
create index papers_search_idx on public.papers using gin (search);

create or replace function public.papers_search_refresh()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  author_text text;
begin
  select coalesce(string_agg(coalesce(a ->> 'given', '') || ' ' || coalesce(a ->> 'family', ''), ' '), '')
    into author_text
    from jsonb_array_elements(coalesce(new.authors, '[]'::jsonb)) as a;

  new.search :=
       setweight(to_tsvector('english'::regconfig, coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english'::regconfig, author_text), 'A')
    || setweight(to_tsvector('english'::regconfig,
         coalesce(new.journal, '') || ' ' || coalesce(new.doi, '') || ' ' ||
         coalesce(new.year::text, '') || ' ' || coalesce(new.site, '') || ' ' ||
         array_to_string(coalesce(new.subjects, '{}'), ' ')), 'B')
    || setweight(to_tsvector('english'::regconfig, coalesce(new.abstract, '')), 'C');
  return new;
end;
$$;

create trigger papers_search_refresh
  before insert or update of title, authors, journal, doi, year, site, subjects, abstract on public.papers
  for each row execute function public.papers_search_refresh();

create trigger papers_updated_at before update on public.papers
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- collections (decks) and membership
-- ---------------------------------------------------------------------------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  parent_id uuid references public.collections (id) on delete set null,
  summary text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collections_not_own_parent check (parent_id is null or parent_id <> id)
);

create index collections_owner_idx on public.collections (owner_id, position);

create trigger collections_updated_at before update on public.collections
  for each row execute function public.set_updated_at();

create table public.collection_papers (
  collection_id uuid not null references public.collections (id) on delete cascade,
  paper_id uuid not null references public.papers (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (collection_id, paper_id)
);

create index collection_papers_paper_idx on public.collection_papers (paper_id);
create index collection_papers_owner_idx on public.collection_papers (owner_id);

-- ---------------------------------------------------------------------------
-- tags (labels) and membership
-- ---------------------------------------------------------------------------
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text,
  created_at timestamptz not null default now()
);

create unique index tags_owner_name_key on public.tags (owner_id, lower(name));

create table public.paper_tags (
  paper_id uuid not null references public.papers (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (paper_id, tag_id)
);

create index paper_tags_tag_idx on public.paper_tags (tag_id);
create index paper_tags_owner_idx on public.paper_tags (owner_id);

-- ---------------------------------------------------------------------------
-- note sections (renamable summary boxes per card) and highlights
-- ---------------------------------------------------------------------------
create table public.note_sections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  paper_id uuid not null references public.papers (id) on delete cascade,
  title text not null default 'Notes',
  color text,
  position integer not null default 0,
  content_html text not null default '',
  has_notes boolean generated always as (content_html <> '' and content_html !~ '^\s*(<br\s*/?>\s*)*$') stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index note_sections_paper_idx on public.note_sections (paper_id, position);
create index note_sections_owner_idx on public.note_sections (owner_id);

create trigger note_sections_updated_at before update on public.note_sections
  for each row execute function public.set_updated_at();

-- Every new card starts with Introduction / Methods / Results / Discussion.
create or replace function public.papers_default_sections()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.note_sections (owner_id, paper_id, title, color, position)
  values
    (new.owner_id, new.id, 'Introduction', '#5ec4ee', 0),
    (new.owner_id, new.id, 'Methods',      '#7ed67e', 1),
    (new.owner_id, new.id, 'Results',      '#f0c463', 2),
    (new.owner_id, new.id, 'Discussion',   '#f0879b', 3);
  return new;
end;
$$;

create trigger papers_default_sections
  after insert on public.papers
  for each row execute function public.papers_default_sections();

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  paper_id uuid not null references public.papers (id) on delete cascade,
  section_id uuid references public.note_sections (id) on delete set null,
  page integer not null check (page >= 1),
  text text not null default '',
  color text,
  rects jsonb not null default '[]'::jsonb,              -- [{ "x": 0..1, "y": 0..1, "w": 0..1, "h": 0..1 }]
  created_at timestamptz not null default now(),
  constraint highlights_rects_is_array check (jsonb_typeof(rects) = 'array')
);

create index highlights_paper_idx on public.highlights (paper_id, page);
create index highlights_owner_idx on public.highlights (owner_id);
create index highlights_section_idx on public.highlights (section_id);

-- ---------------------------------------------------------------------------
-- Ownership helpers used by RLS (security invoker: they only see rows RLS allows)
-- ---------------------------------------------------------------------------
create or replace function public.owns_paper(p_paper_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.papers p where p.id = p_paper_id and p.owner_id = (select auth.uid()));
$$;

create or replace function public.owns_collection(p_collection_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.collections c where c.id = p_collection_id and c.owner_id = (select auth.uid()));
$$;

create or replace function public.owns_tag(p_tag_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.tags t where t.id = p_tag_id and t.owner_id = (select auth.uid()));
$$;

create or replace function public.owns_section(p_section_id uuid, p_paper_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.note_sections s
    where s.id = p_section_id and s.paper_id = p_paper_id and s.owner_id = (select auth.uid())
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.papers            enable row level security;
alter table public.collections       enable row level security;
alter table public.collection_papers enable row level security;
alter table public.tags              enable row level security;
alter table public.paper_tags        enable row level security;
alter table public.note_sections     enable row level security;
alter table public.highlights        enable row level security;

-- profiles: a user sees and edits only their own profile (created by trigger).
create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy profiles_delete_own on public.profiles for delete to authenticated
  using (id = (select auth.uid()));

-- papers
create policy papers_select_own on public.papers for select to authenticated
  using (owner_id = (select auth.uid()));
create policy papers_insert_own on public.papers for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy papers_update_own on public.papers for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy papers_delete_own on public.papers for delete to authenticated
  using (owner_id = (select auth.uid()));

-- collections (a parent must also be yours)
create policy collections_select_own on public.collections for select to authenticated
  using (owner_id = (select auth.uid()));
create policy collections_insert_own on public.collections for insert to authenticated
  with check (owner_id = (select auth.uid()) and (parent_id is null or public.owns_collection(parent_id)));
create policy collections_update_own on public.collections for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and (parent_id is null or public.owns_collection(parent_id)));
create policy collections_delete_own on public.collections for delete to authenticated
  using (owner_id = (select auth.uid()));

-- collection_papers (both sides must be yours)
create policy collection_papers_select_own on public.collection_papers for select to authenticated
  using (owner_id = (select auth.uid()));
create policy collection_papers_insert_own on public.collection_papers for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.owns_collection(collection_id) and public.owns_paper(paper_id));
create policy collection_papers_update_own on public.collection_papers for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.owns_collection(collection_id) and public.owns_paper(paper_id));
create policy collection_papers_delete_own on public.collection_papers for delete to authenticated
  using (owner_id = (select auth.uid()));

-- tags
create policy tags_select_own on public.tags for select to authenticated
  using (owner_id = (select auth.uid()));
create policy tags_insert_own on public.tags for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy tags_update_own on public.tags for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy tags_delete_own on public.tags for delete to authenticated
  using (owner_id = (select auth.uid()));

-- paper_tags (both sides must be yours)
create policy paper_tags_select_own on public.paper_tags for select to authenticated
  using (owner_id = (select auth.uid()));
create policy paper_tags_insert_own on public.paper_tags for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.owns_paper(paper_id) and public.owns_tag(tag_id));
create policy paper_tags_update_own on public.paper_tags for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.owns_paper(paper_id) and public.owns_tag(tag_id));
create policy paper_tags_delete_own on public.paper_tags for delete to authenticated
  using (owner_id = (select auth.uid()));

-- note_sections (the paper must be yours)
create policy note_sections_select_own on public.note_sections for select to authenticated
  using (owner_id = (select auth.uid()));
create policy note_sections_insert_own on public.note_sections for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.owns_paper(paper_id));
create policy note_sections_update_own on public.note_sections for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and public.owns_paper(paper_id));
create policy note_sections_delete_own on public.note_sections for delete to authenticated
  using (owner_id = (select auth.uid()));

-- highlights (the paper, and the section if set, must be yours)
create policy highlights_select_own on public.highlights for select to authenticated
  using (owner_id = (select auth.uid()));
create policy highlights_insert_own on public.highlights for insert to authenticated
  with check (
    owner_id = (select auth.uid()) and public.owns_paper(paper_id)
    and (section_id is null or public.owns_section(section_id, paper_id))
  );
create policy highlights_update_own on public.highlights for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid()) and public.owns_paper(paper_id)
    and (section_id is null or public.owns_section(section_id, paper_id))
  );
create policy highlights_delete_own on public.highlights for delete to authenticated
  using (owner_id = (select auth.uid()));

-- Signed-in users reach these tables through the Data API; the RLS policies above decide which rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Anonymous visitors get nothing.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Storage: private "pdfs" bucket, files at {owner_id}/{paper_id}.pdf
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy pdfs_select_own on storage.objects for select to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pdfs_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pdfs_update_own on storage.objects for update to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy pdfs_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = (select auth.uid())::text);
