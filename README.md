# LinkedInStreak

A public, multi-user web app (PWA) that helps people build a LinkedIn posting habit. Each user sets their own goal, either specific days (for example Fri, Sat and Sun) or a weekly target (for example 3 posts a week). They post on LinkedIn, paste the link, and LinkedInStreak verifies it and keeps score.

- **Stack:** vanilla JS (ES modules, no bundler), Vercel serverless functions, Supabase (Postgres, Auth, RLS) and Web Push (VAPID). Open Sans is the only font.
- **Pages:** `/` (landing), `/login.html`, `/app.html` (the app, hash routes `#/today`, `#/goals`, `#/history`, `#/settings`, `#/log`), `/privacy.html`, `/terms.html` and `/offline.html`.
- **No LinkedIn API, no LinkedIn password.** Verification works like this:
  - The link is parsed.
  - The publish time is read from the post ID (`ms = BigInt(id) >> 22n`).
  - The slug in the link is matched against the user's profile.
  - One public check of LinkedIn's embed page is made per post, cached for 24 hours.

---

## 1. Run it locally

```powershell
npm install
npm test          # 56 tests: timezones/DST, goal versions, pauses, weekly mode, grace, reminders
npm run dev       # http://localhost:3000  (static files + /api, reads .env.local)
```

**Step-by-step guides:** [Google sign-in](docs/setup-google.md) · [sign-in emails (free Gmail SMTP)](docs/setup-email.md) · [reminders (cron-job.org)](docs/setup-cron.md)

Copy `.env.example` to `.env.local` and fill it in (see section 3). `npm run icons` regenerates the icons from `assets/logo.png`.

**Signing in locally without email:** run `npm run login -- you@example.com`. It prints a one-time sign-in link and code without sending an email. The account must exist first, so sign up once on the login page.

---

## 2. Supabase setup

### 2.1 Create the database

1. Create a project at <https://supabase.com>.
2. The database tables and row-level security policies are already set up in the project. The SQL scripts are not kept in this repo.

What the database contains:

| Table | Purpose | Signed-in user (anon key + JWT) | Server (service role) |
|---|---|---|---|
| `profiles` | name, LinkedIn link/slug, timezone, week start, onboarding | read/update own row (created by a trigger on sign-up) | everything |
| `goals` | name, mode, status, start/end date | full CRUD on own rows | everything |
| `goal_versions` | days or weekly target, grace, timezone, reminder times, from `effective_from` | own goals only | everything |
| `goal_pauses` | pause ranges | own goals only | everything |
| `posts` | logged posts; `activity_id` is globally unique (one account per post) | **read and delete only** | insert via `/api/verify-post` |
| `push_subscriptions` | browser push endpoints | read/delete own | insert/update via `/api/push/subscribe` |
| `notification_log` | one row per reminder sent (dedupe) | nothing | everything |
| `rate_limits`, `embed_cache` | abuse protection and the 24h embed cache | nothing | everything |

Edits to a goal add a new `goal_versions` row from today onwards, so past days keep the rules they had. Streaks are never stored. They are worked out from goals, versions, pauses and posts every time.

### 2.2 Auth providers

1. **Authentication → Sign In / Providers**:
   - Turn **on** "Allow new users to sign up".
   - Keep **Email** enabled. Turning "Confirm email" on is fine.
2. **Google:**
   - In Google Cloud Console, go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Choose type **Web application**.
   - Under **Authorised redirect URI**, enter `https://<your-project-ref>.supabase.co/auth/v1/callback` (Supabase shows this exact URL on the Google provider page).
   - Also set up the OAuth consent screen: app name "LinkedInStreak", plus your privacy and terms URLs.
   - Paste the client ID and secret into **Supabase → Authentication → Providers → Google** and enable it.

### 2.3 Redirect URLs

Go to **Authentication → URL Configuration**:

- **Site URL:** `https://linkedin-streak.vercel.app`
- **Redirect URLs:**
  - `https://linkedin-streak.vercel.app/app.html`
  - `https://linkedin-streak.vercel.app/**`
  - `http://localhost:3000/app.html`
  - `http://localhost:3000/**`

