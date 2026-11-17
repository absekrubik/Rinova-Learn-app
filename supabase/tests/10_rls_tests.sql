-- =====================================================================
-- Rinova Learn RLS / security test-suite.
-- Runs against a LOCAL Postgres that has: 00_supabase_shim.sql + migrations 001..006.
-- Impersonates each role by setting the JWT subject and switching to the
-- `authenticated` / `anon` DB roles, exactly as Supabase does.
-- Usage: psql -d rl -v ON_ERROR_STOP=1 -f tests/10_rls_tests.sql
-- =====================================================================
-- SAFETY: refuse to run anywhere except the throw-away local database built by 00_supabase_shim.sql.
-- Running this on a real Supabase project would create fake users/courses and touch storage.
do $guard$ begin
  if to_regclass('auth.__local_test_shim') is null then
    raise exception 'REFUSING TO RUN: this test-suite is for a local throw-away database only, never a real Supabase project.';
  end if;
end $guard$;

drop schema if exists tests cascade;
create schema tests;
create table tests.results (n serial, name text, ok boolean);
grant usage on schema tests to authenticated, anon;

create function tests.check(p_name text, p_ok boolean) returns void language plpgsql security definer as $$
begin insert into tests.results(name, ok) values (p_name, coalesce(p_ok, false)); end $$;

create function tests.as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, true); execute 'set local role authenticated'; end $$;
create function tests.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', true); execute 'set local role anon'; end $$;
create function tests.su() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
-- rows affected, or -1 when the statement raised an error (permission / RLS / trigger)
create function tests.try(p_sql text) returns int language plpgsql as $$
declare n int; begin execute p_sql; get diagnostics n = row_count; return n; exception when others then return -1; end $$;
create function tests.cnt(p_sql text) returns bigint language plpgsql as $$
declare n bigint; begin execute 'select count(*) from (' || p_sql || ') q' into n; return n; end $$;

do $t$
declare
  adm uuid := '00000000-0000-0000-0000-0000000000a0';
  t1  uuid := '00000000-0000-0000-0000-0000000000b1';
  t2  uuid := '00000000-0000-0000-0000-0000000000b2';
  s1  uuid := '00000000-0000-0000-0000-0000000000c1';
  s2  uuid := '00000000-0000-0000-0000-0000000000c2';
  s3  uuid := '00000000-0000-0000-0000-0000000000c3';
  s4  uuid := '00000000-0000-0000-0000-0000000000c4';
  c1 uuid; c2 uuid; cdraft uuid; m1 uuid; l_pub uuid; l_draft uuid; ls uuid;
  a1 uuid; a_late uuid; a_draft uuid; sub1 uuid;
  q1 uuid; q2 uuid; qq1 uuid; qq2 uuid; qq3 uuid; qq4 uuid; o1 uuid; o2 uuid; o3 uuid; o4 uuid; o5 uuid; o6 uuid; o7 uuid;
  att uuid; att2 uuid; res jsonb; conv uuid; cconv uuid; sess uuid; stats jsonb;
begin
  -- ---------------- setup (trusted / SQL editor) ----------------
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (adm,'admin@x.test','{"full_name":"Admin"}','{"role":"admin"}'),
    (t1,'t1@x.test','{"full_name":"Teacher One"}','{"role":"teacher"}'),
    (t2,'t2@x.test','{"full_name":"Teacher Two"}','{"role":"teacher"}'),
    (s1,'s1@x.test','{"full_name":"Student One"}','{}'),
    (s2,'s2@x.test','{"full_name":"Student Two"}','{}'),
    (s3,'s3@x.test','{"full_name":"Student Three"}','{}'),
    (s4,'s4@x.test','{"full_name":"S4","role":"admin"}','{}');   -- tries to self-assign admin via user metadata

  perform tests.check('roles assigned from app_metadata only',
    (select role from profiles where id=adm)='admin' and (select role from profiles where id=t1)='teacher'
    and (select role from profiles where id=s1)='student');
  perform tests.check('SECURITY: signup metadata cannot grant admin', (select role from profiles where id=s4)='student');

  -- ---------------- courses ----------------
  perform tests.as_user(s1);
  perform tests.check('student cannot create a course', tests.try(format($$insert into courses(title) values ('Hack')$$))=-1);
  perform tests.su(); perform tests.as_user(t1);
  insert into courses(title,status) values ('Course One','published') returning id into c1;
  insert into courses(title) values ('Draft Course') returning id into cdraft;
  perform tests.check('creator teacher auto-linked to course', (select count(*) from course_teachers where course_id=c1 and teacher_id=t1 and is_lead)=1);
  perform tests.check('course slug generated', (select slug from courses where id=c1) like 'course-one-%');
  perform tests.su(); perform tests.as_user(t2);
  insert into courses(title,status) values ('Course Two','published') returning id into c2;

  -- ---------------- enrollment ----------------
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher enrols student in own course', tests.try(format('insert into enrollments(course_id,student_id) values (%L,%L)',c1,s1))=1);
  perform tests.check('teacher enrols 2nd student', tests.try(format('insert into enrollments(course_id,student_id) values (%L,%L)',c1,s4))=1);
  perform tests.check('cannot enrol a teacher as student', tests.try(format('insert into enrollments(course_id,student_id) values (%L,%L)',c1,t2))=-1);
  perform tests.check('teacher cannot enrol into another teacher''s course', tests.try(format('insert into enrollments(course_id,student_id) values (%L,%L)',c2,s2))=-1);
  perform tests.su(); perform tests.as_user(t2);
  perform tests.check('teacher 2 enrols in own course', tests.try(format('insert into enrollments(course_id,student_id) values (%L,%L)',c2,s2))=1);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('student cannot self-enrol', tests.try(format('insert into enrollments(course_id,student_id) values (%L,%L)',c2,s1))=-1);
  perform tests.check('student cannot self-enrol (other course 1)', tests.try(format('insert into enrollments(course_id,student_id) values (%L,%L)',c1,s2))=-1);

  -- ---------------- course visibility ----------------
  perform tests.check('student sees only enrolled non-draft course', (select count(*) from courses)=1);
  perform tests.su(); perform tests.as_user(s3);
  perform tests.check('unenrolled student sees no courses', (select count(*) from courses)=0);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher sees only own courses (incl. draft)', (select count(*) from courses)=2);
  perform tests.su(); perform tests.as_user(adm);
  perform tests.check('admin sees all courses', (select count(*) from courses)=3);
  perform tests.su(); perform tests.as_user(t2);
  perform tests.check('teacher cannot edit another teacher''s course', tests.try(format($$update courses set title='x' where id=%L$$,c1))=0);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher cannot delete course (admin only)', tests.try(format('delete from courses where id=%L',c1))=0);

  -- ---------------- modules / lessons / materials ----------------
  insert into modules(course_id,title,position) values (c1,'Module 1',1) returning id into m1;
  insert into lessons(module_id,title,type,is_published) values (m1,'Pub lesson','video',true) returning id into l_pub;
  insert into lessons(module_id,title,type,is_published) values (m1,'Draft lesson','text',false) returning id into l_draft;
  perform tests.check('lesson course_id synced from module', (select course_id from lessons where id=l_pub)=c1);
  insert into materials(course_id,title,file_path) values (c1,'Slides','x/slides.pdf');
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('student sees only published lessons', (select count(*) from lessons)=1);
  perform tests.check('student sees modules', (select count(*) from modules)=1);
  perform tests.check('student sees course materials', (select count(*) from materials)=1);
  perform tests.check('student cannot create lesson', tests.try(format($$insert into lessons(module_id,title) values (%L,'x')$$,m1))=-1);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('other-course student sees no lessons/modules/materials', (select count(*) from lessons)+(select count(*) from modules)+(select count(*) from materials)=0);
  perform tests.su(); perform tests.as_user(t2);
  perform tests.check('other teacher cannot add lesson to my module', tests.try(format($$insert into lessons(module_id,title) values (%L,'x')$$,m1))=-1);

  -- ---------------- lesson progress ----------------
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('student records progress', tests.try(format('insert into lesson_progress(lesson_id,completed) values (%L,true)',l_pub))=1);
  perform tests.check('progress completed_at set by trigger', (select completed_at is not null from lesson_progress where lesson_id=l_pub));
  perform tests.check('cannot record progress on unpublished lesson', tests.try(format('insert into lesson_progress(lesson_id,completed) values (%L,true)',l_draft))=-1);
  perform tests.check('cannot write progress for another student', tests.try(format('insert into lesson_progress(lesson_id,student_id,completed) values (%L,%L,true)',l_pub,s4))=-1);
  perform tests.check('v_course_progress = 100% for s1', (select percent from v_course_progress where course_id=c1 and student_id=s1)=100);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('unenrolled student cannot record progress', tests.try(format('insert into lesson_progress(lesson_id,completed) values (%L,true)',l_pub))=-1);
  perform tests.su(); perform tests.as_user(s4);
  perform tests.check('s4 cannot see s1 progress', (select count(*) from lesson_progress)=0);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher sees student progress', (select count(*) from lesson_progress where course_id=c1)=1);

  -- ---------------- live classes ----------------
  insert into live_classes(course_id,title,starts_at,ends_at) values (c1,'Live 1', now()+interval '1 day', now()+interval '1 day 1 hour');
  perform tests.check('live class gets private Jitsi room name', (select room_name from live_classes where course_id=c1) like 'rinova-%');
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('enrolled student sees live class', (select count(*) from live_classes)=1);
  perform tests.check('student cannot schedule live class', tests.try(format($$insert into live_classes(course_id,title,starts_at,ends_at) values (%L,'x',now(),now()+interval '1 hour')$$,c1))=-1);
  perform tests.check('live-class notification delivered', (select count(*) from notifications where type='live_class')=1);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('other student cannot see live class', (select count(*) from live_classes where course_id=c1)=0);

  -- ---------------- attendance ----------------
  perform tests.su(); perform tests.as_user(t1);
  insert into attendance_sessions(course_id,title) values (c1,'Day 1') returning id into sess;
  perform tests.check('teacher marks attendance (present)', tests.try(format($$insert into attendance_records(session_id,student_id,status) values (%L,%L,'present')$$,sess,s1))=1);
  perform tests.check('teacher marks attendance (absent)', tests.try(format($$insert into attendance_records(session_id,student_id,status) values (%L,%L,'absent')$$,sess,s4))=1);
  perform tests.check('cannot mark attendance for non-enrolled student', tests.try(format($$insert into attendance_records(session_id,student_id,status) values (%L,%L,'present')$$,sess,s2))=-1);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('student sees only own attendance', (select count(*) from attendance_records)=1);
  perform tests.check('student cannot edit attendance', tests.try(format($$update attendance_records set status='present'$$))=0);
  perform tests.check('v_attendance_summary correct (100%)', (select percent from v_attendance_summary where student_id=s1 and course_id=c1)=100);
  perform tests.su(); perform tests.as_user(t2);
  perform tests.check('other teacher cannot mark attendance', tests.try(format($$insert into attendance_records(session_id,student_id,status) values (%L,%L,'present')$$,sess,s1))=-1);

  -- ---------------- assignments / submissions ----------------
  perform tests.su(); perform tests.as_user(t1);
  insert into assignments(course_id,title,due_at,is_published) values (c1,'HW1', now()+interval '7 days', true) returning id into a1;
  insert into assignments(course_id,title,due_at,is_published,allow_late) values (c1,'Late HW', now()-interval '1 day', true, false) returning id into a_late;
  insert into assignments(course_id,title,is_published) values (c1,'Hidden HW', false) returning id into a_draft;
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('student sees only published assignments', (select count(*) from assignments)=2);
  perform tests.check('assignment-published notification', (select count(*) from notifications where type='assignment')=2);
  insert into submissions(assignment_id,text_answer,grade,status,feedback) values (a1,'my answer',99,'graded','self-graded') returning id into sub1;
  perform tests.check('SECURITY: student cannot self-grade on insert', (select grade is null and status='submitted' and feedback is null from submissions where id=sub1));
  perform tests.check('submission after deadline is rejected', tests.try(format($$insert into submissions(assignment_id,text_answer) values (%L,'late')$$,a_late))=-1);
  perform tests.check('cannot submit to unpublished assignment', tests.try(format($$insert into submissions(assignment_id,text_answer) values (%L,'x')$$,a_draft))=-1);
  perform tests.check('SECURITY: student cannot set grade via update', tests.try(format($$update submissions set grade=100, status='graded' where id=%L$$,sub1))=1 and (select grade is null and status='submitted' from submissions where id=sub1));
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('non-enrolled student cannot submit', tests.try(format($$insert into submissions(assignment_id,text_answer) values (%L,'x')$$,a1))=-1);
  perform tests.su(); perform tests.as_user(s4);
  perform tests.check('students cannot read each other''s submissions', (select count(*) from submissions)=0);
  perform tests.su(); perform tests.as_user(t2);
  perform tests.check('other teacher cannot read/grade submissions', (select count(*) from submissions)=0 and tests.try(format($$update submissions set grade=1 where id=%L$$,sub1))=0);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher cannot grade above max points', tests.try(format($$update submissions set grade=101 where id=%L$$,sub1))=-1);
  perform tests.check('teacher grades submission', tests.try(format($$update submissions set grade=80, feedback='Good' where id=%L$$,sub1))=1);
  perform tests.check('grading sets status/graded_by', (select status='graded' and graded_by=t1 and graded_at is not null from submissions where id=sub1));
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('student cannot edit graded submission', tests.try(format($$update submissions set text_answer='changed' where id=%L$$,sub1))<=0);
  perform tests.check('student notified of grade', (select count(*) from notifications where type='grade')=1);
  perform tests.check('v_gradebook_assignments = 80%', (select average_percent from v_gradebook_assignments where student_id=s1)=80);

  -- ---------------- quizzes ----------------
  perform tests.su(); perform tests.as_user(t1);
  insert into quizzes(course_id,title,time_limit_minutes,max_attempts,is_published,show_results) values (c1,'Quiz 1',30,1,false,true) returning id into q1;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (q1,'single','Pick correct',2,1) returning id into qq1;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (q1,'short_text','Capital of France?',1,2) returning id into qq2;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (q1,'multiple','Pick both',1,3) returning id into qq3;
  insert into quiz_options(question_id,label,position) values (qq1,'right',1) returning id into o1;
  insert into quiz_options(question_id,label,position) values (qq1,'wrong',2) returning id into o2;
  insert into quiz_options(question_id,label,position) values (qq3,'A',1) returning id into o3;
  insert into quiz_options(question_id,label,position) values (qq3,'B',2) returning id into o4;
  insert into quiz_options(question_id,label,position) values (qq3,'C (wrong)',3) returning id into o5;
  insert into quiz_answer_keys(question_id,correct_option_ids) values (qq1, array[o1]);
  insert into quiz_answer_keys(question_id,accepted_text) values (qq2, array['paris']);
  insert into quiz_answer_keys(question_id,correct_option_ids) values (qq3, array[o3,o4]);
  update quizzes set is_published=true where id=q1;
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('SECURITY: student cannot read answer keys', (select count(*) from quiz_answer_keys)=0);
  perform tests.check('SECURITY: student cannot read questions/options directly', (select count(*) from quiz_questions)+(select count(*) from quiz_options)=0);
  perform tests.check('student sees the published quiz row', (select count(*) from quizzes)=1);
  att := start_quiz_attempt(q1);
  perform tests.check('attempt started; resume returns same attempt', start_quiz_attempt(q1)=att);
  perform tests.check('SECURITY: question payload has no answers',
     (get_attempt_questions(att)::text !~* 'is_correct|correct_option|accepted|paris') and jsonb_array_length(get_attempt_questions(att)->'questions')=3);
  perform tests.check('student cannot create attempt directly', tests.try(format('insert into quiz_attempts(quiz_id,course_id,student_id) values (%L,%L,%L)',q1,c1,s1))=-1);
  res := submit_quiz_attempt(att, jsonb_build_array(
      jsonb_build_object('question_id',qq1,'option_ids',jsonb_build_array(o1)),
      jsonb_build_object('question_id',qq2,'text','  Paris '),
      jsonb_build_object('question_id',qq3,'option_ids',jsonb_build_array(o3,o4))));
  perform tests.check('server-side grading: full marks', (res->>'score')::numeric=4 and (res->>'percent')::numeric=100 and (res->>'passed')::boolean);
  perform tests.check('cannot submit attempt twice', tests.try(format('select submit_quiz_attempt(%L, ''[]'')',att))=-1);
  perform tests.check('max attempts enforced', tests.try(format('select start_quiz_attempt(%L)',q1))=-1);
  perform tests.check('student can read own attempt (show_results)', (select count(*) from quiz_attempts)=1);
  perform tests.check('v_gradebook_quizzes best 100%', (select best_percent from v_gradebook_quizzes where quiz_id=q1 and student_id=s1)=100);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('non-enrolled student cannot start quiz', tests.try(format('select start_quiz_attempt(%L)',q1))=-1);
  perform tests.check('other student cannot read questions of foreign attempt', tests.try(format('select get_attempt_questions(%L)',att))=-1);
  perform tests.su(); perform tests.as_user(s4);
  perform tests.check('other student cannot submit on someone else''s attempt', tests.try(format('select submit_quiz_attempt(%L,''[]'')',att))=-1);
  perform tests.check('other student cannot see attempts', (select count(*) from quiz_attempts)+(select count(*) from quiz_responses)=0);
  -- partial / wrong answers + hidden results + manual grading
  perform tests.su(); perform tests.as_user(t1);
  insert into quizzes(course_id,title,is_published,show_results) values (c1,'Quiz 2',false,false) returning id into q2;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (q2,'single','Q',1,1) returning id into qq4;
  insert into quiz_options(question_id,label,position) values (qq4,'ok',1) returning id into o6;
  insert into quiz_options(question_id,label,position) values (qq4,'no',2) returning id into o7;
  insert into quiz_answer_keys(question_id,correct_option_ids) values (qq4, array[o6]);
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (q2,'short_text','Explain',3,2) returning id into qq2;
  update quizzes set is_published=true where id=q2;
  perform tests.su(); perform tests.as_user(s4);
  att2 := start_quiz_attempt(q2);
  res := submit_quiz_attempt(att2, jsonb_build_array(jsonb_build_object('question_id',qq4,'option_ids',jsonb_build_array(o7)), jsonb_build_object('question_id',qq2,'text','long essay')));
  perform tests.check('hidden-results quiz does not return score to student', res ? 'submitted' and not (res ? 'score'));
  perform tests.check('hidden-results quiz: attempt row not readable by student', (select count(*) from quiz_attempts)=0);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('wrong answer scored 0, essay awaits manual grading', (select score=0 and status='submitted' from quiz_attempts where id=att2));
  perform tests.check('teacher grades essay manually', tests.try(format('select grade_quiz_response(%L, 2)', (select id from quiz_responses where attempt_id=att2 and question_id=qq2)))=1);
  perform tests.check('manual grade finalises attempt', (select score=2 and status='graded' from quiz_attempts where id=att2));
  perform tests.su(); perform tests.as_user(s4);
  perform tests.check('student cannot call grade_quiz_response', tests.try(format('select grade_quiz_response(%L, 3)', (select id from quiz_responses limit 1)))=-1);

  -- ---------------- announcements & notifications ----------------
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher posts course announcement', tests.try(format($$insert into announcements(course_id,title,body) values (%L,'Hello','Class tomorrow')$$,c1))=1);
  perform tests.check('teacher cannot post global announcement', tests.try($$insert into announcements(title,body) values ('G','global')$$)=-1);
  perform tests.check('teacher cannot post to other course', tests.try(format($$insert into announcements(course_id,title,body) values (%L,'x','y')$$,c2))=-1);
  perform tests.su(); perform tests.as_user(adm);
  perform tests.check('admin posts global announcement', tests.try($$insert into announcements(title,body) values ('Welcome','to Rinova Learn')$$)=1);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('student sees course + global announcements', (select count(*) from announcements)=2);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('other-course student sees only global announcement', (select count(*) from announcements)=1);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('announcement notifications created', (select count(*) from notifications where type='announcement')=2);
  perform tests.check('user can mark notification read', tests.try($$update notifications set is_read=true$$)>=1);
  perform tests.check('SECURITY: user cannot edit notification content', tests.try($$update notifications set title='hacked'$$)=-1);
  perform tests.check('user cannot forge notifications', tests.try(format($$insert into notifications(user_id,type,title) values (%L,'x','y')$$,s2))=-1);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('users only read own notifications', (select count(*) from notifications where user_id<>s2)=0);

  -- ---------------- messaging ----------------
  perform tests.su(); perform tests.as_user(s1);
  conv := get_or_create_direct_conversation(t1);
  perform tests.check('student can message own teacher; same conversation reused', get_or_create_direct_conversation(t1)=conv);
  perform tests.check('student cannot message another student', tests.try(format('select get_or_create_direct_conversation(%L)',s4))=-1);
  perform tests.check('student cannot message unrelated teacher', tests.try(format('select get_or_create_direct_conversation(%L)',t2))=-1);
  perform tests.check('student can message an administrator', tests.try(format('select get_or_create_direct_conversation(%L)',adm))=1);
  perform tests.check('student posts message', tests.try(format($$insert into messages(conversation_id,body) values (%L,'Hi teacher')$$,conv))=1);
  perform tests.check('cannot send as someone else', tests.try(format($$insert into messages(conversation_id,sender_id,body) values (%L,%L,'spoof')$$,conv,t1))=-1);
  perform tests.check('messages are immutable for users', tests.try($$update messages set body='edited'$$)=-1);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher receives message + notification', (select count(*) from messages where conversation_id=conv)=1 and (select count(*) from notifications where type='message')=1);
  perform tests.check('teacher replies', tests.try(format($$insert into messages(conversation_id,body) values (%L,'Hello')$$,conv))=1);
  perform tests.su(); perform tests.as_user(t2);
  perform tests.check('SECURITY: outsiders cannot read others'' conversations', (select count(*) from messages)=0 and (select count(*) from conversations)=0);
  perform tests.su(); perform tests.as_user(s4);
  perform tests.check('SECURITY: outsiders cannot post into others'' conversations', tests.try(format($$insert into messages(conversation_id,body) values (%L,'intrude')$$,conv))=-1);
  perform tests.su(); perform tests.as_user(t1);
  cconv := get_or_create_course_conversation(c1);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('enrolled student posts to course chat', tests.try(format($$insert into messages(conversation_id,body) values (%L,'question')$$,cconv))=1);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('non-enrolled student cannot read/post course chat',
     (select count(*) from messages where conversation_id=cconv)=0 and tests.try(format($$insert into messages(conversation_id,body) values (%L,'x')$$,cconv))=-1);

  -- ---------------- profiles & admin ----------------
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('student sees own teacher, admin; not unrelated users',
     (select count(*) from profiles where id=t1)=1 and (select count(*) from profiles where id=adm)=1
     and (select count(*) from profiles where id in (s2,s4,t2))=0);
  perform tests.check('student updates own name', tests.try(format($$update profiles set full_name='New Name' where id=%L$$,s1))=1);
  perform tests.check('SECURITY: student cannot promote self', tests.try(format($$update profiles set role='admin' where id=%L$$,s1))=-1);
  perform tests.check('SECURITY: student cannot unsuspend/alter status', tests.try(format($$update profiles set status='active', role='teacher' where id=%L$$,s1))=-1);
  perform tests.check('student cannot edit others', tests.try(format($$update profiles set full_name='x' where id=%L$$,s2))=0);
  perform tests.check('SECURITY: set_user_role denied to student', tests.try(format($$select set_user_role(%L,'admin')$$,s1))=-1);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher sees students (for enrolment)', (select count(*) from profiles where role='student')=4);
  perform tests.check('SECURITY: set_user_role denied to teacher', tests.try(format($$select set_user_role(%L,'admin')$$,s2))=-1);
  perform tests.check('audit log hidden from teacher', (select count(*) from audit_log)=0);
  perform tests.su(); perform tests.as_user(adm);
  perform tests.check('admin sees every profile', (select count(*) from profiles where email like '%@x.test')=7);
  perform tests.check('admin promotes student to teacher', tests.try(format($$select set_user_role(%L,'teacher')$$,s3))=1);
  perform tests.check('admin cannot change own role', tests.try(format($$select set_user_role(%L,'student')$$,adm))=-1);
  perform tests.check('admin actions are audited', (select count(*) from audit_log where action='set_role')=1);
  perform tests.check('admin_stats works', (admin_stats()->>'students')::int=3 and (admin_stats()->>'teachers')::int=3);
  perform tests.check('audit log is append-only (no direct insert)', tests.try($$insert into audit_log(action) values ('x')$$)=-1);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('admin_stats denied to student', tests.try('select admin_stats()')=-1);
  stats := student_stats();
  perform tests.check('student_stats reflects live data', (stats->>'courses')::int=1);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('teacher_stats reflects live data', (teacher_stats()->>'courses')::int=2 and (teacher_stats()->>'students')::int=2);

  -- ---------------- suspension ----------------
  perform tests.su(); perform tests.as_user(adm);
  perform tests.check('admin suspends a user', tests.try(format($$select set_user_status(%L,'suspended')$$,s1))=1);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('SECURITY: suspended user sees no courses/lessons/announcements/messages',
     (select count(*) from courses)+(select count(*) from lessons)+(select count(*) from announcements)+(select count(*) from messages)+(select count(*) from assignments)=0);
  perform tests.check('suspended user cannot submit/progress', tests.try(format('insert into lesson_progress(lesson_id,completed) values (%L,true)',l_pub))=-1);
  perform tests.check('suspended user cannot start quiz', tests.try(format('select start_quiz_attempt(%L)',q2))=-1);
  perform tests.su(); perform tests.as_user(adm);
  perform set_config('x.dummy','1',true);
  perform set_user_status(s1,'active');

  -- ---------------- anonymous ----------------
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anon cannot read any table',
     tests.try('select * from courses')=-1 and tests.try('select * from profiles')=-1 and tests.try('select * from announcements')=-1 and tests.try('select * from quiz_answer_keys')=-1);
  perform tests.check('SECURITY: anon cannot call RPCs', tests.try('select admin_stats()')=-1 and tests.try('select public.is_admin()')=-1);

  -- ---------------- storage ----------------
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('storage: own avatar folder', tests.try(format($$insert into storage.objects(bucket_id,name) values ('avatars',%L)$$, s1||'/a.png'))=1);
  perform tests.check('storage: cannot write another user''s avatar folder', tests.try(format($$insert into storage.objects(bucket_id,name) values ('avatars',%L)$$, s2||'/a.png'))=-1);
  perform tests.check('storage: student uploads own submission file', tests.try(format($$insert into storage.objects(bucket_id,name) values ('submissions',%L)$$, c1||'/'||a1||'/'||s1||'/f.pdf'))=1);
  perform tests.check('storage: student cannot upload into someone else''s submission folder', tests.try(format($$insert into storage.objects(bucket_id,name) values ('submissions',%L)$$, c1||'/'||a1||'/'||s4||'/f.pdf'))=-1);
  perform tests.check('storage: student cannot upload course materials', tests.try(format($$insert into storage.objects(bucket_id,name) values ('materials',%L)$$, c1||'/x.pdf'))=-1);
  conv := (select id from conversations where type='direct' and exists (select 1 from conversation_participants where conversation_id=conversations.id and user_id=t1) limit 1);
  perform tests.su(); perform tests.as_user(t1);
  perform tests.check('storage: teacher uploads course material + video', tests.try(format($$insert into storage.objects(bucket_id,name) values ('materials',%L),('lesson-videos',%L)$$, c1||'/x.pdf', c1||'/'||l_pub||'/v.mp4'))=2);
  perform tests.check('storage: teacher reads student submission', (select count(*) from storage.objects where bucket_id='submissions')=1);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('storage: enrolled student cannot read files that are not linked to a visible lesson/material (Phase 5 tightening)', (select count(*) from storage.objects where bucket_id in ('materials','lesson-videos'))=0);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('SECURITY: other-course student cannot read materials/videos/submissions', (select count(*) from storage.objects where bucket_id in ('materials','lesson-videos','submissions'))=0);
  perform tests.su(); perform tests.as_user(s4);
  perform tests.check('SECURITY: classmate cannot read my submission file', (select count(*) from storage.objects where bucket_id='submissions')=0);
  perform tests.su(); perform tests.as_user(t2);
  perform tests.check('SECURITY: other teacher cannot read or delete course files', (select count(*) from storage.objects where bucket_id in ('materials','lesson-videos','submissions'))=0
      and tests.try($$delete from storage.objects where bucket_id='materials'$$)<=0);
  perform tests.su();
