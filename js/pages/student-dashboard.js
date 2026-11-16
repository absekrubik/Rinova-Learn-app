import { mountShell } from '../ui/shell.js';
import { layout, loadStats, loadLive, loadNews } from './dashboard-common.js';

const { me, content } = await mountShell({ roles: ['student'], active: 'student/index.html', title: 'Dashboard' });
const el = layout(content, { me, subtitle: 'Here is what is happening in your courses.' });
loadStats(el.stats, 'student', (s) => [[s.courses, 'Enrolled courses'], [s.upcoming_live_classes, 'Upcoming live classes'], [s.assignments_due, 'Assignments due'], [s.unread_notifications, 'Unread notifications']]);
loadLive(el.live); loadNews(el.news);