Magic links and Google both return to `/app.html`. The app picks up the session and moves to `#/today`, or to onboarding for a new user.

### 2.4 Email (SMTP + templates)

Supabase's built-in sender allows only about 2 emails an hour and won't let you edit templates. For a public app, connect your own SMTP:

- **Gmail** (fine to start):
  1. Turn on 2-Step Verification.
  2. Create an app password at <https://myaccount.google.com/apppasswords>.
  3. In Supabase, go to **Authentication → Emails → SMTP Settings** and enter host `smtp.gmail.com`, port `465`, your Gmail address as username and sender, and the app password.
- **For real traffic:** use a transactional provider (Resend, Postmark, SES or Brevo) with your own domain.

Then go to **Authentication → Emails → Templates → Magic Link**, and use the same text for **Confirm signup**:

```html
<h2>Sign in to LinkedInStreak</h2>
<p><a href="{{ .ConfirmationURL }}">Sign in on this device</a></p>
<p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>
```

The code matters on iPhone. The installed Home Screen app has its own storage, so tapping the link signs in Safari, not the app. Typing the code on the login screen signs in the app itself.

Also raise **Authentication → Rate Limits → emails per hour** once SMTP is set up.

---

## 3. Environment variables

Generate the values:

```powershell
npx web-push generate-vapid-keys                                          # VAPID public/private
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_}) # CRON_SECRET
```

Add them in **Vercel → Settings → Environment Variables** (Production, and Preview if you use it) and in `.env.local`:

| Name | Value | Reaches the browser? |
|---|---|---|
| `SUPABASE_URL` | Project Settings → API → Project URL | yes, via `/api/config` |
| `SUPABASE_ANON_KEY` | `anon` / publishable key | yes, via `/api/config` |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` / secret key | **never** |
| `VAPID_PUBLIC_KEY` | from web-push | yes, via `/api/config` |
| `VAPID_PRIVATE_KEY` | from web-push | **never** |
| `VAPID_SUBJECT` | `mailto:you@yourdomain.com` | no |
| `CRON_SECRET` | the random string | no |
| `APP_URL` | `https://linkedin-streak.vercel.app` | no |

`OWNER_USER_ID` is no longer used, so delete it from Vercel. Redeploy after changing variables.

---

## 4. Deploy

Push to `main` and Vercel deploys it (Node 26.x, set in `package.json`). `vercel.json` sets:

- no-cache headers for `sw.js` and the manifest;
- security headers;
- a **once-a-day backup cron** (Hobby plan limit). The real scheduler is cron-job.org (below).

---

## 5. Reminders (cron-job.org, every 15 minutes)

1. At <https://cron-job.org>, choose **Create cronjob**.
2. Set the URL to `https://linkedin-streak.vercel.app/api/cron/reminders`.
3. Add a request header: `Authorization: Bearer YOUR_CRON_SECRET`. Alternatively, append `?secret=YOUR_CRON_SECRET` to the URL.
4. Set the schedule to **every 15 minutes**.
5. Click **Test run**. You should get `200` with JSON like `{"ok":true,"goals":3,"sent":1,"skipped":2,"completed":0,"errors":0}`. A wrong secret returns `401`.

How each run decides what to send:

- **Batching:**
  - It works through every active goal in batches of 200.
  - All the times are in **that goal's timezone**, so a New York user is reminded at New York times.
- **Days mode:**
  - On an unlogged required day it sends only the **latest** reminder time that has passed. It never sends a backlog.
  - Anything more than 3 hours late is skipped.
  - The last slot of the day says "Last call".
- **Weekly mode:**
  - It sends a single nudge per day, at the first reminder time.
  - It sends more when you're behind (posts needed ≥ days left).
- **Grace reminder:** the morning after a missed unit, from 07:00, while the grace period is still open.
- **Quiet hours:** nothing is sent between 22:00 and 07:00 local time.
- **Dedupe:** each slot is claimed in `notification_log` (a unique index) **before** sending, so running the cron twice in the same slot sends one notification.
- **Dead subscriptions:**
  - A 404/410 response deletes the subscription.
  - Other errors count up, and the subscription is removed after 10.
