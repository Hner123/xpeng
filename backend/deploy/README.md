# Deploying the Future Night backend

Target: Linux server, Caddy for TLS, MySQL 8, front-end on Netlify.
Repo: https://github.com/Hner123/xpeng

Run these on the server as a sudo-capable user. Replace `api.futurenight.xpeng.ph` with your real subdomain throughout.

Files here: [xpeng-future-night.service](xpeng-future-night.service) (systemd) · [Caddyfile](Caddyfile)

---

## 0. Check Node first

```bash
node -v
```

**Must be 22.5 or newer.** Below that `node:sqlite` doesn't exist and the app won't boot. If it's older or missing:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

## 1. Service user and code

```bash
sudo useradd --system --home /srv/xpeng --shell /usr/sbin/nologin xpeng
sudo mkdir -p /srv/xpeng
sudo chown xpeng:xpeng /srv/xpeng

sudo -u xpeng git clone https://github.com/Hner123/xpeng.git /srv/xpeng
cd /srv/xpeng
sudo -u xpeng npm install mysql2 --prefix backend --omit=dev
```

`mysql2` is the only package needed — everything else is Node built-ins.

## 2. MySQL

```bash
sudo mysql -e "CREATE DATABASE xpeng_future_night CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'xpeng'@'localhost' IDENTIFIED BY 'PUT-A-LONG-RANDOM-PASSWORD-HERE';"
sudo mysql -e "GRANT SELECT,INSERT,UPDATE,DELETE ON xpeng_future_night.* TO 'xpeng'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"

sudo mysql xpeng_future_night < /srv/xpeng/backend/schema.mysql.sql
```

The grant deliberately excludes `DROP` and `ALTER` — the app never changes schema at runtime, so schema changes stay a deliberate manual step.

## 3. Environment

```bash
sudo -u xpeng cp /srv/xpeng/backend/.env.example /srv/xpeng/backend/.env
sudo -u xpeng nano /srv/xpeng/backend/.env
```

```ini
PORT=3000

DB_DRIVER=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=xpeng
DB_PASSWORD=the-password-from-step-2
DB_NAME=xpeng_future_night
DB_POOL=10

# 64 hex chars — generate with: openssl rand -hex 32
# BACK THIS UP ELSEWHERE. Lose it and every encrypted column
# (names, mobiles, emails) is unrecoverable.
APP_KEY=

# First admin account, seeded on first boot only.
ADMIN_USER=heiner
ADMIN_PASS=a-long-password-you-choose
ADMIN_NAME=Campaign admin

# Behind Caddy the site is HTTPS, so lock the session cookie to it.
COOKIE_SECURE=true

# Netlify origin(s) allowed to POST the form. Exact, no trailing
# slash, comma-separated. Leave empty if the page is served from
# this same server.
ALLOWED_ORIGINS=https://futurenight.netlify.app

COMMS_DRY_RUN=true
RATE_LIMIT=30
```

```bash
sudo chmod 600 /srv/xpeng/backend/.env
sudo chown xpeng:xpeng /srv/xpeng/backend/.env
sudo -u xpeng mkdir -p /srv/xpeng/backend/data
```

## 4. Run it as a service

```bash
sudo cp /srv/xpeng/backend/deploy/xpeng-future-night.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now xpeng-future-night
sudo systemctl status xpeng-future-night --no-pager
journalctl -u xpeng-future-night -n 30 --no-pager
```

You should see the startup banner with `database mysql`. If it won't start, check `which node` matches `ExecStart` in the unit file — nvm installs live outside `/usr/bin`.

## 5. Caddy

Point the DNS A record for `api.futurenight.xpeng.ph` at this server **before** reloading Caddy — it must answer an ACME challenge to get the certificate.

```bash
sudo cp /srv/xpeng/backend/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile          # set your real domain
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Make sure the app is only reachable through Caddy:

```bash
sudo ufw allow 80,443/tcp
sudo ufw deny 3000/tcp
```

## 6. Point the Netlify page at the API

In `config.js`:

```js
api: {
  base:   "https://api.futurenight.xpeng.ph",
  submit: "/api/waitlist",
  count:  "/api/waitlist/count"
},
```

Netlify serves the repo root; `backend/` is excluded via `netlify.toml`. Redeploy after the change.

## 7. Verify end to end

```bash
# API alive
curl -s https://api.futurenight.xpeng.ph/api/waitlist/count

# CORS preflight from the Netlify origin — expect 204 and the echoed header
curl -s -i -X OPTIONS https://api.futurenight.xpeng.ph/api/waitlist \
  -H "Origin: https://futurenight.netlify.app" \
  -H "Access-Control-Request-Method: POST" | grep -i "HTTP/\|access-control-allow-origin"

# A rejected origin — expect 403, no allow-origin header
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS https://api.futurenight.xpeng.ph/api/waitlist \
  -H "Origin: https://evil.example" -H "Access-Control-Request-Method: POST"
```

Then in a browser: submit the real form on the Netlify page and confirm the row appears at `https://api.futurenight.xpeng.ph/admin`.

## 8. Backups — before traffic, not after

The database holds up to 20,000 people's personal data under the PH Data Privacy Act.

```bash
sudo tee /etc/cron.daily/xpeng-backup >/dev/null <<'SH'
#!/bin/sh
set -e
d=$(date +%F)
mysqldump --single-transaction --quick xpeng_future_night \
  | gzip > /var/backups/xpeng-$d.sql.gz
find /var/backups -name 'xpeng-*.sql.gz' -mtime +30 -delete
SH
sudo chmod +x /etc/cron.daily/xpeng-backup
```

Give the job read credentials via `/root/.my.cnf`, and copy dumps off the box (S3, B2, another host). **A backup that only exists on the server being backed up is not a backup.**

Back up `backend/.env` separately and once — the dumps are useless without `APP_KEY`.

## 9. Updating after a code change

```bash
cd /srv/xpeng
sudo -u xpeng git pull
sudo systemctl restart xpeng-future-night
journalctl -u xpeng-future-night -n 20 --no-pager
```

Restart is near-instant but drops in-flight requests — don't deploy during the boost peaks (artist reveal, forum livestream).

---

## Still to do before go-live

- `COMMS_DRY_RUN=true` means **nothing is actually emailed or texted** — it logs to `backend/data/outbox.log`. Wire real providers in `startCommsWorker` (server.js).
- Real Meta / TikTok / Google pixel IDs in `index.html`.
- `/privacy` and `/terms` pages.
- OTP on mobile numbers.
- SM Tickets claim integration.
- Read-only viewer account for XPENG: `POST /api/admin/users` with `role: "viewer"`.
