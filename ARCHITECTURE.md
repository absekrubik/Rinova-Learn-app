# Rinova Learn: Architecture, Schema, Flows & Development Plan

Status: **Proposal, awaiting approval. No application code has been written.**
Stack: HTML5, CSS3, Vanilla JavaScript (ES modules), Supabase (PostgreSQL, Auth, Storage, Realtime).
Excluded by design: certificates, certificate generation, certificate management.

---

## 1. System Architecture

### 1.1 Overview

```
 Browser (static files, no build step)
 ┌──────────────────────────────────────────────────────────┐
 │  HTML pages  ──  CSS design system  ──  ES-module JS      │
 │                                                          │
 │  pages/*  →  services/*  →  core/supabase.js (anon key)  │
 └───────────────────────────┬──────────────────────────────┘
                             │ HTTPS (supabase-js)
 ┌───────────────────────────▼──────────────────────────────┐
 │ Supabase                                                  │
 │  Auth ── JWT ──► Postgres + RLS (every table protected)   │
 │  Storage (private buckets, signed URLs, storage RLS)      │
 │  Realtime (messages, notifications, announcements)        │
 │  RPC functions (SECURITY DEFINER) for sensitive logic     │
 └──────────────────────────────────────────────────────────┘
 Hosting: any static host (Cloudflare Pages / Netlify / Vercel static / GitHub Pages)
```

Key principles

- The browser only ever holds the **anon key** and the user's JWT. The `service_role` key never appears in frontend code, the repo, or hosting config for the site.
- **All authorization lives in the database** (RLS). Frontend role checks are only for UX (hiding menus), never for security.
- Sensitive logic (quiz grading, enrollment rules, role changes) runs in **Postgres RPC functions**, so no server (Node/Express) is needed.
- No frameworks, no bundler. JS is split into ES modules loaded with `<script type="module">`. `supabase-js` is loaded from a CDN as an ES module.

### 1.2 Folder structure

```
rinova-learn/
├── index.html                  Landing / redirect by role
├── auth/
│   ├── login.html
│   ├── register.html
│   ├── forgot-password.html
│   └── reset-password.html
├── admin/        dashboard, users, courses, enrollments, announcements, reports, settings
├── teacher/      dashboard, courses, course-editor, lessons, live-classes, attendance,
│                 assignments, submissions, quizzes, gradebook, messages
├── student/      dashboard, my-courses, course-view, lesson-player, live-classes,
│                 assignments, quizzes, grades, messages, profile
├── assets/
│   ├── css/
│   │   ├── tokens.css          colors, type scale, spacing, radii, shadows, motion
│   │   ├── base.css            reset, typography
│   │   ├── components.css      buttons, inputs, cards, tables, modals, toasts, tabs
│   │   ├── layout.css          app shell, sidebar, topbar, responsive grid
│   │   └── pages/*.css
│   ├── img/                    logo-mark.svg, logo-full.svg, favicon
│   └── fonts/                  Inter (self-hosted)
├── js/
│   ├── config.js               SUPABASE_URL + ANON key only (public by design)
│   ├── core/
│   │   ├── supabase.js         single client instance
│   │   ├── auth.js             sign in/up/out, session, getProfile()
│   │   ├── guard.js            route guard: requireRole('teacher')
│   │   ├── router-nav.js       role-based sidebar rendering
│   │   ├── realtime.js         channel subscribe/unsubscribe helpers
│   │   └── utils.js            dates, formatting, debounce, escapeHtml
│   ├── ui/
│   │   ├── toast.js  modal.js  table.js  form.js  skeleton.js  empty-state.js
│   │   └── upload.js           progress-aware file uploader
│   ├── services/               one module per domain; ONLY place that calls Supabase
│   │   ├── profiles.js  courses.js  enrollments.js  modules.js  lessons.js
│   │   ├── materials.js  progress.js  live-classes.js  attendance.js
│   │   ├── assignments.js  submissions.js  quizzes.js  announcements.js
│   │   ├── notifications.js  messages.js  reports.js
│   └── pages/                  page controllers (thin: call services, render UI)
├── supabase/
│   ├── migrations/             numbered SQL files (schema, RLS, storage, functions, seed)
│   └── README.md               how to apply migrations in the Supabase SQL editor
└── docs/
```