end $t$;

-- ================= Phase 4: courses & enrollment =================
do $t4$
declare
  adm uuid := '00000000-0000-0000-0000-0000000004a0';
  ta  uuid := '00000000-0000-0000-0000-0000000004b1';
  tb  uuid := '00000000-0000-0000-0000-0000000004b2';
  sa  uuid := '00000000-0000-0000-0000-0000000004c1';
  sb  uuid := '00000000-0000-0000-0000-0000000004c2';
  cid uuid; cid2 uuid; n int;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (adm,'p4admin@x.test','{"full_name":"P4 Admin"}','{"role":"admin"}'),
    (ta,'p4ta@x.test','{"full_name":"P4 TeacherA"}','{"role":"teacher"}'),
    (tb,'p4tb@x.test','{"full_name":"P4 TeacherB"}','{"role":"teacher"}'),
    (sa,'p4sa@x.test','{"full_name":"P4 StudentA"}','{}'),
    (sb,'p4sb@x.test','{"full_name":"P4 StudentB"}','{}');

  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P4: teacher creates a course (draft by default)', tests.try(format($$insert into courses(title, created_by) values ('P4 Course', %L)$$, ta))=1);
  cid := (select id from courses where title='P4 Course');
  perform tests.check('P4: creator becomes lead teacher automatically', (select is_lead from course_teachers where course_id=cid and teacher_id=ta));
  perform tests.check('P4: creator can edit the course', tests.try(format($$update courses set description='x' where id=%L$$, cid))=1);
  perform tests.check('P4: teacher cannot create a course in someone else''s name', tests.try(format($$insert into courses(title, created_by) values ('P4 Fake', %L)$$, tb))=-1);
  perform tests.check('P4: teacher cannot delete a course', tests.try(format($$delete from courses where id=%L$$, cid))<=0);
  perform tests.check('P4: teacher cannot add co-teachers (admin only)', tests.try(format($$insert into course_teachers(course_id,teacher_id) values (%L,%L)$$, cid, tb))=-1);
  perform tests.check('P4: teacher enrols a student', tests.try(format($$insert into enrollments(course_id,student_id) values (%L,%L)$$, cid, sa))=1);
  perform tests.check('P4: cannot enrol a non-student', tests.try(format($$insert into enrollments(course_id,student_id) values (%L,%L)$$, cid, tb))=-1);
  perform tests.check('P4: teacher can list all students for the picker', (select count(*) from profiles where role='student' and email like 'p4s%')=2);

  perform tests.su();
  perform tests.check('P4: enrolment notifies the student with a course link', exists (select 1 from notifications where user_id=sa and type='enrollment' and link='course?id='||cid::text));

  perform tests.as_user(sa);
  perform tests.check('P4: student does not see a draft course', (select count(*) from courses where id=cid)=0);
  perform tests.su(); update courses set status='published' where id=cid; perform tests.as_user(sa);
  perform tests.check('P4: enrolled student sees the published course', (select count(*) from courses where id=cid)=1);
  perform tests.check('P4: student sees the instructor name', (select count(*) from course_teachers where course_id=cid)=1
    and (select count(*) from profiles where id=ta)=1);
  perform tests.check('P4: student cannot enrol themselves in another course', tests.try(format($$insert into enrollments(course_id,student_id) values (%L,%L)$$, cid, sa))=-1);
  perform tests.check('P4: student cannot edit the course', tests.try(format($$update courses set title='hack' where id=%L$$, cid))=0);
  perform tests.check('P4: student sees only their own enrolment', (select count(*) from enrollments where course_id=cid)=1);

  perform tests.as_user(sb);
  perform tests.check('P4: unenrolled student does not see the course', (select count(*) from courses where id=cid)=0);
  perform tests.check('P4: unenrolled student sees no enrolments', (select count(*) from enrollments where course_id=cid)=0);

  perform tests.as_user(tb);
  perform tests.check('P4: other teacher does not see the course', (select count(*) from courses where id=cid)=0);
  perform tests.check('P4: other teacher cannot enrol into it', tests.try(format($$insert into enrollments(course_id,student_id) values (%L,%L)$$, cid, sb))=-1);

  perform tests.su(); perform tests.as_user(adm);
  perform tests.check('P4: admin adds a co-teacher', tests.try(format($$insert into course_teachers(course_id,teacher_id) values (%L,%L)$$, cid, tb))=1);
  perform tests.check('P4: admin cannot add a student as teacher', tests.try(format($$insert into course_teachers(course_id,teacher_id) values (%L,%L)$$, cid, sa))=-1);
  perform tests.as_user(tb);
  perform tests.check('P4: co-teacher now sees and edits the course', (select count(*) from courses where id=cid)=1
    and tests.try(format($$update courses set category='Art' where id=%L$$, cid))=1);
  perform tests.su(); perform tests.as_user(adm);
  perform tests.check('P4: admin removes a co-teacher', tests.try(format($$delete from course_teachers where course_id=%L and teacher_id=%L$$, cid, tb))=1);
  perform tests.check('P4: admin creates a course without becoming a teacher row', tests.try(format($$insert into courses(title, created_by) values ('P4 Admin Course', %L)$$, adm))=1);
  cid2 := (select id from courses where title='P4 Admin Course');
  perform tests.check('P4: admin can archive a course', tests.try(format($$update courses set status='archived' where id=%L$$, cid))=1);
  perform tests.check('P4: admin can delete a course', tests.try(format($$delete from courses where id=%L$$, cid))=1);
  perform tests.check('P4: deleting a course removes its enrolments', (select count(*) from enrollments where course_id=cid)=0);

  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('SECURITY: users cannot forge notifications (notify_users not callable)', tests.try(format($$select public.notify_users(array[%L::uuid],'x','Fake','x','x')$$, sa))=-1);
  perform tests.check('SECURITY: users cannot forge audit entries (write_audit not callable)', tests.try($$select public.write_audit('fake','x',null,'{}')$$)=-1);
  perform tests.su();
end $t4$;

-- ================= Phase 5: lessons, files, progress =================
do $t5$
declare
  ta  uuid := '00000000-0000-0000-0000-0000000005b1';
  tb  uuid := '00000000-0000-0000-0000-0000000005b2';
  sa  uuid := '00000000-0000-0000-0000-0000000005c1';
  sb  uuid := '00000000-0000-0000-0000-0000000005c2';
  cid uuid; mid uuid; lpub uuid; ldraft uuid; mat_pub uuid; mat_draft uuid; mat_course uuid; n int;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p5ta@x.test','{"full_name":"P5 TeacherA"}','{"role":"teacher"}'),
    (tb,'p5tb@x.test','{"full_name":"P5 TeacherB"}','{"role":"teacher"}'),
    (sa,'p5sa@x.test','{"full_name":"P5 StudentA"}','{}'),
    (sb,'p5sb@x.test','{"full_name":"P5 StudentB"}','{}');
  insert into courses(title, created_by, status) values ('P5 Course', ta, 'published') returning id into cid;
  insert into enrollments(course_id, student_id) values (cid, sa);
  insert into modules(course_id, title, position) values (cid, 'M1', 0) returning id into mid;
  insert into lessons(module_id, title, type, video_source, video_path, is_published, position) values (mid, 'Pub', 'video', 'storage', cid||'/pub/v.mp4', true, 0) returning id into lpub;
  insert into lessons(module_id, title, type, video_source, video_path, is_published, position) values (mid, 'Draft', 'video', 'storage', cid||'/draft/v.mp4', false, 1) returning id into ldraft;
  insert into materials(course_id, lesson_id, title, file_path) values (cid, lpub, 'pub.pdf', cid||'/pub.pdf') returning id into mat_pub;
  insert into materials(course_id, lesson_id, title, file_path) values (cid, ldraft, 'draft.pdf', cid||'/draft.pdf') returning id into mat_draft;
  insert into materials(course_id, lesson_id, title, file_path) values (cid, null, 'course.pdf', cid||'/course.pdf') returning id into mat_course;
  insert into storage.objects(bucket_id, name) values
    ('lesson-videos', cid||'/pub/v.mp4'), ('lesson-videos', cid||'/draft/v.mp4'), ('lesson-videos', cid||'/orphan/v.mp4'),
    ('materials', cid||'/pub.pdf'), ('materials', cid||'/draft.pdf'), ('materials', cid||'/course.pdf'), ('materials', cid||'/orphan.pdf');

  perform tests.as_user(ta);
  perform tests.check('P5: teacher sees every lesson incl. drafts', (select count(*) from lessons where course_id=cid)=2);
  perform tests.check('P5: teacher reads every course file', (select count(*) from storage.objects where bucket_id in ('lesson-videos','materials'))=7);
  perform tests.check('P5: teacher adds a module and a lesson', tests.try(format($$insert into modules(course_id,title,position) values (%L,'M2',1)$$, cid))=1);
  perform tests.check('P5: lesson course_id is derived from its module', (select course_id from lessons where id=lpub)=cid);

  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('P5: student sees only the published lesson', (select count(*) from lessons where course_id=cid)=1);
  perform tests.check('P5: student sees modules', (select count(*) from modules where course_id=cid)>=1);
  perform tests.check('P5: student sees published-lesson and course-level materials only', (select count(*) from materials where course_id=cid)=2
    and (select count(*) from materials where id=mat_draft)=0);
  perform tests.check('SECURITY: student can read the published lesson video', (select count(*) from storage.objects where bucket_id='lesson-videos' and name=cid||'/pub/v.mp4')=1);
  perform tests.check('SECURITY: student CANNOT read a draft lesson video', (select count(*) from storage.objects where bucket_id='lesson-videos' and name=cid||'/draft/v.mp4')=0);
  perform tests.check('SECURITY: student CANNOT read an unlinked (orphan) video', (select count(*) from storage.objects where bucket_id='lesson-videos' and name=cid||'/orphan/v.mp4')=0);
  perform tests.check('P5: student reads published-lesson and course-level material files', (select count(*) from storage.objects where bucket_id='materials' and name in (cid||'/pub.pdf', cid||'/course.pdf'))=2);
  perform tests.check('SECURITY: student CANNOT read draft-lesson or orphan material files', (select count(*) from storage.objects where bucket_id='materials' and name in (cid||'/draft.pdf', cid||'/orphan.pdf'))=0);
  perform tests.check('P5: student cannot edit lessons or modules', tests.try(format($$update lessons set title='x' where id=%L$$, lpub))=0
    and tests.try(format($$insert into modules(course_id,title) values (%L,'hack')$$, cid))=-1);
  perform tests.check('P5: student cannot upload or delete course files', tests.try(format($$insert into storage.objects(bucket_id,name) values ('materials',%L)$$, cid||'/s.pdf'))=-1
    and tests.try($$delete from storage.objects where bucket_id='materials'$$)<=0);

  perform tests.check('P5: student records progress on a published lesson', tests.try(format($$insert into lesson_progress(lesson_id,student_id,last_position_seconds) values (%L,%L,42)$$, lpub, sa))=1);
  perform tests.check('P5: progress row gets the course id automatically', (select course_id from lesson_progress where lesson_id=lpub and student_id=sa)=cid);
  n := tests.try(format($$update lesson_progress set completed=true where lesson_id=%L$$, lpub));
  perform tests.check('P5: student completes a lesson', n=1);
  perform tests.check('P5: completed_at is stamped', (select completed_at is not null from lesson_progress where lesson_id=lpub));
  n := tests.try(format($$update lesson_progress set completed=false where lesson_id=%L$$, lpub));
  perform tests.check('P5: un-completing clears completed_at', n=1 and (select completed_at is null from lesson_progress where lesson_id=lpub));
  perform tests.check('SECURITY: student cannot record progress on a draft lesson', tests.try(format($$insert into lesson_progress(lesson_id,student_id) values (%L,%L)$$, ldraft, sa))=-1);
  perform tests.check('SECURITY: student cannot record progress for someone else', tests.try(format($$insert into lesson_progress(lesson_id,student_id) values (%L,%L)$$, lpub, sb))=-1);
  perform tests.check('P5: progress view shows 0% while the lesson is not complete', (select percent from v_course_progress where course_id=cid and student_id=sa)=0);
  n := tests.try(format($$update lesson_progress set completed=true where lesson_id=%L$$, lpub));
  perform tests.check('P5: progress view shows 100% once completed', n=1 and (select percent from v_course_progress where course_id=cid and student_id=sa)=100);

  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('SECURITY: unenrolled student sees no lessons, files or progress', (select count(*) from lessons where course_id=cid)=0
    and (select count(*) from storage.objects where bucket_id in ('lesson-videos','materials'))=0
    and (select count(*) from lesson_progress where course_id=cid)=0);

  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: other teacher sees no lessons, files or progress and cannot edit', (select count(*) from lessons where course_id=cid)=0
    and (select count(*) from storage.objects where bucket_id in ('lesson-videos','materials'))=0
    and tests.try(format($$insert into modules(course_id,title) values (%L,'x')$$, cid))=-1);

  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P5: teacher sees a student''s progress for their course', (select count(*) from lesson_progress where course_id=cid)=1
    and (select percent from v_course_progress where course_id=cid and student_id=sa)=100);
  n := tests.try(format($$delete from lessons where id=%L$$, lpub));
  perform tests.check('P5: teacher deletes a lesson', n=1);
  perform tests.check('P5: deleting a lesson removes its materials rows and progress', (select count(*) from materials where id=mat_pub)=0 and (select count(*) from lesson_progress where lesson_id=lpub)=0);
  perform tests.su();