- **Ended goals:** goals past their end date are marked completed.

---

## 6. Install the app

**iPhone (iOS 16.4+), required for push on iOS:**

1. Open the site in **Safari**.
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open LinkedInStreak from the Home Screen. Sign in with the **6-digit code** from the email.
4. Go to **Settings → Turn on reminders**, then tap **Allow**.

**Android (Chrome):**

1. Use **Install app** from the menu (or the button in Settings).
2. Sign in and turn on reminders.
3. To log in one tap: in the LinkedIn app, open your post, tap **Share**, then choose **LinkedInStreak**. The Log sheet opens with the link filled in. If you're signed out, the link is kept through sign-in.

---

## 7. Test notifications

1. Go to **Settings → Notifications**. "Status on this device" should read **On**.
2. Tap **Send a test**. It should arrive within seconds. If it doesn't:
   - **VAPID keys missing:** set the three `VAPID_*` variables and redeploy.
   - **Blocked:** allow notifications again in the browser's site settings, or on iPhone under Settings → Notifications → LinkedInStreak.
3. Test the scheduler. Pick a goal whose reminder time has just passed in its timezone, with today not yet logged:

   ```powershell
   $h = @{ Authorization = "Bearer YOUR_CRON_SECRET" }
   $u = "https://linkedin-streak.vercel.app/api/cron/reminders"
   Invoke-RestMethod $u -Headers $h   # sent: 1
   Invoke-RestMethod $u -Headers $h   # same slot again: sent: 0
   ```

4. **Diagnostics:** `https://linkedin-streak.vercel.app/app.html?debug=1#/settings` adds a card with your timezone, service worker and push state.

---

## 8. Checking that users are isolated

With the anon key and two users' access tokens (copy each from the browser: DevTools → Application → Local Storage → `ls3-auth` → `access_token`):

```powershell
$anon = "YOUR_ANON_KEY"; $base = "https://<ref>.supabase.co/rest/v1"
$a = @{ apikey = $anon; Authorization = "Bearer USER_A_TOKEN" }
Invoke-RestMethod "$base/goals?select=id,user_id" -Headers $a   # only user A's rows
Invoke-RestMethod "$base/posts" -Headers $a -Method Post -ContentType 'application/json' -Body '{}'   # 401/403: posts are server-only
```

---

## Project layout

```
index.html login.html app.html privacy.html terms.html offline.html
sw.js manifest.webmanifest vercel.json
assets/       logo.png (source artwork), logo.svg, logo-mark.svg
css/          tokens.css (all values) · base · layout · components · landing
js/core/      PURE, shared by browser and /api: time, linkedin, schedule, streak, reminders
js/           app.js (shell) · login.js · router.js · state.js · supabase.js · push.js
js/views/     today · goals · goal-editor · history · log · onboarding · settings
js/ui/        logo.js (only place the logo is rendered) · nav.js (landing navbar) · icons · sheet · toast · dom
api/          config · goals · verify-post · push/{subscribe,test} · cron/reminders · account/{export,delete}
api/_lib/     supabase-admin · auth (JWT check) · rate-limit · push
tests/        node --test suites for js/core
scripts/      dev server · login-link · make-icons · import-logo
```

## Rules, in one place

- **Secrets stay server-side.** The browser only gets the Supabase URL, the anon key and the VAPID public key.
- **No uppercase text anywhere.** Use sentence case. `grep -ri uppercase css/` must return nothing.
- **Fonts and values:** Open Sans only. Every colour and size comes from `css/tokens.css`.
- **The logo** is the restored original. It's rendered only through `js/ui/logo.js` and is never redrawn or recoloured.
- **Abuse protection:**
  - `/api/verify-post` is limited to 20 an hour per user and 60 an hour per IP.
  - `lnkd.in` short links are followed for at most 5 hops, to LinkedIn hosts only.
  - The embed check is cached for 24 hours.
- Not affiliated with or endorsed by LinkedIn.
