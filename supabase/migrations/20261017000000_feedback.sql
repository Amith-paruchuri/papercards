-- Feedback for PaperCards and Choti Copy, sent from the public /feedback page.
-- Anyone (signed in or not) can send; only the people listed in feedback_admins can read or triage it.

create table if not exists public.feedback_admins (
  email text primary key check (email = lower(email))
);
alter table public.feedback_admins enable row level security;
-- No policies: the list is only read through is_feedback_admin() below.

insert into public.feedback_admins (email) values
  ('p.v.saiamith@gmail.com'),
  ('paruchuri.3833@aiims.edu')
on conflict do nothing;

create or replace function public.is_feedback_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.feedback_admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );
$$;
revoke all on function public.is_feedback_admin() from public;
grant execute on function public.is_feedback_admin() to anon, authenticated;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product text not null check (product in ('papercards', 'choticopy', 'both')),
  kind text not null check (kind in ('bug', 'idea', 'love', 'other')),
  rating smallint check (rating between 1 and 5),
  message text not null check (char_length(message) between 3 and 5000),
  name text check (char_length(name) <= 120),
  email text check (char_length(email) <= 254),
  role text check (char_length(role) <= 80),
  page text check (char_length(page) <= 500),
  user_agent text check (char_length(user_agent) <= 400),
  user_id uuid default auth.uid(),
  status text not null default 'new' check (status in ('new', 'planned', 'in_progress', 'done', 'wont_do')),
  admin_note text check (char_length(admin_note) <= 4000),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_created_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists feedback_insert_anyone on public.feedback;
create policy feedback_insert_anyone on public.feedback for insert to anon, authenticated
  with check (status = 'new' and admin_note is null and (user_id is null or user_id = auth.uid()));

drop policy if exists feedback_admin_select on public.feedback;
create policy feedback_admin_select on public.feedback for select to authenticated using (public.is_feedback_admin());

drop policy if exists feedback_admin_update on public.feedback;
create policy feedback_admin_update on public.feedback for update to authenticated
  using (public.is_feedback_admin()) with check (public.is_feedback_admin());

drop policy if exists feedback_admin_delete on public.feedback;
create policy feedback_admin_delete on public.feedback for delete to authenticated using (public.is_feedback_admin());

grant insert on public.feedback to anon, authenticated;
grant select, update, delete on public.feedback to authenticated;
