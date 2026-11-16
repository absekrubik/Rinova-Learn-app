// Supabase Edge Function: create-user
// Lets an ADMIN create teacher / admin / student accounts.
// The service_role key lives only in Supabase's function environment
// (SUPABASE_SERVICE_ROLE_KEY is injected automatically) - never in the website.
//
// Deploy:  supabase functions deploy create-user
// Call:    supabase.functions.invoke('create-user', { body: { email, password, full_name, role } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*'; // set to https://<user>.github.io in production
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['admin', 'teacher', 'student'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // 1. Who is calling? (verified from the caller's JWT)
  const authHeader = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Not signed in' }, 401);

  // 2. Must be an active admin (checked with the service client, not trusted from the client)
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from('profiles').select('role,status').eq('id', userData.user.id).single();
  if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
    return json({ error: 'Administrator only' }, 403);
  }

  // 3. Validate input
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const full_name = String(body.full_name ?? '').trim();
  const role = String(body.role ?? '');
  if (!EMAIL_RE.test(email)) return json({ error: 'Invalid email' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
  if (!full_name || full_name.length > 120) return json({ error: 'Full name is required' }, 400);
  if (!ROLES.includes(role)) return json({ error: 'Invalid role' }, 400);

  // 4. Create the account. The role goes in app_metadata (clients cannot write it);
  //    the handle_new_user() trigger turns it into the profile row.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name },
    app_metadata: { role },
  });
  if (createErr || !created?.user) return json({ error: createErr?.message ?? 'Could not create user' }, 400);

  await admin.from('audit_log').insert({
    actor_id: userData.user.id, action: 'create_user', entity: 'profile', entity_id: created.user.id, meta: { role, email },
  });
  return json({ id: created.user.id, email, role }, 201);
});
