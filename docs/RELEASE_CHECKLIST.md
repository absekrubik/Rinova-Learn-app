# Release checklist

Tick every box on the real site (not a local copy) before giving students access.

## Automatic checks
- [ ] `python tools/audit.py` prints `0 failed`
- [ ] (Optional, needs a throw-away local Postgres) `supabase/tests/run_tests.sh` ends with `0 failed`

## Setup
- [ ] Migrations 001 to 020 ran with no errors
- [ ] `js/config.js` has your Project URL and publishable key (no secret key anywhere)
- [ ] Auth: Site URL and Redirect URLs match your Pages address, "Confirm email" is on
- [ ] `create-user` function is deployed and `ALLOWED_ORIGIN` is set
- [ ] Realtime is on for `messages` and `notifications` (migration 012 does this on Supabase)
- [ ] You are an admin: `update public.profiles set role = 'admin' where email = '...'`

## Walk-through as **admin**
- [ ] Sign in, dashboard numbers are real
- [ ] Create a teacher account (Users > New teacher), the teacher receives a sign-in email
- [ ] Create a course, add the teacher, publish it
- [ ] Suspend and re-activate a test student: a suspended student is signed out of every page
- [ ] Post a school-wide announcement, open Reports

## Walk-through as **teacher** (use a private window)
- [ ] Add a module, a YouTube lesson, an uploaded PDF and a material
- [ ] Enroll a test student
- [ ] Schedule a live class, open it (new tab), mark attendance
- [ ] Create an assignment, publish, grade a submission with feedback
- [ ] Build a quiz (one choice, one multiple, one short text), publish it, grade the text answer
- [ ] Post a course announcement, send a direct message with a PDF
- [ ] Open Reports: numbers match what you graded, CSV downloads
- [ ] Open Calendar: this month's class, deadline and quiz window are on the right days; "Download .ics" opens in your calendar app
- [ ] Needs attention: mark a test student absent three times (or leave a deadline unsubmitted), they appear with plain reasons; Nudge sends once, a second nudge within 24 hours is refused
- [ ] Unlock rules: on a lesson with an uploaded video, add "Complete lesson X". See the "Unlock rules (real storage check)" box below

## Walk-through as **student** (another private window)
- [ ] Register yourself or sign in with the test account, forgot-password email arrives
- [ ] Only enrolled courses are visible; draft lessons are not
- [ ] Watch a lesson, mark it complete, progress bar moves
- [ ] Submit an assignment with a file; after grading the grade and feedback show up
- [ ] Take the quiz (try the timer), see the result
- [ ] Reply to the teacher's message; the notification bell shows the new message live
- [ ] Open Grades: matches the teacher's Reports
- [ ] Try another student's URL (e.g. paste a quiz id from a course you are not in): you see "not found"

## Phone check (390 px wide)
- [ ] Menu opens and closes, every page scrolls, nothing is cut off, chat switches between list and conversation

## Keyboard check
- [ ] Tab from the top of any page: first stop is "Skip to content"
- [ ] Dialogs keep focus inside and close with Esc

## Before announcing
- [ ] Remove test accounts and test courses
- [ ] Write down where the database password and the admin email are kept


## Unlock rules (real storage check)
The database tests prove a locked lesson's row and attached files are hidden. Video and PDF files live in Storage, which the test database does not have, so check it once on your real project:
- [ ] As teacher: lesson B has an uploaded video; add the rule "Complete lesson A".
- [ ] As a test student who has NOT finished A: lesson B shows a lock and opens a "Locked" page, never the video.
- [ ] Still as that student, open the browser developer tools, Network tab, and confirm there is no request for lesson B's video file.
- [ ] Mark A complete: B unlocks by itself and the video plays.
- [ ] If B's video ever plays while locked, stop and tell me: the storage policy `content_read` must be re-checked.

## Mastery, questions, pulse and study plan (migrations 016 to 018)
- [ ] Teacher: add 3 topics on a course (Topics tab), tag a lesson and a quiz question, then have a student take the quiz; the student's My mastery shows the topic with a level
- [ ] Student cannot see the Topics tab, other students' mastery, or tags on lessons that are still locked
- [ ] Student asks a question on a video lesson with a time like 1:05; the teacher sees it in Questions and the Answer link opens the lesson at that moment
- [ ] A teacher reply marks the question answered and the student gets a notification
- [ ] During a live class (from 15 minutes before to 1 hour after): a student taps "I'm lost"; the teacher sees the count only, never names
- [ ] Teacher starts a poll; a student votes and can change the vote; closing the poll shows totals to everyone
- [ ] Outside the class window the pulse box is gone
- [ ] Student Study plan shows the week, ticks are remembered after reload, and changing daily time re-plans

## Joined status (migration 019)
- [ ] Student presses Join during a class: the meeting opens in its own tab and the class page shows "Joined" with the time
- [ ] Student closes the meeting tab, returns to the class page and presses Rejoin: the meeting opens again
- [ ] Teacher and admin see "Who has joined" with names, times and "N of M students"
- [ ] A student cannot see that list, and pressing Join outside the class window records nothing

## Presence: in, left, rejoined (migration 020)
- [ ] Student joins, then closes the Jitsi tab: within a couple of seconds the class page says "You left the class" with the leave time
- [ ] Student presses Rejoin: it opens again as a second visit, and the teacher list shows both visits
- [ ] Student presses "I've left the class": the leave is recorded
- [ ] Student closes the whole browser while in the class: after about 2 minutes the teacher list shows them as Left
- [ ] On a phone using the Jitsi app: the student presses "I've left the class" when finished (the app cannot be detected)
