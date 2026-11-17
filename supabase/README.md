# Rinova Learn: Supabase setup

## 1. Create the project
1. Go to <https://supabase.com> > **New project**. Pick a region near your users and a strong database password (store it safely, you will not need it in the website).
2. Open **Project Settings > API** and copy:
   - **Project URL**
   - **anon public** key (this one is safe in the browser)
   - Do **not** copy or use the `service_role` key anywhere in the website.

## 2. Run the migrations (in order)
Dashboard > **SQL Editor** > New query > paste each file and press **Run**:

1. `migrations/001_schema.sql`
2. `migrations/002_helpers_triggers.sql`
3. `migrations/003_rls.sql`
4. `migrations/004_storage.sql`
5. `migrations/005_rpc_views.sql`
6. `migrations/006_grants.sql`
7. `migrations/007_phase4_courses.sql` (added in Phase 4: locks down internal functions, enrollment notifications)
8. `migrations/008_phase5_content.sql` (added in Phase 5: students can no longer read files of draft lessons)
9. `migrations/009_phase6_live.sql` (added in Phase 6: https-only meeting links, one attendance session per live class, class change notifications, per-session attendance counts)
10. `migrations/010_phase7_assignments.sql` (added in Phase 7: stricter submission rules, teacher notifications, private assignment and submission files)
11. `migrations/011_phase8_quizzes.sql` (added in Phase 8: quiz limits, publish checks, one open attempt per student, server-side scoring and review, teacher and student notifications)
12. `migrations/012_phase9_communication.sql` (added in Phase 9: announcement and message limits, spam brake, one unread notification per chat, chat list and thread functions, Realtime for messages and notifications)
13. `migrations/013_phase10_reports.sql` (added in Phase 10: read-only report and grade functions; students only ever see their own numbers)
14. `migrations/014_phase13_early_warning.sql` (added for the Needs attention list: read-only warning signs for teachers and a rate-limited nudge to a student)
15. `migrations/015_phase14_unlock_rules.sql` (added for unlock rules: locked lessons are hidden from students by Row Level Security, plus the learning-path functions)
16. `migrations/016_phase15_mastery.sql` (topics, tags on lessons and quiz questions, and the mastery functions; students only see their own mastery)
17. `migrations/017_phase16_lesson_questions.sql` (questions and replies under a lesson, optionally tied to a video time, with teacher notifications)
18. `migrations/018_phase17_live_pulse.sql` (anonymous "I'm lost" pulse and live polls during a class)

## 3. Authentication settings
Dashboard > **Authentication**:
- **Providers > Email**: enabled. Keep "Confirm email" on.
- **URL Configuration**: Site URL = your GitHub Pages address (e.g. `https://USER.github.io/rinova-learn/`). Add the same address, and `http://localhost:5500/*` for local testing, to **Redirect URLs**.
- Password policy: minimum 8 characters.

## 4. Create the first admin
1. Open your site (or Authentication > Users > **Add user**) and create an account for yourself.
2. In the SQL Editor run (replace the email):
   ```sql
   update public.profiles set role = 'admin' where email = 'you@example.com';
   ```
   (The SQL editor is trusted, so the role guard allows this one-off bootstrap.)
3. From then on admins create teacher accounts from the Admin panel (Phase 3), which calls the `create-user` Edge Function.

## 5. Deploy the Edge Function (needed for admin-created accounts)
Install the Supabase CLI (<https://supabase.com/docs/guides/cli>), then:
```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy create-user
supabase secrets set ALLOWED_ORIGIN=https://USER.github.io
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the function by Supabase automatically. The service key never touches the website.

## 6. Realtime
Migration 012 turns on realtime for `messages` and `notifications`. Check under Dashboard > **Database > Replication** that both are listed. Row Level Security still decides who receives which row.

## 7. Storage
Migration 004 creates the buckets. Supabase limits uploads project-wide (50 MB on the free plan), so large lesson videos need a paid plan, or use the YouTube/Vimeo embed option.

## Tests (optional, local only)
`tests/run_tests.sh` builds a throw-away local Postgres database with a small Supabase stand-in (`tests/00_supabase_shim.sql`) and runs `tests/10_rls_tests.sql`, which impersonates every role and checks what each can and cannot do (140 checks). **Never run the shim or tests against your real Supabase project.**
