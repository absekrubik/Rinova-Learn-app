// Live "I'm lost" pulse and quick polls during a live class (migration 018).
// Teachers only ever get counts. Students can only send while the class is on.
import { requireClient } from '../core/supabase.js';

const sb = requireClient;
export const REFRESH_MS = 5000, FADE_MS = 5 * 60 * 1000;
export const QUESTION_MAX = 200, OPTION_MAX = 80, MIN_OPTIONS = 2, MAX_OPTIONS = 6;
export const STATES = { got_it: 'Got it', lost: "I'm lost" };

/** Trims the answers and drops empty ones. */
export const cleanOptions = (opts) => (opts ?? []).map((o) => String(o ?? '').trim()).filter(Boolean);
/** Returns an error message or null. */
export function validatePoll(question, options) {
  const q = String(question ?? '').trim(), o = cleanOptions(options);
  if (!q) return 'Enter the question';
  if (q.length > QUESTION_MAX) return `Keep the question under ${QUESTION_MAX + 1} characters`;
  if (o.length < MIN_OPTIONS) return `Give at least ${MIN_OPTIONS} answers`;
  if (o.length > MAX_OPTIONS) return `Use at most ${MAX_OPTIONS} answers`;
  if (o.some((x) => x.length > OPTION_MAX)) return `Keep each answer under ${OPTION_MAX + 1} characters`;
  if (new Set(o.map((x) => x.toLowerCase())).size !== o.length) return 'Each answer must be different';
  return null;
}

export async function sendPulse(classId, state) {
  const { error } = await sb().from('live_pulse').upsert({ live_class_id: classId, state }, { onConflict: 'live_class_id,student_id' });
  if (error) throw error;
}
export async function clearPulse(classId) { const { error } = await sb().from('live_pulse').delete().eq('live_class_id', classId); if (error) throw error; }
/** My own pulse for this class, or null (also null once it has faded). */
export async function myPulse(classId) {
  const { data, error } = await sb().from('live_pulse').select('state,updated_at').eq('live_class_id', classId).maybeSingle();
  if (error) throw error;
  return data && Date.now() - new Date(data.updated_at).getTime() < FADE_MS ? data : null;
}
export async function pulseSummary(classId) {
  const { data, error } = await sb().rpc('pulse_summary', { p_class: classId });
  if (error) throw error; const r = Array.isArray(data) ? data[0] : data;
  return { got_it: r?.got_it ?? 0, lost: r?.lost ?? 0, enrolled: r?.enrolled ?? 0 };
}

export async function listPolls(classId) {
  const { data, error } = await sb().from('live_polls').select('id,question,options,status,created_at').eq('live_class_id', classId).order('created_at', { ascending: false });
  if (error) throw error; return data ?? [];
}
export async function createPoll(classId, question, options) {
  const { error } = await sb().from('live_polls').insert({ live_class_id: classId, question: String(question).trim(), options: cleanOptions(options) });
  if (error) throw error;
}
export async function setPollStatus(id, status) { const { error } = await sb().from('live_polls').update({ status }).eq('id', id); if (error) throw error; }
export async function deletePoll(id) { const { error } = await sb().from('live_polls').delete().eq('id', id); if (error) throw error; }
/** Map(pollId -> option index) of the signed-in student's own votes. */
export async function myVotes(pollIds) {
  if (!pollIds.length) return new Map();
  const { data, error } = await sb().from('live_poll_votes').select('poll_id,option_idx').in('poll_id', pollIds);
  if (error) throw error; return new Map((data ?? []).map((v) => [v.poll_id, v.option_idx]));
}
export async function vote(pollId, optionIdx) {
  const { error } = await sb().from('live_poll_votes').upsert({ poll_id: pollId, option_idx: optionIdx }, { onConflict: 'poll_id,student_id' });
  if (error) throw error;
}
export async function pollResults(pollId) {
  const { data, error } = await sb().rpc('poll_results', { p_poll: pollId });
  if (error) throw error; return data ?? [];
}
