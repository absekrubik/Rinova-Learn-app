// The ONE Supabase client for the whole app. Uses the public anon key only.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

export const isConfigured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL) && !SUPABASE_ANON_KEY.startsWith('YOUR-');

// Guard against the most dangerous mistake: pasting the service_role key into the browser.
function jwtRole(key) {
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { return null; }
}
if (isConfigured && jwtRole(SUPABASE_ANON_KEY) === 'service_role') {
  throw new Error('SECURITY: the service_role key must never be used in the browser. Use the anon key.');
}

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

/** Throws a friendly error when config.js has not been filled in yet. */
export function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured yet. Open js/config.js and add your project URL and anon key (see supabase/README.md).');
  return supabase;
}