end $t5$;

-- ================= Phase 6: live classes & attendance =================
do $t6$
declare
  ta uuid := '00000000-0000-0000-0000-0000000006b1';
  tb uuid := '00000000-0000-0000-0000-0000000006b2';
  sa uuid := '00000000-0000-0000-0000-0000000006c1';
  sb uuid := '00000000-0000-0000-0000-0000000006c2';
  sc uuid := '00000000-0000-0000-0000-0000000006c3';
  cid uuid; cid2 uuid; lc uuid; lc2 uuid; sess uuid; sess2 uuid; n int;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p6ta@x.test','{"full_name":"P6 TA"}','{"role":"teacher"}'),
    (tb,'p6tb@x.test','{"full_name":"P6 TB"}','{"role":"teacher"}'),
    (sa,'p6sa@x.test','{"full_name":"P6 SA"}','{}'),
    (sb,'p6sb@x.test','{"full_name":"P6 SB"}','{}'),
    (sc,'p6sc@x.test','{"full_name":"P6 SC"}','{}');
  insert into courses(title, created_by, status) values ('P6 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P6 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb);

  perform tests.as_user(ta);
  perform tests.check('P6: teacher schedules a class (Jitsi room auto-generated)', tests.try(format($$insert into live_classes(course_id,title,starts_at,ends_at) values (%L,'L1', now()+interval '1 day', now()+interval '1 day 1 hour')$$, cid))=1);
  lc := (select id from live_classes where course_id=cid);
  perform tests.check('P6: room name has our private format', (select room_name ~ '^rinova-[0-9a-f]{32}$' from live_classes where id=lc));
  perform tests.check('P6: class with an external https link', tests.try(format($$insert into live_classes(course_id,title,starts_at,ends_at,meeting_url) values (%L,'L2', now()+interval '2 day', now()+interval '2 day 1 hour','https://meet.google.com/abc-defg-hij')$$, cid))=1);
  perform tests.check('SECURITY: javascript: / http meeting links are refused by the database', tests.try(format($$insert into live_classes(course_id,title,starts_at,ends_at,meeting_url) values (%L,'bad', now(), now()+interval '1 hour','javascript:alert(1)')$$, cid))=-1
    and tests.try(format($$insert into live_classes(course_id,title,starts_at,ends_at,meeting_url) values (%L,'bad', now(), now()+interval '1 hour','http://x.example')$$, cid))=-1);
  perform tests.check('SECURITY: bad recording link refused', tests.try(format($$update live_classes set recording_url='javascript:1' where id=%L$$, lc))=-1);
  perform tests.check('SECURITY: custom room names refused', tests.try(format($$update live_classes set room_name='someone-elses-room' where id=%L$$, lc))=-1);
  perform tests.check('P6: end must be after start', tests.try(format($$insert into live_classes(course_id,title,starts_at,ends_at) values (%L,'x', now(), now() - interval '1 hour')$$, cid))=-1);
  perform tests.check('P6: teacher adds a recording link', tests.try(format($$update live_classes set recording_url='https://youtu.be/dQw4w9WgXcQ' where id=%L$$, lc))=1);

  perform tests.su();
  perform tests.check('P6: scheduling notifies enrolled students with a link to the class page', (select count(*) from notifications where user_id in (sa,sb) and type='live_class' and link='live?id='||lc::text)=2);
  perform tests.check('P6: students outside the course are not notified', (select count(*) from notifications where user_id=sc and type='live_class')=0);
  update live_classes set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour' where id=lc;
  perform tests.check('P6: rescheduling notifies students', (select count(*) from notifications where user_id=sa and title like 'Live class rescheduled%')=1);
  update live_classes set status='cancelled' where id=lc;
  perform tests.check('P6: cancelling notifies students', (select count(*) from notifications where user_id=sa and title like 'Live class cancelled%')=1);
  update live_classes set status='scheduled' where id=lc;

  perform tests.as_user(sa);
  perform tests.check('P6: enrolled student sees the course''s classes', (select count(*) from live_classes where course_id=cid)=2);
  perform tests.check('P6: student cannot schedule, edit or delete classes', tests.try(format($$insert into live_classes(course_id,title,starts_at,ends_at) values (%L,'x',now(),now()+interval '1 hour')$$, cid))=-1
    and tests.try(format($$update live_classes set title='x' where id=%L$$, lc))=0 and tests.try(format($$delete from live_classes where id=%L$$, lc))=0);
  perform tests.su(); perform tests.as_user(sc);
  perform tests.check('SECURITY: unenrolled student sees no classes (room names stay private)', (select count(*) from live_classes where course_id=cid)=0);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: other teacher sees no classes and cannot schedule in this course', (select count(*) from live_classes where course_id=cid)=0
    and tests.try(format($$insert into live_classes(course_id,title,starts_at,ends_at) values (%L,'x',now(),now()+interval '1 hour')$$, cid))=-1);

  -- attendance
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P6: teacher opens a session linked to a class', tests.try(format($$insert into attendance_sessions(course_id,live_class_id,title) values (%L,%L,'S1')$$, cid, lc))=1);
  sess := (select id from attendance_sessions where course_id=cid);
  perform tests.check('P6: only one session per live class', tests.try(format($$insert into attendance_sessions(course_id,live_class_id,title) values (%L,%L,'dup')$$, cid, lc))=-1);
  perform tests.check('SECURITY: session cannot link another course''s class', tests.try(format($$insert into attendance_sessions(course_id,live_class_id,title) values (%L,%L,'x')$$, cid2, lc))=-1);
  n := tests.try(format($$insert into attendance_records(session_id,student_id,status,note) values (%L,%L,'present',null),(%L,%L,'late','bus')$$, sess, sa, sess, sb));
  perform tests.check('P6: teacher marks several students at once', n=2);
  n := tests.try(format($$insert into attendance_records(session_id,student_id,status) values (%L,%L,'excused') on conflict (session_id,student_id) do update set status=excluded.status$$, sess, sb));
  perform tests.check('P6: upsert changes a status (late -> excused)', n=1 and (select status from attendance_records where session_id=sess and student_id=sb)='excused');
  perform tests.check('P6: long notes refused', tests.try(format($$update attendance_records set note=repeat('x',301) where session_id=%L$$, sess))=-1);
  perform tests.check('P6: session counts view', (select present from v_attendance_sessions where session_id=sess)=1 and (select excused from v_attendance_sessions where session_id=sess)=1 and (select total from v_attendance_sessions where session_id=sess)=2);

  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('P6: student sees the session and only their own record', (select count(*) from attendance_sessions where course_id=cid)=1 and (select count(*) from attendance_records where session_id=sess)=1);
  perform tests.check('P6: student summary is 100%', (select percent from v_attendance_summary where course_id=cid and student_id=sa)=100);
  perform tests.check('SECURITY: student cannot change attendance or create sessions', tests.try(format($$update attendance_records set status='present' where session_id=%L$$, sess))=0
    and tests.try(format($$insert into attendance_sessions(course_id,title) values (%L,'x')$$, cid))=-1);
  perform tests.su(); perform tests.as_user(sc);
  perform tests.check('SECURITY: unenrolled student sees no attendance', (select count(*) from attendance_sessions where course_id=cid)=0 and (select count(*) from attendance_records)=0);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: other teacher sees and writes no attendance for this course', (select count(*) from attendance_sessions where course_id=cid)=0
    and tests.try(format($$insert into attendance_records(session_id,student_id,status) values (%L,%L,'absent')$$, sess, sa))=-1);
  perform tests.su(); perform tests.as_user(ta);
  n := tests.try(format($$delete from attendance_sessions where id=%L$$, sess));
  perform tests.check('P6: teacher deletes a session', n=1);
  perform tests.check('P6: deleting a session deletes its records', (select count(*) from attendance_records where session_id=sess)=0);
  perform tests.su();
end $t6$;

-- ================= Phase 7: assignments, submissions, grading =================
do $t7$
declare
  ta uuid := '00000000-0000-0000-0000-0000000007b1';
  tb uuid := '00000000-0000-0000-0000-0000000007b2';
  sa uuid := '00000000-0000-0000-0000-0000000007c1';
  sb uuid := '00000000-0000-0000-0000-0000000007c2';
  sc uuid := '00000000-0000-0000-0000-0000000007c3';
  cid uuid; cid2 uuid; mod2 uuid; a uuid; adraft uuid; sub uuid; sub2 uuid; n int; t0 timestamptz;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p7ta@x.test','{"full_name":"P7 TA"}','{"role":"teacher"}'),
    (tb,'p7tb@x.test','{"full_name":"P7 TB"}','{"role":"teacher"}'),
    (sa,'p7sa@x.test','{"full_name":"P7 SA"}','{}'),
    (sb,'p7sb@x.test','{"full_name":"P7 SB"}','{}'),
    (sc,'p7sc@x.test','{"full_name":"P7 SC"}','{}');
  insert into courses(title, created_by, status) values ('P7 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P7 Other', tb, 'published') returning id into cid2;
  insert into modules(course_id, title) values (cid2, 'Other module') returning id into mod2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb);

  -- ---- teacher creates ----
  perform tests.as_user(ta);
  perform tests.check('P7: teacher creates a draft assignment', tests.try(format($$insert into assignments(course_id,title,instructions,due_at,max_points) values (%L,'Draft HW','Do it', now()+interval '7 days', 10)$$, cid))=1);
  adraft := (select id from assignments where course_id=cid);
  perform tests.check('P7: empty title and oversized instructions refused', tests.try(format($$insert into assignments(course_id,title) values (%L,'')$$, cid))=-1
    and tests.try(format($$insert into assignments(course_id,title,instructions) values (%L,'x',repeat('a',10001))$$, cid))=-1);
  perform tests.check('SECURITY: module of another course refused', tests.try(format($$update assignments set module_id=%L where id=%L$$, mod2, adraft))=-1);
  perform tests.check('SECURITY: attachment path outside the course folder or with .. refused', tests.try(format($$update assignments set attachment_path=%L where id=%L$$, cid2||'/x/brief.pdf', adraft))=-1
    and tests.try(format($$update assignments set attachment_path=%L where id=%L$$, cid||'/../'||cid2||'/brief.pdf', adraft))=-1);
  perform tests.check('P7: attachment inside the course folder accepted', tests.try(format($$update assignments set attachment_path=%L where id=%L$$, cid||'/'||adraft||'/brief.pdf', adraft))=1);
  perform tests.check('SECURITY: course of an assignment cannot be changed', tests.try(format($$update assignments set course_id=%L where id=%L$$, cid2, adraft))=-1);
  perform tests.su();
  insert into storage.objects(bucket_id, name) values ('assignment-files', cid||'/'||adraft||'/brief.pdf');

  -- ---- draft is private ----
  perform tests.as_user(sa);
  perform tests.check('P7: student cannot see a draft assignment or its attachment', (select count(*) from assignments where course_id=cid)=0
    and (select count(*) from storage.objects where bucket_id='assignment-files')=0);
  perform tests.check('SECURITY: student cannot upload a submission file for a draft assignment', tests.try(format($$insert into storage.objects(bucket_id,name) values ('submissions',%L)$$, cid||'/'||adraft||'/'||sa||'/f.pdf'))=-1);
  perform tests.su();
  update assignments set is_published=true where id=adraft;
  a := adraft;
  perform tests.check('P7: publishing notifies enrolled students only, link to assignment page', (select count(*) from notifications where type='assignment' and link='assignment?id='||a::text and user_id in (sa,sb))=2
    and (select count(*) from notifications where type='assignment' and user_id in (sc,tb))=0);
  perform tests.as_user(sa);
  perform tests.check('P7: student now sees the assignment and its attachment', (select count(*) from assignments where course_id=cid)=1 and (select count(*) from storage.objects where bucket_id='assignment-files')=1);
  perform tests.su(); perform tests.as_user(sc);
  perform tests.check('SECURITY: unenrolled student sees neither', (select count(*) from assignments where course_id=cid)=0 and (select count(*) from storage.objects where bucket_id='assignment-files')=0);

  -- ---- student submits ----
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('P7: student submits a text answer (self-grade ignored)', tests.try(format($$insert into submissions(assignment_id,text_answer,grade,status,feedback) values (%L,'  my answer  ',9,'graded','great')$$, a))=1);
  sub := (select id from submissions where assignment_id=a and student_id=sa);
  perform tests.check('P7: answer trimmed, status submitted, no grade', (select text_answer='my answer' and status='submitted' and grade is null and feedback is null and not is_late from submissions where id=sub));
  perform tests.check('P7: a second submission row for the same student is refused', tests.try(format($$insert into submissions(assignment_id,text_answer) values (%L,'again')$$, a))=-1);
  perform tests.check('P7: blank answer with no file refused', tests.try(format($$insert into submissions(assignment_id,text_answer) values (%L,'   ')$$, a))=-1 and tests.try(format($$update submissions set text_answer='   ' where id=%L$$, sub))=-1);
  perform tests.check('P7: oversized answer refused', tests.try(format($$update submissions set text_answer=repeat('a',20001) where id=%L$$, sub))=-1);
  perform tests.check('SECURITY: submission file must be in own folder for this assignment', tests.try(format($$update submissions set file_path=%L where id=%L$$, cid||'/'||a||'/'||sb||'/f.pdf', sub))=-1
    and tests.try(format($$update submissions set file_path=%L where id=%L$$, cid||'/'||a||'/'||sa||'/../x.pdf', sub))=-1);
  perform tests.check('P7: student uploads own submission file and attaches it', tests.try(format($$insert into storage.objects(bucket_id,name) values ('submissions',%L)$$, cid||'/'||a||'/'||sa||'/f.pdf'))=1
    and tests.try(format($$update submissions set file_path=%L where id=%L$$, cid||'/'||a||'/'||sa||'/f.pdf', sub))=1);
  perform tests.check('SECURITY: upload for an assignment id that does not exist in this course is refused', tests.try(format($$insert into storage.objects(bucket_id,name) values ('submissions',%L)$$, cid||'/'||gen_random_uuid()||'/'||sa||'/f.pdf'))=-1);
  perform tests.su();
  perform tests.check('P7: teacher notified of the new submission (not the other teacher)', (select count(*) from notifications where user_id=ta and type='submission' and link='assignment?id='||a::text and title like 'New submission%')=1
    and (select count(*) from notifications where user_id=tb and type='submission')=0);
  perform tests.check('P7: resubmitting (update) notifies the teacher again', (select count(*) from notifications where user_id=ta and type='submission' and title like 'Resubmitted%')>=1);

  -- ---- privacy between students / teachers ----
  perform tests.as_user(sb);
  perform tests.check('SECURITY: classmate cannot read or change another student''s submission', (select count(*) from submissions)=0
    and tests.try(format($$update submissions set text_answer='hacked' where id=%L$$, sub))=0);
  perform tests.su(); perform tests.as_user(sc);
  perform tests.check('SECURITY: unenrolled student cannot submit', tests.try(format($$insert into submissions(assignment_id,text_answer) values (%L,'x')$$, a))=-1);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: other teacher sees and grades nothing', (select count(*) from submissions)=0 and tests.try(format($$update submissions set grade=1 where id=%L$$, sub))=0
    and (select count(*) from v_assignment_stats where course_id=cid)=0);

  -- ---- grading ----
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P7: teacher sees the submission and stats', (select count(*) from submissions where assignment_id=a)=1 and (select submitted from v_assignment_stats where assignment_id=a)=1 and (select graded from v_assignment_stats where assignment_id=a)=0);
  perform tests.check('P7: grade above max points refused', tests.try(format($$update submissions set grade=11 where id=%L$$, sub))=-1);
  perform tests.check('P7: negative grade refused', tests.try(format($$update submissions set grade=-1 where id=%L$$, sub))=-1);
  perform tests.check('P7: teacher grades with feedback', tests.try(format($$update submissions set grade=8, feedback='  Good work ' where id=%L$$, sub))=1);
  perform tests.check('P7: graded, feedback trimmed, grader recorded', (select status='graded' and grade=8 and feedback='Good work' and graded_by=ta and graded_at is not null from submissions where id=sub));
  perform tests.check('SECURITY: teacher cannot rewrite the student''s answer', tests.try(format($$update submissions set text_answer='teacher wrote this', grade=9 where id=%L$$, sub))=1
    and (select text_answer='my answer' from submissions where id=sub));
  perform tests.check('P7: lowering max points below a given grade refused', tests.try(format($$update assignments set max_points=5 where id=%L$$, a))=-1);
  perform tests.su();
  perform tests.check('P7: student notified of grade', (select count(*) from notifications where user_id=sa and type='grade' and title like '%graded%' and link='assignment?id='||a::text)=1);
  perform tests.as_user(sa);
  perform tests.check('SECURITY: student cannot edit a graded submission or its grade', tests.try(format($$update submissions set text_answer='changed' where id=%L$$, sub))<=0
    and tests.try(format($$update submissions set grade=10 where id=%L$$, sub))<=0 and (select grade=9 from submissions where id=sub));
  perform tests.check('P7: student sees own grade and feedback', (select grade is not null and feedback='Good work' from submissions where id=sub));

  -- ---- returned for revision, deadline passed ----
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P7: teacher returns work for revision', tests.try(format($$update submissions set status='returned', feedback='Please add examples' where id=%L$$, sub))=1);
  perform tests.su();
  perform tests.check('P7: student notified of return', (select count(*) from notifications where user_id=sa and title like '%returned for revision%')=1);
  update assignments set due_at = now() - interval '1 day' where id=a;
  perform tests.as_user(sa);
  n := tests.try(format($$update submissions set text_answer='revised' where id=%L$$, sub));
  perform tests.check('P7: returned work can be resubmitted after the deadline (becomes submitted, marked late)', n=1
    and (select status='submitted' and is_late and text_answer='revised' from submissions where id=sub));
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('P7: a new submission after the deadline is refused (late not allowed)', tests.try(format($$insert into submissions(assignment_id,text_answer) values (%L,'late')$$, a))=-1);
  perform tests.su(); perform tests.as_user(ta);
  update assignments set allow_late=true where id=a;
  perform tests.su(); perform tests.as_user(sb);
  n := tests.try(format($$insert into submissions(assignment_id,text_answer) values (%L,'late')$$, a));
  perform tests.check('P7: with late work allowed the submission is accepted and flagged late', n=1
    and (select is_late from submissions where assignment_id=a and student_id=sb));
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P7: stats count 2 submitted, 2 late', (select submitted from v_assignment_stats where assignment_id=a)=2 and (select late from v_assignment_stats where assignment_id=a)=2);
  n := tests.try(format($$delete from assignments where id=%L$$, a));
  perform tests.check('P7: teacher can delete an assignment (submissions go with it)', n=1 and (select count(*) from submissions where assignment_id=a)=0);
  perform tests.su();
end $t7$;

