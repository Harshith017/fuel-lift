# MaxxTempo: setup

About an hour, once. You create the accounts and paste a few keys; everything else is in this folder.

What you end up with: the app on your own link, sign-in by email code (Google optional), each person's logs private to them and synced between phone and laptop, and Claude reading entries through a server function that holds your API key and caps use per person per day.

## Quick setup (recommended)

Create the Supabase project (step 1.1 below), a Supabase access token (Supabase → Account → Access Tokens) and an Anthropic API key (step 2.1). Then one command does everything else in steps 1 and 2:

```
SUPABASE_ACCESS_TOKEN=... ANTHROPIC_API_KEY=... node supabase/deploy.mjs fuel-lift
```

It runs the database script, deploys the `claude` function with its secrets, sets up email-code sign-in for the app's address, and writes `config.js`. Commit `config.js`, then do step 3 (hosting). You can delete the access token afterwards.

The manual steps below do the same thing by hand.

## 1. Supabase project (database + sign-in)

1. Create a free project at [supabase.com](https://supabase.com). Pick the region closest to you (Mumbai for India).
2. **SQL Editor → New query**: paste all of [`supabase/schema.sql`](supabase/schema.sql) and run it.
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key into [`config.js`](config.js).
4. **Authentication → Emails → Magic Link** template: add a line with the code, e.g.
   `<p>Your sign-in code: <b>{{ .Token }}</b></p>`
   An app installed on the iPhone home screen can't receive links opened in Safari, so the code is what signs you in there.
   On the free plan Supabase only lets you edit this template once a custom SMTP sender is set up (**Authentication → Emails → SMTP Settings**, e.g. with a free Resend or Brevo account). Until then, sign in with a password instead: tap **Create account**, confirm with the link in the email (once, any browser), then sign in with the password anywhere, including the home-screen app. `deploy.mjs` skips the template with a warning; run it again after adding SMTP. Supabase's built-in sender also only emails your project's team members, at most 2 emails an hour, so friends need SMTP before they can sign up.
5. **Authentication → URL Configuration**: set **Site URL** to your app's address (step 3) and add the same address under **Redirect URLs**.

## 2. Claude (the server function)

1. At [console.anthropic.com](https://console.anthropic.com): create an API key, add billing, and set a **monthly spend limit** (Settings → Limits).
2. In Supabase, **Edge Functions → Deploy a new function → Via editor**. Name it `claude`, paste [`supabase/functions/claude/index.ts`](supabase/functions/claude/index.ts) and deploy.
   (With the Supabase CLI instead: `supabase functions deploy claude` from the repo root.)
3. **Edge Functions → Secrets**: add `ANTHROPIC_API_KEY`. Optional:
   - `DAILY_CAP`: Claude actions per person per day (default 30)
   - `ALLOWED_ORIGIN`: your app's address, so only your page can call the function
   - `MODEL_SMART` / `MODEL_QUICK`: default `claude-sonnet-5` / `claude-haiku-4-5`
   - `APP_TIMEZONE`: when the daily cap resets (default `Asia/Kolkata`)
4. Check it: sign in to the app, open **Profile → Account**. "Claude: Connected" means the function and key work; anything else names the problem.

Until this is done the app still works: the built-in food table (130 foods), your saved foods, water, weight and editing all run without Claude. Set `CLAUDE: false` in `config.js` to hide the Claude features until then.

### Free option: Gemini instead of Claude

The same function can use Google's Gemini, which has a free tier:
1. At [aistudio.google.com](https://aistudio.google.com) → **Get API key** → create a key (no billing needed).
2. Supabase → **Edge Functions → Secrets**: add `GEMINI_API_KEY`. The function uses Gemini whenever this is set (set `AI_PROVIDER=claude` to prefer Claude while both keys exist).
3. Optional: `GEMINI_MODEL_SMART` / `GEMINI_MODEL_QUICK` (default `gemini-3.8-flash` / `gemini-3.5-flash-lite`).

Things to know: on the free tier Google may use what you send (food logs, photos, blood-test reports) to improve its products, and people may review it; the paid tier doesn't. Free-tier requests are rate-limited per minute and per day (see AI Studio), so heavy use may hit "busy, try again". Estimates can differ from Claude's.

## 3. Hosting

Any static host works: upload this folder.
- **Vercel or Netlify**: drag and drop the folder, and you get a link like `fuel-lift.vercel.app`.
- **GitHub Pages**: Settings → Pages → Deploy from a branch → `main`, `/ (root)`. It's served at `https://harshith017.github.io/maxxtempo/`.

Open the link on your phone, then Share → **Add to Home Screen**.

## 4. Optional

- **New accounts don't need a confirmation email** (Supabase → Authentication → Sign In / Providers → Email → "Confirm email" is off). Supabase's built-in sender only emails the project's own team, so confirmation emails could never reach friends; your approval (below) is what protects the app. Approve only people you recognise, since an email address isn't proven to be theirs. Email sign-in links and password resets still only reach you until a free SMTP sender (Brevo, or Gmail with an app password) is added under Authentication → Emails → SMTP Settings.
- **Approvals**: anyone can sign in, but the first time they land on "waiting for approval". The owner (the first account, marked `is_admin` in the `members` table) approves or declines them in Profile → Settings → People & approvals; a banner on Today shows when someone is waiting. The database enforces it: until approved, a person can't read or write data and the AI function refuses them. Emails added to the `invites` table are approved automatically when they first sign in.
- **Google sign-in** (free): in [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → OAuth consent screen, set it up as External with the app name. Then Credentials → Create credentials → OAuth client ID → Web application, with Authorized JavaScript origin `https://harshith017.github.io` and Authorized redirect URI `https://YOUR_PROJECT.supabase.co/auth/v1/callback`. Paste the client ID and secret into Supabase → Authentication → Sign In / Providers → Google, turn it on, and set `GOOGLE_SIGN_IN: true` in `config.js`.
- **Automatic Apple Health sync (iPhone)**: nothing to set up on the server; `deploy.mjs` deploys the `health-sync` function. Each person taps *Set up automatic sync* in Profile → Settings → Watch & health apps, copies their private sync key into an iPhone Shortcut (the steps are in the app), and sets it to run nightly. It sends steps, active calories and sleep; Garmin data comes along once Garmin Connect shares to Apple Health. Only a hash of each key is stored, and a key can be replaced or turned off at any time.
- **Face ID / Touch ID sign-in**: nothing to set up. Once approved, people turn it on in ⚙︎ Settings (or from the prompt on Today); the `passkey` function (deployed by `deploy.mjs`) checks each Face ID sign-in and re-checks approval. Passkeys are tied to the site's address, so they stop working if the app moves to a different domain.
- **Invite-only Claude**: add friends' emails in the `invites` table (Table Editor). While the table is empty, anyone who signs up can use Claude up to the daily cap. Once it has rows, only those emails can.
- **Built-in databases** (nothing to set up, all free): 1,014 Indian recipes (INDB), ~7,200 USDA foods to search (*Find food* on Today), barcode lookups from Open Food Facts (*Scan*), and ~3,300 exercises with how-to instructions and pictures (free-exercise-db, wger, ExerciseDB free version; *Exercise library* on Train). They live in `data/` and are rebuilt with `node tools/build-data.mjs`; sources and licences are in [DATA-LICENSES.md](DATA-LICENSES.md).

## Security

- **Data**: every table has row-level security. People only see their own logs; until approved they see nothing. The weekly leaderboard shows name, workouts and protein only, to approved members, and anyone can opt out in Settings.
- **Keys**: `config.js` holds only the public anon key, which is safe to publish (the database rules decide what it can do). The service key and AI keys live only in Supabase secrets. Never commit them.
- **The page**: a content security policy allows scripts only from this site and two pinned CDNs, and every CDN library is checked against its hash, so a tampered copy is refused. The page refuses to run inside another site's frame.
- **Passwords**: at least 8 characters; new passwords are checked against known data breaches (only the first 5 characters of the password's hash leave the phone). Supabase's own server-side breach check needs the Pro plan.
- **Face ID**: passkeys are verified on the server, approval is re-checked at each sign-in, and sign-in challenges are single-use, expire after 5 minutes and are capped.
- **Public repository**: the code being public is fine; nothing secret is in it or its history. GitHub Pages on a private repository needs a paid GitHub plan.

## What it costs

Hosting and Supabase are free at friend-group scale. Claude is pay-as-you-go:

| Action | Model | About |
|---|---|---|
| Food / gym / health entry, photo | Sonnet 5 | $0.01–0.02 |
| Sport session with coach questions | Sonnet 5 | $0.03 |
| Next-session plan, weekly review | Sonnet 5 | $0.02–0.03 |
| Blood-test report (PDF) | Sonnet 5 | $0.04 |
| Meal ideas, sport questions | Haiku 4.5 | under $0.01 |
| Food already in the table or saved foods | none | free |

That comes to roughly $3–5 a month for someone who logs every day, and under $1 for a light user. Food entries use Sonnet rather than Haiku because food estimates are where accuracy matters most. Set `MODEL_SMART=claude-haiku-4-5` to halve the cost.

## Checking it works

- `node --test calc.test.js` runs the unit tests for all the maths and the food table.
- `node --test exercises.test.js` checks the built-in gym table and how it reads sets ("bench 60kg 3x8", "60x8, 65x6", "treadmill 20 min 3 km"). Gym entries it can read log without AI; anything unclear goes to the AI.
- In the app, the dot after the logo shows sync: green is saved, amber is saving, grey is offline (still saved on the phone), red is retrying.