Conventions: services return `{ data, error }`; page controllers never build raw queries; all user-supplied text is escaped before rendering (XSS); every list view has loading, empty, and error states.

### 1.3 Roles and permissions

| Capability | Admin | Teacher | Student |
|---|---|---|---|
| Manage all users, assign roles | ✅ | ❌ | ❌ |
| Create/edit courses | ✅ all | ✅ own | ❌ |
| Enroll/unenroll students | ✅ | ✅ own courses | ❌ (optional self-enroll, see §7) |
| Modules, lessons, materials | ✅ | ✅ own | 👁 enrolled, published only |
| Live classes | ✅ | ✅ own | 👁 enrolled |
| Attendance | ✅ | ✅ mark own | 👁 own record |
| Assignments | ✅ | ✅ create/grade own | submit own |
| Quizzes | ✅ | ✅ create/grade own | attempt own |
| Announcements | ✅ global + any course | ✅ own courses | 👁 relevant |
| Messaging | ✅ anyone | ✅ students of own courses + admins | ✅ teachers of enrolled courses + admins |
| Progress | ✅ all | ✅ own courses | 👁 own |

### 1.4 Authentication model

- Supabase Auth, email + password (magic link and Google can be added later).
- On signup a DB trigger creates a `profiles` row with role **`student`**, always. A user can never choose their own role.
- Admins promote users to `teacher` or `admin` from the Admin panel. This runs through an RPC that checks `is_admin()`, so no service_role is needed.
- A column-level guard (trigger) blocks anyone but an admin from changing `profiles.role` or `profiles.status`.
- After login, `guard.js` loads the profile and redirects to `/admin/`, `/teacher/` or `/student/`. Visiting another role's pages redirects back (UX only; RLS is the real wall).

---

## 2. Database Schema (PostgreSQL)

All tables use `uuid` primary keys (`gen_random_uuid()`), `created_at timestamptz default now()`, and have RLS **enabled**.

### 2.1 Enums

`user_role` (admin, teacher, student) · `user_status` (active, suspended) · `course_status` (draft, published, archived) · `lesson_type` (video, pdf, text) · `enrollment_status` (active, completed, dropped) · `attendance_status` (present, absent, late, excused) · `question_type` (single, multiple, true_false, short_text) · `attempt_status` (in_progress, submitted, graded) · `submission_status` (submitted, graded, returned) · `conversation_type` (direct, course)

### 2.2 Tables

**Identity**

| Table | Columns |
|---|---|
| `profiles` | id (pk, fk auth.users), full_name, email, role, status, avatar_url, phone, bio, last_seen_at |

**Courses & content**

| Table | Columns |
|---|---|
| `courses` | id, title, slug (unique), description, category, level, thumbnail_path, status, created_by (fk profiles) |
| `course_teachers` | course_id, teacher_id, is_lead (pk: course_id+teacher_id). Supports co-teaching |
| `enrollments` | id, course_id, student_id, status, enrolled_by, enrolled_at. Unique (course_id, student_id) |
| `modules` | id, course_id, title, description, position |
| `lessons` | id, module_id, course_id, title, type, video_source (`storage`/`external`), video_path, video_url, content (rich text), duration_seconds, position, is_published |
| `materials` | id, course_id, lesson_id (nullable), title, file_path, mime_type, size_bytes, uploaded_by |
| `lesson_progress` | id, lesson_id, course_id, student_id, completed, last_position_seconds, completed_at. Unique (lesson_id, student_id) |

**Live classes & attendance**

| Table | Columns |
|---|---|
| `live_classes` | id, course_id, title, description, starts_at, ends_at, meeting_url, status (scheduled/live/ended/cancelled), recording_url, created_by |
| `attendance_sessions` | id, course_id, live_class_id (nullable), session_date, title, created_by |
| `attendance_records` | id, session_id, student_id, status, note, marked_by. Unique (session_id, student_id) |

