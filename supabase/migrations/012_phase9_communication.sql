-- =====================================================================
-- Rinova Learn  |  012_phase9_communication.sql   (Phase 9: announcements + messaging)
-- Safe to run more than once.
-- =====================================================================

-- 1. Announcements: size limits and immutability -----------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'announcements_limits') then
    alter table public.announcements add constraint announcements_limits
      check (char_length(title) between 1 and 200 and char_length(body) between 1 and 5000) not valid;
  end if;
end $$;

create or replace function public.announcements_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.title := btrim(coalesce(new.title, ''));
  new.body  := btrim(coalesce(new.body, ''));
  if new.title = '' then raise exception 'Add a title'; end if;
  if new.body  = '' then raise exception 'Write a message'; end if;
  if char_length(new.title) > 200 then raise exception 'Title is too long (200 characters max)'; end if;
  if char_length(new.body) > 5000 then raise exception 'Message is too long (5000 characters max)'; end if;
  if tg_op = 'UPDATE' then
    if new.course_id is distinct from old.course_id then raise exception 'An announcement cannot move to another course'; end if;
    if new.author_id <> old.author_id then raise exception 'The author cannot change'; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_announcements_guard on public.announcements;
create trigger trg_announcements_guard before insert or update on public.announcements
  for each row execute function public.announcements_guard();

-- Notify the course audience (or everyone for a global post); link opens the post.
create or replace function public.trg_notify_announcement() returns trigger
language plpgsql security definer set search_path = public as $$
declare uids uuid[];
begin
  if new.course_id is null then
    select array_agg(p.id) into uids from public.profiles p where p.status = 'active';
  else
    uids := public.course_audience(new.course_id)
         || array(select ct.teacher_id from public.course_teachers ct where ct.course_id = new.course_id);
  end if;
  perform public.notify_users(uids, 'announcement', new.title, left(new.body, 140), 'announcements?id=' || new.id);
  return new;
end $$;

