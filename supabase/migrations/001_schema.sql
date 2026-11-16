-- =====================================================================
-- Rinova Learn  |  001_schema.sql  |  enums + tables + indexes
-- Run migrations 001 -> 006 in order (Supabase Dashboard > SQL Editor).
-- No certificate tables exist by design.
-- =====================================================================

create type public.user_role          as enum ('admin','teacher','student');
create type public.user_status        as enum ('active','suspended');
create type public.course_status      as enum ('draft','published','archived');
create type public.lesson_type        as enum ('video','pdf','text');
create type public.video_source       as enum ('storage','external');
create type public.enrollment_status  as enum ('active','completed','dropped');
create type public.live_status        as enum ('scheduled','live','ended','cancelled');
create type public.attendance_status  as enum ('present','absent','late','excused');
create type public.submission_status  as enum ('submitted','graded','returned');
create type public.question_type      as enum ('single','multiple','true_false','short_text');
create type public.attempt_status     as enum ('in_progress','submitted','graded');
create type public.conversation_type  as enum ('direct','course');

-- ---------- identity ------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text not null default '',
  role         public.user_role   not null default 'student',
  status       public.user_status not null default 'active',
  avatar_url   text,
  phone        text,
  bio          text,
  last_seen_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- courses & content ---------------------------------------