**Assignments**

| Table | Columns |
|---|---|
| `assignments` | id, course_id, module_id (nullable), title, instructions, attachment_path, due_at, max_points, allow_late, is_published |
| `submissions` | id, assignment_id, student_id, text_answer, file_path, submitted_at, is_late, status, grade, feedback, graded_by, graded_at. Unique (assignment_id, student_id) |

**Quizzes**

| Table | Columns |
|---|---|
| `quizzes` | id, course_id, title, description, time_limit_minutes, max_attempts, available_from, available_until, pass_percent, shuffle_questions, show_results, is_published |
| `quiz_questions` | id, quiz_id, type, prompt, points, position, explanation |
| `quiz_options` | id, question_id, label, position. **No correct flag here** |
| `quiz_answer_keys` | question_id, correct_option_ids uuid[], accepted_text text[]. **Teacher/admin only** |
| `quiz_attempts` | id, quiz_id, student_id, started_at, submitted_at, score, max_score, status |
| `quiz_responses` | id, attempt_id, question_id, selected_option_ids uuid[], text_answer, is_correct, points_awarded |

Correct answers live in a separate table students cannot read, and grading happens in the RPC `submit_quiz_attempt()`. A student therefore can never read answers from the browser's network tab.

**Communication**

| Table | Columns |
|---|---|
| `announcements` | id, course_id (null = global), author_id, title, body, pinned, created_at |
| `notifications` | id, user_id, type, title, body, link, is_read, created_at |
| `conversations` | id, type, course_id (nullable), created_by |
| `conversation_participants` | conversation_id, user_id, last_read_at |
| `messages` | id, conversation_id, sender_id, body, attachment_path, created_at |

**System**

| Table | Columns |
|---|---|
| `audit_log` | id, actor_id, action, entity, entity_id, meta jsonb, created_at (admin read only) |

### 2.3 Derived data (views / RPC, never hardcoded)

- `v_course_progress`: lessons completed ÷ published lessons per student per course.
- `v_attendance_summary`: present/late/absent counts and percentage.
- `v_gradebook`: assignment and quiz scores per student per course.
- Dashboard counts come from RPCs such as `admin_stats()`, `teacher_stats()`, `student_stats()`, so every number on a dashboard is a live query.

### 2.4 Triggers and RPCs

- `handle_new_user()`: creates the profile (role = student) on signup.
- `guard_profile_update()`: blocks non-admins from changing role/status.
- `set_user_role(user_id, role)`: admin only, writes to `audit_log`.
- `submit_quiz_attempt(attempt_id, responses)`: grades server-side, enforces time limit and attempt count.
- `start_quiz_attempt(quiz_id)`: checks enrollment, availability window, max attempts.
- Notification triggers: new announcement, assignment published, grade released, live class scheduled, new message.
- `is_late` computed by trigger on submission insert.

---

## 3. Row Level Security Plan

Helper functions (all `SECURITY DEFINER`, `STABLE`, with `search_path` pinned, to avoid recursive-policy problems):

```
current_role()          → role of auth.uid()
is_admin()
is_teacher_of(course)   → in course_teachers (or admin)
is_enrolled(course)     → active enrollment for auth.uid()
```

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| profiles | self; admin all; teachers see students in their courses; students see teachers of their courses | self update (non-role fields); admin all |
| courses | published → any signed-in user (catalog); drafts → teacher_of / admin | admin; teacher inserts and edits own |
| enrollments | own row; teacher_of(course); admin | teacher_of(course) / admin |
| modules, lessons, materials | enrolled (published only); teacher_of; admin | teacher_of / admin |
| lesson_progress | own; teacher_of; admin | student: own row only, and only if enrolled |
| live_classes | enrolled; teacher_of; admin | teacher_of / admin |
| attendance_* | student: own record; teacher_of; admin | teacher_of / admin |
| assignments | enrolled and published; teacher_of | teacher_of / admin |
| submissions | own; teacher_of | student: insert/update own before grading; teacher_of: grade |
| quizzes, questions, options | enrolled and published (options without answers); teacher_of | teacher_of / admin |
| quiz_answer_keys | teacher_of / admin only | teacher_of / admin |
| quiz_attempts / responses | own; teacher_of | via RPC only (no direct student writes) |
| announcements | global → all; course → enrolled / teacher_of | teacher_of / admin |
| notifications | own only | server triggers; user may mark own as read |
| conversations / messages | participants only | participants insert as themselves; no edits by others |
| audit_log | admin | triggers / RPC only |

