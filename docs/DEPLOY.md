# Deploying Rinova Learn

The site is static files. Nothing to build or install. Two places are involved: **Supabase** (database, sign-in, files) and **GitHub Pages** (hosting).

## 1. Supabase (once)
Follow `supabase/README.md` from top to bottom: create the project, run migrations `001` to `018` in order, set the Auth URLs, make yourself the first admin, deploy the `create-user` function.

## 2. Connect the website
Open `js/config.js` and set:
```js
export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-PUBLISHABLE-KEY';   // the publishable / anon key
```
The publishable key is meant to be public. Never paste the `service_role` or `sb_secret_` key: the site refuses to start if you do.

## 3. Publish on GitHub Pages
1. Create a GitHub repository and upload everything in this folder (keep `.nojekyll`).
2. Repository **Settings > Pages**: Source = *Deploy from a branch*, Branch = `main`, folder = `/ (root)`.
3. Wait a minute. Your address is `https://USER.github.io/REPO/`.
4. Back in Supabase **Authentication > URL Configuration**, make sure *Site URL* and *Redirect URLs* contain exactly that address. Without this, password reset emails go to the wrong place.
5. Run `supabase secrets set ALLOWED_ORIGIN=https://USER.github.io` so the account-creation function only accepts calls from your site.

## 4. Security headers
GitHub Pages cannot set HTTP headers, so every page carries a Content-Security-Policy `<meta>` tag. It allows scripts only from this site and `cdn.jsdelivr.net` (the Supabase library), connections only to `*.supabase.co`, and video frames only from Supabase, YouTube (privacy mode) and Vimeo. If you add a new service (analytics, another video host), add it to that tag in every HTML file or the browser will block it.

## 5. Updating the site later
Edit files, commit, push. Pages redeploys in about a minute. If you add a database migration, run it in the Supabase SQL Editor **before** pushing the matching code.

## 6. Backups and limits
- Supabase free plan: daily backups are not included. Export important data (Database > Backups on paid plans, or `pg_dump`) before big changes.
- Uploads are limited to 50 MB per file on the free plan. For long videos use a YouTube or Vimeo link instead.
- Free projects pause after a week of no activity. Open the dashboard to wake it.