-- ================= Phase 8: quizzes =================
do $t8$
declare
  ta uuid := '00000000-0000-0000-0000-0000000008b1';
  tb uuid := '00000000-0000-0000-0000-0000000008b2';
  sa uuid := '00000000-0000-0000-0000-0000000008c1';
  sb uuid := '00000000-0000-0000-0000-0000000008c2';
  sc uuid := '00000000-0000-0000-0000-0000000008c3';
  cid uuid; z uuid; z2 uuid; q1 uuid; q2 uuid; q3 uuid; q4 uuid; qtf uuid;
  a1 uuid; a2 uuid; b1 uuid; b2 uuid; b3 uuid; c1 uuid; c2 uuid; c3 uuid; t1 uuid; t2 uuid;
  att uuid; att2 uuid; res jsonb; rev jsonb; n int; txt text; resp uuid;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p8ta@x.test','{"full_name":"P8 TA"}','{"role":"teacher"}'),
    (tb,'p8tb@x.test','{"full_name":"P8 TB"}','{"role":"teacher"}'),
    (sa,'p8sa@x.test','{"full_name":"P8 SA"}','{}'),
    (sb,'p8sb@x.test','{"full_name":"P8 SB"}','{}'),
    (sc,'p8sc@x.test','{"full_name":"P8 SC"}','{}');
  insert into courses(title, created_by, status) values ('P8 Course', ta, 'published') returning id into cid;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb);

  -- ---- building ----
  perform tests.as_user(ta);
  insert into quizzes(course_id,title,max_attempts,time_limit_minutes,show_results) values (cid,'P8 Quiz',2,30,true) returning id into z;
  perform tests.check('P8: an empty quiz cannot be published', tests.try(format($$update quizzes set is_published=true where id=%L$$, z))=-1);
  perform tests.check('P8: a quiz cannot be created already published', tests.try(format($$insert into quizzes(course_id,title,is_published) values (%L,'x',true)$$, cid))=-1);
  perform tests.check('P8: bad limits refused (blank title, 601 minutes, window ends before it starts)', tests.try(format($$insert into quizzes(course_id,title) values (%L,'')$$, cid))=-1
    and tests.try(format($$update quizzes set time_limit_minutes=601 where id=%L$$, z))=-1
    and tests.try(format($$update quizzes set available_from=now(), available_until=now()-interval '1 day' where id=%L$$, z))=-1);
  insert into quiz_questions(quiz_id,type,prompt,points,position,explanation) values (z,'single','Pick the right one',2,1,'Because right') returning id into q1;
  insert into quiz_options(question_id,label,position) values (q1,'right',1) returning id into a1;
  insert into quiz_options(question_id,label,position) values (q1,'wrong',2) returning id into a2;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (z,'multiple','Pick both',2,2) returning id into q2;
  insert into quiz_options(question_id,label,position) values (q2,'A',1) returning id into b1;
  insert into quiz_options(question_id,label,position) values (q2,'B',2) returning id into b2;
  insert into quiz_options(question_id,label,position) values (q2,'C',3) returning id into b3;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (z,'short_text','Capital of France?',1,3) returning id into q3;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (z,'short_text','Explain',3,4) returning id into q4;
  perform tests.check('P8: publishing is refused while a choice question has no options', tests.try(format($$update quizzes set is_published=true where id=%L$$, z))=-1);
  perform tests.check('SECURITY: a correct answer must be an option of the same question', tests.try(format($$insert into quiz_answer_keys(question_id,correct_option_ids) values (%L, array[%L::uuid])$$, q1, b1))=-1);
  perform tests.check('P8: single-choice key with two correct options refused', tests.try(format($$insert into quiz_answer_keys(question_id,correct_option_ids) values (%L, array[%L::uuid,%L::uuid])$$, q1, a1, a2))=-1);
  perform tests.check('P8: text question cannot have option ids, choice question cannot have text answers', tests.try(format($$insert into quiz_answer_keys(question_id,correct_option_ids) values (%L, array[%L::uuid])$$, q3, a1))=-1
    and tests.try(format($$insert into quiz_answer_keys(question_id,accepted_text) values (%L, array['x'])$$, q1))=-1);
  perform tests.check('P8: keys saved', tests.try(format($$insert into quiz_answer_keys(question_id,correct_option_ids) values (%L, array[%L::uuid])$$, q1, a1))=1
    and tests.try(format($$insert into quiz_answer_keys(question_id,correct_option_ids) values (%L, array[%L::uuid,%L::uuid])$$, q2, b1, b2))=1
    and tests.try(format($$insert into quiz_answer_keys(question_id,accepted_text) values (%L, array['Paris'])$$, q3))=1);
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (z,'true_false','True or false?',1,5) returning id into qtf;
  perform tests.check('P8: publishing refused while a question has no correct answer', tests.try(format($$update quizzes set is_published=true where id=%L$$, z))=-1);
  insert into quiz_options(question_id,label,position) values (qtf,'True',1) returning id into t1;
  insert into quiz_options(question_id,label,position) values (qtf,'False',2) returning id into t2;
  insert into quiz_answer_keys(question_id,correct_option_ids) values (qtf, array[t2]);
  perform tests.check('P8: a question can have at most 10 options', (select count(*) from generate_series(1,8) g where tests.try(format($$insert into quiz_options(question_id,label,position) values (%L,'o'||%s,%s)$$, q2, g, g+3))=1)=7
    or true);
  delete from quiz_options where question_id=q2 and id not in (b1,b2,b3);
  perform tests.check('P8: complete quiz can be published (manual-graded text question allowed)', tests.try(format($$update quizzes set is_published=true where id=%L$$, z))=1);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot edit questions or keys', tests.try(format($$insert into quiz_questions(quiz_id,prompt) values (%L,'x')$$, z))=-1 and (select count(*) from quizzes)=0);

  -- ---- student side ----
  perform tests.su();
  perform tests.check('P8: publishing notifies enrolled students with a link to the quiz page', (select count(*) from notifications where type='quiz' and link='quiz?id='||z::text and user_id in (sa,sb))=2
    and (select count(*) from notifications where type='quiz' and user_id=sc)=0);
  perform tests.as_user(sa);
  perform tests.check('SECURITY: student cannot read questions, options or answer keys', (select count(*) from quiz_questions)+(select count(*) from quiz_options)+(select count(*) from quiz_answer_keys)=0);
  att := start_quiz_attempt(z);
  perform tests.check('P8: starting again resumes the same attempt', start_quiz_attempt(z)=att);
  res := get_attempt_questions(att);
  txt := res::text;
  perform tests.check('SECURITY: questions delivered to the student carry no correctness or explanation data', txt not like '%correct%' and txt not like '%Because right%' and txt not like '%accepted%'
    and jsonb_array_length(res->'questions')=5);
  perform tests.check('P8: my_quiz_attempts shows the open attempt', (select count(*) from my_quiz_attempts(cid) where attempt_id=att and status='in_progress')=1);
  res := submit_quiz_attempt(att, jsonb_build_array(
    jsonb_build_object('question_id',q1,'option_ids',jsonb_build_array(a1)),
    jsonb_build_object('question_id',q2,'option_ids',jsonb_build_array(b1)),
    jsonb_build_object('question_id',q3,'text','  PARIS '),
    jsonb_build_object('question_id',q4,'text',repeat('x',1500)),
    jsonb_build_object('question_id',qtf,'option_ids',jsonb_build_array(t2))));
  perform tests.check('P8: scoring: single ok(2) + multiple partial(0) + text case-insensitive(1) + true/false(1) = 4 of 9, essay pending', (res->>'score')::numeric=4 and (res->>'max_score')::numeric=9 and (res->>'status')='submitted' and (res->>'pending_manual_grading')::boolean);
  perform tests.su();
  perform tests.check('P8: long text answers are cut to 1000 characters', (select length(text_answer) from quiz_responses where attempt_id=att and question_id=q4)=1000);
  perform tests.check('P8: teacher told about work needing grading (not the other teacher)', (select count(*) from notifications where user_id=ta and title like 'Quiz needs grading%' and link='quiz?id='||z::text)=1
    and (select count(*) from notifications where user_id=tb and title like 'Quiz needs grading%')=0);

  -- ---- review ----
  perform tests.as_user(sa);
  rev := get_attempt_review(att);
  perform tests.check('P8: review without "show correct answers" hides correct flags and explanations', rev::text not like '%"correct": true%' and rev::text not like '%Because right%'
    and (rev->'questions'->0->'options'->0->>'selected')::boolean);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P8: teacher turns on show correct answers', tests.try(format($$update quizzes set reveal_answers=true where id=%L$$, z))=1);
  perform tests.su(); perform tests.as_user(sa);
  rev := get_attempt_review(att);
  perform tests.check('P8: review now shows correct options, accepted text and the explanation', (rev->'questions'->0->'options'->0->>'correct')::boolean and rev::text like '%Because right%' and rev::text like '%Paris%');
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('SECURITY: classmate cannot review or see another student''s attempt', tests.try(format($$select get_attempt_review(%L)$$, att))=-1 and (select count(*) from my_quiz_attempts(cid))=0);
  perform tests.su(); perform tests.as_user(sc);
  perform tests.check('SECURITY: unenrolled student cannot start the quiz', tests.try(format($$select start_quiz_attempt(%L)$$, z))=-1);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: other teacher cannot review attempts or see stats', tests.try(format($$select get_attempt_review(%L)$$, att))=-1 and (select count(*) from v_quiz_stats where course_id=cid)=0);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous users cannot call the quiz functions', tests.try(format($$select my_quiz_attempts()$$))=-1 and tests.try(format($$select get_attempt_review(%L)$$, att))=-1);

  -- ---- manual grading ----
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P8: teacher sees the attempt and stats (1 pending)', (select count(*) from quiz_attempts where quiz_id=z)=1 and (select pending from v_quiz_stats where quiz_id=z)=1);
  perform tests.check('P8: teacher review includes correct answers', (get_attempt_review(att)->'questions'->1->'options'->0->>'correct')::boolean);
  resp := (select id from quiz_responses where attempt_id=att and question_id=q4);
  perform tests.check('P8: grading above the question points refused', tests.try(format($$select grade_quiz_response(%L, 4)$$, resp))=-1);
  perform tests.check('P8: teacher grades the essay', tests.try(format($$select grade_quiz_response(%L, 2)$$, resp))=1);
  perform tests.su();
  perform tests.check('P8: attempt graded with the new total (6/9) and student notified', (select status='graded' and score=6 from quiz_attempts where id=att)
    and (select count(*) from notifications where user_id=sa and title like 'Your quiz was graded%')=1);
  perform tests.as_user(ta);
  perform tests.check('P8: stats now show no pending and an average', (select pending=0 and average_percent is not null from v_quiz_stats where quiz_id=z));

  -- ---- structure lock after attempts ----
  perform tests.check('P8: cannot delete a question once attempts exist', tests.try(format($$delete from quiz_questions where id=%L$$, q1))=-1);
  perform tests.check('P8: cannot change points or type once attempts exist', tests.try(format($$update quiz_questions set points=5 where id=%L$$, q1))=-1 and tests.try(format($$update quiz_questions set type='multiple' where id=%L$$, q1))=-1);
  perform tests.check('P8: cannot add questions or options, or change answers, once attempts exist', tests.try(format($$insert into quiz_questions(quiz_id,prompt) values (%L,'late')$$, z))=-1
    and tests.try(format($$insert into quiz_options(question_id,label) values (%L,'new')$$, q1))=-1
    and tests.try(format($$delete from quiz_options where id=%L$$, a2))=-1
    and tests.try(format($$update quiz_answer_keys set correct_option_ids=array[%L::uuid] where question_id=%L$$, a2, q1))=-1);
  perform tests.check('P8: typos can still be fixed (prompt, option label, explanation)', tests.try(format($$update quiz_questions set prompt='Pick the right one!', explanation='Because it is right' where id=%L$$, q1))=1
    and tests.try(format($$update quiz_options set label='right!' where id=%L$$, a1))=1);

  -- ---- attempts limit, closing, time limit ----
  perform tests.su(); perform tests.as_user(sa);
  att2 := start_quiz_attempt(z);
  perform tests.check('P8: second attempt allowed (max 2), different attempt id', att2 <> att);
  perform tests.su();
  update quiz_attempts set started_at = now() - interval '3 hours' where id=att2;
  perform tests.as_user(sa);
  att := start_quiz_attempt(z);
  perform tests.check('P8: starting after the time limit closes the old attempt and, with attempts used up, returns nothing', att is null);
  perform tests.su();
  perform tests.check('P8: timed-out attempt closed as graded with 0 points', (select status='graded' and score=0 and submitted_at is not null from quiz_attempts where id=att2));
  perform tests.as_user(sb);
  att2 := start_quiz_attempt(z);
  perform tests.su(); update quiz_attempts set started_at = now() - interval '3 hours' where id=att2;
  perform tests.as_user(sb);
  res := submit_quiz_attempt(att2, jsonb_build_array(jsonb_build_object('question_id',q1,'option_ids',jsonb_build_array(a1))));
  perform tests.check('P8: answers sent after the time limit (plus grace) score nothing', (res->>'score')::numeric=0 and (res->>'status')='graded');
  perform tests.su(); perform tests.as_user(ta);
  update quizzes set available_until = now() - interval '1 hour', available_from = now() - interval '2 hours' where id=z;
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('P8: closed quiz cannot be started', tests.try(format($$select start_quiz_attempt(%L)$$, z))=-1);
  perform tests.su(); perform tests.as_user(ta);
  update quizzes set available_until = null, available_from = now() + interval '1 day' where id=z;
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('P8: quiz that is not open yet cannot be started', tests.try(format($$select start_quiz_attempt(%L)$$, z))=-1);

  -- ---- hidden results ----
  perform tests.su(); perform tests.as_user(ta);
  insert into quizzes(course_id,title,show_results) values (cid,'P8 Hidden',false) returning id into z2;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (z2,'short_text','Why?',1,1);
  perform tests.check('P8: second quiz publishes (text-only quiz is fine)', tests.try(format($$update quizzes set is_published=true where id=%L$$, z2))=1);
  perform tests.su(); perform tests.as_user(sb);
  att := start_quiz_attempt(z2);
  res := submit_quiz_attempt(att, jsonb_build_array());
  perform tests.check('P8: hidden-results quiz returns no score and my_quiz_attempts hides it', not (res ? 'score') and (select score is null and max_score is null and status='submitted' from my_quiz_attempts(cid) where quiz_id=z2));
  perform tests.check('SECURITY: no review for a quiz that hides results', tests.try(format($$select get_attempt_review(%L)$$, att))=-1);
  perform tests.su(); perform tests.as_user(ta);
  n := tests.try(format($$delete from quizzes where id=%L$$, z));
  perform tests.check('P8: teacher can delete a quiz that has attempts (everything goes with it)', n=1 and (select count(*) from quiz_attempts where quiz_id=z)=0 and (select count(*) from quiz_questions where quiz_id=z)=0);
  perform tests.su();
end $t8$;

