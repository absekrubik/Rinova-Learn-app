-- =====================================================================
-- Rinova Learn  |  009_phase6_live.sql  |  Phase 6: live classes & attendance
-- Safe to run more than once.
-- =====================================================================

-- 1. Links stored in the database must be https URLs and the room name must have our own format
--    (the browser also validates; this stops a bad value from ever being stored).
alter table public.live_classes drop constraint if exists live_meeting_url_https;
alter table public.live_classes add constraint live_meeting_url_https
  check (meeting_url is null or meeting_url ~* '^https://[^[:space:]]+$') not valid;
alter table public.live_classes drop constraint if exists live_recording_url_https;
alter table public.live_classes add constraint live_recording_url_https
  check (recording_url is null or recording_url ~* '^https://[^[:space:]]+$') not valid;
alter table public.live_classes drop constraint if exists live_room_name_format;
alter table public.live_classes add constraint live_room_name_format
  check (room_name ~ '^rinova-[0-9a-f]{32}$') not valid;

-- 2. One attendance session per live class; the class must belong to the same course.
create unique index if not exists attendance_sessions_live_uidx on public.attendance_sessions (live_class_id) where live_class_id is not null;

create or replace function public.attendance_sessions_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.live_class_id is not null and not exists (
      select 1 from public.live_classes l where l.id = new.live_class_id and l.course_id = new.course_id) then
    raise exception 'Live class does not belong to this course';
  end if;
  if tg_op = 'UPDATE' and new.course_id <> old.course_id then raise exception 'Course cannot be changed'; end if;
  return new;
end $$;
drop trigger if exists trg_attendance_sessions_check on public.attendance_sessions;
create trigger trg_attendance_sessions_check before insert or update on public.attendance_sessions
  for each row execute function public.attendance_sessions_check();

alter table public.attendance_records drop constraint if exists attendance_note_len;
alter table public.attendance_records add constraint attendance_note_len check (note is null or length(note) <= 300) not valid;

-- 3. Notifications: link to the class page; also tell students when a class is moved or cancelled.
create or replace function public.trg_notify_live_class() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_users(public.course_audience(new.course_id), 'live_class',
    'Live class scheduled: ' || new.title, to_char(new.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'),
    'live?id=' || new.id);
  return new;
end $$;

create or replace function public.trg_notify_live_class_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.notify_users(public.course_audience(new.course_id), 'live_class',
      'Live class cancelled: ' || new.title, null, 'live?id=' || new.id);
  elsif new.status <> 'cancelled' and new.starts_at is distinct from old.starts_at then
    perform public.notify_users(public.course_audience(new.course_id), 'live_class',
      'Live class rescheduled: ' || new.title, to_char(new.starts_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"'), 'live?id=' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_live_class_change on public.live_classes;
create trigger trg_live_class_change after update on public.live_classes
  for each row execute function public.trg_notify_live_class_change();

-- 4. Per-session counts for the attendance list (respects the caller's access via security_invoker).
create or replace view public.v_attendance_sessions with (security_invoker = true) as
select s.id as session_id, s.course_id,
       count(r.id) filter (where r.status = 'present') as present,
       count(r.id) filter (where r.status = 'late')    as late,
       count(r.id) filter (where r.status = 'absent')  as absent,
       count(r.id) filter (where r.status = 'excused') as excused,
       count(r.id) as total
from public.attendance_sessions s left join public.attendance_records r on r.session_id = s.id
group by s.id, s.course_id;
grant select on public.v_attendance_sessions to authenticated;

create index if not exists live_classes_start_idx on public.live_classes (starts_at);
