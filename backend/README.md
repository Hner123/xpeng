# Future Night — backend

Registration API, invitation pipeline and admin dashboard for the campaign landing page in the parent folder.

**Zero npm dependencies.** Node's own `http` server and `node:sqlite`. Nothing to install, nothing to audit, no native builds.

## Run

```bash
node backend/server.js
```

| URL | What |
|---|---|
| http://localhost:3000/ | the landing page (served from the repo root) |
| http://localhost:3000/admin/login | sign in — default `admin` / `futurenight` |
| http://localhost:3000/admin | dashboard (redirects to the login page without a session) |

Seed fake registrations so the dashboard has data: `node backend/seed.js 60`

On first run the server generates `APP_KEY` into `backend/.env`. **Back that key up** — the encrypted columns are unreadable without it, and it is not in git (see `.gitignore`).

## Endpoints

**Public**
- `POST /api/waitlist` — register. Validates server-side, dedupes silently, queues confirmation email + SMS, returns `{ ok, sequence }`. Rate-limited per IP (`RATE_LIMIT`, default 30/min).
- `GET /api/waitlist/count` — completed registrations, for the on-page counter.

**Auth**
- `GET /admin/login` — login page. Redirects to `/admin` if already signed in.
- `POST /api/auth/login` — `{ username, password, remember }`. Sets an HttpOnly, SameSite=Strict session cookie.
- `POST /api/auth/logout` — deletes the session server-side and clears the cookie.

**Admin** (session cookie required)
- `GET /api/admin/stats` — tiles, daily curve, city / source / intent breakdowns
- `GET /api/admin/registrations` — filter by `city, province, status, intent, budget, segment, source, dealer, from, to, complete, consent_dealer, min_score`; sort by `recent|score|city`; `limit`/`offset`
- `POST /api/admin/invite` — `{ ids: [], hours: 72 }` → issues single-use codes, sets INVITED, queues email + SMS
- `GET /api/admin/export.csv` — any filtered view. With `?dealer=NAME` it force-adds the dealer-consent filter
- `GET /api/admin/exports` — export audit log
- `GET /api/admin/comms` — the generated message queue
- `GET|POST /api/admin/dealers` — City → dealer territory map
- `POST /api/admin/rescore` — recompute all lead scores after editing weights
- `GET /api/admin/me` — the signed-in user and role
- `POST /api/admin/password` — change your own password (kills all your sessions)
- `GET|POST /api/admin/users` — list / create accounts (admin role only)

**Dev**
- `POST /api/dev/claim` — `{ code }`. Stands in for the SM Tickets claim callback until their mechanics are agreed. Enforces single-use and the 72-hour expiry.

## How the brief's rules are enforced

- **Dedupe (Section 5).** Unique indexes on mobile and email; the write is an upsert, so a repeat registration silently updates and returns the original sequence number. No error ever reveals list mechanics.
- **Encryption (Section 10).** Name, mobile and email are AES-256-GCM encrypted per value. Ciphertext can't be indexed, so each has a deterministic HMAC-SHA256 column carrying the unique index — that's what dedupe matches on. See `lib/crypto.js`.
- **Dealer consent.** A dealer export applies `consent_dealer=1` in the SQL, not in the UI, so un-consented records cannot leak through a crafted request. Every export is written to `export_log` with actor, filters and row count.
- **Step 1 saved separately.** Step 1 POSTs with `partial: true`; an abandon at Step 2 still leaves the lead. Partial records can't be invited and get no confirmation message.
- **Lead score.** Computed on write from Step 2 answers, weights in `lib/score.js` (intent heaviest, per the brief). Edit the weights, then `node backend/rescore.js`.
- **Spike safety.** The write path is one upsert and returns; email and SMS go to `comms_queue` and a worker drains it. No provider API call ever blocks a registrant's request.

## Accounts and roles

Two roles, per Section 7 of the brief:

| | admin | viewer |
|---|---|---|
| Dashboards, tiles, charts | yes | yes |
| Registration table | yes | yes, **without mobile or email** |
| Comms queue | yes | recipients hidden |
| Invite / CSV export / dealer mapping / rescore | yes | blocked (403) |

Create a read-only XPENG account:

```bash
curl -b cookies.txt -X POST http://localhost:3000/api/admin/users   -H "Content-Type: application/json"   -d '{"username":"xpeng.viewer","password":"at-least-10-chars","role":"viewer","name":"XPENG (read-only)"}'
```

Security properties worth knowing:

- Passwords are **scrypt** hashes with a per-user salt (`node:crypto`, no bcrypt dependency). Minimum 10 characters on creation.
- Sessions last 8 hours server-side. Only a SHA-256 of the token is stored, so a database dump can't be replayed as a live login.
- The cookie is `HttpOnly` + `SameSite=Strict`, which is also the CSRF defence — no cross-site page can act as an admin. Set `COOKIE_SECURE=true` behind HTTPS.
- **Brute force:** 8 failed attempts per username+IP triggers a 15-minute lockout, keyed so an attacker can't lock a real admin out from a different address. Login failures are logged to the console.
- Failed logins hash a decoy password, so response timing doesn't reveal which usernames exist.
- Changing a password invalidates every session for that user.

## Going to MySQL for staging

```bash
mysql -u root -p -e "CREATE DATABASE xpeng_future_night CHARACTER SET utf8mb4"
mysql -u root -p xpeng_future_night < backend/schema.mysql.sql
npm install mysql2 --prefix backend
```

Then in `backend/.env`: `DB_DRIVER=mysql` plus `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME`. Same code path — the only per-driver SQL is the upsert, in `lib/db.js`. `schema.mysql.sql` and `schema.sqlite.sql` must be kept in step.

## Not built yet

- **OTP** on mobile numbers — needs the SMS provider decision. `otp_verified` exists on the table, always 0.
- **Real email/SMS sending.** `COMMS_DRY_RUN=true` writes what would have been sent to `backend/data/outbox.log`, so the pipeline is observable end to end. Swap in the provider inside `startCommsWorker` in `server.js`.
- **SM Tickets integration** — blocked on their claim mechanics. `POST /api/dev/claim` is the placeholder; expect either a daily CSV import or a callback.
- **Game-pass QR.** Per brief steps 4 and 6, the invitation code doubles as the foyer play-zone game pass, so the QR belongs in the **invitation** email/SMS (and repeated in the T-1 day reminder) — not on the registration success screen, where it would reach the ~17,000 registrants who never get in. A placeholder QR was removed from that screen for exactly this reason. Still to build: render the code as a QR server-side (email clients can't run a JS encoder), a `/pass/<token>` fallback page for guests who lose the email, and a scan/redeem endpoint that logs redemptions and blocks replays. **Open question for the event team:** whether the play zone scans our code or simply re-scans the SM ticket barcode — if the latter, this item disappears. Also confirm whether the foyer sits inside the ticketed perimeter; if it is open to the mall, non-invited registrants could reach the play zone and the pass would have to go to everyone.
- **`/privacy` and `/terms` pages.**

## Local files

`backend/data/` holds the SQLite database and `outbox.log`. Both are git-ignored and safe to delete — the schema rebuilds on next start.