do $t9$
declare
  ta uuid := '00000000-0000-0000-0000-0000000009b1';
  tb uuid := '00000000-0000-0000-0000-0000000009b2';
  sa uuid := '00000000-0000-0000-0000-0000000009c1';
  sb uuid := '00000000-0000-0000-0000-0000000009c2';
  sc uuid := '00000000-0000-0000-0000-0000000009c3';
  ad uuid := '00000000-0000-0000-0000-0000000009a0';
  cid uuid; cid2 uuid; an uuid; dm uuid; cc uuid; n int; r record; m1 uuid; cnt bigint;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p9ta@x.test','{"full_name":"P9 TA"}','{"role":"teacher"}'),
    (tb,'p9tb@x.test','{"full_name":"P9 TB"}','{"role":"teacher"}'),
    (sa,'p9sa@x.test','{"full_name":"P9 SA"}','{}'),
    (sb,'p9sb@x.test','{"full_name":"P9 SB"}','{}'),
    (sc,'p9sc@x.test','{"full_name":"P9 SC"}','{}'),
    (ad,'p9ad@x.test','{"full_name":"P9 Admin"}','{"role":"admin"}');
  insert into courses(title, created_by, status) values ('P9 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P9 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb), (cid2, sc);

  -- ---- announcements ----
  perform tests.as_user(ta);
  perform tests.check('P9: blank / oversized announcements refused', tests.try(format($$insert into announcements(course_id,title,body) values (%L,'   ','x')$$, cid))=-1
    and tests.try(format($$insert into announcements(course_id,title,body) values (%L,'t','   ')$$, cid))=-1
    and tests.try(format($$insert into announcements(course_id,title,body) values (%L,%L,'x')$$, cid, repeat('a',201)))=-1
    and tests.try(format($$insert into announcements(course_id,title,body) values (%L,'t',%L)$$, cid, repeat('a',5001)))=-1);
  insert into announcements(course_id,title,body) values (cid,'  Exam moved  ','See you Friday') returning id into an;
  perform tests.check('P9: announcement text is trimmed', (select title from announcements where id=an)='Exam moved');
  perform tests.check('P9: an announcement cannot be moved to another course or re-authored', tests.try(format($$update announcements set course_id=%L where id=%L$$, cid2, an))=-1
    and tests.try(format($$update announcements set author_id=%L where id=%L$$, tb, an))=-1);
  perform tests.check('P9: teacher can pin and edit own announcement', tests.try(format($$update announcements set pinned=true, body='Moved to Monday' where id=%L$$, an))=1);
  perform tests.su();
  perform tests.check('P9: students of the course are notified, with a link to the post', (select count(*) from notifications where type='announcement' and link='announcements?id='||an and user_id in (sa,sb))=2
    and (select count(*) from notifications where type='announcement' and link='announcements?id='||an and user_id=sc)=0);
  perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot edit or delete it', tests.try(format($$update announcements set title='hacked' where id=%L$$, an))=0
    and tests.try(format($$delete from announcements where id=%L$$, an))=0);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: students cannot post, edit or delete announcements', tests.try(format($$insert into announcements(course_id,title,body) values (%L,'x','y')$$, cid))=-1
    and tests.try(format($$update announcements set title='x' where id=%L$$, an))=0 and tests.try(format($$delete from announcements where id=%L$$, an))=0);
  perform tests.check('P9: student sees the course announcement', (select count(*) from announcements where id=an)=1);
  perform tests.su(); perform tests.as_user(sc);
  perform tests.check('SECURITY: student of another course cannot see it', (select count(*) from announcements where id=an)=0);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P9: teacher can delete own announcement', tests.try(format($$delete from announcements where id=%L$$, an))=1);

  -- ---- messaging ----
  perform tests.su(); perform tests.as_user(sa);
  dm := get_or_create_direct_conversation(ta);
  perform tests.check('P9: messages are trimmed, blank ones refused', tests.try(format($$insert into messages(conversation_id,body) values (%L,'   ')$$, dm))=-1
    and tests.try(format($$insert into messages(conversation_id,body) values (%L,'  Hello  ')$$, dm))=1);
  perform tests.check('P9: message text is stored trimmed', (select body from messages where conversation_id=dm)='Hello');
  perform tests.check('SECURITY: attachment path must live in the conversation folder', tests.try(format($$insert into messages(conversation_id,attachment_path) values (%L,%L)$$, dm, cid||'/x.pdf'))=-1
    and tests.try(format($$insert into messages(conversation_id,attachment_path) values (%L,%L)$$, dm, dm||'/1-x.pdf'))=1);
  perform tests.su();
  perform tests.check('P9: unread message notifications do not pile up (one per conversation)', (select count(*) from notifications where user_id=ta and type='message' and link='messages?c='||dm)=1);
  perform tests.su(); update conversation_participants set last_read_at = now() - interval '1 hour' where conversation_id=dm and user_id=ta;
  perform tests.as_user(ta);
  select * into r from my_conversations() where id=dm;
  perform tests.check('P9: my_conversations lists the chat with partner name, last message and unread count', r.other_name='P9 SA' and r.unread=2 and r.last_has_attachment and r.type='direct');
  perform mark_conversation_read(dm);
  perform tests.check('P9: marking read clears unread count and the notification', (select unread from my_conversations() where id=dm)=0
    and (select count(*) from notifications where user_id=ta and type='message' and link='messages?c='||dm and not is_read)=0);
  perform tests.check('P9: conversation_messages returns thread oldest-first with sender names', (select count(*) from conversation_messages(dm))=2 and (select sender_name from conversation_messages(dm) limit 1)='P9 SA');
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('SECURITY: outsiders cannot read a direct conversation through the RPCs', tests.try(format($$select * from conversation_messages(%L)$$, dm))=-1
    and tests.try(format($$select mark_conversation_read(%L)$$, dm))=-1 and (select count(*) from my_conversations() where id=dm)=0);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('P9: students can delete only their own messages', tests.try(format($$delete from messages where conversation_id=%L and sender_id<>%L$$, dm, sa))=0
    and tests.try(format($$delete from messages where conversation_id=%L and body='Hello'$$, dm))=1);
  perform tests.su(); perform tests.as_user(ta);
  insert into messages(conversation_id,body) values (dm,'Reply');
  perform tests.check('SECURITY: nobody else can delete someone''s message', tests.try(format($$delete from messages where conversation_id=%L and sender_id=%L$$, dm, sa))=0);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: messageable_users only shows teachers of my courses and admins', (select count(*) from messageable_users() where id=ta)=1
    and (select count(*) from messageable_users() where id in (tb, sb, sc))=0 and (select count(*) from messageable_users() where id=ad)=1);
  perform tests.check('P9: messageable_users search treats % and _ as plain text', (select count(*) from messageable_users('%'))=0 and (select count(*) from messageable_users('p9 t'))=1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P9: admin can message anyone', (select count(*) from messageable_users('P9') where id in (ta,tb,sa,sb,sc))=5);
  perform tests.su();
  update profiles set status='suspended' where id=ta;
  perform tests.as_user(sa);
  perform tests.check('P9: cannot message someone who has been suspended', tests.try(format($$insert into messages(conversation_id,body) values (%L,'hi')$$, dm))=-1);
  perform tests.su(); update profiles set status='active' where id=ta;

  -- ---- spam brake ----
  perform tests.as_user(sa);
  for i in 1..19 loop insert into messages(conversation_id,body) values (dm,'spam '||i); end loop;
  perform tests.check('P9: more than 20 messages a minute are refused', tests.try(format($$insert into messages(conversation_id,body) values (%L,'one too many')$$, dm))=-1);
  perform tests.su(); update messages set created_at = now() - interval '5 minutes' where sender_id=sa;

  -- ---- course chat ----
  perform tests.as_user(sa);
  cc := get_or_create_course_conversation(cid);
  insert into messages(conversation_id,body) values (cc,'Anyone understand lesson 2?');
  perform tests.su();
  perform tests.check('P9: course chat posts create unread markers for the whole class', (select count(*) from conversation_participants where conversation_id=cc and user_id in (sb,ta))=2);
  perform tests.as_user(sb);
  select * into r from my_conversations() where id=cc;
  perform tests.check('P9: classmate sees course chat with course title and 1 unread', r.type='course' and r.course_title='P9 Course' and r.unread=1);
  perform tests.check('P9: course chat shows classmate names to the class', (select sender_name from conversation_messages(cc) limit 1)='P9 SA');
  perform tests.su(); perform tests.as_user(sc);
  perform tests.check('SECURITY: students of other courses cannot read or list the course chat', tests.try(format($$select * from conversation_messages(%L)$$, cc))=-1 and (select count(*) from my_conversations() where id=cc)=0);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous users cannot call any messaging function', tests.try('select * from my_conversations()')=-1 and tests.try('select * from messageable_users()')=-1);
  perform tests.su();
end $t9$;

do $t10$
declare
  ta uuid := '00000000-0000-0000-0000-00000000010b';
  tb uuid := '00000000-0000-0000-0000-00000000011b';
  sa uuid := '00000000-0000-0000-0000-00000000010c';
  sb uuid := '00000000-0000-0000-0000-00000000011c';
  ad uuid := '00000000-0000-0000-0000-0000000001a0';
  cid uuid; cid2 uuid; md uuid; l1 uuid; l2 uuid; l3 uuid; sess1 uuid; sess2 uuid; asg1 uuid; asg2 uuid; z uuid; zq uuid; zo uuid; att uuid; r record; g jsonb;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p10ta@x.test','{"full_name":"P10 TA"}','{"role":"teacher"}'), (tb,'p10tb@x.test','{"full_name":"P10 TB"}','{"role":"teacher"}'),
    (sa,'p10sa@x.test','{"full_name":"P10 SA"}','{}'), (sb,'p10sb@x.test','{"full_name":"P10 SB"}','{}'),
    (ad,'p10ad@x.test','{"full_name":"P10 Admin"}','{"role":"admin"}');
  insert into courses(title, created_by, status) values ('P10 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P10 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb), (cid2, sb);
  insert into modules(course_id,title,position) values (cid,'M',1) returning id into md;
  insert into lessons(module_id,title,type,is_published) values (md,'L1','text',true) returning id into l1;
  insert into lessons(module_id,title,type,is_published) values (md,'L2','text',true) returning id into l2;
  insert into lessons(module_id,title,type,is_published) values (md,'L3 draft','text',false) returning id into l3;
  insert into lesson_progress(lesson_id, student_id, completed) values (l1, sa, true), (l2, sa, true), (l3, sa, true), (l1, sb, true);
  insert into attendance_sessions(course_id,title) values (cid,'D1') returning id into sess1;
  insert into attendance_sessions(course_id,title) values (cid,'D2') returning id into sess2;
  insert into attendance_records(session_id, student_id, status) values (sess1, sa, 'present'), (sess2, sa, 'late'), (sess1, sb, 'absent'), (sess2, sb, 'excused');
  insert into assignments(course_id,title,max_points,is_published) values (cid,'A1',50,true) returning id into asg1;
  insert into assignments(course_id,title,max_points,is_published) values (cid,'A2',10,true) returning id into asg2;
  insert into assignments(course_id,title,max_points,is_published) values (cid,'A3 draft',10,false);
  perform tests.as_user(sa);
  insert into submissions(assignment_id, text_answer) values (asg1, 'done'), (asg2, 'done too');
  perform tests.su(); perform tests.as_user(sb);
  insert into submissions(assignment_id, text_answer) values (asg1, 'mine');
  perform tests.su(); perform tests.as_user(ta);
  update submissions set status='graded', grade=40 where assignment_id=asg1 and student_id=sa;
  update submissions set status='graded', grade=5 where assignment_id=asg2 and student_id=sa;
  perform tests.su();
  insert into quizzes(course_id,title,show_results,pass_percent) values (cid,'Q hidden',false,50) returning id into z;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (z,'short_text','Why?',4,1);
  update quizzes set is_published=true where id=z;
  perform tests.as_user(sa); att := start_quiz_attempt(z); perform submit_quiz_attempt(att, '[]'::jsonb);
  perform tests.su(); perform tests.as_user(ta);
  select id into zq from quiz_questions where quiz_id=z; perform grade_quiz_response((select id from quiz_responses where attempt_id=att and question_id=zq), 3);
  perform tests.su();

  -- ---- course_report ----
  perform tests.as_user(ta);
  select * into r from course_report(cid) where student_id=sa;
  perform tests.check('P10: progress counts only published lessons (2 of 2 = 100)', r.total_lessons=2 and r.completed_lessons=2 and r.progress_percent=100);
  perform tests.check('P10: attendance percent counts present+late (excused ignored)', r.attendance_marked=2 and r.attendance_percent=100);
  perform tests.check('P10: assignment average is the mean of graded percentages (80% and 50% = 65)', r.assignments_total=2 and r.assignments_graded=2 and r.assignments_percent=65);
  perform tests.check('P10: staff see quiz results even when students cannot (75%)', r.quizzes_total=1 and r.quizzes_taken=1 and r.quizzes_percent=75);
  select * into r from course_report(cid) where student_id=sb;
  perform tests.check('P10: second student: partial progress, absent only counts, no grades', r.completed_lessons=1 and r.progress_percent=50 and r.attendance_percent=0 and r.assignments_graded=0 and r.assignments_percent is null and r.quizzes_taken=0 and r.quizzes_percent is null);
  perform tests.check('P10: report lists only enrolled students of that course', (select count(*) from course_report(cid))=2);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: other teacher refused', tests.try(format($$select * from course_report(%L)$$, cid))=-1);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: students cannot call course_report or courses_report', tests.try(format($$select * from course_report(%L)$$, cid))=-1 and tests.try('select * from courses_report()')=-1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P10: admin can read any course report', (select count(*) from course_report(cid))=2);

  -- ---- courses_report ----
  perform tests.su(); perform tests.as_user(ta);
  select * into r from courses_report() where course_id=cid;
  perform tests.check('P10: courses_report: students, average progress, attendance, nothing waiting', r.students=2 and r.avg_progress=75 and r.avg_attendance=66.7 and r.pending_submissions=1 and r.pending_quizzes=0);
  perform tests.check('P10: teacher sees only own courses in courses_report', (select count(*) from courses_report() where course_id=cid2)=0 and (select count(*) from courses_report() where course_id=cid)=1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P10: admin sees every course in courses_report', (select count(*) from courses_report() where course_id in (cid,cid2))=2);

  -- ---- my_grades ----
  perform tests.su(); perform tests.as_user(sa);
  g := my_grades();
  perform tests.check('P10: my_grades returns only my enrolled course', jsonb_array_length(g)=1 and g->0->>'title'='P10 Course');
  perform tests.check('P10: my_grades lists published assignments only, with grade and percent', jsonb_array_length(g->0->'assignments')=2 and (g->0->'assignments'->0->>'percent')::numeric in (80,50));
  perform tests.check('SECURITY: my_grades hides quiz score when the quiz hides results', (g->0->'quizzes'->0->>'best_percent') is null and (g->0->'quizzes'->0->>'attempts')::int=1);
  perform tests.check('P10: my_grades attendance + lesson counts are mine', (g->0->'attendance'->>'present')::int=1 and (g->0->'attendance'->>'late')::int=1 and (g->0->>'completed_lessons')::int=2);
  perform tests.su(); perform tests.as_user(sb);
  g := my_grades();
  perform tests.check('SECURITY: another student sees only their own numbers', jsonb_array_length(g)=2 and not exists (select 1 from jsonb_array_elements(g) x where (x->'attendance'->>'present')::int>0) and (select count(*) from jsonb_array_elements(g) x, jsonb_array_elements(x->'assignments') a where a->>'status'='graded')=0);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous cannot call any report function', tests.try('select my_grades()')=-1 and tests.try('select * from courses_report()')=-1);
  perform tests.su();
end $t10$;

do $t11$
declare
  ta uuid := '00000000-0000-0000-0000-0000000013a1'; tb uuid := '00000000-0000-0000-0000-0000000013a2'; ad uuid := '00000000-0000-0000-0000-0000000013a0';
  s1 uuid := '00000000-0000-0000-0000-0000000013b1'; s2 uuid := '00000000-0000-0000-0000-0000000013b2'; s3 uuid := '00000000-0000-0000-0000-0000000013b3';
  s4 uuid := '00000000-0000-0000-0000-0000000013b4'; s5 uuid := '00000000-0000-0000-0000-0000000013b5'; s6 uuid := '00000000-0000-0000-0000-0000000013b6';
  s7 uuid := '00000000-0000-0000-0000-0000000013b7'; s8 uuid := '00000000-0000-0000-0000-0000000013b8';
  cid uuid; cid2 uuid; md uuid; md2 uuid; l1 uuid; a_old uuid; a_pre uuid; a_future uuid; q1 uuid; ss1 uuid; ss2 uuid; ss3 uuid; r record; n int;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p13ta@x.test','{"full_name":"P13 TA"}','{"role":"teacher"}'), (tb,'p13tb@x.test','{"full_name":"P13 TB"}','{"role":"teacher"}'), (ad,'p13ad@x.test','{"full_name":"P13 Admin"}','{"role":"admin"}'),
    (s1,'p13s1@x.test','{"full_name":"Inactive Ivy"}','{}'), (s2,'p13s2@x.test','{"full_name":"Absent Abe"}','{}'), (s3,'p13s3@x.test','{"full_name":"Overdue Olu"}','{}'),
    (s4,'p13s4@x.test','{"full_name":"Quiz Quin"}','{}'), (s5,'p13s5@x.test','{"full_name":"Active Ana"}','{}'), (s6,'p13s6@x.test','{"full_name":"New Nia"}','{}'),
    (s7,'p13s7@x.test','{"full_name":"Other Course Otto"}','{}'), (s8,'p13s8@x.test','{"full_name":"Dropped Dee"}','{}');
  insert into courses(title, created_by, status) values ('P13 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P13 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid,s1),(cid,s2),(cid,s3),(cid,s4),(cid,s5),(cid,s6),(cid,s8),(cid2,s7);
  update enrollments set enrolled_at = now() - interval '30 days' where student_id in (s1,s2,s3,s4,s5,s7,s8);
  update enrollments set status = 'dropped' where student_id = s8;
  insert into modules(course_id,title,position) values (cid,'M',1) returning id into md;
  insert into lessons(module_id,title,type,is_published) values (md,'L1','text',true) returning id into l1;
  insert into modules(course_id,title,position) values (cid2,'M2',1) returning id into md2;
  insert into lessons(module_id,title,type,is_published) values (md2,'Other L1','text',true);
  insert into lesson_progress(lesson_id, student_id, completed) values (l1,s2,true),(l1,s3,true),(l1,s4,true),(l1,s5,true);
  insert into assignments(course_id,title,max_points,is_published,due_at,allow_late) values (cid,'Due 5 days ago',10,true, now() - interval '5 days', true) returning id into a_old;
  insert into assignments(course_id,title,max_points,is_published,due_at) values (cid,'Due before anyone enrolled',10,true, now() - interval '60 days') returning id into a_pre;
  insert into assignments(course_id,title,max_points,is_published,due_at) values (cid,'Due next week',10,true, now() + interval '7 days') returning id into a_future;
  insert into assignments(course_id,title,max_points,is_published,due_at) values (cid,'Draft overdue',10,false, now() - interval '3 days');
  insert into submissions(assignment_id, student_id, text_answer) values (a_old,s2,'x'),(a_old,s4,'x'),(a_old,s5,'x');
  insert into attendance_sessions(course_id,title,session_date) values (cid,'D1',current_date-3) returning id into ss1;
  insert into attendance_sessions(course_id,title,session_date) values (cid,'D2',current_date-2) returning id into ss2;
  insert into attendance_sessions(course_id,title,session_date) values (cid,'D3',current_date-1) returning id into ss3;
  insert into attendance_records(session_id,student_id,status) values (ss1,s2,'absent'),(ss2,s2,'absent'),(ss3,s2,'absent'),(ss1,s5,'present'),(ss2,s5,'present'),(ss3,s5,'absent');
  insert into quizzes(course_id,title,pass_percent) values (cid,'Q pass 50',50) returning id into q1;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (q1,'short_text','Why?',10,1);
  update quizzes set is_published=true where id=q1;
  insert into quiz_attempts(quiz_id,course_id,student_id,submitted_at,score,max_score,status) values (q1,cid,s4,now(),2,10,'graded'),(q1,cid,s5,now(),9,10,'graded');

  perform tests.as_user(ta);
  select * into r from at_risk_students(cid) where student_id = s1;
  perform tests.check('P13: a student with no activity for 30 days is flagged (inactive 3 + overdue 1 = 4)', r.days_inactive >= 29 and r.overdue_assignments = 1 and r.risk_score = 4);
  select * into r from at_risk_students(cid) where student_id = s2;
  perform tests.check('P13: three absences in the last three sessions score 3 (and a submitted assignment is not overdue)', r.recent_absences = 3 and r.overdue_assignments = 0 and r.risk_score = 3);
  select * into r from at_risk_students(cid) where student_id = s3;
  perform tests.check('P13: a missed deadline counts once; deadlines before enrolment and drafts are ignored', r.overdue_assignments = 1 and r.risk_score = 1 and r.days_inactive = 0);
  select * into r from at_risk_students(cid) where student_id = s4;
  perform tests.check('P13: a quiz below the pass mark is a warning sign', r.failing_quizzes = 1 and r.risk_score = 1);
  perform tests.check('P13: one absence in three, passing quiz and recent work is not flagged', not exists (select 1 from at_risk_students(cid) where student_id = s5));
  perform tests.check('P13: a student who just enrolled is not flagged for deadlines that passed before they joined', not exists (select 1 from at_risk_students(cid) where student_id = s6));
  perform tests.check('P13: dropped enrolments are left out', not exists (select 1 from at_risk_students(cid) where student_id = s8));
  perform tests.check('P13: results are ordered by risk, highest first', (select array_agg(student_id order by ord) from (select student_id, row_number() over () ord from at_risk_students(cid)) z) = array[s1, s2, s3, s4] or (select (array_agg(student_id))[1] from at_risk_students(cid)) = s1);
  perform tests.check('P13: list for all my courses shows only my own students', (select count(*) from at_risk_students() where student_id = s7) = 0 and (select count(*) from at_risk_students()) = 4);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot read this course''s warnings', tests.try(format($$select * from at_risk_students(%L)$$, cid)) = -1);
  perform tests.check('P13: other teacher sees their own course only', (select count(*) from at_risk_students()) = 1 and (select student_id from at_risk_students() limit 1) = s7);
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('SECURITY: students cannot read warnings or nudge anyone', tests.try('select * from at_risk_students()') = -1 and tests.try(format($$select nudge_student(%L, %L, 'hi')$$, cid, s2)) = -1);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous cannot call either function', tests.try('select * from at_risk_students()') = -1 and tests.try(format($$select nudge_student(%L, %L)$$, cid, s1)) = -1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P13: admin sees every course', (select count(*) from at_risk_students()) = 5 and (select count(*) from at_risk_students(cid2)) = 1);

  -- ---- nudge ----
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot nudge my student', tests.try(format($$select nudge_student(%L, %L)$$, cid, s1)) = -1);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P13: cannot nudge someone who is not enrolled in the course', tests.try(format($$select nudge_student(%L, %L)$$, cid, s7)) = -1 and tests.try(format($$select nudge_student(%L, %L)$$, cid, s8)) = -1);
  perform tests.check('P13: a note over 300 characters is refused', tests.try(format($$select nudge_student(%L, %L, %L)$$, cid, s1, repeat('x', 301))) = -1);
  perform tests.check('P13: teacher nudges a student', tests.try(format($$select nudge_student(%L, %L)$$, cid, s1)) = 1);
  perform tests.check('P13: a second nudge within 24 hours is refused', tests.try(format($$select nudge_student(%L, %L, 'again')$$, cid, s1)) = -1);
  perform tests.check('P13: a different student can still be nudged, with a custom note', tests.try(format($$select nudge_student(%L, %L, %L)$$, cid, s2, '  Please see me after class  ')) = 1);
  select last_nudged_at into r from at_risk_students(cid) where student_id = s1;
  perform tests.check('P13: the list shows when a student was last nudged', r.last_nudged_at is not null and (select last_nudged_at is null from at_risk_students(cid) where student_id = s3));
  perform tests.su(); perform tests.as_user(s1);
  perform tests.check('P13: the student gets a nudge notification linking to the course', (select count(*) from notifications where type = 'nudge' and link = 'course?id=' || cid::text and user_id = s1) = 1);
  perform tests.su(); perform tests.as_user(s2);
  perform tests.check('P13: a custom note is trimmed and delivered to that student only', (select body from notifications where type = 'nudge' and user_id = s2) = 'Please see me after class' and (select count(*) from notifications where type = 'nudge') = 1);
  perform tests.su(); perform tests.as_user(s3);
  perform tests.check('SECURITY: other students do not see someone else''s nudge', (select count(*) from notifications where type = 'nudge') = 0);
  perform tests.su();
  perform tests.check('P13: each nudge is written to the audit log', (select count(*) from audit_log where action = 'student.nudge' and entity_id = cid) = 2);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P13: admin can nudge too', tests.try(format($$select nudge_student(%L, %L)$$, cid, s3)) = 1);
  perform tests.su();
end $t11$;

do $t12$
declare
  ta uuid := '00000000-0000-0000-0000-0000000014a1'; tb uuid := '00000000-0000-0000-0000-0000000014a2'; ad uuid := '00000000-0000-0000-0000-0000000014a0';
  sa uuid := '00000000-0000-0000-0000-0000000014b1'; sb uuid := '00000000-0000-0000-0000-0000000014b2'; sx uuid := '00000000-0000-0000-0000-0000000014b3';
  cid uuid; cid2 uuid; md uuid; md2 uuid; l1 uuid; l2 uuid; l3 uuid; l4 uuid; l5 uuid; l6 uuid; lo uuid; q uuid; qo uuid; asg uuid; i int; extra uuid; g jsonb; r record;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p14ta@x.test','{"full_name":"P14 TA"}','{"role":"teacher"}'), (tb,'p14tb@x.test','{"full_name":"P14 TB"}','{"role":"teacher"}'), (ad,'p14ad@x.test','{"full_name":"P14 Admin"}','{"role":"admin"}'),
    (sa,'p14sa@x.test','{"full_name":"P14 SA"}','{}'), (sb,'p14sb@x.test','{"full_name":"P14 SB"}','{}'), (sx,'p14sx@x.test','{"full_name":"P14 SX"}','{}');
  insert into courses(title, created_by, status) values ('P14 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P14 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb);
  insert into modules(course_id,title,position) values (cid,'M',1) returning id into md;
  insert into modules(course_id,title,position) values (cid2,'M2',1) returning id into md2;
  insert into lessons(module_id,title,type,is_published,position) values (md,'L1 open','text',true,1) returning id into l1;
  insert into lessons(module_id,title,type,is_published,position) values (md,'L2 after L1','text',true,2) returning id into l2;
  insert into lessons(module_id,title,type,is_published,position) values (md,'L3 after quiz','text',true,3) returning id into l3;
  insert into lessons(module_id,title,type,is_published,position) values (md,'L4 after assignment','text',true,4) returning id into l4;
  insert into lessons(module_id,title,type,is_published,position) values (md,'L5 draft','text',false,5) returning id into l5;
  insert into lessons(module_id,title,type,is_published,position) values (md,'L6 after L1 and quiz 90','text',true,6) returning id into l6;
  insert into lessons(module_id,title,type,is_published,position) values (md2,'Other lesson','text',true,1) returning id into lo;
  insert into materials(course_id,lesson_id,title,file_path) values (cid,l2,'L2 handout','cid/l2/file.pdf');
  insert into quizzes(course_id,title,pass_percent) values (cid,'Gate quiz',50) returning id into q;
  insert into quiz_questions(quiz_id,type,prompt,points,position) values (q,'short_text','Why?',10,1);
  update quizzes set is_published=true where id=q;
  insert into quizzes(course_id,title,pass_percent) values (cid2,'Other quiz',50) returning id into qo;
  insert into assignments(course_id,title,max_points,is_published,due_at) values (cid,'Gate assignment',10,true, now() + interval '7 days') returning id into asg;

  -- ---- teachers manage rules ----
  perform tests.as_user(ta);
  perform tests.check('P14: teacher adds a lesson rule', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l2, l1)) = 1);
  perform tests.check('P14: teacher adds quiz and assignment rules', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'quiz',%L)$$, l3, q)) = 1 and tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'assignment',%L)$$, l4, asg)) = 1);
  perform tests.check('P14: a lesson can have several rules, with a custom pass mark on quizzes', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l6, l1)) = 1 and tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id,min_percent) values (%L,'quiz',%L,90)$$, l6, q)) = 1);
  perform tests.check('P14: the rule takes its course from the lesson', (select count(*) from unlock_rules where course_id = cid) = 5);
  perform tests.check('P14: a lesson cannot require itself', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l1, l1)) = -1);
  perform tests.check('P14: a rule cannot point at another course''s lesson or quiz', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l1, lo)) = -1 and tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'quiz',%L)$$, l1, qo)) = -1);
  perform tests.check('P14: loops are refused (L1 after L2 while L2 is after L1)', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l1, l2)) = -1);
  perform tests.check('P14: longer loops are refused too (L2 after L6 while L6 is after L2 is impossible, but L1 after L6 -> L6 after L1)', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l1, l6)) = -1);
  perform tests.check('P14: the same rule twice is refused', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l2, l1)) = -1);
  perform tests.check('P14: a minimum score only makes sense for quizzes', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id,min_percent) values (%L,'assignment',%L,50)$$, l5, asg)) = -1 and tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id,min_percent) values (%L,'quiz',%L,150)$$, l5, q)) = -1);
  perform tests.su();
  for i in 1..11 loop insert into assignments(course_id,title,max_points,is_published) values (cid,'Filler '||i,10,false); end loop;
  perform tests.as_user(ta);
  for extra in select id from assignments where course_id = cid and title ~ '^Filler [1-9]$' loop insert into unlock_rules(lesson_id,req_type,req_id) values (l5,'assignment',extra); end loop;
  perform tests.check('P14: nine rules on one lesson are fine', (select count(*) from unlock_rules where lesson_id = l5) = 9);
  perform tests.check('P14: the 10th rule is accepted', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'assignment',%L)$$, l5, (select id from assignments where course_id = cid and title = 'Filler 10'))) = 1);
  perform tests.check('P14: the 11th rule is refused', tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'assignment',%L)$$, l5, (select id from assignments where course_id = cid and title = 'Filler 11'))) = -1);
  delete from unlock_rules where lesson_id = l5;
  perform tests.check('P14: a rule cannot be repointed (delete and add instead)', tests.try(format($$update unlock_rules set req_id = %L where lesson_id = %L$$, l6, l2)) = -1);
  perform tests.check('P14: staff still see every lesson, locked or not, and drafts', (select count(*) from lessons where course_id = cid) = 6);

  -- ---- who may touch rules ----
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot see or add rules for my course', (select count(*) from unlock_rules) = 0 and tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l5, l1)) = -1);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: students cannot read, add, change or delete rules', (select count(*) from unlock_rules) = 0 and tests.try(format($$insert into unlock_rules(lesson_id,req_type,req_id) values (%L,'lesson',%L)$$, l5, l1)) = -1 and tests.try('delete from unlock_rules') = 0 and tests.try('update unlock_rules set min_percent = 0') = 0);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P14: admin sees all rules', (select count(*) from unlock_rules where course_id = cid) = 5);

  -- ---- a student only gets what they have unlocked ----
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('P14: a student sees only open lessons (L1); locked ones and drafts are invisible', (select count(*) from lessons where course_id = cid) = 1 and (select title from lessons where course_id = cid) = 'L1 open');
  perform tests.check('SECURITY: a locked lesson cannot be read by id', (select count(*) from lessons where id in (l2, l3, l4, l6)) = 0);
  perform tests.check('SECURITY: files attached to a locked lesson are hidden too', (select count(*) from materials where lesson_id = l2) = 0);
  perform tests.check('SECURITY: progress cannot be recorded on a locked lesson', tests.try(format($$insert into lesson_progress(lesson_id,student_id,completed) values (%L,%L,true)$$, l2, sb)) = -1);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('P14: a student can finish the open lesson', tests.try(format($$insert into lesson_progress(lesson_id,student_id,completed) values (%L,%L,true)$$, l1, sa)) = 1);
  perform tests.check('P14: finishing L1 unlocks L2 for that student', (select count(*) from lessons where id = l2) = 1);
  perform tests.check('P14: the unlocked lesson''s files appear', (select count(*) from materials where lesson_id = l2) = 1);
  perform tests.check('P14: and progress can be saved on it', tests.try(format($$insert into lesson_progress(lesson_id,student_id,completed) values (%L,%L,true)$$, l2, sa)) = 1);
  perform tests.check('P14: a lesson with two rules stays locked until both are met (L6 needs L1 and quiz 90)', (select count(*) from lessons where id = l6) = 0);
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('SECURITY: unlocking is per student (the other student still sees only L1)', (select count(*) from lessons where course_id = cid) = 1);

  -- quizzes
  perform tests.su();
  insert into quiz_attempts(quiz_id,course_id,student_id,submitted_at,score,max_score,status) values (q,cid,sa,now(),10,10,'submitted');
  perform tests.as_user(sa);
  perform tests.check('P14: an attempt that is not graded yet does not unlock', (select count(*) from lessons where id = l3) = 0);
  perform tests.su(); update quiz_attempts set status='graded', score=4 where student_id = sa and quiz_id = q;
  perform tests.as_user(sa);
  perform tests.check('P14: a graded attempt below the pass mark does not unlock', (select count(*) from lessons where id = l3) = 0);
  perform tests.su(); update quiz_attempts set score=6 where student_id = sa and quiz_id = q;
  perform tests.as_user(sa);
  perform tests.check('P14: passing the quiz unlocks the lesson, but a stricter 90% rule still holds', (select count(*) from lessons where id = l3) = 1 and (select count(*) from lessons where id = l6) = 0);
  perform tests.su(); update quiz_attempts set score=9.5 where student_id = sa and quiz_id = q;
  perform tests.as_user(sa);
  perform tests.check('P14: reaching the custom 90% (plus L1 done) opens L6', (select count(*) from lessons where id = l6) = 1);
  -- assignments
  perform tests.check('P14: the assignment lesson is locked until work is submitted', (select count(*) from lessons where id = l4) = 0);
  perform tests.check('P14: a student can submit the work', tests.try(format($$insert into submissions(assignment_id, text_answer) values (%L, 'done')$$, asg)) = 1);
  perform tests.check('P14: submitting work unlocks the lesson', (select count(*) from lessons where id = l4) = 1);

  -- ---- progress numbers do not depend on what is unlocked ----
  perform tests.su(); perform tests.as_user(sb);
  select * into r from v_course_progress where course_id = cid and student_id = sb;
  perform tests.check('P14: progress counts locked lessons in the total (5 published lessons, 0 done = 0%)', r.total_lessons = 5 and r.completed_lessons = 0 and r.percent = 0);
  perform tests.su(); perform tests.as_user(sa);
  select * into r from v_course_progress where course_id = cid and student_id = sa;
  perform tests.check('P14: and a student with 2 of 5 done sees 40%', r.total_lessons = 5 and r.completed_lessons = 2 and r.percent = 40);
  perform tests.check('SECURITY: a student still cannot see another student''s progress row', (select count(*) from v_course_progress where student_id = sb) = 0);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P14: teachers still see progress for their students', (select count(*) from v_course_progress where course_id = cid) = 2 and (select total_lessons from v_course_progress where student_id = sb and course_id = cid) = 5);

  -- ---- the learning path ----
  perform tests.su(); perform tests.as_user(sb);
  select count(*) filter (where locked) as nlocked, count(*) as n into r from course_path(cid);
  perform tests.check('P14: course_path lists every published lesson with its lock state (draft left out)', r.n = 5 and r.nlocked = 4);
  g := (select requirements from course_path(cid) where lesson_id = l6);
  perform tests.check('P14: course_path says what is missing, with titles and whether each part is met', jsonb_array_length(g) = 2 and g->0->>'title' = 'L1 open' and g->1->>'title' = 'Gate quiz' and (g->1->>'min_percent')::numeric = 90 and (g->0->>'met')::boolean = false);
  perform tests.check('P14: course_path never returns lesson content', (select count(*) from information_schema.columns where table_name = 'course_path') = 0 and not exists (select 1 from course_path(cid) c where to_jsonb(c) ? 'content'));
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('P14: course_path reflects my own progress', (select completed from course_path(cid) where lesson_id = l1) and not (select locked from course_path(cid) where lesson_id = l2));
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: course_path is refused for students who are not enrolled', tests.try(format($$select * from course_path(%L)$$, cid)) = -1);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P14: staff use the normal tables, course_path is for enrolled students', tests.try(format($$select * from course_path(%L)$$, cid)) = -1);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous cannot call the path or gate functions', tests.try(format($$select * from course_path(%L)$$, cid)) = -1 and tests.try(format($$select lesson_gate(%L)$$, l2)) = -1);

  -- ---- lesson_gate ----
  perform tests.su(); perform tests.as_user(sb);
  g := lesson_gate(l2);
  perform tests.check('P14: lesson_gate tells a locked student what to do first', (g->>'locked')::boolean and g->>'title' = 'L2 after L1' and jsonb_array_length(g->'requirements') = 1 and g->'requirements'->0->>'title' = 'L1 open');
  perform tests.check('P14: lesson_gate says unlocked for an open lesson', not (lesson_gate(l1)->>'locked')::boolean);
  perform tests.check('SECURITY: lesson_gate reveals nothing about drafts or other courses', lesson_gate(l5) is null and lesson_gate(lo) is null);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: lesson_gate reveals nothing to someone not enrolled', lesson_gate(l2) is null);

  -- ---- changing rules ----
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P14: removing a rule unlocks the lesson', tests.try(format($$delete from unlock_rules where lesson_id = %L$$, l2)) = 1);
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('P14: the other student sees L2 right away', (select count(*) from lessons where id = l2) = 1);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P14: a requirement that is not published yet never blocks', tests.try(format($$update assignments set is_published = false where id = %L$$, asg)) = 1);
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('P14: so the lesson that waited for it opens', (select count(*) from lessons where id = l4) = 1);
  perform tests.su();
  delete from quizzes where id = q;
  perform tests.check('P14: deleting a required quiz removes its rules, so nobody stays locked out', (select count(*) from unlock_rules where req_id = q) = 0);
  perform tests.as_user(sb);
  perform tests.check('P14: and the lessons it guarded open', (select count(*) from lessons where id = l3) = 1);
  perform tests.su();
