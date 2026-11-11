# LinkedStreak

A personal ledger for posting on LinkedIn every **Friday, Saturday and Sunday**. Paste (or share) a post link, and the app checks it's a real post, that it's yours, and that it was published on a required day in London time. Then it extends the streak. Miss a day and the streak breaks.

- Vanilla HTML/CSS/JS (ES modules), no build step
- Vercel Serverless Functions in `/api`
- Supabase (Postgres + RLS + magic-link auth)
- Web Push (VAPID) through `web-push`
- Typeface: Libre Baskerville only

Everything below works in **Windows PowerShell**.

---

## 1. Run the tests

```powershell
npm install
npm test
```

`npm test` runs `node --test`. It covers London day boundaries, both DST Sundays, the grace window, duplicate IDs, one-post-per-day, and the reminder schedule.

---

## 2. Supabase (from scratch)

1. Go to <https://supabase.com>, sign up, then **New project**. Pick a region near London (e.g. *West EU (London)*), set a database password and wait for it to finish.
2. **Create the tables.** Open **SQL Editor**, then **New query**. Paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. You should see "Success. No rows returned". The script can safely be run again.
3. **Lock sign-ups.** Go to **Authentication → Sign In / Providers**. Turn **off** "Allow new users to sign up". Leave **Email** enabled.
4. **Add yourself as the only user.** Go to **Authentication → Users → Add user → Create new user**, enter your email, and tick **Auto Confirm User**. Then open the user and copy its **UID**. That UID is your `OWNER_USER_ID`.
5. **Allow the app's URL.** Go to **Authentication → URL Configuration**:
   - **Site URL**: `https://linkedin-streak.vercel.app`
   - **Redirect URLs**: add `https://linkedin-streak.vercel.app/**` (and `http://localhost:3000/**` if you use `vercel dev`)
6. **Put the code in the sign-in email.** This matters on iPhone. Supabase only lets you edit email templates once you've connected your own email sender (SMTP), so do that first. Gmail works and is free:
   - Turn on 2-Step Verification at <https://myaccount.google.com/security>, then create an app password at <https://myaccount.google.com/apppasswords>.
   - In Supabase, go to **Authentication → Emails → SMTP Settings** and turn on **Enable custom SMTP**. Set host `smtp.gmail.com`, port `465`, and use your Gmail address as both the sender and the username. The password is the 16-character app password. Set the sender name to `LinkedStreak`.

   Then go to **Authentication → Emails → Templates → Magic Link** and replace the body with:

   ```html
   <h2>Sign in to LinkedStreak</h2>
   <p><a href="{{ .ConfirmationURL }}">Sign in on this device</a></p>
   <p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>
   ```

   **Why:** an installed iPhone app keeps its own storage, separate from Safari. Tapping the link opens Safari and signs *Safari* in, not the Home Screen app. Typing the code into the installed app signs the app itself in.
7. **Copy your keys** from **Project Settings → API**:
   - Project URL → `SUPABASE_URL`
   - `anon` / publishable key → `SUPABASE_ANON_KEY`
   - `service_role` / secret key → `SUPABASE_SERVICE_ROLE_KEY` (**server only, never paste it into a client file**)

> **Email limits:** without your own SMTP, Supabase's built-in sender only allows a few emails per hour, and the email contains only the link (no code). On a computer or Android the link alone is enough. Setting up SMTP as in step 6 also raises the limit.

### Who can do what (RLS)

| Table | Signed-in owner (anon key + session) | Server (service role) |
|---|---|---|
| `settings` | read / insert / update own row | everything |
| `posts` | **read and delete only** | insert (via `/api/verify-post`) |
| `push_subscriptions` | read / delete own rows | insert / update / delete |
| `notification_log` | **nothing** | everything |

The anon role has no grants on any table. RLS is on for all four tables, and every policy is `user_id = auth.uid()`.

---

## 3. Keys and environment variables

Generate the VAPID keys (for push notifications):

```powershell
npx web-push generate-vapid-keys
```

Generate a cron secret:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

In **Vercel → your project → Settings → Environment Variables**, add each of these for **Production** (and Preview if you use it):

| Name | Value |
|---|---|
| `SUPABASE_URL` | from step 2.7 |
| `SUPABASE_ANON_KEY` | from step 2.7 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 2.7 (secret) |
| `VAPID_PUBLIC_KEY` | "Public Key" from `web-push` |
| `VAPID_PRIVATE_KEY` | "Private Key" from `web-push` (secret) |
| `VAPID_SUBJECT` | `mailto:you@yourdomain.com` |
| `CRON_SECRET` | the random string |
| `OWNER_USER_ID` | your Supabase user UID |

