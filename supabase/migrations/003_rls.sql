-- =====================================================================
-- Rinova Learn  |  003_rls.sql  |  Row Level Security (default deny)
-- Every table has RLS enabled. A table/operation with no policy = denied.
-- Suspended users: app_role() is NULL, so every check below is false.
-- =====================================================================

do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- profiles -----------------------------------------------
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.is_admin()
  or (role = 'admin' and public.is_active_user())
  or (public.app_role() = 'teacher' and role = 'student')
  or public.shares_course_with(id)
);
create policy profiles_update on public.profiles for update to authenticated
  using ((id = auth.uid() and public.is_active_user()) or public.is_admin())
  with check ((id = auth.uid() and public.is_active_user()) or public.is_admin());
-- inserts happen via trigger; deletes via auth.users cascade (service role)

-- ---------- courses ------------------------------------------------
create policy courses_select on public.courses for select to authenticated using (
  public.is_teacher_of(id) or created_by = auth.uid()
  or (public.is_enrolled(id) and status <> 'draft')
);
create policy courses_insert on public.courses for insert to authenticated with check (
  public.is_admin() or (public.app_role() = 'teacher' and created_by = auth.uid())
);
create policy courses_update on public.courses for update to authenticated
  using (public.is_teacher_of(id)) with check (public.is_teacher_of(id));
create policy courses_delete on public.courses for delete to authenticated using (public.is_admin());

-- ---------- course_teachers ----------------------------------------
create policy course_teachers_select on public.course_teachers for select to authenticated using (
  teacher_id = auth.uid() or public.is_teacher_of(course_id) or public.is_enrolled(course_id)
);
create policy course_teachers_admin on public.course_teachers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- enrollments (teachers/admins only write) ----------------
create policy enrollments_select on public.enrollments for select to authenticated using (
  (student_id = auth.uid() and public.is_active_user()) or public.is_teacher_of(course_id)
);
create policy enrollments_insert on public.enrollments for insert to authenticated
  with check (public.is_teacher_of(course_id));
create policy enrollments_update on public.enrollments for update to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));
create policy enrollments_delete on public.enrollments for delete to authenticated
  using (public.is_teacher_of(course_id));

-- ---------- modules / lessons / materials ---------------------------
create policy modules_select on public.modules for select to authenticated using (public.can_view_course(course_id));
create policy modules_write on public.modules for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

create policy lessons_select on public.lessons for select to authenticated using (
  public.is_teacher_of(course_id) or (public.is_enrolled(course_id) and is_published)
);
create policy lessons_write on public.lessons for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

create policy materials_select on public.materials for select to authenticated using (
  public.is_teacher_of(course_id)
  or (public.is_enrolled(course_id) and (lesson_id is null or exists (
        select 1 from public.lessons l where l.id = lesson_id and l.is_published)))
);
create policy materials_write on public.materials for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

-- ---------- lesson progress ----------------------------------------
create policy progress_select on public.lesson_progress for select to authenticated using (
  (student_id = auth.uid() and public.is_active_user()) or public.is_teacher_of(course_id)
);
create policy progress_insert on public.lesson_progress for insert to authenticated with check (
  student_id = auth.uid() and exists (
    select 1 from public.lessons l where l.id = lesson_id and l.is_published and public.is_enrolled(l.course_id))
);
create policy progress_update on public.lesson_progress for update to authenticated
  using (student_id = auth.uid() and public.is_enrolled(course_id))
  with check (student_id = auth.uid() and public.is_enrolled(course_id));

-- ---------- live classes -------------------------------------------
create policy live_select on public.live_classes for select to authenticated using (public.can_view_course(course_id));
create policy live_write on public.live_classes for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

-- ---------- attendance ---------------------------------------------
create policy att_sessions_select on public.attendance_sessions for select to authenticated using (public.can_view_course(course_id));
create policy att_sessions_write on public.attendance_sessions for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

create policy att_records_select on public.attendance_records for select to authenticated using (
  (student_id = auth.uid() and public.is_active_user()) or public.is_teacher_of(course_id)
);
create policy att_records_write on public.attendance_records for all to authenticated
  using (public.is_teacher_of(course_id))
  with check (public.is_teacher_of((select s.course_id from public.attendance_sessions s where s.id = session_id)));