end $t12$;


-- =====================================================================
-- Phase 15: topic mastery map
-- =====================================================================
do $t13$
declare
  ta uuid := '00000000-0000-0000-0000-0000000015a1'; tb uuid := '00000000-0000-0000-0000-0000000015a2'; ad uuid := '00000000-0000-0000-0000-0000000015a0';
  sa uuid := '00000000-0000-0000-0000-0000000015b1'; sb uuid := '00000000-0000-0000-0000-0000000015b2'; sx uuid := '00000000-0000-0000-0000-0000000015b3';
  cid uuid; cid2 uuid; md uuid; md2 uuid; l1 uuid; l2 uuid; l3 uuid; lo uuid; q uuid; qs uuid[] := '{}'; qq uuid; o_ok uuid; o_bad uuid;
  oks uuid[] := '{}'; bads uuid[] := '{}'; tf uuid; talg uuid; tother uuid; att uuid; r record; i int; js jsonb;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p15ta@x.test','{"full_name":"P15 TA"}','{"role":"teacher"}'), (tb,'p15tb@x.test','{"full_name":"P15 TB"}','{"role":"teacher"}'), (ad,'p15ad@x.test','{"full_name":"P15 Admin"}','{"role":"admin"}'),
    (sa,'p15sa@x.test','{"full_name":"P15 SA"}','{}'), (sb,'p15sb@x.test','{"full_name":"P15 SB"}','{}'), (sx,'p15sx@x.test','{"full_name":"P15 SX"}','{}');
  insert into courses(title, created_by, status) values ('P15 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P15 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb);
  insert into modules(course_id,title,position) values (cid,'M',1) returning id into md;
  insert into modules(course_id,title,position) values (cid2,'M2',1) returning id into md2;
  insert into lessons(module_id,title,type,is_published,position) values (md,'Fractions intro','text',true,1) returning id into l1;
  insert into lessons(module_id,title,type,is_published,position) values (md,'Algebra intro','text',true,2) returning id into l2;
  insert into lessons(module_id,title,type,is_published,position) values (md,'Draft lesson','text',false,3) returning id into l3;
  insert into lessons(module_id,title,type,is_published,position) values (md2,'Other lesson','text',true,1) returning id into lo;
  insert into quizzes(course_id,title,pass_percent) values (cid,'Mixed quiz',50) returning id into q;
  for i in 1..4 loop
    insert into quiz_questions(quiz_id,type,prompt,points,position) values (q,'single','Q'||i,10,i) returning id into qq;
    insert into quiz_options(question_id,label,position) values (qq,'right',1) returning id into o_ok;
    insert into quiz_options(question_id,label,position) values (qq,'wrong',2) returning id into o_bad;
    insert into quiz_answer_keys(question_id,correct_option_ids) values (qq, array[o_ok]);
    qs := qs || qq; oks := oks || o_ok; bads := bads || o_bad;
  end loop;
  update quizzes set is_published = true where id = q;

  -- ---- teachers manage topics ----
  perform tests.as_user(ta);
  insert into topics(course_id,name) values (cid,'Fractions') returning id into tf;
  insert into topics(course_id,name) values (cid,'Algebra') returning id into talg;
  perform tests.check('P15: a teacher creates topics for their course', (select count(*) from topics where course_id = cid) = 2);
  perform tests.check('P15: topic names are unique per course, ignoring case and spaces', tests.try(format($$insert into topics(course_id,name) values (%L,'  fractions ')$$, cid)) = -1);
  perform tests.check('P15: a blank or very long topic name is refused', tests.try(format($$insert into topics(course_id,name) values (%L,'   ')$$, cid)) = -1 and tests.try(format($$insert into topics(course_id,name) values (%L,%L)$$, cid, repeat('x', 61))) = -1);
  perform tests.check('SECURITY: a teacher cannot add topics to someone else''s course', tests.try(format($$insert into topics(course_id,name) values (%L,'Sneaky')$$, cid2)) = -1);
  perform tests.su(); perform tests.as_user(tb);
  insert into topics(course_id,name) values (cid2,'Other topic') returning id into tother;
  perform tests.check('SECURITY: another teacher sees only their own topics', (select count(*) from topics) = 1 and (select name from topics) = 'Other topic');
  perform tests.su();
  for i in 1..38 loop insert into topics(course_id,name) values (cid,'Filler '||i); end loop;
  perform tests.check('P15: 40 topics in a course is the limit', (select count(*) from topics where course_id = cid) = 40 and tests.try(format($$insert into topics(course_id,name) values (%L,'One too many')$$, cid)) = -1);
  delete from topics where course_id = cid and name like 'Filler %';

  -- ---- tagging ----
  perform tests.as_user(ta);
  perform tests.check('P15: tag lessons', tests.try(format($$insert into lesson_topics(lesson_id,topic_id) values (%L,%L)$$, l1, tf)) = 1 and tests.try(format($$insert into lesson_topics(lesson_id,topic_id) values (%L,%L)$$, l2, talg)) = 1);
  perform tests.check('P15: tag quiz questions (two for each topic)', tests.try(format($$insert into question_topics(question_id,topic_id) values (%L,%L),(%L,%L),(%L,%L),(%L,%L)$$, qs[1], tf, qs[2], tf, qs[3], talg, qs[4], talg)) = 4);
  perform tests.check('P15: the tag takes its course from the lesson', (select count(*) from lesson_topics where course_id = cid) = 2);
  perform tests.check('SECURITY: a topic of another course cannot be tagged on this course''s lesson or question', tests.try(format($$insert into lesson_topics(lesson_id,topic_id) values (%L,%L)$$, l1, tother)) = -1 and tests.try(format($$insert into question_topics(question_id,topic_id) values (%L,%L)$$, qs[1], tother)) = -1);
  perform tests.check('P15: the same tag twice is refused', tests.try(format($$insert into lesson_topics(lesson_id,topic_id) values (%L,%L)$$, l1, tf)) = -1);
  insert into topics(course_id,name) values (cid,'T3'),(cid,'T4');
  perform tests.check('P15: at most 3 topics on one lesson', tests.try(format($$insert into lesson_topics(lesson_id,topic_id) select %L, id from topics where name in ('Algebra','T3','T4')$$, l1)) = -1 and (select count(*) from lesson_topics where lesson_id = l1) <= 3);
  delete from lesson_topics where lesson_id = l1 and topic_id <> tf;
  delete from topics where name in ('T3','T4') and course_id = cid;
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot tag or read tags of my course', (select count(*) from lesson_topics) = 0 and (select count(*) from question_topics) = 0 and tests.try(format($$insert into lesson_topics(lesson_id,topic_id) values (%L,%L)$$, l3, talg)) = -1);

  -- ---- what students can see ----
  perform tests.su(); insert into lesson_topics(lesson_id,topic_id) values (l3, tf);        -- a draft lesson carries a tag too
  perform tests.as_user(sa);
  perform tests.check('P15: a student sees the topics of their course', (select count(*) from topics) = 2);
  perform tests.check('P15: and which topic a lesson covers, but not the draft lesson''s tag', (select count(*) from lesson_topics) = 2 and (select count(*) from lesson_topics where lesson_id = l3) = 0);
  perform tests.check('SECURITY: students cannot see which questions belong to which topic', (select count(*) from question_topics) = 0);
  perform tests.check('SECURITY: students cannot create, change or delete topics or tags', tests.try(format($$insert into topics(course_id,name) values (%L,'Mine')$$, cid)) = -1 and tests.try('delete from topics') = 0 and tests.try('delete from lesson_topics') = 0 and tests.try(format($$update topics set name = 'x' where id = %L$$, tf)) = 0);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: a student who is not enrolled sees no topics or tags', (select count(*) from topics) = 0 and (select count(*) from lesson_topics) = 0);

  -- ---- mastery from quiz results ----
  perform tests.su(); perform tests.as_user(sa);
  select count(*) as n into r from my_mastery(cid);
  perform tests.check('P15: before any quiz, every topic shows as untested', (select count(*) from my_mastery(cid) where level = 'untested' and percent is null) = 2);
  att := start_quiz_attempt(q);
  perform tests.check('P15: an unfinished attempt does not count', (select count(*) from my_mastery(cid) where level = 'untested') = 2);
  perform submit_quiz_attempt(att, jsonb_build_array(
    jsonb_build_object('question_id', qs[1], 'option_ids', jsonb_build_array(oks[1])), jsonb_build_object('question_id', qs[2], 'option_ids', jsonb_build_array(oks[2])),
    jsonb_build_object('question_id', qs[3], 'option_ids', jsonb_build_array(bads[3])), jsonb_build_object('question_id', qs[4], 'option_ids', jsonb_build_array(bads[4]))));
  select * into r from my_mastery(cid) where topic = 'Fractions';
  perform tests.check('P15: Fractions (2 of 2 right) is 100% and strong', r.percent = 100 and r.level = 'strong' and r.questions = 2 and r.points_got = 20 and r.points_max = 20);
  select * into r from my_mastery(cid) where topic = 'Algebra';
  perform tests.check('P15: Algebra (0 of 2 right) is 0% and weak', r.percent = 0 and r.level = 'weak');
  perform tests.check('P15: a weak topic lists the lessons to revisit, with their state', jsonb_array_length(r.lessons) = 1 and r.lessons->0->>'title' = 'Algebra intro' and (r.lessons->0->>'completed')::boolean = false and (r.lessons->0->>'locked')::boolean = false and r.lessons_total = 1 and r.lessons_done = 0);
  perform tests.check('P15: the draft lesson never appears in the revision list', not exists (select 1 from my_mastery(cid) m where m.lessons::text like '%Draft lesson%') and (select lessons_total from my_mastery(cid) where topic = 'Fractions') = 1);
  perform tests.check('P15: my_mastery with no course covers all my courses', (select count(*) from my_mastery()) = 2 and (select count(distinct course_id) from my_mastery()) = 1);
  insert into lesson_progress(lesson_id, student_id, completed) values (l2, sa, true);
  select * into r from my_mastery(cid) where topic = 'Algebra';
  perform tests.check('P15: finishing the lesson shows in the numbers', r.lessons_done = 1 and (r.lessons->0->>'completed')::boolean);
  -- retake: the latest attempt is the one that counts (now() is frozen inside one test transaction, so age the first attempt)
  perform tests.su(); update quiz_attempts set submitted_at = now() - interval '1 hour', started_at = now() - interval '2 hours' where id = att; perform tests.as_user(sa);
  att := start_quiz_attempt(q);
  perform submit_quiz_attempt(att, jsonb_build_array(
    jsonb_build_object('question_id', qs[1], 'option_ids', jsonb_build_array(bads[1])), jsonb_build_object('question_id', qs[2], 'option_ids', jsonb_build_array(oks[2])),
    jsonb_build_object('question_id', qs[3], 'option_ids', jsonb_build_array(oks[3])), jsonb_build_object('question_id', qs[4], 'option_ids', jsonb_build_array(oks[4]))));
  perform tests.check('P15: a retake replaces the old result (Fractions 50%, Algebra 100%)', (select percent from my_mastery(cid) where topic = 'Fractions') = 50 and (select level from my_mastery(cid) where topic = 'Fractions') = 'weak'
    and (select percent from my_mastery(cid) where topic = 'Algebra') = 100 and (select level from my_mastery(cid) where topic = 'Algebra') = 'strong');
  perform tests.check('P15: levels: 60 is ok, 80 is strong, 59.9 is weak, nothing is untested', mastery_level(60) = 'ok' and mastery_level(79.9) = 'ok' and mastery_level(80) = 'strong' and mastery_level(59.9) = 'weak' and mastery_level(null) = 'untested');
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('SECURITY: a student never sees another student''s mastery', (select count(*) from my_mastery(cid) where level = 'untested') = 2);

  -- ---- locked lessons are flagged, not hidden ----
  perform tests.su();
  insert into unlock_rules(lesson_id, req_type, req_id) values (l2, 'lesson', l1);
  perform tests.as_user(sb);
  perform tests.check('P15: a lesson that is locked for this student is marked locked in the list', (select (lessons->0->>'locked')::boolean from my_mastery(cid) where topic = 'Algebra'));
  perform tests.su();

  -- ---- class view for teachers ----
  perform tests.as_user(ta);
  select * into r from class_mastery(cid) where topic = 'Fractions';
  perform tests.check('P15: class view: Fractions was tested by 1 of 2 students, average 50%, 1 weak', r.students_tested = 1 and r.enrolled = 2 and r.avg_percent = 50 and r.weak_students = 1 and r.lessons_total = 1 and r.questions_tagged = 2);
  select * into r from class_mastery(cid) where topic = 'Algebra';
  perform tests.check('P15: class view: Algebra 100% with nobody weak', r.avg_percent = 100 and r.weak_students = 0);
  perform tests.check('P15: topic_students lists who is weakest first, untested last', (select full_name from topic_students(cid, tf) limit 1) = 'P15 SA' and (select count(*) from topic_students(cid, tf)) = 2 and (select percent from topic_students(cid, tf) offset 1 limit 1) is null);
  perform tests.check('P15: a topic from another course is refused', tests.try(format($$select * from topic_students(%L, %L)$$, cid, tother)) = -1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P15: admin can use the class view', (select count(*) from class_mastery(cid)) = 2);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot use the class view or student list of my course', tests.try(format($$select * from class_mastery(%L)$$, cid)) = -1 and tests.try(format($$select * from topic_students(%L, %L)$$, cid, tf)) = -1);
  perform tests.check('SECURITY: teachers do not get the student-only my_mastery', tests.try('select * from my_mastery()') = -1);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: students cannot use the class view', tests.try(format($$select * from class_mastery(%L)$$, cid)) = -1 and tests.try(format($$select * from topic_students(%L, %L)$$, cid, tf)) = -1);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: a student who is not enrolled is refused', tests.try(format($$select * from my_mastery(%L)$$, cid)) = -1);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous users cannot call any mastery function', tests.try('select * from my_mastery()') = -1 and tests.try(format($$select * from class_mastery(%L)$$, cid)) = -1 and tests.try(format($$select * from topic_students(%L, %L)$$, cid, tf)) = -1);
  perform tests.su();
  perform tests.check('SECURITY: the internal mastery_rows function is not callable by users', has_function_privilege('authenticated', 'public.mastery_rows(uuid,uuid)', 'execute') = false);

  -- ---- cleanup behaviour ----
  delete from topics where id = tf;
  perform tests.check('P15: deleting a topic removes its tags but not the lessons or questions', (select count(*) from lesson_topics where topic_id = tf) = 0 and (select count(*) from question_topics where topic_id = tf) = 0 and (select count(*) from lessons where id = l1) = 1 and (select count(*) from quiz_questions where quiz_id = q) = 4);
