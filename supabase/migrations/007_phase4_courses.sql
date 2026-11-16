-- =====================================================================
-- Rinova Learn  |  007_phase4_courses.sql  |  Phase 4: courses & enrollment
-- Safe to run more than once.
-- =====================================================================

-- 1. SECURITY: internal primitives must not be callable from the browser.
--    Triggers and SECURITY DEFINER functions still use them (they run as the owner).
--    Without this, any signed-in user could call rpc('notify_users', ...) to send
--    fake notifications to anyone, or rpc('write_audit', ...) to forge audit entries.
revoke execute on function public.notify_users(uuid[], text, text, text, text) from authenticated, anon, public;
revoke execute on function public.write_audit(text, text, uuid, jsonb)          from authenticated, anon, public;

-- 2. A student is told when they are enrolled in a course.
create or replace function public.trg_notify_enrollment() returns trigger
language plpgsql security definer set search_path = public as $$
declare ctitle text;
begin
  if new.status = 'active' then
    select title into ctitle from public.courses where id = new.course_id;
    perform public.notify_users(array[new.student_id], 'enrollment', 'You were enrolled in a course',
      ctitle, 'course?id=' || new.course_id::text);
  end if;
  return new;
end $$;

drop trigger if exists trg_enrollment_notify on public.enrollments;
create trigger trg_enrollment_notify after insert on public.enrollments
  for each row execute function public.trg_notify_enrollment();

-- 3. Course lists order/filter by these.
create index if not exists courses_status_idx on public.courses (status, created_at desc);
