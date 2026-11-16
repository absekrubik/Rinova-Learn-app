-- =====================================================================
-- Rinova Learn  |  011_phase8_quizzes.sql  |  Phase 8: quizzes
-- Safe to run more than once.
-- =====================================================================

-- 1. New quiz setting + limits (the browser enforces them too).
alter table public.quizzes add column if not exists reveal_answers boolean not null default false;

alter table public.quizzes drop constraint if exists quizzes_limits;
alter table public.quizzes add constraint quizzes_limits check (
  length(title) between 1 and 200 and (description is null or length(description) <= 5000)
  and (time_limit_minutes is null or time_limit_minutes <= 600) and (max_attempts is null or max_attempts <= 20)
  and (available_from is null or available_until is null or available_until > available_from)) not valid;
alter table public.quiz_questions drop constraint if exists quiz_questions_limits;
alter table public.quiz_questions add constraint quiz_questions_limits check (
  length(prompt) between 1 and 2000 and (explanation is null or length(explanation) <= 2000) and points <= 1000) not valid;
alter table public.quiz_options drop constraint if exists quiz_options_limits;
alter table public.quiz_options add constraint quiz_options_limits check (length(label) between 1 and 500) not valid;
alter table public.quiz_answer_keys drop constraint if exists quiz_keys_limits;
alter table public.quiz_answer_keys add constraint quiz_keys_limits check (cardinality(accepted_text) <= 20 and cardinality(correct_option_ids) <= 10) not valid;

-- one unfinished attempt per student per quiz (stops a double click from starting two)
create unique index if not exists quiz_attempts_one_open_uidx on public.quiz_attempts (quiz_id, student_id) where status = 'in_progress';

-- 2. Helpers
create or replace function public.quiz_has_attempts(qid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.quiz_attempts where quiz_id = qid)
$$;

-- 3. Structure guards. Once students have started a quiz, anything that would change how it is scored is locked
--    (question type/points, adding or removing questions/options, answer keys). Typos in text can still be fixed.
create or replace function public.quiz_questions_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.quizzes z where z.id = old.quiz_id) and public.quiz_has_attempts(old.quiz_id) then
      raise exception 'This quiz already has attempts, so questions cannot be removed';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if public.quiz_has_attempts(new.quiz_id) then raise exception 'This quiz already has attempts, so questions cannot be added'; end if;
    if (select count(*) from public.quiz_questions where quiz_id = new.quiz_id) >= 100 then raise exception 'A quiz can have at most 100 questions'; end if;
  else
    new.quiz_id := old.quiz_id;
    if public.quiz_has_attempts(new.quiz_id) and (new.type is distinct from old.type or new.points is distinct from old.points) then
      raise exception 'This quiz already has attempts, so the type and points of a question cannot change';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_quiz_questions_guard on public.quiz_questions;
create trigger trg_quiz_questions_guard before insert or update or delete on public.quiz_questions
  for each row execute function public.quiz_questions_guard();

create or replace function public.quiz_options_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare qid uuid;
begin
  select q.quiz_id into qid from public.quiz_questions q where q.id = case when tg_op = 'DELETE' then old.question_id else new.question_id end;
  if tg_op = 'DELETE' then
    if qid is not null and public.quiz_has_attempts(qid) then raise exception 'This quiz already has attempts, so options cannot be removed'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if qid is null then raise exception 'Question not found'; end if;
    if public.quiz_has_attempts(qid) then raise exception 'This quiz already has attempts, so options cannot be added'; end if;
    if (select count(*) from public.quiz_options where question_id = new.question_id) >= 10 then raise exception 'A question can have at most 10 options'; end if;
  else
    new.question_id := old.question_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_quiz_options_guard on public.quiz_options;
create trigger trg_quiz_options_guard before insert or update or delete on public.quiz_options
  for each row execute function public.quiz_options_guard();

create or replace function public.quiz_keys_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare qt public.question_type; qid uuid;
begin
  if tg_op = 'DELETE' then
    select q.quiz_id into qid from public.quiz_questions q where q.id = old.question_id;
    if qid is not null and public.quiz_has_attempts(qid) then raise exception 'This quiz already has attempts, so answers cannot change'; end if;
    return old;
  end if;
  select q.type, q.quiz_id into qt, qid from public.quiz_questions q where q.id = new.question_id;
  if qid is null then raise exception 'Question not found'; end if;
  if tg_op = 'UPDATE' then new.question_id := old.question_id; end if;
  if public.quiz_has_attempts(qid) and (tg_op = 'INSERT' or new.correct_option_ids is distinct from old.correct_option_ids or new.accepted_text is distinct from old.accepted_text) then
    raise exception 'This quiz already has attempts, so answers cannot change';
  end if;
  if exists (select 1 from unnest(new.correct_option_ids) c
             where not exists (select 1 from public.quiz_options o where o.id = c and o.question_id = new.question_id)) then
    raise exception 'Correct answers must be options of this question';
  end if;
  if qt in ('single', 'true_false') and cardinality(new.correct_option_ids) > 1 then raise exception 'This question type has exactly one correct option'; end if;
  if qt = 'short_text' and cardinality(new.correct_option_ids) > 0 then raise exception 'Text questions have accepted answers, not options'; end if;
  if qt <> 'short_text' and cardinality(new.accepted_text) > 0 then raise exception 'Choice questions do not have accepted text answers'; end if;
  return new;