-- ---------- assignments & submissions ------------------------------
create policy assignments_select on public.assignments for select to authenticated using (
  public.is_teacher_of(course_id) or (public.is_enrolled(course_id) and is_published)
);
create policy assignments_write on public.assignments for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

create policy submissions_select on public.submissions for select to authenticated using (
  (student_id = auth.uid() and public.is_active_user()) or public.is_teacher_of(course_id)
);
create policy submissions_insert on public.submissions for insert to authenticated with check (
  student_id = auth.uid() and exists (
    select 1 from public.assignments a where a.id = assignment_id and public.is_enrolled(a.course_id))
);
create policy submissions_update on public.submissions for update to authenticated
  using ((student_id = auth.uid() and status in ('submitted','returned') and public.is_active_user()) or public.is_teacher_of(course_id))
  with check ((student_id = auth.uid() and public.is_active_user()) or public.is_teacher_of(course_id));
create policy submissions_delete on public.submissions for delete to authenticated using (public.is_teacher_of(course_id));

-- ---------- quizzes ------------------------------------------------
-- Students never read quiz content or answer keys directly. They use the
-- RPCs start_quiz_attempt / get_attempt_questions / submit_quiz_attempt.
create policy quizzes_select on public.quizzes for select to authenticated using (
  public.is_teacher_of(course_id) or (public.is_enrolled(course_id) and is_published)
);
create policy quizzes_write on public.quizzes for all to authenticated
  using (public.is_teacher_of(course_id)) with check (public.is_teacher_of(course_id));

create policy qq_staff on public.quiz_questions for all to authenticated
  using (public.is_teacher_of(public.quiz_course_id(quiz_id)))
  with check (public.is_teacher_of(public.quiz_course_id(quiz_id)));
create policy qo_staff on public.quiz_options for all to authenticated
  using (public.is_teacher_of(public.question_course_id(question_id)))
  with check (public.is_teacher_of(public.question_course_id(question_id)));
create policy qk_staff on public.quiz_answer_keys for all to authenticated
  using (public.is_teacher_of(public.question_course_id(question_id)))
  with check (public.is_teacher_of(public.question_course_id(question_id)));

create policy attempts_select on public.quiz_attempts for select to authenticated using (
  public.is_teacher_of(course_id)
  or (student_id = auth.uid() and public.is_active_user()
      and (status = 'in_progress' or public.quiz_shows_results(quiz_id)))
);
create policy responses_select on public.quiz_responses for select to authenticated using (
  public.is_teacher_of(course_id)
  or (student_id = auth.uid() and public.is_active_user()
      and public.quiz_shows_results((select a.quiz_id from public.quiz_attempts a where a.id = attempt_id)))
);
-- no insert/update/delete policies on attempts/responses: RPC only.

-- ---------- announcements ------------------------------------------
create policy announcements_select on public.announcements for select to authenticated using (
  public.is_active_user() and (course_id is null or public.can_view_course(course_id))
);
create policy announcements_insert on public.announcements for insert to authenticated with check (
  author_id = auth.uid() and (
    public.is_admin() or (course_id is not null and public.is_teacher_of(course_id)))
);
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_admin() or (author_id = auth.uid() and public.is_teacher_of(course_id)))
  with check (public.is_admin() or (author_id = auth.uid() and public.is_teacher_of(course_id)));
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_admin() or (author_id = auth.uid() and public.is_teacher_of(course_id)));

-- ---------- notifications ------------------------------------------
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());   -- column grant limits to is_read
create policy notifications_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- ---------- messaging ----------------------------------------------
create policy conversations_select on public.conversations for select to authenticated using (public.can_access_conversation(id));
create policy participants_select on public.conversation_participants for select to authenticated using (
  user_id = auth.uid() or public.is_participant(conversation_id));
create policy participants_update on public.conversation_participants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());   -- column grant: last_read_at only
create policy messages_select on public.messages for select to authenticated using (public.can_access_conversation(conversation_id));
create policy messages_insert on public.messages for insert to authenticated with check (
  sender_id = auth.uid() and public.can_access_conversation(conversation_id));
create policy messages_delete on public.messages for delete to authenticated using (public.is_admin());

-- ---------- audit --------------------------------------------------
create policy audit_select on public.audit_log for select to authenticated using (public.is_admin());
