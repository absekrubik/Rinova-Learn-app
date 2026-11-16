# Security model

**Authorization lives in the database.** The website is untrusted: anyone can open the browser tools and call Supabase directly, so every rule is enforced by Postgres, never by hiding buttons.

| Layer | What it does |
|---|---|
| Row Level Security | Switched on for every table. No policy means no access. Anonymous visitors can read nothing. |
| Role from `app_metadata` | A user cannot give themselves a role at sign-up (a test tries and fails). |
| Helper functions | `is_admin()`, `is_teacher_of()`, `is_enrolled()`, `can_view_course()` decide who can see what. Suspended users see nothing. |
| Server-side scoring | Quiz answers never leave the database. Students receive questions without answer data; scoring and timing happen in `submit_quiz_attempt`. |
| Private files | Buckets are private. Files open through signed links that expire in an hour. Paths are checked against the course or conversation folder. |
| Column limits | Users can only update the columns they own (for example `is_read` on notifications, `last_read_at` on chats). Roles and grades cannot be written by students. |
| Triggers | Check sizes and ownership on every write: course cannot change on an assignment, attempts lock a quiz, 20 messages per minute per person. |
| Output escaping | Every piece of user text goes through an escaping template or `textContent`, so `<script>` in a title is shown as text. |
| CSP meta tag | Blocks inline scripts, eval, unknown script hosts and unknown connections. |
| Keys | Only the publishable key is in the browser. The site stops if a secret key is pasted into `js/config.js`. The `service_role` key lives only inside the `create-user` Edge Function. |
| Admin-created teachers | Only admins can create teacher accounts; the function re-checks the caller's role. |
| Spreadsheet exports | CSV cells beginning with `=`, `+`, `-` or `@` are neutralised. |

## Tested
`supabase/tests/10_rls_tests.sql` impersonates admin, teachers, students, outsiders, suspended users and anonymous visitors and checks what each can read and change. With unlock rules and the early-warning list: **446 checks, 0 failures**. `tools/audit.py` re-checks the static rules (no secrets, no certificates, every link resolves, no inline scripts).

## Known limits (be aware, not bugs)
- The CSP is a `<meta>` tag because GitHub Pages cannot send headers. It cannot stop other sites from framing yours. If clickjacking matters, host behind Cloudflare or Netlify and add `X-Frame-Options: DENY`.
- Live classes use a public Jitsi room name or a link you paste. Anyone with the link can join, so treat links as private.
- File type checks use the browser-reported type plus Supabase bucket limits. Do not open student uploads outside the app if you do not trust the student.
- Supabase's own limits (rate limits, free-plan pauses) apply.
