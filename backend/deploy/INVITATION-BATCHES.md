# Saved invitation batches

This release saves draft batches and reserves official codes. It does not
queue messages, mark registrations INVITED, or connect an inbox.

## Deploy

Pull the release on the backend server. SQLite creates the new tables on
restart. For MySQL, have a database administrator run the additive migration
against the existing application database before restarting:

```bash
mysql -u YOUR_DB_ADMIN -p YOUR_DATABASE < backend/migrations/2026-09-19-invitation-batches.sql
```

The migration creates two tables; it does not replace registrations or
existing invitations. The restricted application account need not get DDL
permissions. Restart the backend with `pm2 restart xpeng-fn`, then refresh
the dashboard. No Netlify deployment is needed for this dashboard change.

## Use

In Invitations, upload the assigned-code CSV, validate, then click Save batch.
Choose the batch from Saved batches after reloading the page to reopen it.
Saving revalidates current registrations and existing codes. The entire save
rolls back on conflict, and repeating the same import returns the saved batch.
Codes are stored in invitations with status ISSUED and no send/expiry dates.
Guest registrations remain REGISTERED. The legacy Invite selected operation
skips these reserved drafts; use the future batch sending workflow instead.

Batch rows reference existing encrypted registrations rather than storing
another plaintext contact list. Deleting a registration also removes its
invitation and batch membership; the batch header remains for traceability.
Saved previews display the current contact information and template text.
Reply tracking and message delivery are not part of this release.

## Verification

`node --test backend/test/batches.test.js` uses a temporary synthetic SQLite
database and checks persistence, retry safety, conflicts/rollback, code
reservation, deletion, and absence of queued messages. It does not access
the production database or contact any messaging provider.

## Create and populate batches in the dashboard

Use Create a batch to save an empty named batch (for example Batch 2). Select it, then use Add guests to this batch to search by name, email or registration ID. Search shows up to 100 eligible registrations; refine the search to find others. Select guests and their ticket type, then Add selected guests. Available inventory codes are assigned atomically. Registrations with existing invitations are excluded. Conflicting assignments roll back the entire addition; refresh and retry. No messages are queued or sent by these actions.

New guests change the email approval fingerprint, so send and review a new test before sending unsent invitations. Existing queued email snapshots and assignments remain unchanged. No additional schema migration is needed for manual batch creation.
