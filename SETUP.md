# Fuel & Lift: setup

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
   On the free plan Supabase only lets you edit this template once a custom SMTP sender is set up (**Authentication → Emails → SMTP Settings**, e.g. with a free Resend or Brevo account). Until then, sign-in by link works in the browser, and `deploy.mjs` skips this step with a warning; run it again after adding SMTP.
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

## 3. Hosting

Any static host works: upload this folder.
- **Vercel or Netlify**: drag and drop the folder, and you get a link like `fuel-lift.vercel.app`.
- **GitHub Pages**: Settings → Pages → Deploy from a branch → `main`, `/ (root)`. It's served at `https://harshith017.github.io/fuel-lift/`.

Open the link on your phone, then Share → **Add to Home Screen**.

## 4. Optional

- **Google sign-in**: in Google Cloud, create an OAuth client (Web) with redirect URI `https://YOUR_PROJECT.supabase.co/auth/v1/callback`. Paste its client ID and secret into Supabase → Authentication → Providers → Google, then set `GOOGLE_SIGN_IN: true` in `config.js`.
- **Invite-only Claude**: add friends' emails in the `invites` table (Table Editor). While the table is empty, anyone who signs up can use Claude up to the daily cap. Once it has rows, only those emails can.
- **1,014 Indian recipes**: download `INDB.xlsx` from the INDB project, then Profile → *Import 1,014 Indian recipes*. They then log instantly without Claude.

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
- In the app, the dot after the logo shows sync: green is saved, amber is saving, grey is offline (still saved on the phone), red is retrying.
