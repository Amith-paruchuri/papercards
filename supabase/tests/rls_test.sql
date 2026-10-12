-- RLS isolation test: user A's data must be invisible and untouchable for user B.
\set ON_ERROR_STOP on
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
insert into auth.users values ('aaaaaaaa-0000-0000-0000-000000000001','a@test.dev'),('bbbbbbbb-0000-0000-0000-000000000002','b@test.dev');

-- ---- user A creates data
set role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
insert into public.papers (id, title, authors, year, doi, abstract, subjects)
  values ('11111111-0000-0000-0000-000000000001','Deep learning for oral cancer histopathology',
          '[{"family":"Paruchuri","given":"Amith"},{"family":"Madabhushi","given":"Anant"}]', 2025, '10.1000/xyz', 'Whole slide images of oral squamous cell carcinoma.', '{pathology}');
insert into public.collections (id, name) values ('22222222-0000-0000-0000-000000000001','Oral pathology');
insert into public.tags (id, name) values ('33333333-0000-0000-0000-000000000001','OSCC');
insert into public.collection_papers (collection_id, paper_id) values ('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001');
insert into public.paper_tags (paper_id, tag_id) values ('11111111-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001');
insert into public.highlights (paper_id, section_id, page, text, rects)
  select '11111111-0000-0000-0000-000000000001', id, 1, 'key finding', '[{"x":0.1,"y":0.1,"w":0.5,"h":0.02}]'
  from public.note_sections where title='Results';
insert into storage.objects (bucket_id, name) values ('pdfs','aaaaaaaa-0000-0000-0000-000000000001/11111111-0000-0000-0000-000000000001.pdf');

do $$ begin
  assert (select count(*) from public.note_sections) = 4, 'default sections created';
  assert (select count(*) from public.papers where search @@ to_tsquery('english','oral & carcinoma')) = 1, 'full text search on abstract';
  assert (select count(*) from public.papers where search @@ to_tsquery('english','madabhushi')) = 1, 'full text search on authors';
  assert (select count(*) from public.papers where search @@ to_tsquery('english','histopath:*')) = 1, 'prefix search';
end $$;

-- duplicate DOI for same owner is rejected
do $$ begin
  begin insert into public.papers (title, doi) values ('dup','10.1000/xyz'); raise exception 'dup DOI allowed';
  exception when unique_violation then null; end;
end $$;

-- ---- user B
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
do $$ begin
  assert (select count(*) from public.papers) = 0, 'B cannot see A papers';
  assert (select count(*) from public.collections) = 0, 'B cannot see A collections';
  assert (select count(*) from public.tags) = 0, 'B cannot see A tags';
  assert (select count(*) from public.note_sections) = 0, 'B cannot see A notes';
  assert (select count(*) from public.highlights) = 0, 'B cannot see A highlights';
  assert (select count(*) from public.collection_papers) = 0, 'B cannot see A memberships';
  assert (select count(*) from storage.objects) = 0, 'B cannot see A pdfs';
end $$;

-- B cannot modify or delete A's rows (silently 0 rows)
update public.papers set title='hacked' where id='11111111-0000-0000-0000-000000000001';
delete from public.papers where id='11111111-0000-0000-0000-000000000001';

-- B can create own paper and may reuse the same DOI (uniqueness is per owner)
insert into public.papers (id, title, doi) values ('11111111-0000-0000-0000-000000000002','B paper','10.1000/xyz');
insert into public.tags (id, name) values ('33333333-0000-0000-0000-000000000002','OSCC');

-- B cannot link A's paper into B's collection/tag, impersonate A, or write into A's storage folder
do $$
declare blocked int := 0;
begin
  begin insert into public.paper_tags (paper_id, tag_id) values ('11111111-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000002');
  exception when insufficient_privilege then blocked := blocked + 1; end;
  begin insert into public.paper_tags (paper_id, tag_id) values ('11111111-0000-0000-0000-000000000002','33333333-0000-0000-0000-000000000001');
  exception when insufficient_privilege then blocked := blocked + 1; end;
  begin insert into public.collection_papers (collection_id, paper_id) values ('22222222-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002');
  exception when insufficient_privilege then blocked := blocked + 1; end;
  begin insert into public.papers (title, owner_id) values ('spoof','aaaaaaaa-0000-0000-0000-000000000001');
  exception when insufficient_privilege then blocked := blocked + 1; end;
  begin insert into public.highlights (paper_id, page, text) values ('11111111-0000-0000-0000-000000000001',1,'x');
  exception when insufficient_privilege then blocked := blocked + 1; end;
  begin insert into public.note_sections (paper_id, title) values ('11111111-0000-0000-0000-000000000001','x');
  exception when insufficient_privilege then blocked := blocked + 1; end;
  begin insert into storage.objects (bucket_id, name) values ('pdfs','aaaaaaaa-0000-0000-0000-000000000001/evil.pdf');
  exception when insufficient_privilege then blocked := blocked + 1; end;
  begin insert into public.highlights (paper_id, section_id, page, text)
    select '11111111-0000-0000-0000-000000000002', id, 1, 'x' from public.note_sections limit 0; -- no-op sanity
  end;
  assert blocked = 7, format('expected 7 blocked writes, got %s', blocked);
end $$;

-- ---- back to A: data intact
select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
do $$ begin
  assert (select title from public.papers where id='11111111-0000-0000-0000-000000000001') = 'Deep learning for oral cancer histopathology', 'A paper untouched';
  assert (select count(*) from public.papers) = 1, 'A sees only own paper';
end $$;

-- cascade: deleting the paper removes its sections, highlights, memberships
delete from public.papers where id='11111111-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.note_sections) = 0 and (select count(*) from public.highlights) = 0
     and (select count(*) from public.paper_tags) = 0 and (select count(*) from public.collection_papers) = 0, 'cascade delete';
end $$;

-- anon sees nothing
reset role; set role anon;
do $$ begin
  begin perform 1 from public.papers; raise exception 'anon could read papers';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'ALL RLS TESTS PASSED' as result;
