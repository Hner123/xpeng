# Ticket code inventory

Pull the release. On MySQL, run the additive migration as a database
administrator (after the invitation-batches migration from the previous
release), then restart the backend:

```bash
sudo mysql xpeng_future_night < backend/migrations/2026-09-19-ticket-codes.sql
pm2 restart xpeng-fn
```

SQLite creates the new table on restart. No Netlify update is required.

In the admin dashboard, open Ticket codes. Import a CSV with headers
`ticket_code,ticket_type`; types must be VIP or General Public. Importing
identical codes/types again is safe. Conflicting types or duplicate rows
reject the whole import. Raw ticket-code files must not be committed.

Inventory status is joined from current invitation records. ISSUED is
displayed as Reserved, SENT as Sent, CLAIMED as Claimed, and EXPIRED as
Expired; no invitation means Available. Saved batch names and guest names
are displayed without copying contact data into the inventory. No send or
claim action is provided by this tab. Sent is an invitation-record status,
not a verified delivery receipt, and no automatic SM Tickets claim feed
is connected. Existing registration deletion removes its invitation, so
an associated inventory code will become Available again; do not delete
real invited guests as a way to cancel or decline attendance.

After any inventory codes are imported, batch validation requires imported
codes with matching ticket types. Previously saved batches are matched by
code when inventory is imported; incompatible ticket types are rejected.

Tests: `node --test backend/test/batches.test.js backend/test/ticket-codes.test.js`.
These use synthetic SQLite data only; production MySQL and the browser
layout must be checked after deployment.
