# XPENG FUTURE NIGHT — registration landing page

Static, mobile-first landing page for the Physical AI Open House at MOA Arena,
built to the `XPENG_Landing_Design_IT` brief.

## Files

| File | Purpose |
|---|---|
| `index.html` | The page: nav, hero + countdown, waitlist card, event, how-it-works, experience + artist module, FAQ, footer |
| `styles.css` | All styling. Base rules are the phone layout; desktop layers in at `min-width:1020px` |
| `app.js` | Form flow, validation, UTM capture, submit queue, tracking events, share, countdown, artist swap |
| `config.js` | Campaign copy and switches — edit without touching code |
| `geo.js` | Province → City/Municipality dropdown data + current-vehicle brand list |

Open `index.html` directly in a browser to review; no build step.

## Things you flip from `config.js` (no redeploy)

- `artist.revealed = true` + fill `artist.acts` → hero/experience silhouette module swaps to the real names.
- `counter.show` / `counter.total` → the "N already on the waitlist" line.
- `confirmation.mode = "closed"` → post-submit copy switches to the X Space priority message after invitations close.
- `event.dateISO` drives the countdown; `api.submit` points the form at the backend.

Ticket status is hard-coded to SOLD OUT / **WAITLIST OPEN**. There is no purchase path anywhere on the page.

## Form behaviour

- **Step 1** (name, mobile, email, province, city) POSTs immediately with `partial: true`, so an abandon at Step 2 still leaves the lead. The full record is re-POSTed on final submit with `partial: false` — dedupe server-side on email + mobile and silently update, never error.
- **Step 2** requires all seven profile answers plus the privacy consent. Dealer-sharing and marketing consents are separate checkboxes with a timestamp; records without the dealer tick must never appear in a dealer export.
- Mobile is normalised to `09XXXXXXXXX` (accepts `+63`/spaces) client-side. **OTP is not implemented** — it needs the SMS provider and a server endpoint.
- Failed submissions retry with exponential backoff (6 attempts) while the tab is open, and the guest sees the confirmation immediately. This is deliberately **in-memory only**: the brief forbids personal data in client-side storage, so a closed tab mid-outage loses the retry. If you need survival across tab close, the fix is server-side queueing behind a queue/worker, not `localStorage`.

## Backend to build (not in this repo)

`POST /api/waitlist` accepting the payload in `app.js → payload()`, returning `{ "sequence": <number> }`. Plus: OTP send/verify, admin dashboard, invitation batch send with single-use codes, SM Tickets claim reconciliation, dealer territory mapping and exports, `/privacy` and `/terms` pages.

## Before go-live

- Paste the Meta Pixel, TikTok Pixel and Google Tag snippets into the marked block in `<head>`. Events already fire: `PageView`, `StartForm`, `CompleteRegistration`, `Share` — add `ClaimClick` on the SM Tickets link in the invitation email.
- Replace `/og.jpg` with the approved key art (1200×630) and drop in the hero key art; the current hero is a CSS-generated arena-glow treatment, no image weight.
- Fonts load from Google Fonts. Self-host them if you want to guarantee the sub-2s mobile 4G target during the paid boost.
- `geo.js` carries every region and all dealer-relevant cities; swap it for the full PSGC table once dealer territories are mapped.
