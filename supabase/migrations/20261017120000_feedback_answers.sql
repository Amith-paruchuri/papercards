-- App-specific questions on the feedback form (Anki vs Choti Copy, Zotero vs PaperCards, ...).
-- Answers are stored as JSON ({question_id: "option"} or {question_id: ["option", ...]}).
-- A response may now be answers only, with no written message.
alter table public.feedback add column if not exists answers jsonb not null default '{}'::jsonb;

alter table public.feedback drop constraint if exists feedback_message_check;
alter table public.feedback alter column message set default '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_message_len') then
    alter table public.feedback add constraint feedback_message_len check (char_length(message) <= 5000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_has_content') then
    alter table public.feedback add constraint feedback_has_content check (char_length(message) >= 3 or answers <> '{}'::jsonb);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_answers_size') then
    alter table public.feedback add constraint feedback_answers_size check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 4000);
  end if;
end $$;