Rules of the road: default-deny; one policy per operation; policies tested with a SQL test script that impersonates each role (`set local role authenticated; set local request.jwt.claims ...`).

### Storage buckets and policies

| Bucket | Visibility | Access rule |
|---|---|---|
| `avatars` | public read | write own folder `{user_id}/` |
| `course-thumbnails` | public read | teacher_of / admin write |
| `lesson-videos` | **private** | read: enrolled or teacher_of via signed URL; write: teacher_of |
| `materials` | **private** | same as videos, path `{course_id}/...` |
| `assignment-files` | **private** | teacher_of write; enrolled read |
| `submissions` | **private** | student writes/reads own `{assignment_id}/{student_id}/`; teacher_of reads |
| `message-attachments` | **private** | conversation participants only |

Paths start with `course_id`, so storage policies can reuse `is_teacher_of` / `is_enrolled`.

---

## 4. User Flows

**Student**
1. Register → lands on student dashboard (enrolled courses, upcoming live classes, due assignments, announcements, progress).
2. Open course → modules/lessons tree with progress ticks → play video (resumes where they stopped), download materials, mark complete.
3. Join live class from the schedule (opens meeting link at the allowed time).
4. Submit assignment (text and/or file) → see grade and feedback.
5. Take quiz → timer, auto-save, submit → instant score where allowed.
6. Message a teacher; receive realtime notifications.

**Teacher**
1. Dashboard: my courses, pending submissions, today's classes, recent messages.
2. Create course → add modules/lessons → upload video/PDF/materials → publish.
3. Enroll students (search/add or bulk by email).
4. Schedule live class → mark attendance.
5. Create assignment → review submissions → grade with feedback.
6. Build quiz (question bank per quiz) → publish → review attempts.
7. Post announcements; message students; view progress and gradebook.

**Admin**
1. Dashboard: users, courses, enrollments, activity (all live counts).
2. Users: search, suspend/reactivate, promote to teacher/admin.
3. Courses: view all, reassign teacher, archive.
4. Enrollments: oversee and fix.
5. Global announcements, reports (attendance, progress, grades), audit log.

---

## 5. Design System

- **Look:** Apple clarity, Linear precision, Notion calm. Near-white surfaces, a 1px hairline border, soft shadows used sparingly, 12px radii.
- **Type:** Inter (self-hosted), tight tracking on headings, 14–15px body, a 1.2 modular scale.
- **Color:** ink `#0B0B0F`, gray scale, brand blue/green/orange from the client logo (see section 8), semantic green/amber/red. Full light theme; dark theme via CSS variables in a later phase.
- **Layout:** left sidebar (collapses to bottom/drawer on mobile), slim topbar with search and notification bell, content max-width 1200px, generous whitespace.
- **Motion:** 150–220ms ease-out fades/slides, skeleton loaders, `prefers-reduced-motion` respected.
- **Accessibility:** WCAG AA contrast, visible focus rings, keyboard navigation, labelled inputs.
- **Responsive:** mobile-first; breakpoints 640 / 1024 / 1280.

**Logo:** the client logo replaces my draft. (Draft, retired: `logo-mark.svg` (app icon / favicon) and `logo-full.svg` (mark + wordmark). A rounded ink-black tile with a geometric white "R" whose leg points forward, and one indigo dot.)

---

## 6. Security Checklist