create table public.courses (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) > 0),
  slug           text unique,
  description    text,
  category       text,
  level          text,
  thumbnail_path text,
  status         public.course_status not null default 'draft',
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.course_teachers (
  course_id  uuid not null references public.courses(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  is_lead    boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (course_id, teacher_id)
);
create index on public.course_teachers (teacher_id);

create table public.enrollments (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  status      public.enrollment_status not null default 'active',
  enrolled_by uuid references public.profiles(id) on delete set null default auth.uid(),
  enrolled_at timestamptz not null default now(),
  unique (course_id, student_id)
);
create index on public.enrollments (student_id);

create table public.modules (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  title       text not null,
  description text,
  position    int  not null default 0,
  created_at  timestamptz not null default now()
);
create index on public.modules (course_id, position);

create table public.lessons (
  id               uuid primary key default gen_random_uuid(),
  module_id        uuid not null references public.modules(id) on delete cascade,
  course_id        uuid not null references public.courses(id) on delete cascade, -- set by trigger
  title            text not null,
  type             public.lesson_type not null default 'video',
  video_source     public.video_source,
  video_path       text,          -- storage path inside bucket lesson-videos
  video_url        text,          -- external YouTube / Vimeo url
  content          text,
  duration_seconds int,
  position         int  not null default 0,
  is_published     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index on public.lessons (module_id, position);
create index on public.lessons (course_id);

create table public.materials (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  lesson_id   uuid references public.lessons(id) on delete cascade,
  title       text not null,
  file_path   text not null,      -- path inside bucket materials
  mime_type   text,
  size_bytes  bigint,
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index on public.materials (course_id);

create table public.lesson_progress (
  id                    uuid primary key default gen_random_uuid(),
  lesson_id             uuid not null references public.lessons(id) on delete cascade,
  course_id             uuid not null references public.courses(id) on delete cascade, -- set by trigger
  student_id            uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  completed             boolean not null default false,
  last_position_seconds int not null default 0,
  completed_at          timestamptz,
  updated_at            timestamptz not null default now(),
  unique (lesson_id, student_id)
);
create index on public.lesson_progress (student_id, course_id);

-- ---------- live classes & attendance -------------------------------
create table public.live_classes (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references public.courses(id) on delete cascade,
  title       text not null,
  description text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  room_name   text not null default ('rinova-' || replace(gen_random_uuid()::text,'-','')), -- Jitsi room
  meeting_url text,                -- optional external link (Meet / Zoom)
  status      public.live_status not null default 'scheduled',
  recording_url text,
  created_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on public.live_classes (course_id, starts_at);

create table public.attendance_sessions (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.courses(id) on delete cascade,
  live_class_id uuid references public.live_classes(id) on delete set null,
  session_date  date not null default current_date,
  title         text,
  created_by    uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now()
);
create index on public.attendance_sessions (course_id, session_date);

create table public.attendance_records (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade, -- set by trigger
  student_id uuid not null references public.profiles(id) on delete cascade,
  status     public.attendance_status not null default 'present',
  note       text,
  marked_by  uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (session_id, student_id)
);
create index on public.attendance_records (student_id, course_id);

-- ---------- assignments --------------------------------------------
create table public.assignments (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.courses(id) on delete cascade,
  module_id       uuid references public.modules(id) on delete set null,
  title           text not null,
  instructions    text,
  attachment_path text,           -- bucket assignment-files
  due_at          timestamptz,
  max_points      numeric(7,2) not null default 100 check (max_points > 0),
  allow_late      boolean not null default false,
  is_published    boolean not null default false,
  created_by      uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at      timestamptz not null default now()
);
create index on public.assignments (course_id);

create table public.submissions (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  course_id     uuid not null references public.courses(id) on delete cascade, -- set by trigger
  student_id    uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  text_answer   text,
  file_path     text,             -- bucket submissions
  submitted_at  timestamptz not null default now(),
  is_late       boolean not null default false,
  status        public.submission_status not null default 'submitted',
  grade         numeric(7,2) check (grade >= 0),
  feedback      text,
  graded_by     uuid references public.profiles(id) on delete set null,
  graded_at     timestamptz,
  unique (assignment_id, student_id),
  check (text_answer is not null or file_path is not null)
);
create index on public.submissions (course_id, status);
create index on public.submissions (student_id);

-- ---------- quizzes -------------------------------------------------
create table public.quizzes (
  id                 uuid primary key default gen_random_uuid(),
  course_id          uuid not null references public.courses(id) on delete cascade,
  title              text not null,
  description        text,
  time_limit_minutes int check (time_limit_minutes > 0),
  max_attempts       int check (max_attempts > 0),
  available_from     timestamptz,
  available_until    timestamptz,
  pass_percent       numeric(5,2) not null default 50 check (pass_percent between 0 and 100),
  shuffle_questions  boolean not null default false,
  show_results       boolean not null default true,
  is_published       boolean not null default false,
  created_by         uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now()
);
create index on public.quizzes (course_id);

create table public.quiz_questions (
  id          uuid primary key default gen_random_uuid(),
  quiz_id     uuid not null references public.quizzes(id) on delete cascade,
  type        public.question_type not null default 'single',
  prompt      text not null,
  points      numeric(6,2) not null default 1 check (points >= 0),
  position    int not null default 0,
  explanation text
);
create index on public.quiz_questions (quiz_id, position);

create table public.quiz_options (          -- NO correctness flag here
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.quiz_questions(id) on delete cascade,
  label       text not null,
  position    int not null default 0
);
create index on public.quiz_options (question_id, position);

create table public.quiz_answer_keys (      -- staff only
  question_id        uuid primary key references public.quiz_questions(id) on delete cascade,
  correct_option_ids uuid[] not null default '{}',
  accepted_text      text[] not null default '{}'
);

create table public.quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  quiz_id      uuid not null references public.quizzes(id) on delete cascade,
  course_id    uuid not null references public.courses(id) on delete cascade,
  student_id   uuid not null references public.profiles(id) on delete cascade,
  started_at   timestamptz not null default now(),
  submitted_at timestamptz,
  score        numeric(8,2),
  max_score    numeric(8,2),
  status       public.attempt_status not null default 'in_progress'
);
create index on public.quiz_attempts (quiz_id, student_id);
create index on public.quiz_attempts (course_id);

create table public.quiz_responses (
  id                  uuid primary key default gen_random_uuid(),
  attempt_id          uuid not null references public.quiz_attempts(id) on delete cascade,
  course_id           uuid not null references public.courses(id) on delete cascade,
  student_id          uuid not null references public.profiles(id) on delete cascade,
  question_id         uuid not null references public.quiz_questions(id) on delete cascade,
  selected_option_ids uuid[] not null default '{}',
  text_answer         text,
  is_correct          boolean,          -- null = awaiting manual grading
  points_awarded      numeric(6,2) not null default 0,
  unique (attempt_id, question_id)
);

-- ---------- communication ------------------------------------------
create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  course_id  uuid references public.courses(id) on delete cascade,  -- null = global
  author_id  uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  title      text not null,
  body       text not null,
  pinned     boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.announcements (course_id, created_at desc);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications (user_id, is_read, created_at desc);

create table public.conversations (
  id         uuid primary key default gen_random_uuid(),
  type       public.conversation_type not null,
  course_id  uuid references public.courses(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check ((type = 'course') = (course_id is not null))
);
create unique index conversations_one_per_course on public.conversations (course_id) where type = 'course';

create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index on public.conversation_participants (user_id);

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  body            text check (length(body) <= 4000),
  attachment_path text,
  created_at      timestamptz not null default now(),
  check (coalesce(body,'') <> '' or attachment_path is not null)
);
create index on public.messages (conversation_id, created_at);

-- ---------- system --------------------------------------------------
create table public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid,
  action     text not null,
  entity     text,
  entity_id  uuid,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (created_at desc);
