# Batch email sending

## Deploy

The invitation-batch and ticket-inventory migrations from earlier releases
must already be installed. Pull the release, then run as database admin:

```bash
sudo mysql xpeng_future_night < backend/migrations/2026-09-19-batch-email.sql
pm2 restart xpeng-fn
```

SQLite creates the tables on restart. No Netlify update is needed.
Existing SMTP settings are reused. The panel shows From and Reply-To;
verify they are the approved addresses and that replies reach a monitored
inbox. The panel blocks sending when SMTP is absent or COMMS_DRY_RUN is on.
Changing COMMS_DRY_RUN also affects the existing confirmation/SMS worker,
so inspect those queues before changing that setting on production.

## Use

Open a saved batch in Invitations. Enter an internal test recipient and
click Send test email. This sends a real email to that address, using a
non-redeemable TEST-NOT-VALID code. No guest status is changed by a test.
Review the email in the inbox, including sender, Reply-To, wording and
SM Tickets outlet instructions. The current copy has no claim deadline;
confirm those instructions with the event team before approving a batch.

Tick the review checkbox and choose Send unsent invitations. Type SEND
in the confirmation dialog to queue the real guest emails. A successful
test by the same administrator must match the current recipient list,
template, sender and reply address. Changes require another test.

Saving or reopening a batch never queues mail. Sending creates encrypted
recipient/content snapshots in a separate batch email queue; no SMS is
queued. A unique invitation constraint prevents duplicate queue entries.
The worker claims messages conditionally so overlapping workers cannot
normally process the same item. It never auto-replays SENDING records.

Progress refreshes while the Invitations tab is active. SENT means SMTP
provider acceptance, not confirmed inbox delivery, opening or attendance.
Only provider acceptance updates the invitation to SENT and registration
to INVITED. The official ticket code is reused; no expiry is invented.

FAILED means SMTP explicitly rejected the attempt. Retry rejected emails
requires a separate RETRY confirmation, and only retries FAILED records.
Timeouts/uncertain outcomes become REVIEW. An interrupted process may
leave SENDING. Check provider logs before manually reconciling these;
there is intentionally no automatic replay or resend button for them.
Exactly-once inbox delivery cannot be guaranteed by SMTP.

The legacy Invite selected action skips every saved-batch recipient,
including already sent ones, to prevent use of its old SMS/72-hour flow.
Automatic inbox reading, attendance confirmation, delivery webhooks and
SM Tickets claim reconciliation are not implemented by this release.

## Tests

```bash
node --test backend/test/batch-email.test.js backend/test/batches.test.js backend/test/ticket-codes.test.js
```

Tests use temporary synthetic databases and a fake email transport. They
do not read production credentials or send real email. Live SMTP, MySQL
migration and browser behavior need deployment verification before a
guest batch is sent.
