# Attendance confirmation

Deploy the backend migration before restarting:

```bash
cd ~/xpeng
git pull --ff-only
sudo mysql xpeng_future_night < backend/migrations/2026-09-20-attendance.sql
pm2 restart xpeng-fn
```

Publish a new Netlify build as well. Git-triggered builds are currently paused by `build.ignore` in netlify.toml; use the existing manual build-hook workflow or resume builds. The deploy must include confirm.html, confirm.js and the /api/attendance 200 proxy. Verify a test invitation opens the preview page on the public Netlify domain before sending new batches.

Newly queued invitations include a signed, invitation-specific confirmation link. The signature uses APP_KEY with a dedicated attendance prefix. A GET only opens the page; the guest must press Confirm my attendance to POST. Test and unsaved previews have a disabled preview link. Only SMTP-accepted batch invitations with SENT or CLAIMED ticket status can confirm. Repeated confirmations retain the original UTC timestamp. No name, email or ticket code is included in the URL; the token stays in the fragment until submitted.

Attendance is stored separately from email, registration and ticket status. The batch table polls existing email progress and shows attendance, with the UTC timestamp in the confirmation tooltip and an attendance filter. Confirmation does not claim an SM ticket.

Existing queued email snapshots and already sent messages are unchanged. They will not gain the link retroactively. No messages are sent by this deployment. A new test is required for newly queued emails because the template fingerprint changes. Reply-to-CONFIRM automation is still not connected.

Validation: synthetic SQLite tests with fake SMTP cover invalid/tampered tokens, unsent and test invitations, successful confirmation, idempotent repeat taps, dashboard state and unchanged ticket claim status. No live emails sent. MySQL migration and Netlify deployment must be applied on their respective hosts.
