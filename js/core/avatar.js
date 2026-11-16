import { SUPABASE_URL } from '../config.js';
import { initials, escapeHtml } from './utils.js';

const PREFIX = `${SUPABASE_URL}/storage/v1/object/public/avatars/`;
/** Only our own avatar bucket is trusted (a profile row could contain any text). */
export const safeAvatarUrl = (u) => (typeof u === 'string' && u.startsWith(PREFIX) ? u : null);

/** Inner HTML of an .avatar element: photo if present, otherwise initials. Already escaped. */
export function avatarInner(profile) {
  const src = safeAvatarUrl(profile?.avatar_url);
  return src ? `<img src="${escapeHtml(src)}" alt="">` : escapeHtml(initials(profile?.full_name || profile?.email || ''));
}
