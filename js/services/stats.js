import { requireClient } from '../core/supabase.js';

const FN = { admin: 'admin_stats', teacher: 'teacher_stats', student: 'student_stats' };
/** Live dashboard numbers computed by the database (see supabase/migrations/005). */
export async function getStats(role) {
  const { data, error } = await requireClient().rpc(FN[role]);
  if (error) throw error;
  return data;
}
