# Railway redeploy — checklist for Steve

> What this is: a tight, action-by-action runbook for getting Coffeecue
> live again on Railway with Twilio SMS and a shareable rebrand.ly link.
> Estimated time: ~15 minutes once you sit down with the Railway,
> Twilio, and Rebrandly tabs open.

---

## Phase 1 — Things only YOU can do (no code change needed)

Do these in any order. They unblock everything else.

### ☐ 1. Find your existing Railway project

1. Go to <https://railway.app> and log in (Google / GitHub).
2. Dashboard → look for a project called something like **expresso**,
   **coffeecue**, or **Coffeecue**.
3. If you find it: write down its URL (e.g. `coffeecue-production.up.railway.app`).
4. If you DON'T find it: tell Claude — we'll create a fresh one in Phase 2.

### ☐ 2. Rotate the leaked Twilio Auth Token

The old token was committed in `.env.production` so it's in the public
git history forever. Anyone reading the repo can use it to send SMS
on your account.

1. <https://console.twilio.com> → Account → API keys & tokens.
2. Find the live token → **Rotate** → copy the new value.
3. Write the new SID + new Auth Token down — you'll paste them into
   Railway in Phase 3.

### ☐ 3. Generate fresh secret keys (one terminal command)

```bash
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(32)); print('JWT_SECRET_KEY=' + secrets.token_hex(32))"
```

Copy the two printed lines somewhere safe — they go into Railway in Phase 3.
**Do not reuse the ones from `.env.production`** — those are also public now.

### ☐ 4. Check your Rebrandly account

1. <https://app.rebrandly.com> → look for `rebrand.ly/coffeecue`.
2. If it already exists, note what URL it currently points at.
3. If it points at the OLD Railway URL: you'll update it in Phase 4.

---

## Phase 2 — Tell Claude to push code to GitHub

Once Phase 1 is done, say to Claude: **"push to main"**.

Claude will:

1. Rebase the worktree branch onto `main` (78 commits).
2. Push `main` to `github.com/fruithappens/Coffeecue`.
3. Confirm push succeeded with a short summary.

This triggers Railway's auto-deploy (if your project is set up to deploy
from `main`).

---

## Phase 3 — Railway dashboard (where you do the env vars)

Open your Railway project → **Variables** tab. Add or update these.
Anything marked **REPLACE** needs a value YOU paste in.

| Variable | Value |
|---|---|
| `SECRET_KEY` | REPLACE — from Phase 1 step 3 |
| `JWT_SECRET_KEY` | REPLACE — from Phase 1 step 3 |
| `FLASK_ENV` | `production` |
| `DEBUG` | `False` |
| `TESTING_MODE` | `False` |
| `JWT_ACCESS_TOKEN_EXPIRES` | `900` |
| `JWT_REFRESH_TOKEN_EXPIRES` | `604800` |
| `JWT_COOKIE_SECURE` | `True` |
| `JWT_COOKIE_CSRF_PROTECT` | `True` |
| `TWILIO_ACCOUNT_SID` | REPLACE — new value from Phase 1 step 2 |
| `TWILIO_AUTH_TOKEN` | REPLACE — new value from Phase 1 step 2 |
| `TWILIO_PHONE_NUMBER` | `+61489263333` |
| `CORS_ALLOWED_ORIGINS` | REPLACE — see note below |
| `CORS_SUPPORTS_CREDENTIALS` | `True` |
| `PG_SSL_MODE` | `require` |
| `DB_POOL_MIN_CONNECTIONS` | `1` |
| `DB_POOL_MAX_CONNECTIONS` | `10` |
| `PG_MAX_RETRIES` | `3` |
| `LOG_LEVEL` | `INFO` |
| `PASSWORD_MIN_LENGTH` | `12` |
| `PASSWORD_REQUIRE_SPECIAL` | `True` |
| `DEFAULT_ADMIN_USERNAME` | `coffeecue` |
| `DEFAULT_ADMIN_EMAIL` | `admin@coffeecue.com` |
| `DEFAULT_ADMIN_PASSWORD` | REPLACE — something strong, you remember it |

**CORS_ALLOWED_ORIGINS** must include BOTH your Railway URL and your
Rebrandly URL, comma-separated. Example:

```
https://coffeecue-production.up.railway.app,https://rebrand.ly/coffeecue
```

You won't know the Railway URL until after the first deploy succeeds.
The flow:

1. Save everything except CORS first → trigger deploy.
2. After deploy, copy your assigned `*.up.railway.app` URL.
3. Update CORS_ALLOWED_ORIGINS with both URLs.
4. Trigger redeploy (Variables tab → "Redeploy").

### Confirm the database

Railway should auto-provision `DATABASE_URL` if a PostgreSQL plugin is
attached. Check **Services** tab → ensure there's a Postgres service
linked to the app. If not: **New → Database → PostgreSQL**.

---

## Phase 4 — Twilio + Rebrandly wiring

### ☐ Twilio webhook

1. <https://console.twilio.com> → Phone Numbers → Manage → Active numbers.
2. Click `+61489263333` → Messaging section.
3. **A MESSAGE COMES IN** → Webhook → set to:
   ```
   https://<your-railway-url>/sms
   ```
   (replace `<your-railway-url>` with the actual URL from Phase 3).
4. Method: `HTTP POST`. Save.

### ☐ Rebrandly link

1. <https://app.rebrandly.com> → `rebrand.ly/coffeecue` (or create it).
2. Destination → set to your Railway URL (the long one).
3. Save.

Now `rebrand.ly/coffeecue` redirects to your Railway-hosted app.

---

## Phase 5 — Smoke test

Once Phase 4 is done:

1. Open `https://rebrand.ly/coffeecue` in a private window.
2. Should load the landing page.
3. Log in with `coffeecue / <DEFAULT_ADMIN_PASSWORD you set>`.
4. Send an SMS from any phone to `+61 489 263 333`:
   ```
   I'd like a flat white
   ```
5. You should see the conversational flow play out and the order
   appear in the Barista interface.

If steps 1-3 work but step 4 SMS doesn't trigger anything:
- Check Twilio Console → Monitor → Logs → Errors for the webhook call.
- Check Railway → Deploy logs for "/sms" requests.
- Most common cause: `CORS_ALLOWED_ORIGINS` missing the Railway URL.

---

## Sharing the demo

Once smoke test passes, the link to share is:

```
https://rebrand.ly/coffeecue
```

…plus the Twilio number `+61 489 263 333` for SMS testing.

Costs:
- Railway: $5/month while the project exists.
- Twilio: ~AU$0.05 per outbound SMS, ~AU$0.0075 per inbound. A 10-person
  demo session will be under $1.
- Rebrandly: free tier.

You can pause the Railway project anytime to stop the $5/month —
Settings → Pause.