- anon key only in the frontend; `service_role` never in the repo, JS, or hosting settings used by the site.
- RLS on every table, default deny, tested per role.
- Quiz answers unreadable by students; grading server-side.
- Private storage with short-lived signed URLs for video, materials, submissions.
- Role changes only through an admin RPC, logged in `audit_log`.
- Output escaping on all user content; no `innerHTML` with raw data.
- Upload validation (type and size) in both UI and bucket limits.
- Supabase Auth: email confirmation on, password rules, rate limits, redirect URL allow-list.
- Security headers via host config (CSP, X-Frame-Options, Referrer-Policy).

---

## 7. Development Plan

Each phase ends with a **test checkpoint** and I will not move on until it passes. Earlier modules are re-checked after each new one (regression pass).

| # | Phase | Deliverables | Test checkpoint |
|---|---|---|---|
| 0 | Foundation | Project structure, design tokens, base components, logo/favicon, Supabase client, config | Pages render at 360 / 768 / 1280 px |
| 1 | Database | Migrations for all tables, enums, helper functions, triggers, RLS, storage policies | SQL role-impersonation tests: each role can and cannot do what §3 says |
| 2 | Auth & shells | Login, register, reset, guard, role redirects, three dashboard shells with sidebar | Sign up → student; role redirects; direct URL access blocked |
| 3 | Users & profiles | Admin user management, role promotion, profile editing, avatars | Non-admin cannot change a role (UI and API) |
| 4 | Courses & enrollment | Course CRUD, co-teachers, enrollment management, catalog | Student sees only enrolled courses; teacher only own |
| 5 | Content | Modules, lessons, video upload/embed, PDFs/materials, player, progress tracking | Unenrolled user cannot fetch a signed URL |
| 6 | Live classes & attendance | Scheduling, join link, attendance marking, student view and summary | Attendance percentages match raw records |
| 7 | Assignments | Create, submit with file, late detection, grading, feedback | Student cannot read others' submissions or edit after grading |
| 8 | Quizzes | Builder, attempt flow with timer, server grading, results | Answer keys not present in any student response |
| 9 | Communication | Announcements, notifications, realtime messaging | Realtime delivery; no cross-user message leakage |
| 10 | Progress & reports | Dashboards, gradebook, progress, attendance reports | Every dashboard number traces to a query |
| 11 | Polish & release | Accessibility, performance, empty/error states, deployment guide | Full multi-role walkthrough on mobile and desktop |

Testing method: SQL tests for RLS, manual scripted walkthroughs per role in a real browser, plus console and network checks for every module. I will report results per phase.

---

## 8. Confirmed Decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Teacher accounts | Created by admins only, through one Supabase Edge Function (`create-user`). It verifies the caller is an admin, then uses the service_role key from Supabase secrets, never from the frontend. Public sign-up is for students only |
| 2 | Video | Both: Supabase Storage uploads and external YouTube/Vimeo embeds |
| 3 | Live classes | Jitsi Meet embedded in the app (teacher starts, students join inside Rinova Learn). Optional external meeting-link field per class |
| 4 | Enrollment | Teachers and admins only. No student self-enrollment |
| 5 | Brand | Client-supplied logo (`assets/img/logo.png`). Palette is taken from it, see below. The earlier indigo SVG draft is retired |
| 6 | Hosting | GitHub Pages (static; relative paths, no server rewrites) |
| 7 | Language | English only |
| 8 | Supabase | New project to be created. Setup guide included in Phase 1 |

### Brand palette (from the logo)
Deep blue `#0B3C95` (primary), bright blue `#0A5FC4`, green `#3A9A2F` (success / secondary accent), orange `#F59E0B` (highlight, used sparingly), ink `#0B0B0F`, neutral grays. Minimalist layouts stay mostly white and gray, with blue as the main interactive color.

### Changes caused by the decisions
- Section 1.4: role promotion is still available, but account creation for teachers/admins goes through the `create-user` Edge Function.
- Section 2: `live_classes` gains `room_name` (Jitsi room, unguessable) and keeps `meeting_url` as optional.
- Section 1: static-only hosting on GitHub Pages; Supabase Auth redirect URLs must include the Pages URL.
- Phase 3 now includes the Edge Function; Phase 6 includes the Jitsi room.

Next step: reply "approved" and I'll begin Phase 0 and Phase 1.
