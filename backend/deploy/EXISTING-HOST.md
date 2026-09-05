# Deploy to xpeng.heineraboka.site

The Node server serves the campaign, assets, legal pages, API, and admin
dashboard together. Netlify is not required for this deployment. Keep its
published deploy locked if that copy must remain unchanged.

## Existing host update

1. Identify the running app directory, service/process manager, reverse proxy,
   and Node version. The repository's `/srv/xpeng` and systemd service are
   examples, not verified details of the live host.
2. Back up the current application and database, and retain its `backend/.env`
   and `APP_KEY`. The upload package excludes credentials, databases, logs,
   `.git`, and dependencies. Extract over the confirmed app directory without
   deleting these existing files. Do not run the seed or migration scripts.
3. In the host's existing environment, set:

   ```ini
   PUBLIC_SITE_URL=https://xpeng.heineraboka.site
   SITE_OFFLINE=false
   COOKIE_SECURE=true
   ```

   Preserve database, encryption, provider, and other existing settings.
   An existing PUBLIC_SITE_URL overrides the updated code default.
4. The domain should proxy to the running Node application. A standalone Caddy
   site block is provided as `xpeng.heineraboka.site.Caddyfile` if the host uses
   Caddy. Merge it with the existing configuration only if necessary; validate
   before reloading. On another proxy, use its equivalent host configuration.
5. Restart the existing application using its actual process manager. If its
   dependency installation is missing, install from `backend/package-lock.json`
   with `npm ci --omit=dev` in `backend/` first. Node must meet package.json's
   engine requirement.
6. Verify `/`, `/styles.css`, `/app.js`, `/image/x9/x9-360.webp`, `/privacy`,
   `/terms`, `/api/waitlist/count`, and `/admin/login`. Confirm the current X9
   viewer and partner banner display and browser API requests use this domain.
   Do not submit a real registration merely to test deployment: it can queue
   email and SMS.

The public host returned HTTP 503 during preparation on September 6, 2026.
Check service logs and the active maintenance configuration before release;
the HTTP response alone does not establish the cause.

For rollback, restore the prior application files and environment settings,
then restart the same service. This release does not require a schema change.
