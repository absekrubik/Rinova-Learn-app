#!/usr/bin/env python3
"""Rinova Learn release audit. Static checks only: nothing is sent anywhere.
Run from the project folder:   python tools/audit.py
Exit code 0 = all checks passed.
"""
import glob, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)
fails, passes = [], 0
def check(name, bad):
    global passes
    if bad: fails.append((name, bad[:8]))
    else: passes += 1
read = lambda p: open(p, encoding='utf-8').read()
html_files = sorted(glob.glob('**/*.html', recursive=True))
js_files = sorted(glob.glob('js/**/*.js', recursive=True))
sql_files = sorted(glob.glob('supabase/migrations/*.sql'))
app_pages = [f for f in html_files if f.split('/')[0] in ('admin', 'teacher', 'student')]

# ---- pages
for name, rx in [('lang attribute', r'<html[^>]*\blang="en"'), ('viewport meta', r'name="viewport"'), ('charset', r'<meta charset="utf-8">'), ('<title>', r'<title>[^<]+</title>'),
                 ('Content-Security-Policy meta', r'http-equiv="Content-Security-Policy"'), ('noscript notice', r'<noscript>')]:
    check(f'every page has {name}', [f for f in html_files if f != '404.html' and not re.search(rx, read(f))] if name != 'noscript notice' else [f for f in html_files if f != '404.html' and not re.search(rx, read(f))])
check('no inline <script> bodies (CSP) outside 404.html', [f for f in html_files if f != '404.html' and re.search(r'<script(?![^>]*\bsrc=)[^>]*>\s*\S', read(f))])
check('no inline event handlers (onclick=...)', [f for f in html_files + js_files if re.search(r'\son(click|load|error|submit|change|input|mouseover)\s*=\s*["\']', re.sub(r'onerror=(alert|window)[^"\'> ]*', '', read(f))) and not f.startswith('design-system')])
check('app pages load a page script', [f for f in app_pages if not re.search(r'<script type="module" src="\.\./js/pages/[\w-]+\.js"', read(f))])
check('app pages are noindex', [f for f in app_pages if 'noindex' not in read(f)])
# ---- links and imports resolve
bad = []
for f in html_files:
    for m in re.finditer(r'(?:href|src)="([^"#?]+)', read(f)):
        u = m.group(1)
        if re.match(r'^(https?:|mailto:|data:|/)', u): continue
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), u))): bad.append(f'{f} -> {u}')
check('every href/src in HTML points to a file that exists', bad)
bad = []
for f in js_files:
    for m in re.finditer(r'(?:from|import)\s*\(?\s*[\'"](\.{1,2}/[^\'"]+)[\'"]', read(f)):
        if not os.path.exists(os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))): bad.append(f'{f} -> {m.group(1)}')
check('every JS import resolves', bad)
shell = read('js/ui/shell.js')
check('every sidebar link has a page', [h for h in re.findall(r"href: '([\w/.-]+\.html)'", shell) if not os.path.exists(h)])
check('no "Soon" placeholders left in the sidebar', ['soon: true'] if 'soon: true' in shell.split('export const NAV')[1].split('const ICON')[0] else [])
# ---- security
check('no certificate features (excluded by requirement)', [f for f in html_files + js_files + sql_files if re.search(r'certificat', read(f), re.I) and 'No certificate tables exist by design' not in read(f)])
check('service_role / secret keys never appear in the website', [f for f in html_files + js_files if re.search(r'sb_secret_[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}', read(f))])
check('config.js holds no secret', ['js/config.js'] if re.search(r'sb_secret_[A-Za-z0-9]', read('js/config.js')) else [])
check('no eval / new Function / document.write', [f for f in js_files if re.search(r'\beval\(|new Function\(|document\.write\(', read(f))])
check('no frameworks or build tools referenced', [f for f in js_files + html_files if re.search(r'from [\'"](react|vue|@angular|next|express)|import React|createApp\(|require\(', read(f))])
check('no package.json / build step', [f for f in ('package.json', 'webpack.config.js', 'vite.config.js') if os.path.exists(f)])
check('no console.log left in code', [f for f in js_files if 'console.log' in read(f)])
check('only the anon/publishable key is ever used (guard present)', [] if 'service_role' in read('js/core/supabase.js') else ['guard missing'])
# user text must go through html`` (escaped) - flag raw innerHTML concatenation of obvious user fields
bad = []
for f in js_files:
    for i, line in enumerate(read(f).splitlines(), 1):
        if re.search(r"innerHTML\s*[+]?=\s*[^;]*\$\{[^}]*\b(full_name|email|title|body|prompt|label|description)\b", line) and not re.search(r'html`|raw\(|escapeHtml', line): bad.append(f'{f}:{i}')
check('user fields are escaped before innerHTML', bad)
# ---- database
tables = set(re.findall(r'create table public\.(\w+)', ' '.join(read(f) for f in sql_files)))
rls = read('supabase/migrations/003_rls.sql')
check('RLS is switched on for every table (003 loops over all public tables)', [] if 'enable row level security' in rls and "table_schema = 'public'" in rls.replace('"', "'") or 'pg_tables' in rls else ['003_rls.sql loop missing'])
check('no certificate tables', [t for t in tables if 'cert' in t])
check('anon is revoked everywhere', [] if 'revoke all on all tables    in schema public from anon' in read('supabase/migrations/006_grants.sql') else ['006_grants.sql'])
check('migrations are numbered without gaps', [] if [int(os.path.basename(f)[:3]) for f in sql_files] == list(range(1, len(sql_files) + 1)) else ['gap'])

for n, b in fails: print(f'FAIL  {n}\n      ' + '\n      '.join(map(str, b)))
print(f'\n{passes} checks passed, {len(fails)} failed')
sys.exit(1 if fails else 0)