end $$;
drop trigger if exists trg_quiz_keys_guard on public.quiz_answer_keys;
create trigger trg_quiz_keys_guard before insert or update or delete on public.quiz_answer_keys
  for each row execute function public.quiz_keys_guard();

-- 4. A quiz can only be published when every question can actually be answered and scored.
create or replace function public.quizzes_publish_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare qq record; n int; k public.quiz_answer_keys%rowtype;
begin
  if tg_op = 'UPDATE' then new.course_id := old.course_id; end if;
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    if not exists (select 1 from public.quiz_questions where quiz_id = new.id) or tg_op = 'INSERT' then
      raise exception 'Add at least one question before publishing';
    end if;
    for qq in select * from public.quiz_questions where quiz_id = new.id loop
      if qq.type <> 'short_text' then
        select count(*) into n from public.quiz_options where question_id = qq.id;
        if n < 2 then raise exception 'Question "%" needs at least two options', left(qq.prompt, 40); end if;
        select * into k from public.quiz_answer_keys where question_id = qq.id;
        if k.question_id is null or cardinality(k.correct_option_ids) = 0
           or exists (select 1 from unnest(k.correct_option_ids) c where not exists (select 1 from public.quiz_options o where o.id = c and o.question_id = qq.id)) then
          raise exception 'Question "%" needs a correct answer', left(qq.prompt, 40);
        end if;
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists trg_quizzes_publish_check on public.quizzes;
create trigger trg_quizzes_publish_check before insert or update on public.quizzes
  for each row execute function public.quizzes_publish_check();

