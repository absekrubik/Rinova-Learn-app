// Progress, grades and reports. All numbers are computed by the database (migration 013); nothing is stored client-side.
import { requireClient } from '../core/supabase.js';
const sb = () => requireClient();

export async function courseReport(courseId) { const { data, error } = await sb().rpc('course_report', { p_course: courseId }); if (error) throw error; return data ?? []; }
export async function coursesReport() { const { data, error } = await sb().rpc('courses_report'); if (error) throw error; return data ?? []; }
export async function myGrades() { const { data, error } = await sb().rpc('my_grades'); if (error) throw error; return data ?? []; }

export const pct = (v) => (v == null || v === '' ? '—' : `${Number(v)}%`);
export const num = (v) => (v == null || v === '' ? null : Number(v));
/** Mean of the numbers that exist (ignores nulls); null when none. */
export const mean = (list) => { const xs = list.map(num).filter((x) => x != null && !Number.isNaN(x)); return xs.length ? Math.round((10 * xs.reduce((a, b) => a + b, 0)) / xs.length) / 10 : null; };
/** A student's overall result: average of the parts that have data (progress is not a grade, so it is left out). */
export const overall = (r) => mean([r.assignments_percent, r.quizzes_percent]);
export function sortRows(rows, key, dir = 1) {
  const get = (r) => (key === 'overall' ? overall(r) : key === 'full_name' ? (r.full_name ?? '').toLowerCase() : num(r[key]));
  return rows.slice().sort((a, b) => { const x = get(a), y = get(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * dir; });
}
/** CSV cell: quotes values, and neutralises spreadsheet formulas (=, +, -, @) so a name like "=HYPERLINK(...)" cannot run in Excel. */
export function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
export function reportCsv(rows) {
  const head = ['Student', 'Email', 'Lessons completed', 'Lessons total', 'Progress %', 'Attendance %', 'Assignments graded', 'Assignments total', 'Assignments avg %', 'Quizzes taken', 'Quizzes total', 'Quizzes avg %', 'Overall %'];
  const lines = rows.map((r) => [r.full_name, r.email, r.completed_lessons, r.total_lessons, r.progress_percent, r.attendance_percent, r.assignments_graded, r.assignments_total, r.assignments_percent, r.quizzes_taken, r.quizzes_total, r.quizzes_percent, overall(r)].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\r\n');
}
export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename.replace(/[^\w.-]+/g, '_'); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
