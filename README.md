# Rinova Learn

Online Learning Management System. HTML5, CSS3, vanilla JavaScript (ES modules), Supabase. No frameworks, no build step, no certificates.

## Status
- Phase 0 (foundation, design system, core JS): done
- Phase 1 (database, RLS, storage, Edge Function): done, 446 automated security checks pass
- Phase 2 (login, register, password reset, role dashboards, app shell, notifications): done
- Phase 3 (admin user management, teacher accounts via Edge Function, profile + avatar): done
- Phase 4 (courses, co-teachers, enrollment, thumbnails): done
- Phase 5 (modules, lessons, video, PDFs, materials, progress): done
- Phase 6 (live classes, attendance): done. Classes open in a new tab (Jitsi room or your own Meet/Zoom link)
- Phase 7 (assignments, submissions, grading): done
- Phase 8 (quizzes: builder, timed attempts, auto and manual grading, results): done
- Phase 9 (announcements, direct messages, class chats with attachments): done
- Phase 10 (student Grades, teacher and admin Reports with CSV export): done
- Phase 11 (accessibility, security headers, audit script, deploy guide, release checklist): done
- Global search (top bar on every page, press / or Ctrl+K): done
- Calendar (live classes, deadlines and quiz windows for every role, with an .ics download): done
- Needs attention (early-warning list for teachers and admins, with a friendly nudge): done
- Unlock rules (a teacher locks a lesson until a lesson, quiz or assignment is done; students see a learning path): done

All planned phases are complete.

## Get started
1. Follow `supabase/README.md` (create project, run migrations 001-015, create first admin).
2. Put your Project URL and **anon** key in `js/config.js`. Never use the service_role key.
3. Preview locally with any static server (for example the VS Code "Live Server" extension), open `index.html`; `design-system.html` shows every component.
4. Deploy: see `docs/DEPLOY.md`. Before opening to students, work through `docs/RELEASE_CHECKLIST.md` and run `python tools/audit.py`.

## Structure
`assets/` css + images, `js/core` auth/guard/client, `js/ui` toast/modal/forms, `js/services` (data access, from Phase 2), `js/pages` page controllers, `supabase/` migrations, Edge Function and tests, `tools/audit.py` release audit, `docs/` deploy guide, release checklist and security model.
