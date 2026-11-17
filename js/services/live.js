// Live classes. Classes use either a built-in Jitsi room (free, no account) or any external https meeting link (Google Meet, Zoom, ...).
// Meetings open in a new tab: the free public Jitsi server limits embedded meetings to 5 minutes.
import { requireClient } from '../core/supabase.js';

export const JOIN_EARLY_MS = 15 * 60 * 1000;   // students may join 15 minutes before the start
export const JOIN_LATE_MS = 60 * 60 * 1000;    // and up to 1 hour after the scheduled end

const SELECT = 'id,course_id,title,description,starts_at,ends_at,room_name,meeting_url,status,recording_url,created_by,courses(title)';

/** Only https links are accepted. Returns the normalised URL string or null. */
export function safeHttpsUrl(input) {
  try { const u = new URL(String(input ?? '').trim()); return u.protocol === 'https:' && u.hostname.includes('.') ? u.href : null; } catch { return null; }
}
export const ROOM_RE = /^rinova-[0-9a-f]{32}$/;

/** 'cancelled' | 'upcoming' | 'live' | 'ended', derived from the clock (the database only stores scheduled/cancelled). */
export function classState(c, now = Date.now()) {
  if (c.status === 'cancelled') return 'cancelled';
  const s = new Date(c.starts_at).getTime(), e = new Date(c.ends_at).getTime();
  return now < s ? 'upcoming' : now <= e ? 'live' : 'ended';
}
export function canJoinNow(c, now = Date.now()) {
  if (c.status === 'cancelled') return false;
  return now >= new Date(c.starts_at).getTime() - JOIN_EARLY_MS && now <= new Date(c.ends_at).getTime() + JOIN_LATE_MS;
}
/** The URL to open for a class, or null if it has no valid one. */
export function joinUrl(c, displayName = '') {
  if (c.meeting_url) return safeHttpsUrl(c.meeting_url);
  if (ROOM_RE.test(c.room_name ?? '')) {
    const hash = displayName ? `#userInfo.displayName=${encodeURIComponent(JSON.stringify(displayName.slice(0, 60)))}` : '';
    return `https://meet.jit.si/${c.room_name}${hash}`;
  }
  return null;
}
/** Phones: Jitsi's website cannot share the screen on mobile, but its free app can. Returns { kind, url } for opening the room in the app, or null. */
export function jitsiAppLink(c, ua = (typeof navigator !== 'undefined' ? navigator.userAgent : ''), touch = (typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0)) {
  if (c.meeting_url || !ROOM_RE.test(c.room_name ?? '')) return null;
  // Android phones, tablets and touch panels, including ones whose browser is set to "desktop site" (it then says Linux, not Android)
  const android = /Android/i.test(ua) || (/Linux/i.test(ua) && !/CrOS/i.test(ua) && touch > 0);
  // iPhone, iPad, and iPadOS in desktop mode (it says Macintosh but has a touch screen)
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && touch > 1);
  if (android) return { kind: 'android', url: `intent://meet.jit.si/${c.room_name}#Intent;scheme=https;package=org.jitsi.meet;S.browser_fallback_url=${encodeURIComponent('https://play.google.com/store/apps/details?id=org.jitsi.meet')};end` };
  if (ios) return { kind: 'ios', url: `org.jitsi.meet://meet.jit.si/${c.room_name}` };
  return null;
}
export const providerLabel = (c) => {
  if (!c.meeting_url) return 'Jitsi Meet';
  try { const h = new URL(c.meeting_url).hostname.replace(/^www\./, ''); return h === 'meet.google.com' ? 'Google Meet' : /(^|\.)zoom\.us$/.test(h) ? 'Zoom' : h === 'teams.microsoft.com' ? 'Microsoft Teams' : h; } catch { return 'External link'; }
};

export async function listClasses({ courseId = null, scope = 'all' } = {}) {
  let q = requireClient().from('live_classes').select(SELECT);
  if (courseId) q = q.eq('course_id', courseId);
  const now = new Date().toISOString();
  if (scope === 'upcoming') q = q.gte('ends_at', now);
  if (scope === 'past') q = q.lt('ends_at', now);
  const { data, error } = await q.order('starts_at', { ascending: scope !== 'past' }).limit(200);
  if (error) throw error; return data;
}
export async function getClass(id) {
  const { data, error } = await requireClient().from('live_classes').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw error; return data;
}
const fields = (v) => ({
  title: v.title.trim(), description: v.description?.trim() || null,
  starts_at: v.starts_at, ends_at: v.ends_at, meeting_url: v.meeting_url || null, recording_url: v.recording_url || null,
});
export async function createClass(courseId, v) {
  const { data, error } = await requireClient().from('live_classes').insert({ course_id: courseId, ...fields(v) }).select('id').single();
  if (error) throw error; return data;
}
export async function updateClass(id, v) {
  const { error } = await requireClient().from('live_classes').update(fields(v)).eq('id', id); if (error) throw error;
}
export async function setClassStatus(id, status) {
  const { error } = await requireClient().from('live_classes').update({ status }).eq('id', id); if (error) throw error;
}
export async function deleteClass(id) {
  const { error } = await requireClient().from('live_classes').delete().eq('id', id); if (error) throw error;
}

/** datetime-local <-> ISO helpers (the browser shows and edits local time; the database stores UTC). */
export const toLocalInput = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
export const fromLocalInput = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

// ---- "Joined" status (migration 019) ----
/** Records that the signed-in user pressed Join (only works while the class is open). Returns { first_joined_at, last_joined_at, join_count }. */
export async function recordJoin(classId) {
  const { data, error } = await requireClient().rpc('record_join', { p_class: classId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : data;
}
/** The signed-in user's own join record for a class, or null. */
export async function myJoin(classId) {
  const { data, error } = await requireClient().from('live_joins').select('first_joined_at,last_joined_at,join_count').eq('live_class_id', classId).maybeSingle();
  if (error) throw error;
  return data ?? null;
}
/** Staff only: everyone who has joined, oldest first, with the number of enrolled students. */
export async function joinedList(classId) {
  const { data, error } = await requireClient().rpc('live_joined', { p_class: classId });
  if (error) throw error;
  return data ?? [];
}