-- 5. Engine fixes. start_quiz_attempt: a timed-out unfinished attempt is closed as graded with 0 (it used to stay "submitted",
--    which looked like it was waiting for a teacher); a quiz with no questions cannot be started.
create or replace function public.start_quiz_attempt(p_quiz_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare qz public.quizzes%rowtype; att public.quiz_attempts%rowtype; n int; mx numeric; new_id uuid; closed_stale boolean := false;
begin
  select * into qz from public.quizzes where id = p_quiz_id;
  if not found or not qz.is_published then raise exception 'Quiz not available'; end if;
  if not public.is_enrolled(qz.course_id) then raise exception 'You are not enrolled in this course'; end if;
  if not public.is_active_user() then raise exception 'Not allowed'; end if;
  if qz.available_from  is not null and now() < qz.available_from  then raise exception 'This quiz is not open yet'; end if;
  select coalesce(sum(points), 0), count(*) into mx, n from public.quiz_questions where quiz_id = qz.id;
  if n = 0 then raise exception 'This quiz has no questions yet'; end if;

  select * into att from public.quiz_attempts
   where quiz_id = qz.id and student_id = auth.uid() and status = 'in_progress'
   order by started_at desc limit 1;
  if found then
    if qz.time_limit_minutes is not null
       and now() > att.started_at + make_interval(mins => qz.time_limit_minutes) + interval '60 seconds' then
      update public.quiz_attempts set status = 'graded', submitted_at = now(), score = 0, max_score = mx where id = att.id;
      closed_stale := true;
    else
      return att.id;
    end if;
  end if;

  -- when a timed-out attempt was just closed we return null instead of raising, so that the closing is kept
  if qz.available_until is not null and now() > qz.available_until then
    if closed_stale then return null; end if;
    raise exception 'This quiz is closed';
  end if;
  select count(*) into n from public.quiz_attempts
   where quiz_id = qz.id and student_id = auth.uid() and status <> 'in_progress';
  if qz.max_attempts is not null and n >= qz.max_attempts then
    if closed_stale then return null; end if;
    raise exception 'No attempts left';
  end if;

  insert into public.quiz_attempts (quiz_id, course_id, student_id, max_score)
  values (qz.id, qz.course_id, auth.uid(), mx) returning id into new_id;
  return new_id;
end $$;

-- submit_quiz_attempt: same scoring as before, plus text answers are capped at 1000 characters.
create or replace function public.submit_quiz_attempt(p_attempt_id uuid, p_responses jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  att public.quiz_attempts%rowtype; qz public.quizzes%rowtype; qq record; r jsonb; k public.quiz_answer_keys%rowtype;
  total numeric := 0; maxs numeric := 0; sel uuid[]; txt text; ok boolean; pts numeric; pending boolean := false;
  expired boolean; final_status public.attempt_status; pct numeric;
begin
  select * into att from public.quiz_attempts where id = p_attempt_id and student_id = auth.uid() for update;
  if not found then raise exception 'Attempt not found'; end if;
  if att.status <> 'in_progress' then raise exception 'Attempt already submitted'; end if;
  if not public.is_enrolled(att.course_id) then raise exception 'You are not enrolled in this course'; end if;
  select * into qz from public.quizzes where id = att.quiz_id;
  expired := qz.time_limit_minutes is not null
             and now() > att.started_at + make_interval(mins => qz.time_limit_minutes) + interval '60 seconds';
  if p_responses is null or jsonb_typeof(p_responses) <> 'array' then p_responses := '[]'::jsonb; end if;

  for qq in select * from public.quiz_questions where quiz_id = att.quiz_id order by position loop
    maxs := maxs + qq.points;
    select x into r from jsonb_array_elements(p_responses) x where x ->> 'question_id' = qq.id::text limit 1;
    sel := '{}'; txt := null; ok := false; pts := 0;

    if r is not null and not expired then
      select coalesce(array_agg(o.id), '{}') into sel from public.quiz_options o
       where o.question_id = qq.id and o.id::text in (select jsonb_array_elements_text(coalesce(r -> 'option_ids', '[]'::jsonb)));
      txt := left(nullif(trim(r ->> 'text'), ''), 1000);
    end if;

    select * into k from public.quiz_answer_keys where question_id = qq.id;
    if qq.type = 'short_text' then
      if k.question_id is null or coalesce(array_length(k.accepted_text, 1), 0) = 0 then
        ok := null; pending := true;
      else
        ok := txt is not null and lower(txt) in (select lower(trim(a)) from unnest(k.accepted_text) a);
      end if;
    else
      ok := k.question_id is not null and coalesce(array_length(sel,1),0) > 0
            and sel <@ k.correct_option_ids and sel @> k.correct_option_ids;
    end if;
    if ok then pts := qq.points; end if;
    total := total + pts;

    insert into public.quiz_responses (attempt_id, course_id, student_id, question_id, selected_option_ids, text_answer, is_correct, points_awarded)
    values (att.id, att.course_id, att.student_id, qq.id, sel, txt, ok, pts)
    on conflict (attempt_id, question_id) do update
      set selected_option_ids = excluded.selected_option_ids, text_answer = excluded.text_answer,
          is_correct = excluded.is_correct, points_awarded = excluded.points_awarded;
  end loop;

  final_status := case when pending and not expired then 'submitted' else 'graded' end;
  update public.quiz_attempts set status = final_status, submitted_at = now(), score = total, max_score = maxs where id = att.id;

  pct := case when maxs > 0 then round(total / maxs * 100, 2) else 0 end;
  if qz.show_results then
    return jsonb_build_object('status', final_status, 'score', total, 'max_score', maxs, 'percent', pct,
                              'passed', pct >= qz.pass_percent, 'pending_manual_grading', final_status = 'submitted');
  end if;
  return jsonb_build_object('status', final_status, 'submitted', true);
end $$;

-- 6. What the student sees about their own attempts. Scores are only returned when the quiz shows results.
create or replace function public.my_quiz_attempts(p_course_id uuid default null)
returns table (quiz_id uuid, attempt_id uuid, status public.attempt_status, started_at timestamptz, submitted_at timestamptz, score numeric, max_score numeric)
language sql stable security definer set search_path = public as $$
  select a.quiz_id, a.id, a.status, a.started_at, a.submitted_at,
         case when z.show_results or a.status = 'in_progress' then a.score end,
         case when z.show_results or a.status = 'in_progress' then a.max_score end
  from public.quiz_attempts a join public.quizzes z on z.id = a.quiz_id
  where a.student_id = auth.uid() and public.is_active_user()
    and (p_course_id is null or a.course_id = p_course_id)
  order by a.started_at
$$;

-- 7. Review of a finished attempt. Students: only when the quiz shows results; correct answers and explanations only when the
--    teacher turned on "show correct answers". Teachers of the course always see everything.
create or replace function public.get_attempt_review(p_attempt_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare att public.quiz_attempts%rowtype; qz public.quizzes%rowtype; staff boolean; reveal boolean; qs jsonb;
begin
  select * into att from public.quiz_attempts where id = p_attempt_id;
  if not found then raise exception 'Attempt not found'; end if;
  staff := public.is_teacher_of(att.course_id);
  if not staff then
    if att.student_id <> auth.uid() or not public.is_active_user() then raise exception 'Attempt not found'; end if;
    if att.status = 'in_progress' then raise exception 'This attempt is not finished'; end if;
  end if;
  select * into qz from public.quizzes where id = att.quiz_id;
  if not staff and not qz.show_results then raise exception 'Results are not shown for this quiz'; end if;
  reveal := staff or qz.reveal_answers;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', qq.id, 'type', qq.type, 'prompt', qq.prompt, 'points', qq.points,
      'explanation', case when reveal then qq.explanation end,
      'response_id', r.id, 'text_answer', r.text_answer, 'is_correct', r.is_correct, 'points_awarded', r.points_awarded,
      'accepted_text', case when reveal and qq.type = 'short_text' then to_jsonb(k.accepted_text) end,
      'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'label', o.label,
                              'selected', coalesce(o.id = any (r.selected_option_ids), false),
                              'correct', case when reveal then coalesce(o.id = any (k.correct_option_ids), false) end) order by o.position)
                           from public.quiz_options o where o.question_id = qq.id), '[]'::jsonb))
    order by qq.position), '[]'::jsonb)
  into qs
  from public.quiz_questions qq
  left join public.quiz_responses r on r.attempt_id = att.id and r.question_id = qq.id
  left join public.quiz_answer_keys k on k.question_id = qq.id
  where qq.quiz_id = att.quiz_id;

  return jsonb_build_object(
    'attempt', jsonb_build_object('id', att.id, 'status', att.status, 'score', att.score, 'max_score', att.max_score,
                                  'submitted_at', att.submitted_at, 'student_id', att.student_id),
    'quiz', jsonb_build_object('id', qz.id, 'title', qz.title, 'pass_percent', qz.pass_percent, 'reveal_answers', qz.reveal_answers),
    'questions', qs);