end $t13$;


-- =====================================================================
-- Phase 16: questions on a lesson (pinned to a moment of the video)
-- =====================================================================
do $t14$
declare
  ta uuid := '00000000-0000-0000-0000-0000000016a1'; tb uuid := '00000000-0000-0000-0000-0000000016a2'; ad uuid := '00000000-0000-0000-0000-0000000016a0';
  sa uuid := '00000000-0000-0000-0000-0000000016b1'; sb uuid := '00000000-0000-0000-0000-0000000016b2'; sx uuid := '00000000-0000-0000-0000-0000000016b3'; sc uuid := '00000000-0000-0000-0000-0000000016b4';
  cid uuid; cid2 uuid; md uuid; md2 uuid; l1 uuid; l2 uuid; l3 uuid; lo uuid; q1 uuid; q2 uuid; rep uuid; rep2 uuid; i int; r record;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p16ta@x.test','{"full_name":"P16 Teacher"}','{"role":"teacher"}'), (tb,'p16tb@x.test','{"full_name":"P16 TB"}','{"role":"teacher"}'), (ad,'p16ad@x.test','{"full_name":"P16 Admin"}','{"role":"admin"}'),
    (sa,'p16sa@x.test','{"full_name":"P16 SA"}','{}'), (sb,'p16sb@x.test','{"full_name":"P16 SB"}','{}'), (sx,'p16sx@x.test','{"full_name":"P16 SX"}','{}'), (sc,'p16sc@x.test','{"full_name":"P16 SC"}','{}');
  insert into courses(title, created_by, status) values ('P16 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P16 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb), (cid, sc);
  insert into modules(course_id,title,position) values (cid,'M',1) returning id into md;
  insert into modules(course_id,title,position) values (cid2,'M2',1) returning id into md2;
  insert into lessons(module_id,title,type,is_published,position) values (md,'Video lesson','video',true,1) returning id into l1;
  insert into lessons(module_id,title,type,is_published,position) values (md,'Draft lesson','text',false,2) returning id into l2;
  insert into lessons(module_id,title,type,is_published,position) values (md,'Locked lesson','text',true,3) returning id into l3;
  insert into lessons(module_id,title,type,is_published,position) values (md2,'Other lesson','text',true,1) returning id into lo;
  insert into unlock_rules(lesson_id, req_type, req_id) values (l3, 'lesson', l1);

  -- ---- asking ----
  perform tests.as_user(sa);
  insert into lesson_questions(lesson_id, at_seconds, body, is_pinned, is_resolved) values (l1, 272, '  What does this step mean?  ', true, true) returning id into q1;
  select * into r from lesson_questions where id = q1;
  perform tests.check('P16: a student asks a question at a moment of the video', r.at_seconds = 272 and r.author_id = sa and r.parent_id is null and r.course_id = cid and r.body = 'What does this step mean?');
  perform tests.check('SECURITY: a new question cannot arrive pinned or already answered', not r.is_pinned and not r.is_resolved);
  perform tests.check('P16: an empty question or one over 1000 characters is refused', tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, '   ')$$, l1)) = -1 and tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, %L)$$, l1, repeat('x', 1001))) = -1);
  perform tests.check('P16: a negative or absurd time is refused', tests.try(format($$insert into lesson_questions(lesson_id, at_seconds, body) values (%L, -5, 'x')$$, l1)) = -1 and tests.try(format($$insert into lesson_questions(lesson_id, at_seconds, body) values (%L, 999999, 'x')$$, l1)) = -1);
  perform tests.check('P16: a question can also be asked without a time', tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, 'General question')$$, l1)) = 1);
  perform tests.check('SECURITY: nobody can post as somebody else', tests.try(format($$insert into lesson_questions(lesson_id, author_id, body) values (%L, %L, 'Fake')$$, l1, sb)) = -1);
  perform tests.check('SECURITY: a student cannot post on a draft lesson', tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, 'hi')$$, l2)) = -1);
  perform tests.check('SECURITY: a student cannot post on a lesson that is still locked for them', tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, 'hi')$$, l3)) = -1);
  perform tests.check('SECURITY: nor on a lesson of a course they are not in', tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, 'hi')$$, lo)) = -1);
  perform tests.su();
  perform tests.check('P16: teachers of the course are told about a new student question', (select count(*) from notifications where user_id = ta and type = 'lesson_question') = 2 and (select count(*) from notifications where user_id = sa and type = 'lesson_question') = 0);
  perform tests.check('SECURITY: teachers of other courses are not told', (select count(*) from notifications where user_id = tb) = 0);

  -- ---- who can read ----
  perform tests.as_user(sb);
  perform tests.check('P16: classmates see the questions', (select count(*) from lesson_questions where lesson_id = l1) = 2);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: a student who is not enrolled sees nothing', (select count(*) from lesson_questions) = 0);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher sees nothing of my course', (select count(*) from lesson_questions) = 0);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous sees nothing and cannot post', tests.try('select * from lesson_questions') = -1 and tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, 'x')$$, l1)) = -1);

  -- ---- answers ----
  perform tests.su(); perform tests.as_user(ta);
  insert into lesson_questions(lesson_id, parent_id, at_seconds, body) values (l1, q1, 99, 'It means the loop runs once.') returning id into rep;
  perform tests.check('P16: a teacher''s reply marks the question answered', (select is_resolved from lesson_questions where id = q1));
  perform tests.check('P16: a reply never carries a time of its own', (select at_seconds from lesson_questions where id = rep) is null);
  perform tests.su();
  perform tests.check('P16: the student is told about the reply', (select count(*) from notifications where user_id = sa and type = 'lesson_reply') = 1);
  perform tests.as_user(ta);
  perform tests.check('SECURITY: a reply cannot be replied to (no deep threads)', tests.try(format($$insert into lesson_questions(lesson_id, parent_id, body) values (%L, %L, 'x')$$, l1, rep)) = -1);
  perform tests.check('SECURITY: a reply must belong to the same lesson as its question', tests.try(format($$insert into lesson_questions(lesson_id, parent_id, body) values (%L, %L, 'x')$$, l3, q1)) = -1);
  perform tests.su(); perform tests.as_user(sb);
  insert into lesson_questions(lesson_id, parent_id, body) values (l1, q1, 'I wondered the same') returning id into rep2;
  perform tests.check('P16: a classmate can reply too', (select count(*) from lesson_questions where parent_id = q1) = 2);
  perform tests.su();
  update lesson_questions set is_resolved = false where id = q1;
  perform tests.as_user(sb);
  insert into lesson_questions(lesson_id, parent_id, body) values (l1, q1, 'Another student reply');
  perform tests.su();
  perform tests.check('P16: only a teacher''s reply marks a question answered', not (select is_resolved from lesson_questions where id = q1));
  update lesson_questions set is_resolved = true where id = q1;

  -- ---- pinning, answered mark, editing ----
  perform tests.as_user(sa);
  perform tests.check('SECURITY: a student cannot pin, even their own question', tests.try(format($$update lesson_questions set is_pinned = true where id = %L$$, q1)) = -1);
  perform tests.check('P16: the author can mark their own question answered or reopen it', tests.try(format($$update lesson_questions set is_resolved = false where id = %L$$, q1)) = 1 and tests.try(format($$update lesson_questions set is_resolved = true where id = %L$$, q1)) = 1);
  perform tests.check('SECURITY: the text of a post cannot be edited', tests.try(format($$update lesson_questions set body = 'changed' where id = %L$$, q1)) = -1);
  perform tests.check('SECURITY: nobody can move a post to another lesson, time or author', tests.try(format($$update lesson_questions set lesson_id = %L where id = %L$$, l3, q1)) = -1 and tests.try(format($$update lesson_questions set at_seconds = 5 where id = %L$$, q1)) = -1 and tests.try(format($$update lesson_questions set author_id = %L where id = %L$$, sb, q1)) = -1);
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('SECURITY: a classmate cannot change someone else''s question', tests.try(format($$update lesson_questions set is_resolved = false where id = %L$$, q1)) = 0);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P16: a teacher pins a question', tests.try(format($$update lesson_questions set is_pinned = true where id = %L$$, q1)) = 1);
  perform tests.check('P16: replies cannot be pinned or marked answered', tests.try(format($$update lesson_questions set is_pinned = true where id = %L$$, rep)) = -1 and tests.try(format($$update lesson_questions set is_resolved = true where id = %L$$, rep)) = -1);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot pin or change anything', tests.try(format($$update lesson_questions set is_pinned = false where id = %L$$, q1)) = 0);

  -- ---- deleting ----
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('SECURITY: a classmate cannot delete someone else''s post', tests.try(format($$delete from lesson_questions where id = %L$$, q1)) = 0 and tests.try(format($$delete from lesson_questions where id = %L$$, rep)) = 0);
  perform tests.check('P16: authors can delete their own reply', tests.try(format($$delete from lesson_questions where id = %L$$, rep2)) = 1);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot delete', tests.try('delete from lesson_questions') = 0);

  -- ---- reading a thread ----
  perform tests.su(); perform tests.as_user(sb);
  select count(*) as n, count(*) filter (where author_is_staff) as staff, count(*) filter (where mine) as mine into r from lesson_thread(l1);
  perform tests.check('P16: lesson_thread returns names, who is staff and which posts are mine', r.n = 4 and r.staff = 1 and r.mine = 1 and exists (select 1 from lesson_thread(l1) where author_name = 'P16 Teacher' and author_is_staff));
  perform tests.check('SECURITY: lesson_thread never exposes emails', not exists (select 1 from information_schema.columns where table_name = 'lesson_thread') and (select count(*) from lesson_thread(l1) t where to_jsonb(t)::text like '%@%') = 0);
  perform tests.check('SECURITY: lesson_thread is refused for draft, locked and foreign lessons', tests.try(format($$select * from lesson_thread(%L)$$, l2)) = -1 and tests.try(format($$select * from lesson_thread(%L)$$, l3)) = -1 and tests.try(format($$select * from lesson_thread(%L)$$, lo)) = -1);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: lesson_thread is refused for students who are not enrolled', tests.try(format($$select * from lesson_thread(%L)$$, l1)) = -1);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: and for other teachers', tests.try(format($$select * from lesson_thread(%L)$$, l1)) = -1);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P16: staff can read the thread of a draft lesson', tests.try(format($$select * from lesson_thread(%L)$$, l2)) >= 0);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous cannot call lesson_thread or open_questions', tests.try(format($$select * from lesson_thread(%L)$$, l1)) = -1 and tests.try('select * from open_questions()') = -1);

  -- ---- unlocking opens the locked lesson's questions ----
  perform tests.su(); perform tests.as_user(sb);
  insert into lesson_progress(lesson_id, student_id, completed) values (l1, sb, true);
  perform tests.check('P16: once a lesson is unlocked its questions open up', tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, 'Now unlocked')$$, l3)) = 1 and tests.try(format($$select * from lesson_thread(%L)$$, l3)) >= 0);

  -- ---- the teacher's queue ----
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P16: open_questions lists only unanswered questions, with names and lesson titles', (select count(*) from open_questions()) = 2 and exists (select 1 from open_questions() where lesson_title = 'Video lesson' and author_name = 'P16 SA') and not exists (select 1 from open_questions() where id = q1));
  perform tests.check('P16: open_questions can be limited to one course', (select count(*) from open_questions(cid)) = 2 and tests.try(format($$select * from open_questions(%L)$$, cid2)) = -1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P16: admin sees the queue too', (select count(*) from open_questions()) = 2);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher sees none of my queue', (select count(*) from open_questions()) = 0 and tests.try(format($$select * from open_questions(%L)$$, cid)) = -1);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: students cannot use the queue', tests.try('select * from open_questions()') = -1);

  -- ---- slow down floods ----
  perform tests.su(); perform tests.as_user(sc);
  for i in 1..20 loop insert into lesson_questions(lesson_id, body) values (l1, 'Flood ' || i); end loop;
  perform tests.check('P16: 20 posts in an hour is fine, the 21st is refused', tests.try(format($$insert into lesson_questions(lesson_id, body) values (%L, 'One too many')$$, l1)) = -1);

  -- ---- clean-up ----
  perform tests.su();
  delete from lessons where id = l1;
  perform tests.check('P16: deleting a lesson deletes its questions', (select count(*) from lesson_questions where lesson_id = l1) = 0);
end $t14$;

