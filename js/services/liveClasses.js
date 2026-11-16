import { requireClient } from '../core/supabase.js';

export async function upcoming(limit = 5) {
  const { data, error } = await requireClient().from('live_classes')
    .select('id,title,starts_at,ends_at,status,course:courses(title)')
    .gte('ends_at', new Date().toISOString()).neq('status', 'cancelled')
    .order('starts_at', { ascending: true }).limit(limit);
  if (error) throw error;
  return data;
}