-- 2. Messages: validation, anti-spam, notifications ---------------------
create or replace function public.messages_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype; other uuid;
begin
  select * into c from public.conversations where id = new.conversation_id;
  new.body := nullif(btrim(coalesce(new.body, '')), '');
  if new.body is null and new.attachment_path is null then raise exception 'Write a message first'; end if;
  if new.attachment_path is not null and (
       left(new.attachment_path, 37) <> new.conversation_id::text || '/' or char_length(new.attachment_path) > 300) then
    raise exception 'Invalid attachment';
  end if;
  if (select count(*) from public.messages m where m.sender_id = new.sender_id and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'You are sending messages too fast. Wait a moment.';
  end if;
  if c.type = 'direct' then
    select user_id into other from public.conversation_participants where conversation_id = c.id and user_id <> new.sender_id limit 1;
    if other is null or not exists (select 1 from public.profiles p where p.id = other and p.status = 'active') then
      raise exception 'This person can no longer receive messages';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_messages_guard on public.messages;
create trigger trg_messages_guard before insert on public.messages
  for each row execute function public.messages_guard();

-- One unread "message" notification per conversation (no spam), and course-chat
-- members get a read marker so unread counts work for them too.
create or replace function public.trg_notify_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c public.conversations%rowtype; uids uuid[]; sender text; lnk text; fresh uuid[];
begin
  select * into c from public.conversations where id = new.conversation_id;
  select full_name into sender from public.profiles where id = new.sender_id;
  lnk := 'messages?c=' || c.id;
  if c.type = 'direct' then
    select array_agg(user_id) into uids from public.conversation_participants where conversation_id = c.id;
  else
    uids := public.course_audience(c.course_id) || array(select ct.teacher_id from public.course_teachers ct where ct.course_id = c.course_id);
    insert into public.conversation_participants (conversation_id, user_id, last_read_at)
      select c.id, u, new.created_at - interval '1 millisecond' from unnest(uids) u where u <> new.sender_id
      on conflict do nothing;
  end if;
  insert into public.conversation_participants (conversation_id, user_id, last_read_at)
    values (c.id, new.sender_id, new.created_at) on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
  select coalesce(array_agg(u), '{}') into fresh from unnest(uids) u
   where not exists (select 1 from public.notifications n where n.user_id = u and n.type = 'message' and n.link = lnk and not n.is_read);
  perform public.notify_users(fresh, 'message', 'New message from ' || coalesce(nullif(sender, ''), 'someone'),
    left(coalesce(new.body, 'Attachment'), 140), lnk);
  return new;
end $$;

-- People may delete their own messages (admins can delete any, as before).
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete to authenticated
  using (sender_id = auth.uid() and public.can_access_conversation(conversation_id));

-- 3. RPCs ----------------------------------------------------------------
create or replace function public.my_conversations() returns table(
  id uuid, type public.conversation_type, course_id uuid, course_title text,
  other_id uuid, other_name text, other_avatar text, other_role public.user_role,
  last_body text, last_has_attachment boolean, last_at timestamptz, last_sender uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select c.id, c.type, c.course_id, co.title,
         o.id, case when o.id is null then null else coalesce(nullif(o.full_name, ''), 'User') end, o.avatar_url, o.role,
         lm.body, (lm.attachment_path is not null), lm.created_at, lm.sender_id,
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id <> auth.uid() and m.created_at > coalesce(me.last_read_at, now()))
  from public.conversations c
  left join public.conversation_participants me on me.conversation_id = c.id and me.user_id = auth.uid()
  left join public.courses co on co.id = c.course_id
  left join lateral (select p.id, p.full_name, p.avatar_url, p.role from public.conversation_participants cp
                     join public.profiles p on p.id = cp.user_id
                     where c.type = 'direct' and cp.conversation_id = c.id and cp.user_id <> auth.uid() limit 1) o on true
  left join lateral (select m.body, m.attachment_path, m.created_at, m.sender_id from public.messages m
                     where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
  where public.is_active_user() and public.can_access_conversation(c.id)
    and (c.type = 'direct' or lm.created_at is not null)
  order by lm.created_at desc nulls last, c.created_at desc
$$;

create or replace function public.conversation_messages(p_conv uuid, p_limit int default 60, p_before timestamptz default null)
returns table(id uuid, sender_id uuid, sender_name text, sender_avatar text, sender_role public.user_role,
              body text, attachment_path text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_access_conversation(p_conv) then raise exception 'Conversation not found'; end if;
  return query
    select x.id, x.sender_id, coalesce(nullif(p.full_name, ''), 'User'), p.avatar_url, p.role, x.body, x.attachment_path, x.created_at
    from (select m.* from public.messages m where m.conversation_id = p_conv and (p_before is null or m.created_at < p_before)
          order by m.created_at desc limit least(greatest(coalesce(p_limit, 60), 1), 100)) x
    join public.profiles p on p.id = x.sender_id
    order by x.created_at asc;
end $$;

create or replace function public.mark_conversation_read(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_access_conversation(p_conv) then raise exception 'Conversation not found'; end if;
  insert into public.conversation_participants (conversation_id, user_id, last_read_at) values (p_conv, auth.uid(), now())
    on conflict (conversation_id, user_id) do update set last_read_at = now();
  update public.notifications set is_read = true
   where user_id = auth.uid() and type = 'message' and link = 'messages?c=' || p_conv and not is_read;
end $$;

create or replace function public.messageable_users(p_query text default null)
returns table(id uuid, full_name text, role public.user_role, avatar_url text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.full_name, ''), 'User'), p.role, p.avatar_url
  from public.profiles p
  where public.is_active_user() and p.status = 'active' and p.id <> auth.uid()
    and (public.is_admin() or p.role = 'admin' or public.shares_course_with(p.id))
    and (nullif(btrim(p_query), '') is null
         or p.full_name ilike '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by p.full_name nulls last limit 30
$$;

revoke execute on function public.messages_guard(), public.announcements_guard() from public, anon, authenticated;
revoke execute on function public.my_conversations(), public.conversation_messages(uuid, int, timestamptz),
  public.mark_conversation_read(uuid), public.messageable_users(text) from public, anon;
grant execute on function public.my_conversations(), public.conversation_messages(uuid, int, timestamptz),
  public.mark_conversation_read(uuid), public.messageable_users(text) to authenticated;

-- 4. Realtime: new messages and notifications appear without a refresh (RLS still applies).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
      alter publication supabase_realtime add table public.messages;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end $$;