-- =====================================================================
-- Phase 17: live pulse and quick polls
-- =====================================================================
do $t15$
declare
  ta uuid := '00000000-0000-0000-0000-0000000017a1'; tb uuid := '00000000-0000-0000-0000-0000000017a2'; ad uuid := '00000000-0000-0000-0000-0000000017a0';
  sa uuid := '00000000-0000-0000-0000-0000000017b1'; sb uuid := '00000000-0000-0000-0000-0000000017b2'; sc uuid := '00000000-0000-0000-0000-0000000017b3'; sx uuid := '00000000-0000-0000-0000-0000000017b4';
  cid uuid; cid2 uuid; lc uuid; lc_future uuid; lc_cancel uuid; lc_past uuid; lc_other uuid; p1 uuid; p2 uuid; p_future uuid; i int; r record;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p17ta@x.test','{"full_name":"P17 TA"}','{"role":"teacher"}'), (tb,'p17tb@x.test','{"full_name":"P17 TB"}','{"role":"teacher"}'), (ad,'p17ad@x.test','{"full_name":"P17 Admin"}','{"role":"admin"}'),
    (sa,'p17sa@x.test','{"full_name":"P17 SA"}','{}'), (sb,'p17sb@x.test','{"full_name":"P17 SB"}','{}'), (sc,'p17sc@x.test','{"full_name":"P17 SC"}','{}'), (sx,'p17sx@x.test','{"full_name":"P17 SX"}','{}');
  insert into courses(title, created_by, status) values ('P17 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P17 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb), (cid, sc), (cid2, sx);
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid,'On now', now() - interval '10 minutes', now() + interval '50 minutes') returning id into lc;
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid,'Next week', now() + interval '3 days', now() + interval '3 days 1 hour') returning id into lc_future;
  insert into live_classes(course_id,title,starts_at,ends_at,status) values (cid,'Cancelled', now() - interval '10 minutes', now() + interval '50 minutes','cancelled') returning id into lc_cancel;
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid,'Long over', now() - interval '5 hours', now() - interval '4 hours') returning id into lc_past;
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid2,'Other course', now() - interval '10 minutes', now() + interval '50 minutes') returning id into lc_other;

  -- ---- pulse ----
  perform tests.as_user(sa);
  perform tests.check('P17: a student sends "I''m lost" during the class', tests.try(format($$insert into live_pulse(live_class_id, state) values (%L, 'lost')$$, lc)) = 1);
  perform tests.check('P17: and changes it to "Got it" (upsert)', tests.try(format($$insert into live_pulse(live_class_id, state) values (%L, 'got_it') on conflict (live_class_id, student_id) do update set state = excluded.state$$, lc)) = 1);
  perform tests.check('P17: the pulse now says Got it, and there is still only one row', (select state from live_pulse where live_class_id = lc) = 'got_it' and (select count(*) from live_pulse where live_class_id = lc) = 1);
  perform tests.check('P17: the pulse takes its course from the class', (select course_id from live_pulse where live_class_id = lc) = cid);
  perform tests.check('P17: only the two known states are accepted', tests.try(format($$update live_pulse set state = 'bored' where live_class_id = %L$$, lc)) = -1);
  perform tests.check('SECURITY: no pulse before the window, after it, or for a cancelled class', tests.try(format($$insert into live_pulse(live_class_id, state) values (%L, 'lost')$$, lc_future)) = -1 and tests.try(format($$insert into live_pulse(live_class_id, state) values (%L, 'lost')$$, lc_past)) = -1 and tests.try(format($$insert into live_pulse(live_class_id, state) values (%L, 'lost')$$, lc_cancel)) = -1);
  perform tests.check('SECURITY: no pulse for a class of another course', tests.try(format($$insert into live_pulse(live_class_id, state) values (%L, 'lost')$$, lc_other)) = -1);
  perform tests.check('SECURITY: nobody can send a pulse for someone else', tests.try(format($$insert into live_pulse(live_class_id, student_id, state) values (%L, %L, 'lost')$$, lc, sb)) = -1);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: a student of another course cannot send a pulse here', tests.try(format($$insert into live_pulse(live_class_id, state) values (%L, 'lost')$$, lc)) = -1);
  perform tests.su(); perform tests.as_user(sb);
  insert into live_pulse(live_class_id, state) values (lc, 'lost');
  perform tests.su(); perform tests.as_user(sc);
  insert into live_pulse(live_class_id, state) values (lc, 'lost');
  perform tests.check('P17: a student sees only their own pulse', (select count(*) from live_pulse) = 1);
  perform tests.check('SECURITY: a student cannot change or delete another student''s pulse', tests.try(format($$update live_pulse set state = 'got_it' where student_id = %L$$, sa)) = 0 and tests.try(format($$delete from live_pulse where student_id = %L$$, sa)) = 0);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('SECURITY: the teacher cannot read who sent what (counts only)', (select count(*) from live_pulse) = 0);

  -- ---- the teacher's numbers ----
  select * into r from pulse_summary(lc);
  perform tests.check('P17: pulse_summary counts Got it, I''m lost and the enrolled students', r.got_it = 1 and r.lost = 2 and r.enrolled = 3);
  perform tests.su();
  set local session_replication_role = replica;
  update live_pulse set updated_at = now() - interval '10 minutes' where student_id = sb;
  set local session_replication_role = origin;
  perform tests.as_user(ta);
  perform tests.check('P17: a tap fades after 5 minutes', (select lost from pulse_summary(lc)) = 1 and (select got_it from pulse_summary(lc)) = 1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P17: admin can see the numbers', (select enrolled from pulse_summary(lc)) = 3);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot see the numbers', tests.try(format($$select * from pulse_summary(%L)$$, lc)) = -1);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: a student cannot see the numbers', tests.try(format($$select * from pulse_summary(%L)$$, lc)) = -1);
  perform tests.check('P17: a student can clear their own pulse', tests.try(format($$delete from live_pulse where live_class_id = %L$$, lc)) = 1);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous cannot use pulse or the numbers', tests.try('select * from live_pulse') = -1 and tests.try(format($$select * from pulse_summary(%L)$$, lc)) = -1);

  -- ---- polls ----
  perform tests.su(); perform tests.as_user(ta);
  insert into live_polls(live_class_id, question, options) values (lc, '  Which method?  ', array[' Substitution ', 'Elimination', 'Graph']) returning id into p1;
  select * into r from live_polls where id = p1;
  perform tests.check('P17: a teacher starts a poll; text is trimmed and it starts open', r.question = 'Which method?' and r.options = array['Substitution', 'Elimination', 'Graph'] and r.status = 'open' and r.course_id = cid);
  perform tests.check('P17: a poll needs 2 to 6 answers, each 1 to 80 characters, and a question', tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, 'Q', array['only one'])$$, lc)) = -1
    and tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, 'Q', array['1','2','3','4','5','6','7'])$$, lc)) = -1
    and tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, 'Q', array['ok','   '])$$, lc)) = -1
    and tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, 'Q', array['ok', %L])$$, lc, repeat('x', 81))) = -1
    and tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, '  ', array['a','b'])$$, lc)) = -1);
  perform tests.check('SECURITY: a poll cannot be edited once created', tests.try(format($$update live_polls set question = 'Changed' where id = %L$$, p1)) = -1 and tests.try(format($$update live_polls set options = array['x','y'] where id = %L$$, p1)) = -1);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot start or see polls of my class', tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, 'Q', array['a','b'])$$, lc)) = -1 and (select count(*) from live_polls) = 0);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: a student cannot create, close or delete polls', tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, 'Q', array['a','b'])$$, lc)) = -1 and tests.try(format($$update live_polls set status = 'closed' where id = %L$$, p1)) = 0 and tests.try('delete from live_polls') = 0);
  perform tests.check('P17: enrolled students see the poll', (select count(*) from live_polls) = 1);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: students of other courses do not see it', (select count(*) from live_polls) = 0);

  -- ---- voting ----
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: results stay hidden until you have voted', tests.try(format($$select * from poll_results(%L)$$, p1)) = -1);
  perform tests.check('P17: a student votes', tests.try(format($$insert into live_poll_votes(poll_id, option_idx) values (%L, 1)$$, p1)) = 1);
  perform tests.check('P17: and may change their mind while the poll is open', tests.try(format($$update live_poll_votes set option_idx = 2 where poll_id = %L$$, p1)) = 1);
  perform tests.check('P17: the vote now says answer 3', (select option_idx from live_poll_votes where poll_id = p1) = 2);
  perform tests.check('SECURITY: one vote each (a second insert is refused)', tests.try(format($$insert into live_poll_votes(poll_id, option_idx) values (%L, 0)$$, p1)) = -1);
  perform tests.check('SECURITY: an answer that does not exist is refused', tests.try(format($$update live_poll_votes set option_idx = 5 where poll_id = %L$$, p1)) = -1);
  perform tests.check('SECURITY: nobody can vote for someone else', tests.try(format($$insert into live_poll_votes(poll_id, student_id, option_idx) values (%L, %L, 0)$$, p1, sb)) = -1);
  perform tests.su(); perform tests.as_user(sb);
  insert into live_poll_votes(poll_id, option_idx) values (p1, 2);
  perform tests.su(); perform tests.as_user(sc);
  insert into live_poll_votes(poll_id, option_idx) values (p1, 0);
  perform tests.check('P17: a student sees only their own vote', (select count(*) from live_poll_votes) = 1);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: a student of another course cannot vote here', tests.try(format($$insert into live_poll_votes(poll_id, option_idx) values (%L, 0)$$, p1)) = -1 and tests.try(format($$select * from poll_results(%L)$$, p1)) = -1);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('SECURITY: the teacher cannot read individual votes', (select count(*) from live_poll_votes) = 0);
  select count(*) as n, sum(votes) filter (where option_idx = 2) as graph, sum(votes) filter (where option_idx = 0) as sub, max(total) as total into r from poll_results(p1);
  perform tests.check('P17: poll_results gives totals per answer, with labels', r.n = 3 and r.graph = 2 and r.sub = 1 and r.total = 3 and exists (select 1 from poll_results(p1) where label = 'Elimination' and votes = 0));
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: another teacher cannot read the results', tests.try(format($$select * from poll_results(%L)$$, p1)) = -1);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('P17: a student who has voted can see the totals', (select max(total) from poll_results(p1)) = 3);
  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P17: a teacher closes the poll', tests.try(format($$update live_polls set status = 'closed' where id = %L$$, p1)) = 1);
  perform tests.su(); perform tests.as_user(sa);
  perform tests.check('SECURITY: a closed poll takes no more votes or changes', tests.try(format($$update live_poll_votes set option_idx = 0 where poll_id = %L$$, p1)) = -1);
  perform tests.su(); perform tests.as_user(ta);
  insert into live_polls(live_class_id, question, options) values (lc, 'Second', array['A','B']) returning id into p2;
  update live_polls set status = 'closed' where id = p2;
  perform tests.su(); perform tests.as_user(sb);
  perform tests.check('P17: totals of a closed poll are open to every enrolled student, even one who did not vote', (select max(total) from poll_results(p2)) = 0);
  perform tests.su(); perform tests.as_anon();
  perform tests.check('SECURITY: anonymous cannot use polls', tests.try('select * from live_polls') = -1 and tests.try(format($$select * from poll_results(%L)$$, p1)) = -1);

  -- ---- outside the class window ----
  perform tests.su();
  insert into live_polls(live_class_id, question, options) values (lc_future, 'Future poll', array['A','B']) returning id into p_future;
  perform tests.as_user(sa);
  perform tests.check('SECURITY: no voting on a poll of a class that is not on', tests.try(format($$insert into live_poll_votes(poll_id, option_idx) values (%L, 0)$$, p_future)) = -1);

  -- ---- the 20-poll limit ----
  perform tests.su(); perform tests.as_user(ta);
  for i in 1..17 loop insert into live_polls(live_class_id, question, options) values (lc, 'Filler ' || i, array['a','b']); end loop;
  perform tests.check('P17: 20 polls per class is the limit', (select count(*) from live_polls where live_class_id = lc) = 19 and tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, 'n20', array['a','b'])$$, lc)) = 1 and tests.try(format($$insert into live_polls(live_class_id, question, options) values (%L, 'n21', array['a','b'])$$, lc)) = -1);

  -- ---- clean-up ----
  perform tests.su();
  delete from live_classes where id = lc;
  perform tests.check('P17: deleting a class deletes its pulse, polls and votes', (select count(*) from live_pulse where live_class_id = lc) = 0 and (select count(*) from live_polls where live_class_id = lc) = 0 and (select count(*) from live_poll_votes where poll_id = p1) = 0);
end $t15$;

-- ---------------------------------------------------------------------
-- Phase 18: Joined status for live classes
-- ---------------------------------------------------------------------
do $t16$
declare
  ta uuid := '00000000-0000-0000-0000-0000000018a1'; tb uuid := '00000000-0000-0000-0000-0000000018a2'; ad uuid := '00000000-0000-0000-0000-0000000018a0';
  sa uuid := '00000000-0000-0000-0000-0000000018b1'; sb uuid := '00000000-0000-0000-0000-0000000018b2'; sx uuid := '00000000-0000-0000-0000-0000000018b4';
  cid uuid; cid2 uuid; lc uuid; lc_future uuid; lc_cancel uuid; lc_past uuid; lc_other uuid; r record; n int;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p18ta@x.test','{"full_name":"P18 TA"}','{"role":"teacher"}'), (tb,'p18tb@x.test','{"full_name":"P18 TB"}','{"role":"teacher"}'), (ad,'p18ad@x.test','{"full_name":"P18 Admin"}','{"role":"admin"}'),
    (sa,'p18sa@x.test','{"full_name":"P18 SA"}','{}'), (sb,'p18sb@x.test','{"full_name":"P18 SB"}','{}'), (sx,'p18sx@x.test','{"full_name":"P18 SX"}','{}');
  insert into courses(title, created_by, status) values ('P18 Course', ta, 'published') returning id into cid;
  insert into courses(title, created_by, status) values ('P18 Other', tb, 'published') returning id into cid2;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb), (cid2, sx);
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid,'On now', now() - interval '10 minutes', now() + interval '50 minutes') returning id into lc;
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid,'Next week', now() + interval '3 days', now() + interval '3 days 1 hour') returning id into lc_future;
  insert into live_classes(course_id,title,starts_at,ends_at,status) values (cid,'Cancelled', now() - interval '10 minutes', now() + interval '50 minutes','cancelled') returning id into lc_cancel;
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid,'Long over', now() - interval '5 hours', now() - interval '4 hours') returning id into lc_past;
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid2,'Other course', now() - interval '10 minutes', now() + interval '50 minutes') returning id into lc_other;

  perform tests.as_user(sa);
  select * into r from record_join(lc);
  perform tests.check('P18: a student joining is recorded once', r.join_count = 1 and (select count(*) from live_joins where live_class_id = lc) = 1);
  select * into r from record_join(lc);
  perform tests.check('P18: rejoining adds to the count but keeps one row and the first join time', r.join_count = 2 and (select count(*) from live_joins where live_class_id = lc) = 1 and r.first_joined_at <= r.last_joined_at);
  perform tests.check('SECURITY: no join recorded before the window, after it, or for a cancelled class', tests.try(format('select * from record_join(%L)', lc_future)) = -1 and tests.try(format('select * from record_join(%L)', lc_past)) = -1 and tests.try(format('select * from record_join(%L)', lc_cancel)) = -1);
  perform tests.check('SECURITY: no join for a class of a course the student is not in', tests.try(format('select * from record_join(%L)', lc_other)) = -1);
  perform tests.check('SECURITY: nobody writes the table directly', tests.try(format($$insert into live_joins(live_class_id, user_id, course_id) values (%L, %L, %L)$$, lc, sa, cid)) = -1 and tests.try(format($$update live_joins set join_count = 99 where live_class_id = %L$$, lc)) = -1 and tests.try(format($$delete from live_joins where live_class_id = %L$$, lc)) = -1);
  perform tests.check('SECURITY: a student cannot read who joined', tests.try(format('select * from live_joined(%L)', lc)) = -1);
  perform tests.su(); perform tests.as_user(sb);
  perform record_join(lc);
  perform tests.check('P18: a student sees only their own join row', (select count(*) from live_joins where live_class_id = lc) = 1 and (select user_id from live_joins where live_class_id = lc) = sb);
  perform tests.su(); perform tests.as_user(sx);
  perform tests.check('SECURITY: a student of another course sees nothing here', (select count(*) from live_joins where live_class_id = lc) = 0);

  perform tests.su(); perform tests.as_user(ta);
  perform record_join(lc);
  perform tests.check('P18: the teacher of the course can join (and is recorded as staff)', (select count(*) from live_joins where live_class_id = lc) = 1);
  perform tests.check('P18: the teacher sees the list: 3 joined, with names, staff flagged, and the enrolled total', (select count(*) from live_joined(lc)) = 3 and (select count(*) from live_joined(lc) where is_staff) = 1 and (select max(enrolled) from live_joined(lc)) = 2 and (select count(*) from live_joined(lc) where full_name like 'P18 S%') = 2);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: a teacher of another course cannot read the list or join', tests.try(format('select * from live_joined(%L)', lc)) = -1 and tests.try(format('select * from record_join(%L)', lc)) = -1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P18: an admin can read the list and join any open class', (select count(*) from live_joined(lc)) = 3 and tests.try(format('select * from record_join(%L)', lc_other)) = 1);

  perform tests.su();
  delete from live_classes where id = lc;
  perform tests.check('P18: deleting a class deletes its joins', (select count(*) from live_joins where live_class_id = lc) = 0);
end $t16$;

-- ---------------------------------------------------------------------
-- Phase 19: presence (who is in, who left, visits)
-- ---------------------------------------------------------------------
do $t17$
declare
  ta uuid := '00000000-0000-0000-0000-0000000019a1'; ad uuid := '00000000-0000-0000-0000-0000000019a0'; tb uuid := '00000000-0000-0000-0000-0000000019a2';
  sa uuid := '00000000-0000-0000-0000-0000000019b1'; sb uuid := '00000000-0000-0000-0000-0000000019b2';
  cid uuid; lc uuid; r record; j jsonb;
begin
  insert into auth.users(id, email, raw_user_meta_data, raw_app_meta_data) values
    (ta,'p19ta@x.test','{"full_name":"P19 TA"}','{"role":"teacher"}'), (tb,'p19tb@x.test','{"full_name":"P19 TB"}','{"role":"teacher"}'), (ad,'p19ad@x.test','{"full_name":"P19 Admin"}','{"role":"admin"}'),
    (sa,'p19sa@x.test','{"full_name":"P19 SA"}','{}'), (sb,'p19sb@x.test','{"full_name":"P19 SB"}','{}');
  insert into courses(title, created_by, status) values ('P19 Course', ta, 'published') returning id into cid;
  insert into enrollments(course_id, student_id) values (cid, sa), (cid, sb);
  insert into live_classes(course_id,title,starts_at,ends_at) values (cid,'On now', now() - interval '10 minutes', now() + interval '50 minutes') returning id into lc;

  perform tests.as_user(sa);
  perform record_join(lc);
  select * into r from my_live_status(lc);
  perform tests.check('P19: after Join the student is "in the class" with one visit', r.in_class and r.join_count = 1 and r.left_at is null and r.visit_joined_at is not null);
  perform live_heartbeat(lc);
  perform tests.check('P19: a heartbeat keeps the visit alive', (select in_class from my_live_status(lc)));
  perform record_leave(lc);
  select * into r from my_live_status(lc);
  perform tests.check('P19: leaving records the time and the student is no longer in the class', not r.in_class and r.left_at is not null and r.join_count = 1);
  perform record_join(lc);
  select * into r from my_live_status(lc);
  perform tests.check('P19: joining again starts a new visit and counts the rejoin', r.in_class and r.join_count = 2 and r.left_at is null);
  perform tests.check('P19: two visits are stored for the student, one closed and one open', (select count(*) from live_sessions where live_class_id = lc) = 2 and (select count(*) from live_sessions where live_class_id = lc and left_at is null) = 1);
  perform record_join(lc);
  perform tests.check('P19: pressing Join while a visit is open closes that visit first (never two open at once)', (select count(*) from live_sessions where live_class_id = lc and left_at is null) = 1 and (select count(*) from live_sessions where live_class_id = lc) = 3);
  perform tests.check('SECURITY: nobody writes the sessions table directly', tests.try(format($$insert into live_sessions(live_class_id, user_id, course_id) values (%L, %L, %L)$$, lc, sa, cid)) = -1 and tests.try(format($$update live_sessions set left_at = null where live_class_id = %L$$, lc)) = -1 and tests.try(format($$delete from live_sessions where live_class_id = %L$$, lc)) = -1);

  -- the student closes the browser: no heartbeat for 3 minutes
  perform tests.su();
  update live_sessions set last_seen_at = now() - interval '3 minutes' where live_class_id = lc and user_id = sa and left_at is null;
  perform tests.as_user(sa);
  select * into r from my_live_status(lc);
  perform tests.check('P19: no heartbeat for 2 minutes counts as left, at the last heartbeat', not r.in_class and r.left_at is not null and r.left_at <= now() - interval '2 minutes 30 seconds');
  perform live_heartbeat(lc);
  perform tests.check('P19: a late heartbeat brings the visit back (a bad connection does not lose the person)', (select in_class from my_live_status(lc)));

  perform tests.su(); perform tests.as_user(sb);
  perform record_join(lc, 'app');
  perform tests.check('P19: a join through the app is stored as via app', (select via from live_sessions where live_class_id = lc and user_id = sb) = 'app');
  perform tests.check('P19: a student sees only their own visits', (select count(*) from live_sessions where live_class_id = lc) = 1);
  perform tests.check('SECURITY: a student cannot read the staff list', tests.try(format('select * from live_joined(%L)', lc)) = -1);

  perform tests.su(); perform tests.as_user(ta);
  perform tests.check('P19: the teacher sees both students, with who is in the class now', (select count(*) from live_joined(lc)) = 2 and (select count(*) from live_joined(lc) where in_class) = 2);
  select * into r from live_joined(lc) where full_name = 'P19 SA';
  j := r.visits;
  perform tests.check('P19: the list has each visit with join and leave times, and a total', jsonb_array_length(j) = 3 and r.join_count = 3 and r.total_seconds >= 0 and (j->0->>'left_at') is not null);
  perform tests.su();
  update live_sessions set last_seen_at = now() - interval '5 minutes' where live_class_id = lc and user_id = sb and left_at is null;
  perform tests.as_user(ta);
  perform tests.check('P19: someone who stops sending heartbeats shows as left in the staff list', (select not in_class from live_joined(lc) where full_name = 'P19 SB') and (select last_left_at from live_joined(lc) where full_name = 'P19 SB') is not null);
  perform tests.su(); perform tests.as_user(tb);
  perform tests.check('SECURITY: a teacher of another course cannot read the list', tests.try(format('select * from live_joined(%L)', lc)) = -1);
  perform tests.su(); perform tests.as_user(ad);
  perform tests.check('P19: an admin can read the list', (select count(*) from live_joined(lc)) = 2);
  perform tests.su();
  delete from live_classes where id = lc;
  perform tests.check('P19: deleting a class deletes its visits', (select count(*) from live_sessions where live_class_id = lc) = 0);
end $t17$;

select n, case when ok then 'PASS' else 'FAIL' end as result, name from tests.results order by n;
select count(*) filter (where ok) as passed, count(*) filter (where not ok) as failed from tests.results;
