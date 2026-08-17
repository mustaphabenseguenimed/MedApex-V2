-- 1. Extend questions with exam metadata
alter table public.questions
  add column if not exists exam_year integer,
  add column if not exists exam_source text; -- 'externat_p1' | 'externat_p2' | 'externat_p3' | 'residanat' | null

create index if not exists questions_exam_year_idx on public.questions(exam_year);
create index if not exists questions_exam_source_idx on public.questions(exam_source);

-- 2. Extend qcm_sessions with mode + timing + filter snapshot
alter table public.qcm_sessions
  add column if not exists mode text not null default 'training',
  add column if not exists time_limit_seconds integer,
  add column if not exists duration_seconds integer,
  add column if not exists filters jsonb not null default '{}'::jsonb;

-- 3. Per-user per-question spaced repetition memory
create table if not exists public.question_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  ease numeric not null default 2.5,
  interval_days numeric not null default 0,
  repetitions integer not null default 0,
  lapses integer not null default 0,
  last_grade smallint,
  last_correct boolean,
  last_reviewed_at timestamptz,
  due_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
grant select, insert, update, delete on public.question_progress to authenticated;
grant all on public.question_progress to service_role;
alter table public.question_progress enable row level security;
create policy "own progress" on public.question_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists question_progress_due_idx on public.question_progress(user_id, due_at);

-- 4. Flags (bookmark or report a question)
create table if not exists public.question_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, question_id)
);
grant select, insert, update, delete on public.question_flags to authenticated;
grant all on public.question_flags to service_role;
alter table public.question_flags enable row level security;
create policy "own flags" on public.question_flags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 5. Personal notes per question
create table if not exists public.question_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
grant select, insert, update, delete on public.question_notes to authenticated;
grant all on public.question_notes to service_role;
alter table public.question_notes enable row level security;
create policy "own notes" on public.question_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