end $$;

-- 8. Teacher overview per quiz.
create or replace view public.v_quiz_stats with (security_invoker = true) as
select z.id as quiz_id, z.course_id,
       count(a.id) filter (where a.status <> 'in_progress') as attempts,
       count(a.id) filter (where a.status = 'submitted') as pending,
       round(avg(100.0 * a.score / nullif(a.max_score, 0)) filter (where a.status = 'graded'), 1) as average_percent
from public.quizzes z left join public.quiz_attempts a on a.quiz_id = z.id
group by z.id, z.course_id;
grant select on public.v_quiz_stats to authenticated;

-- 9. Notifications
create or replace function public.trg_notify_quiz() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_published and (tg_op = 'INSERT' or not old.is_published) then
    perform public.notify_users(public.course_audience(new.course_id), 'quiz', 'New quiz: ' || new.title,
      case when new.available_until is null then null else 'Open until ' || to_char(new.available_until at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"') end,
      'quiz?id=' || new.id);
  end if;
  return new;
end $$;
drop trigger if exists trg_quiz_notify on public.quizzes;
create trigger trg_quiz_notify after insert or update of is_published on public.quizzes
  for each row execute function public.trg_notify_quiz();

create or replace function public.trg_notify_attempt() returns trigger
language plpgsql security definer set search_path = public as $$
declare t uuid[]; ttl text; who text;
begin
  if new.status = 'submitted' and old.status = 'in_progress' then
    select array_agg(ct.teacher_id) into t from public.course_teachers ct where ct.course_id = new.course_id;
    select title into ttl from public.quizzes where id = new.quiz_id;
    select coalesce(nullif(full_name, ''), email) into who from public.profiles where id = new.student_id;
    perform public.notify_users(coalesce(t, '{}'), 'quiz', 'Quiz needs grading: ' || ttl, who, 'quiz?id=' || new.quiz_id);
  elsif new.status = 'graded' and old.status = 'submitted' then
    select title into ttl from public.quizzes where id = new.quiz_id;
    perform public.notify_users(array[new.student_id], 'grade', 'Your quiz was graded: ' || ttl, null, 'quiz?id=' || new.quiz_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_attempt_notify on public.quiz_attempts;
create trigger trg_attempt_notify after update of status on public.quiz_attempts
  for each row execute function public.trg_notify_attempt();

-- 10. Function rights: signed-in users only.
revoke execute on function public.my_quiz_attempts(uuid), public.get_attempt_review(uuid), public.quiz_has_attempts(uuid) from public, anon;
grant execute on function public.my_quiz_attempts(uuid), public.get_attempt_review(uuid) to authenticated;
revoke execute on function public.quiz_has_attempts(uuid) from authenticated;