Only `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `VAPID_PUBLIC_KEY` ever reach the browser, through `GET /api/config`. See [`.env.example`](.env.example).

**After adding or changing variables, redeploy.** Push a commit, or use **Deployments → … → Redeploy**.

---

## 4. Deploy

Use the existing Vercel project. Push to `main`:

```powershell
git add -A
git commit -m "Rebuild LinkedStreak"
git push
```

Vercel picks up `vercel.json`, which sets:

- the `/share` rewrite (Android share target)
- no-cache headers for `sw.js` and the manifest
- a once-daily backup cron

Open the site, sign in, then go to **Settings** and fill in your **LinkedIn profile link**. Posts are matched against the slug taken from that link.

---

## 5. Reminders every 15 minutes (cron-job.org)

Vercel's free (Hobby) plan only runs crons **once a day**, so `vercel.json` keeps a single 20:00 UTC run on Fri/Sat/Sun as a **backup**. The real scheduler is cron-job.org (free):

1. Sign up at <https://cron-job.org>, then **Create cronjob**.
2. **URL:** `https://linkedin-streak.vercel.app/api/cron/reminders?secret=YOUR_CRON_SECRET`
3. **Schedule:** every 15 minutes.
4. **Request method:** GET. Under **Advanced**, set the timezone to *Europe/London* (only for the job log; the app does its own London maths).
5. Save, then click **Test run**. You should get `200` and JSON like `{"ok":true,"london":"2026-11-13","sent":[]}`. A wrong secret gives `401`.

**How a run decides what to send:**

- On a required day that isn't logged, it sends the most recent passed slot from your reminder times (default 09:00, 18:00, 21:30). The messages get firmer through the day: *"Friday's post is due…"*, then *"Still time…"*, then *"Last call…"*. If the cron was late, only the latest slot goes out, never a backlog.
- The morning after an unlogged required day, after your grace-reminder time (default 10:00) and before noon, it sends *"Yesterday's post isn't logged. You have until noon."*
- Each slot is claimed in `notification_log` before sending, using a unique index and insert-on-conflict-do-nothing. Calling the endpoint twice in the same slot sends **one** notification.
- A push service answer of 404/410 deletes that subscription. Any other error increments its `failure_count`.

---

## 6. Install the app

### iPhone (iOS 16.4 or later)

Web push on iPhone only works from the Home Screen app.

1. Open `https://linkedin-streak.vercel.app` in **Safari**.
2. Tap **Share** (the square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open **Streak** from the Home Screen. Sign in by typing the **code** from the email, not by tapping the link (see step 2.6).
4. Go to **Settings → Reminders → Turn on notifications**, then **Allow**.

### Android (Chrome)

1. Open the site in Chrome, then tap the menu and choose **Install app** (or **Add to Home screen**).
2. Sign in. Then go to **Settings → Turn on notifications**.
3. **One-tap logging:** in the LinkedIn app, open your post, tap **Share**, and choose **Streak**. The Log sheet opens with the link already filled in.

---

## 7. Test notifications

1. **Settings → Reminders.** "This device" should read **On**.
2. Tap **Send test notification**. It should arrive within a few seconds. If it doesn't:
   - **"No devices are subscribed"**: turn notifications on first.
   - **"VAPID keys are not set on the server"**: add the three `VAPID_*` variables and redeploy.
   - **Blocked**: re-allow notifications in the browser's site settings (Android), or in iPhone **Settings → Notifications → Streak**.
3. Test the scheduler on a Friday after 09:00 London time, with nothing logged:

   ```powershell
   $u = "https://linkedin-streak.vercel.app/api/cron/reminders?secret=YOUR_CRON_SECRET"
   Invoke-RestMethod $u   # sends the 09:00 reminder
   Invoke-RestMethod $u   # same slot: "skipped": "already-sent"
   ```

---

## 8. Checking the link decoder

Open `https://linkedin-streak.vercel.app/?debug=1#/settings` and scroll to **Debug · link checker**. Paste any LinkedIn link to see:

- the parsed parts (slug, URN type, ID)
- the decoded publish time in UTC and London
- what the streak rules would say about it

Use this to confirm the decoder against real posts. LinkedIn post IDs carry their creation time in the top 41 bits: `ms = BigInt(id) >> 22n`.

**Which links work best:** in LinkedIn, use **⋯ → Copy link to post**. That gives a `/posts/yourname_…-activity-…` link that includes the author, so the app can confirm the post is yours. `/feed/update/urn:li:…` links carry no author, so the server makes one best-effort check of LinkedIn's public embed page. If that check is inconclusive, the post is still accepted but marked *unconfirmed*.

---

## Project layout

```
index.html, manifest.webmanifest, sw.js, offline.html
css/       tokens.css (all design values) · base · layout · components
js/        app.js (boot + router) · supabase.js · state.js · push.js · theme.js
           streak.js · linkedin.js · time.js · reminders.js   ← pure, shared with the server
js/views/  today · ledger · log · settings · signin
js/ui/     toast · sheet · icons (Lucide, ISC) · dom
api/       config · verify-post · push/subscribe · push/test · cron/reminders
api/_lib/  supabase-admin · push · re-exports of the shared pure modules
supabase/  schema.sql
tests/     node:test suites
icons/     icon.svg (source) + PNGs. Re-render with: npm run icons
```

## Rules, in one place

- **Required days:** Friday, Saturday and Sunday, using Europe/London calendar days.
- **One post completes one day.** A post counts for the London day it was **published** on. An activity ID can only be logged once. A second post on the same day is rejected; it does not roll over to the next day.
- **Grace window:** a day can be logged until **12:00 London the next day** (Sunday's until Monday noon). After that, the day is missed.
- **Streaks are always derived** from posts, the start date and the current time. They are never stored.
- **Days before the start date** don't count either way.
