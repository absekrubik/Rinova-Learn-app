// Supabase Edge Function: admin-set-password
// Lets an ADMIN set a new password for any user (for example when someone forgets theirs and has no email access).
// The service_role key lives only in Supabase's function environment - never in the website.
//
// Deploy:  supabase functions deploy admin-set-password
// Call:    supabase.functions.invoke('admin-set-password', { body: { user_id, password } })

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED = (Deno.env.get('ALLOWED_ORIGIN') ?? '*').split(',').map((s) => s.trim()).filter(Boolean);
let cors: Record<string, string> = {};
const setCors = (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const allow = ALLOWED.includes('*') ? '*' : (ALLOWED.includes(origin) ? origin : ALLOWED[0] ?? '');
  cors = {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  setCors(req);
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
  if (!profile || profile.role !== 'admin' || profile.status !== 'active') return json({ error: 'Administrator only' }, 403);

  // 3. Validate input
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const userId = String(body.user_id ?? '');
  const password = String(body.password ?? '');
  if (!UUID_RE.test(userId)) return json({ error: 'Invalid user' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
  if (new TextEncoder().encode(password).length > 72) return json({ error: 'Password is too long (72 characters at most)' }, 400);

  // 4. The user must exist in this system
  const { data: target } = await admin.from('profiles').select('id,email,role').eq('id', userId).maybeSingle();
  if (!target) return json({ error: 'User not found' }, 404);

  // 5. Set the password
  const { error: updErr } = await admin.auth.admin.updateUserById(userId, { password });
  if (updErr) return json({ error: updErr.message ?? 'Could not change the password' }, 400);

  // Audit trail: who changed whose password. The password itself is never stored or logged.
  await admin.from('audit_log').insert({
    actor_id: userData.user.id, action: 'reset_password', entity: 'profile', entity_id: userId, meta: { role: target.role },
  });
  return json({ ok: true });
});
