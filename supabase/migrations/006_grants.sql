-- =====================================================================
-- Rinova Learn  |  006_grants.sql
-- Table privileges (RLS decides rows) and function execute rights.
-- anon gets NOTHING: every part of the app requires sign-in.
-- =====================================================================

revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all functions in schema public from public;

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Column-level limits: users may only touch these columns
revoke update on public.notifications from authenticated;
grant  update (is_read) on public.notifications to authenticated;
revoke update on public.conversation_participants from authenticated;
grant  update (last_read_at) on public.conversation_participants to authenticated;
-- audit log + messages are append-only for clients
revoke insert, update, delete on public.audit_log from authenticated;
revoke update on public.messages from authenticated;
revoke insert, update, delete on public.notifications from authenticated;
grant  update (is_read) on public.notifications to authenticated;
grant  delete on public.notifications to authenticated;
-- conversations / participants are created through RPCs only
revoke insert, update, delete on public.conversations from authenticated;
revoke insert, delete on public.conversation_participants from authenticated;
-- quiz attempt data is written through RPCs only
revoke insert, update, delete on public.quiz_attempts, public.quiz_responses from authenticated;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on functions from anon;
